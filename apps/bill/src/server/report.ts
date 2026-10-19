/**
 * 账单报表层：总览（summary）、趋势（trend）。
 *
 * 替代 cash-platform/server/src/index.js 里 /api/summary 与 /api/trend 的统计逻辑。
 * 响应结构与旧接口逐字段对齐（安卓端与旧 Web 直接复用，不做前端改动）。
 *
 * ⚠ 时区：`occurredAt` 存的是 UTC 墙钟（迁移旧账单库时的既定约定），
 *   所有「按本地日期」的分组/区间都必须先 +8 小时，否则跨零点的账单会被算到前一天。
 *   本文件里统一用 LOCAL_DAY / LOCAL_TS 两个片段，不要另写。
 */
import { prisma } from "@nas/db";
import { centsToYuan } from "./money";
import { formatDate, monthBounds, todayString } from "./dates";
import type { Actor } from "./book";
import { bookById, bookParticipants, canSeeBook } from "./book";
import { listAccountsWithBalance, presentAccount } from "./account";
import {
  bookScope,
  computeAa,
  daysBetween,
  eachDay,
  eachMonth,
  parseLocalDate,
  resolveBounds,
  type AaBillRow,
  type TxQuery,
} from "./query";

/** 本地时间戳（墙钟 + 8h），用于分组与日期区间比较 */
const LOCAL_TS = `(t."occurredAt" + INTERVAL '8 hours')`;
/** 本地日期 */
const LOCAL_DAY = `${LOCAL_TS}::date`;

/** 把 ? 占位符按顺序换成 $1..$n；fragments 之间用 AND 连接 */
function build(fragments: string[], params: unknown[]): { text: string; params: unknown[] } {
  let i = 0;
  const text = fragments.join(" AND ").replace(/\?/g, () => `$${++i}`);
  return { text, params };
}

