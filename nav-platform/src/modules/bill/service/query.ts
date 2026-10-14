/**
 * 账单查询与统计层。
 *
 * 替代 cash-platform/server/src/reports.js：按条件筛选账单、统计、AA 平摊、账本作用域、时间区间。
 *
 * ⚠ 时区要点：occurredAt 列是 timestamp（无时区）**存 UTC 墙钟**
 *   （本地 21:23:27 → 库里 13:23:27，见 docs/账单迁移报告.md）。
 *   所以凡是「按用户看到的本地日期」做比较的地方，都必须先 +8 小时：
 *       (t."occurredAt" + INTERVAL '8 hours')::date
 *   漏掉这个偏移，跨零点的账单会被算到前一天。
 */
import { prisma } from "@/lib/prisma";
import type { BillCategoryKind, BillTxType } from "@prisma/client";
import { BillError } from "./errors";
import { centsToYuan, yuanToCents } from "./money";
import { formatDate, monthBounds, pad } from "./dates";
import type { Actor } from "./book";
import { canSeeBook, transactionImages, visibleBookIds } from "./book";
import { parseShareWith, presentTransaction, type TransactionRow } from "./transaction";

/** 本地时区相对 UTC 的偏移；库里的墙钟时间要加回这个量才是本地时间 */
const TZ_SHIFT = `INTERVAL '8 hours'`;

/** 把 t."occurredAt" 转成「用户看到的本地日期」 */
const LOCAL_DAY = `((t."occurredAt" + ${TZ_SHIFT})::date)`;

export interface TxQuery {
  bookId?: unknown;
  from?: unknown;
  to?: unknown;
  accountIds?: unknown;
  accountId?: unknown;
  type?: unknown;
  source?: unknown;
  memberName?: unknown;
  categoryIds?: unknown;
  categoryLabel?: unknown;
  minAmount?: unknown;
  maxAmount?: unknown;
  q?: unknown;
  sort?: unknown;
  year?: unknown;
  month?: unknown;
  /** 趋势图的区间口径：month / 3m / year / all */
  range?: unknown;
}

/** 账单可见范围：指定账本看这一个，没指定就看自己所有账本 */
export async function bookScope(actor: Actor, query: TxQuery) {
  const asked = Number(query.bookId) || 0;
  if (asked) {
    const book = await canSeeBook(actor, asked);
    if (!book) throw new BillError("账本不存在", 404);
    return { sql: `t."bookId" = ?`, params: [asked] as unknown[] };
  }
  const ids = await visibleBookIds(actor.id);
  if (!ids.length) return { sql: "false", params: [] as unknown[] };
  return {
    sql: `t."bookId" IN (${ids.map(() => "?").join(",")})`,
    params: ids as unknown[],
  };
}

/**
 * 选账户时把归并过的账户一起带上：旧账户本身没有账单，账单都挂在主账户上，
 * 所以选中任意一个都要展开成「主账户 + 它所有旧账户」。
 */
export async function expandAccountIds(ids: number[]): Promise<number[]> {
  if (!ids.length) return [];
  const rows = await prisma.billAccount.findMany({ select: { id: true, mergedInto: true } });
  const parentOf = new Map(rows.map((r) => [r.id, r.mergedInto ?? null]));
  const rootOf = (id: number): number => {
    let current = id;
    for (let i = 0; i < 20 && parentOf.get(current); i += 1) current = parentOf.get(current)!;
    return current;
  };
  const roots = new Set(ids.map(rootOf));
  const out = new Set(roots);
  for (const [child, parent] of parentOf) {
    if (parent && roots.has(rootOf(parent))) out.add(child);
  }
  return [...out];
}

/** 把「元」换成「分」，没填或填错了返回 null（不参与筛选） */
export function amountCentsFilter(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const cents = yuanToCents(text);
  return cents != null && Number.isFinite(cents) ? cents : null;
}

/** 允许的流水来源（与 BillTxSource 枚举一致，小写） */
const SOURCES = ["manual", "wechat", "alipay", "jd", "qianji", "recurring", "custom", "cmb"];

