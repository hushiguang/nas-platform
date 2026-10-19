/**
 * 账单日历：某个月每天的收支合计 + 「还没到」的定期账单预排。
 *
 * 移植自 cash-platform/server/src/index.js 的 GET /api/calendar。
 *
 * ⚠ 按天分组必须先按本地日期折算（+8 小时）—— 库里存的是 UTC 墙钟，
 *   直接取 substr 会把跨零点的账单算到前一天。24,882 条里有 7,853 条跨零点。
 */
import { prisma } from "@nas/db";
import { centsToYuan } from "./money";
import { monthBounds, todayString } from "./dates";
import type { Actor } from "./book";
import type { TxQuery } from "./query";
import { buildWhere } from "./query";
import { loadRule, pendingInMonth, ruleBookIds } from "./recurring";

/** 本地日期（墙钟 + 8h） */
const LOCAL_TS = `(t."occurredAt" + INTERVAL '8 hours')`;

export async function billCalendar(actor: Actor, query: TxQuery) {
  const now = new Date();
  const year = Number(query.year) || now.getFullYear();
  const month = Number(query.month) || now.getMonth() + 1;
  const { start, end } = monthBounds(year, month);

  const { where, params } = await buildWhere(actor, { ...query, from: start, to: end });
  let i = 0;
  const text = where.join(" AND ").replace(/\?/g, () => `$${++i}`);

  const rows = await prisma.$queryRawUnsafe<
    Array<{ day: string; type: string; amount_cents: bigint; n: bigint }>
  >(
    `SELECT to_char(${LOCAL_TS}, 'YYYY-MM-DD') AS day,
            t.type::text AS type,
            SUM(CASE WHEN t.type IN ('EXPENSE', 'INCOME') AND NOT t."countExpense" THEN 0 ELSE t."amountCents" END) AS amount_cents,
            COUNT(*) AS n
     FROM bill_transaction t
     LEFT JOIN bill_category c ON c.id = t."categoryId"
     LEFT JOIN bill_category p ON p.id = c."parentId"
     LEFT JOIN bill_account a ON a.id = t."accountId"
     LEFT JOIN bill_account b ON b.id = t."toAccountId"
     WHERE ${text}
     GROUP BY day, t.type::text`,
    ...params,
  );

  interface DayCell {
    income: number;
    expense: number;
    count: number;
    planned: Array<{ id: number; type: string; amount: string; payee: string; note: string }>;
  }
  const days = new Map<string, DayCell>();
  const cell = (day: string): DayCell => {
    const found = days.get(day);
    if (found) return found;
    const fresh: DayCell = { income: 0, expense: 0, count: 0, planned: [] };
    days.set(day, fresh);
    return fresh;
  };

  for (const row of rows) {
    const target = cell(row.day);
    if (row.type === "INCOME") target.income += Number(row.amount_cents);
    if (row.type === "EXPENSE") target.expense += Number(row.amount_cents);
    target.count += Number(row.n);
  }

  // 还没到期的定期账单：日历上画成虚线预算，用户能提前看到月底还有几笔要出
  const today = todayString();
  const ruleIds = await ruleBookIds(actor, query.bookId);
  if (ruleIds.length) {
    const rules = await prisma.billRecurringRule.findMany({
      where: { ownerId: actor.id, paused: false, bookId: { in: ruleIds } },
    });
    for (const row of rules) {
      const rule = loadRule(row);
      for (const date of pendingInMonth(rule, start, end, today)) {
        cell(date).planned.push({
          id: rule.id,
          type: rule.type,
          amount: centsToYuan(rule.amountCents),
          payee: rule.payee,
          note: rule.note,
        });
      }
    }
  }

  const calendar = [...days.entries()]
    .map(([day, value]) => ({
      day,
      income: centsToYuan(value.income),
      expense: centsToYuan(value.expense),
      count: value.count,
      planned: value.planned,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return { year, month, days: calendar };
}