// ================================================================ 总览
export async function billSummary(actor: Actor, query: TxQuery) {
  const now = new Date();
  const year = Number(query.year) || now.getFullYear();
  const month = Number(query.month) || now.getMonth() + 1;
  const { start, end } = resolveBounds(query, now);
  const scope = await bookScope(actor, query);

  // 整个可见范围内最早/最晚一笔的**本地**日期，前端选「全部」时拿它当区间
  const bounds = build([scope.sql], [...scope.params]);
  const boundRows = await prisma.$queryRawUnsafe<
    Array<{ first: string | null; last: string | null }>
  >(
    `SELECT to_char(MIN(${LOCAL_TS}), 'YYYY-MM-DD') AS first,
            to_char(MAX(${LOCAL_TS}), 'YYYY-MM-DD') AS last
     FROM bill_transaction t WHERE ${bounds.text}`,
    ...bounds.params,
  );
  const firstDate = boundRows[0]?.first ?? null;
  const lastDate = boundRows[0]?.last ?? null;

  // 区间内收支合计（转账是资金搬家，不计入）
  const range = build(
    [scope.sql, `${LOCAL_DAY} >= ?::date`, `${LOCAL_DAY} <= ?::date`],
    [...scope.params, start, end],
  );
  const totalRows = await prisma.$queryRawUnsafe<
    Array<{ income: bigint | null; expense: bigint | null }>
  >(
    `SELECT COALESCE(SUM(CASE WHEN t.type = 'INCOME' AND t."countExpense" THEN t."amountCents" END), 0) AS income,
            COALESCE(SUM(CASE WHEN t.type = 'EXPENSE' AND t."countExpense" THEN t."amountCents" END), 0) AS expense
     FROM bill_transaction t WHERE ${range.text}`,
    ...range.params,
  );
  const income = Number(totalRows[0]?.income ?? 0);
  const expense = Number(totalRows[0]?.expense ?? 0);

  // 同名分类可能有多个 id（历史归档留下的），按名称聚合并收集全部 id，点饼图时一起筛
  const categoryRows = await prisma.$queryRawUnsafe<
    Array<{ kind: string; category_name: string; category_ids: string | null; amount_cents: bigint }>
  >(
    `SELECT LOWER(t.type::text) AS kind,
            COALESCE(p.name, c.name, t."categoryLabel", '未分类') AS category_name,
            string_agg(DISTINCT COALESCE(p.id, c.id)::text, ',') AS category_ids,
            SUM(ABS(t."amountCents")) AS amount_cents
     FROM bill_transaction t
     LEFT JOIN bill_category c ON c.id = t."categoryId"
     LEFT JOIN bill_category p ON p.id = c."parentId"
     WHERE ${range.text} AND t.type IN ('EXPENSE', 'INCOME') AND t."countExpense"
     GROUP BY LOWER(t.type::text), category_name
     ORDER BY kind, amount_cents DESC`,
    ...range.params,
  );

  const shape = (kind: string) =>
    categoryRows
      .filter((row) => row.kind === kind)
      .map((row) => ({
        name: row.category_name,
        ids: row.category_ids ? row.category_ids.split(",").map(Number) : [],
        amount: centsToYuan(Number(row.amount_cents)),
      }));

  // 人员汇总 + AA：逐笔取出来，AA 要用每笔自己的分摊人算账
  const billRows = await prisma.$queryRawUnsafe<
    Array<{ kind: string; member_name: string; amount_cents: bigint; share_with: unknown }>
  >(
    `SELECT LOWER(t.type::text) AS kind,
            COALESCE(NULLIF(TRIM(t."memberName"), ''), '未填') AS member_name,
            t."amountCents" AS amount_cents,
            t."shareWith" AS share_with
     FROM bill_transaction t
     WHERE ${range.text} AND t.type IN ('EXPENSE', 'INCOME') AND t."countExpense"`,
    ...range.params,
  );

  const shapeMembers = (kind: string) => {
    const sums = new Map<string, number>();
    for (const row of billRows) {
      if (row.kind !== kind) continue;
      sums.set(row.member_name, (sums.get(row.member_name) || 0) + Math.abs(Number(row.amount_cents) || 0));
    }
    return [...sums.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({ name, amount: centsToYuan(amount) }));
  };

  // AA 平摊：账本没开 AA 就不算，只当大家一起记账
  const askedBookId = Number(query.bookId) || 0;
  const askedBook = askedBookId ? await canSeeBook(actor, askedBookId) : null;
  const presetNames = askedBook ? (await bookParticipants(askedBook.id)).map((p) => p.name) : [];
  const aa =
    askedBook && !askedBook.aaEnabled
      ? null
      : computeAa(billRows as unknown as AaBillRow[], presetNames);

  const accountRows = (await listAccountsWithBalance(actor.id)).filter((row) => !row.archived);

  return {
    year,
    month,
    start,
    end,
    firstDate,
    lastDate,
    income: centsToYuan(income),
    expense: centsToYuan(expense),
    net: centsToYuan(income - expense),
    categories: shape("expense"),
    incomeCategories: shape("income"),
    members: shapeMembers("expense"),
    incomeMembers: shapeMembers("income"),
    aa,
    accounts: accountRows.map(presentAccount),
  };
}