/** 拼出 WHERE 片段数组 + 参数数组（占位符用 ?，最后统一换成 $n） */
export async function buildWhere(actor: Actor, query: TxQuery) {
  const scope = await bookScope(actor, query);
  const where: string[] = [scope.sql];
  const params: unknown[] = [...scope.params];

  if (query.from) {
    where.push(`${LOCAL_DAY} >= ?::date`);
    params.push(String(query.from).slice(0, 10));
  }
  if (query.to) {
    where.push(`${LOCAL_DAY} < (?::date + INTERVAL '1 day')`);
    params.push(String(query.to).slice(0, 10));
  }

  // 账户筛选，支持多个 id。转账的转出/转入账户都要算进来
  const rawAccountIds = String(query.accountIds || query.accountId || "")
    .split(",")
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0);
  const accountIds = await expandAccountIds(rawAccountIds);
  if (accountIds.length) {
    const marks = accountIds.map(() => "?").join(",");
    where.push(`(t."accountId" IN (${marks}) OR t."toAccountId" IN (${marks}))`);
    params.push(...accountIds, ...accountIds);
  }

  const type = String(query.type || "");
  if (type === "expense" || type === "income" || type === "transfer") {
    // 必须 ::text 转型 —— PG 的枚举类型不能直接和 text 参数比较，会报 42883
    where.push(`t.type::text = ?`);
    params.push(type.toUpperCase());
  }

  const source = String(query.source || "");
  if (SOURCES.includes(source)) {
    where.push(`t.source::text = ?`);
    params.push(source.toUpperCase());
  }

  // 按成员（付款人/收款人）筛选，出游/家庭账本用；传 none 表示没填成员
  const memberName = String(query.memberName || "").trim();
  if (memberName) {
    if (memberName === "none") where.push(`(t."memberName" IS NULL OR TRIM(t."memberName") = '')`);
    else {
      // 汇总里是按 TRIM 后的名字聚合的，筛选也要 TRIM，否则带空格的旧数据点不开
      where.push(`TRIM(COALESCE(t."memberName", '')) = ?`);
      params.push(memberName);
    }
  }

  // 按分类筛选：命中二级分类时也算进来，支持多个 id；传 none/0 表示「未分类」
  const categoryParts = String(query.categoryIds || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const categoryIds = categoryParts.map(Number).filter((v) => Number.isInteger(v) && v > 0);
  const wantUncategorized = categoryParts.some((v) => v === "none" || v === "0");
  const categoryClauses: string[] = [];
  if (categoryIds.length) {
    const marks = categoryIds.map(() => "?").join(",");
    categoryClauses.push(`(c.id IN (${marks}) OR p.id IN (${marks}))`);
    params.push(...categoryIds, ...categoryIds);
  }
  if (wantUncategorized) categoryClauses.push(`(t."categoryId" IS NULL OR c.id IS NULL)`);
  if (categoryClauses.length) where.push(`(${categoryClauses.join(" OR ")})`);

  // 分类名：共享账本里手填的分类只存了文本（没有 categoryId），只能用名字匹配
  const categoryLabel = String(query.categoryLabel || "").trim();
  if (categoryLabel) {
    where.push(`(t."categoryLabel" = ? OR c.name = ? OR p.name = ?)`);
    params.push(categoryLabel, categoryLabel, categoryLabel);
  }

  const minCents = amountCentsFilter(query.minAmount);
  if (minCents !== null) {
    where.push(`t."amountCents" >= ?`);
    params.push(minCents);
  }
  const maxCents = amountCentsFilter(query.maxAmount);
  if (maxCents !== null) {
    where.push(`t."amountCents" <= ?`);
    params.push(maxCents);
  }

  // 关键词：空格分词，每个词都要命中（AND）。覆盖界面上能看见的所有字段
  const keyword = String(query.q || "").trim();
  if (keyword) {
    const words = keyword.split(/\s+/).filter(Boolean).slice(0, 6);
    for (const word of words) {
      const like = `%${word}%`;
      where.push(`(
        t.payee ILIKE ? OR t.note ILIKE ? OR c.name ILIKE ? OR p.name ILIKE ?
        OR a.name ILIKE ? OR b.name ILIKE ? OR t."memberName" ILIKE ? OR t."categoryLabel" ILIKE ?
        OR to_char(t."amountCents" / 100.0, 'FM9999999990.00') LIKE ?
        OR CASE t.type WHEN 'EXPENSE' THEN '支出' WHEN 'INCOME' THEN '收入' ELSE '转账' END LIKE ?
      )`);
      params.push(like, like, like, like, like, like, like, like, like, like);
    }
  }

  return { where, params };
}

/** 把 ? 占位符按出现顺序换成 $1..$n，并展开参数 */
function toPgSql(fragments: string[], params: unknown[]): { text: string; params: unknown[] } {
  let i = 0;
  const text = fragments.map((f) => f.replace(/\?/g, () => `$${++i}`)).join(" AND ");
  return { text, params };
}

/** 账单排序。默认按时间倒序；按金额排时同额再按时间倒序 */
export const TRANSACTION_SORTS: Record<string, string> = {
  amount_asc: `t."amountCents" ASC, t."occurredAt" DESC, t.id DESC`,
  amount_desc: `t."amountCents" DESC, t."occurredAt" DESC, t.id DESC`,
  amount_abs: `ABS(t."amountCents") DESC, t."occurredAt" DESC, t.id DESC`,
};

/** 带展示字段的流水查询骨架 */
const TX_SELECT = `
  SELECT t.*,
    c.name AS "categoryName",
    p.name AS "parentName",
    a.name AS "accountName",
    b.name AS "toAccountName"
  FROM bill_transaction t
  LEFT JOIN bill_category c ON c.id = t."categoryId"
  LEFT JOIN bill_category p ON p.id = c."parentId"
  LEFT JOIN bill_account a ON a.id = t."accountId"
  LEFT JOIN bill_account b ON b.id = t."toAccountId"
`;

/** 按条件取流水（分页）。limit 为 0/undefined 表示全量（导出用） */
export async function transactionRows(
  actor: Actor,
  query: TxQuery,
  limit = 0,
  offset = 0,
): Promise<TransactionRow[]> {
  const { where, params } = await buildWhere(actor, query);
  const order = TRANSACTION_SORTS[String(query.sort || "")] || `t."occurredAt" DESC, t.id DESC`;
  const { text } = toPgSql(where, params);
  const p = [...params];
  let sql = `${TX_SELECT} WHERE ${text} ORDER BY ${order}`;
  if (limit) {
    sql += ` LIMIT $${p.length + 1}`;
    p.push(limit);
    if (offset) {
      sql += ` OFFSET $${p.length + 1}`;
      p.push(offset);
    }
  }
  return prisma.$queryRawUnsafe<TransactionRow[]>(sql, ...p);
}

/** 按当前筛选条件统计笔数和金额。金额只算支出和收入，转账是资金搬家不计入 */
export async function transactionTotal(actor: Actor, query: TxQuery) {
  const { where, params } = await buildWhere(actor, query);
  const { text } = toPgSql(where, params);
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint; expense: bigint; income: bigint }>>(
    `SELECT COUNT(*) AS n,
       COALESCE(SUM(CASE WHEN t.type = 'EXPENSE' THEN t."amountCents" END), 0) AS expense,
       COALESCE(SUM(CASE WHEN t.type = 'INCOME' THEN t."amountCents" END), 0) AS income
     FROM bill_transaction t
     LEFT JOIN bill_category c ON c.id = t."categoryId"
     LEFT JOIN bill_category p ON p.id = c."parentId"
     LEFT JOIN bill_account a ON a.id = t."accountId"
     LEFT JOIN bill_account b ON b.id = t."toAccountId"
     WHERE ${text}`,
    ...params,
  );
  const row = rows[0];
  return {
    count: Number(row?.n ?? 0),
    expenseCents: Number(row?.expense ?? 0),
    incomeCents: Number(row?.income ?? 0),
  };
}

/** 按 id 批量取流水（带展示字段），保持传入顺序。仅用于「刚写完一笔再回读」 */
export async function transactionsByIds(actor: Actor, ids: number[]): Promise<TransactionRow[]> {
  const clean = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!clean.length) return [];
  const marks = clean.map((_, i) => `$${i + 1}`).join(",");
  const rows = await prisma.$queryRawUnsafe<TransactionRow[]>(
    `${TX_SELECT} WHERE t.id IN (${marks})`,
    ...clean,
  );
  const order = new Map(clean.map((id, index) => [id, index]));
  return rows
    .filter((row) => canSee(actor, row))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** 单笔能看见吗（与 getTransaction 同一口径，只是这里拿到的是已 join 的行） */
function canSee(actor: Actor, row: TransactionRow): boolean {
  if (actor.role === "ADMIN") return true;
  return row.ownerId === actor.id;
}

/** 刚写完一笔账单时的对外呈现：行 + 图片一起返回（旧 presentWithImages） */
export async function presentWithImages(actor: Actor, id: number) {
  const rows = await transactionsByIds(actor, [id]);
  if (!rows.length) throw new BillError("账单不存在", 404);
  const images = await transactionImages([rows[0].id]);
  return presentTransaction(rows[0], images.get(rows[0].id) || []);
}

/** 把金额（分）平均分成 count 份，余数一分一分补给前面的人，保证几份加起来正好等于总额 */
export function splitEvenly(cents: number, count: number): number[] {
  const base = Math.trunc(cents / count);
  let leftover = cents - base * count;
  return Array.from({ length: count }, () => {
    let extra = 0;
    if (leftover !== 0) {
      extra = leftover > 0 ? 1 : -1;
      leftover -= extra;
    }
    return base + extra;
  });
}

export interface AaBillRow {
  kind: string;
  member_name: string | null;
  amount_cents: number | bigint;
  share_with: unknown;
}