// ================================================================ 趋势
export async function billTrend(actor: Actor, query: TxQuery) {
  const now = new Date();
  const range = ["month", "3m", "year", "all"].includes(String(query.range || ""))
    ? String(query.range)
    : "month";
  const scope = await bookScope(actor, query);

  let from: string;
  let to: string;

  if (query.from && query.to) {
    // 前端已算好区间（总览页的时间范围），直接用
    from = String(query.from).slice(0, 10);
    to = String(query.to).slice(0, 10);
  } else if (range === "month") {
    const bounds = monthBounds(
      Number(query.year) || now.getFullYear(),
      Number(query.month) || now.getMonth() + 1,
    );
    from = bounds.start;
    to = bounds.end;
  } else if (range === "3m") {
    from = formatDate(new Date(now.getFullYear(), now.getMonth() - 2, 1));
    to = todayString();
  } else {
    let start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    if (range === "all") {
      const scopeOnly = build([scope.sql], [...scope.params]);
      const rows = await prisma.$queryRawUnsafe<Array<{ first: string | null }>>(
        `SELECT to_char(MIN(${LOCAL_TS}), 'YYYY-MM-DD') AS first
         FROM bill_transaction t
         WHERE ${scopeOnly.text} AND t.type IN ('EXPENSE', 'INCOME')`,
        ...scopeOnly.params,
      );
      const first = rows[0]?.first;
      if (first) start = new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1);
    }
    from = formatDate(start);
    to = formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }

  // 跨度超过 3 个月就按月聚合，否则按天
  const unit = daysBetween(from, to) > 92 ? "month" : "day";
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  const keys = unit === "month" ? eachMonth(start, end) : eachDay(start, end);

  const w = build(
    [scope.sql, `${LOCAL_DAY} >= ?::date`, `${LOCAL_DAY} <= ?::date`],
    [...scope.params, from, to],
  );
  const bucket =
    unit === "month"
      ? `to_char(${LOCAL_TS}, 'YYYY-MM')`
      : `to_char(${LOCAL_TS}, 'YYYY-MM-DD')`;
  const rows = await prisma.$queryRawUnsafe<
    Array<{ bucket: string; expense: bigint | null; income: bigint | null }>
  >(
    `SELECT ${bucket} AS bucket,
            COALESCE(SUM(CASE WHEN t.type = 'EXPENSE' AND t."countExpense" THEN t."amountCents" END), 0) AS expense,
            COALESCE(SUM(CASE WHEN t.type = 'INCOME' AND t."countExpense" THEN t."amountCents" END), 0) AS income
     FROM bill_transaction t
     WHERE ${w.text}
     GROUP BY bucket`,
    ...w.params,
  );

  const byKey = new Map(rows.map((row) => [row.bucket, row]));
  const spansYears = unit === "month" && keys.length > 0 && keys[0].slice(0, 4) !== keys[keys.length - 1].slice(0, 4);
  const points = keys.map((key) => {
    const row = byKey.get(key);
    const label =
      unit === "month"
        ? spansYears
          ? `${key.slice(2, 4)}/${Number(key.slice(5))}`
          : `${Number(key.slice(5))}月`
        : String(Number(key.slice(8)));
    return {
      key,
      label,
      expense: centsToYuan(Number(row?.expense ?? 0)),
      income: centsToYuan(Number(row?.income ?? 0)),
    };
  });

  return { range, unit, from, to, points };
}

/** 供上层（门户聚合看板）使用的快捷查询：某月的收支合计 */
export async function monthTotals(actor: Actor, year: number, month: number) {
  const scope = await bookScope(actor, {});
  const bounds = monthBounds(year, month);
  const w = build(
    [scope.sql, `${LOCAL_DAY} >= ?::date`, `${LOCAL_DAY} <= ?::date`],
    [...scope.params, bounds.start, bounds.end],
  );
  const rows = await prisma.$queryRawUnsafe<
    Array<{ income: bigint | null; expense: bigint | null; n: bigint }>
  >(
    `SELECT COALESCE(SUM(CASE WHEN t.type = 'INCOME' AND t."countExpense" THEN t."amountCents" END), 0) AS income,
            COALESCE(SUM(CASE WHEN t.type = 'EXPENSE' AND t."countExpense" THEN t."amountCents" END), 0) AS expense,
            COUNT(*) AS n
     FROM bill_transaction t WHERE ${w.text}`,
    ...w.params,
  );
  return {
    year,
    month,
    incomeCents: Number(rows[0]?.income ?? 0),
    expenseCents: Number(rows[0]?.expense ?? 0),
    count: Number(rows[0]?.n ?? 0),
  };
}

/** 保留导出：账本详情（summary 里 AA 需要账本信息，门户也会用） */
export { bookById };