/**
 * AA 平摊。逐笔算：每笔按它自己勾选的分摊人平分，「打车这种每天坐车的人不一样」就靠这个。
 * 没设过分摊人的老账单退回「全员平分」，行为跟以前一样。
 */
export function computeAa(billRows: AaBillRow[], presetNames: string[] = []) {
  const paid = new Map<string, number>();
  const excluded = new Map<string, number>();
  const share = new Map<string, number>();
  const payerNames = new Set<string>();
  const sharerNames = new Set<string>();
  let legacyPool = 0;
  let aaPool = 0;
  let unassigned = 0;

  for (const row of billRows || []) {
    const amount = Number(row.amount_cents) || 0;
    if (!amount) continue;
    const signed = row.kind === "income" ? -amount : amount; // 收入当退款，抵掉垫付
    const payer = row.member_name && row.member_name !== "未填" ? row.member_name : null;
    if (payer) {
      payerNames.add(payer);
      paid.set(payer, (paid.get(payer) || 0) + signed);
    } else {
      unassigned += signed;
    }
    const picked = parseShareWith(row.share_with);
    if (picked === null) {
      legacyPool += signed;
      aaPool += signed;
      continue;
    }
    if (!picked.length) {
      if (payer) excluded.set(payer, (excluded.get(payer) || 0) + signed);
      continue;
    }
    aaPool += signed;
    const heads = splitEvenly(signed, picked.length);
    picked.forEach((name, index) => {
      sharerNames.add(name);
      share.set(name, (share.get(name) || 0) + heads[index]);
    });
  }

  const legacySharers = [...new Set([...presetNames, ...payerNames])];
  if (legacyPool && legacySharers.length) {
    const heads = splitEvenly(legacyPool, legacySharers.length);
    legacySharers.forEach((name, index) => share.set(name, (share.get(name) || 0) + heads[index]));
  }

  const names = [...new Set([...presetNames, ...payerNames, ...sharerNames])].sort(
    (a, b) => (paid.get(b) || 0) - (paid.get(a) || 0),
  );
  const diff = new Map<string, number>();
  const members = names.map((name) => {
    // 自己承担的（请客）不进 AA：垫付里先扣掉，不然「垫付 − 应摊」对不上差额
    const own = excluded.get(name) || 0;
    const inAa = (paid.get(name) || 0) - own;
    const value = inAa - (share.get(name) || 0);
    diff.set(name, value);
    return {
      name,
      paid: centsToYuan(inAa),
      share: centsToYuan(share.get(name) || 0),
      diff: centsToYuan(value),
      own: centsToYuan(own),
    };
  });

  const creditors = names
    .filter((n) => (diff.get(n) || 0) > 0)
    .map((n) => ({ name: n, cents: diff.get(n) || 0 }));
  const debtors = names
    .filter((n) => (diff.get(n) || 0) < 0)
    .map((n) => ({ name: n, cents: -(diff.get(n) || 0) }));
  creditors.sort((a, b) => b.cents - a.cents);
  debtors.sort((a, b) => b.cents - a.cents);

  const transfers: Array<{ from: string; to: string; amount: string }> = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const amount = Math.min(creditors[ci].cents, debtors[di].cents);
    if (amount > 0) {
      transfers.push({
        from: debtors[di].name,
        to: creditors[ci].name,
        amount: centsToYuan(amount),
      });
    }
    creditors[ci].cents -= amount;
    debtors[di].cents -= amount;
    if (creditors[ci].cents <= 0) ci += 1;
    if (debtors[di].cents <= 0) di += 1;
  }

  return {
    total: centsToYuan(aaPool),
    perPerson: centsToYuan(names.length ? Math.round(aaPool / names.length) : 0),
    memberCount: names.length,
    unassigned: centsToYuan(unassigned),
    members,
    transfers,
  };
}

/** 统一解析时间区间：优先用 from/to，否则退回 year/month */
export function resolveBounds(query: TxQuery, now = new Date()) {
  if (query.from && query.to) {
    return { start: String(query.from).slice(0, 10), end: String(query.to).slice(0, 10) };
  }
  const year = Number(query.year) || now.getFullYear();
  const month = Number(query.month) || now.getMonth() + 1;
  return monthBounds(year, month);
}

/** '2026-09-01' 按本地时区解析，避免 UTC 偏移把日期挪到前一天 */
export function parseLocalDate(text: string): Date {
  const s = String(text).slice(0, 10);
  return new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
}

export function daysBetween(start: string, end: string): number {
  return Math.round((parseLocalDate(end).getTime() - parseLocalDate(start).getTime()) / 86400000) + 1;
}

export function eachDay(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= last) {
    days.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function eachMonth(start: Date, end: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    months.push(`${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/** 类型别名，供上层引用 */
export type BillKind = BillCategoryKind | BillTxType;
