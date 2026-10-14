/**
 * 定期账单（recurring）：规则的增删改，以及「按规则把到期的账单补进来」。
 *
 * 移植自 cash-platform/server/src/recurring.js。与原实现的差异只有两处：
 *   1. 落库的日期转换集中在 dates.ts（date 列 vs timestamp 列口径不同，见那里的注释）；
 *   2. 生成流水直接调 insertTransaction —— 幂等靠 (ownerId, source, externalId) 唯一键，
 *      和导入走同一条路径，不会出现「定期账单和导入账单去重规则不一致」。
 *
 * 规则推进算法（firstOccurrence / advance）已在 dates.ts，这里不重复实现。
 */
import { prisma } from "@/lib/prisma";
import type { BillRecurringRule, BillTxType } from "@prisma/client";
import { BillError } from "./errors";
import {
  advance,
  dateColumnToISO,
  firstOccurrence,
  isoToDateColumn,
  isoToWallClock,
  todayString,
  wallClockToISO,
  type RecurringRuleLike,
} from "./dates";
import { centsToYuan, yuanToCents } from "./money";
import { insertTransaction } from "./transaction";
import { accountOwned } from "./account";
import { canSeeBook, canWriteBook, ensurePersonalBook, visibleBookIds, type Actor } from "./book";

/** 默认推送时点（与原 config.recurring.defaultTime 一致） */
export const DEFAULT_RULE_TIME = process.env.RECURRING_DEFAULT_TIME || "09:00";

/** 规则在业务层的形态：日期一律用 'YYYY-MM-DD' 字符串，避免时区在中间层里来回漂 */
export interface RuleShape extends RecurringRuleLike {
  id: number;
  userId: number;
  bookId: number | null;
  type: string;
  amountCents: number;
  accountId: number;
  toAccountId: number | null;
  categoryId: number | null;
  payee: string;
  note: string;
  frequency: string;
  intervalDays: number | null;
  weekdays: number[];
  monthDay: number | null;
  yearMonth: number | null;
  yearDay: number | null;
  startDate: string;
  endDate: string | null;
  time: string;
  nextRun: string | null;
  paused: boolean;
}

/** weekdays 在库里是 JSON 字符串（如 '[1,3]'） */
function parseWeekdays(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number).filter((n) => n >= 1 && n <= 7) : [];
  } catch {
    return [];
  }
}

/** 行 → 业务形态 */
export function loadRule(row: BillRecurringRule): RuleShape {
  return {
    id: row.id,
    userId: row.ownerId,
    bookId: row.bookId,
    type: row.type.toLowerCase(),
    amountCents: row.amountCents,
    accountId: row.accountId,
    toAccountId: row.toAccountId,
    categoryId: row.categoryId,
    payee: row.payee || "",
    note: row.note || "",
    frequency: row.frequency,
    intervalDays: row.intervalDays,
    weekdays: parseWeekdays(row.weekdays),
    monthDay: row.monthDay,
    yearMonth: row.yearMonth,
    yearDay: row.yearDay,
    startDate: dateColumnToISO(row.startDate),
    endDate: row.endDate ? dateColumnToISO(row.endDate) : null,
    time: row.time || DEFAULT_RULE_TIME,
    nextRun: row.nextRun ? wallClockToISO(row.nextRun) : null,
    paused: row.paused,
  };
}

/** 排期只看这几个字段 */
function scheduleOf(rule: RuleShape): RecurringRuleLike {
  return {
    frequency: rule.frequency,
    intervalDays: rule.intervalDays,
    weekdays: rule.weekdays,
    monthDay: rule.monthDay,
    yearMonth: rule.yearMonth,
    yearDay: rule.yearDay,
    startDate: rule.startDate,
  };
}

/** 规则刚建好时的第一次发生日；超出 endDate 就返回 null（= 不再排） */
export function initialNextRun(rule: RuleShape): string | null {
  const next = firstOccurrence(scheduleOf(rule));
  if (rule.endDate && next > rule.endDate) return null;
  return next;
}

/**
 * 规则改动后重新排期：从 from 当天往后找下一次。
 * 关键是**不要把过去的日子再补一遍** —— 历史账单已经生成过了，改规则不能追溯。
 */
export function nextRunFrom(rule: RuleShape, from = todayString()): string | null {
  let next: string | null = firstOccurrence(scheduleOf(rule));
  let guard = 0;
  while (next && next < from && guard < 500) {
    const step = advance(scheduleOf(rule), next);
    if (!step || step <= next) break;
    next = step;
    guard += 1;
  }
  if (next && rule.endDate && next > rule.endDate) return null;
  return next;
}

/** 一天最多补多少条，兜底防止规则写错（比如 startDate 是 1970 年）把库刷爆 */
const GENERATE_GUARD = 400;

/**
 * 把 nextRun 起、到 through（默认今天）为止的每一次都补成账单。
 * 幂等：externalId = `r{规则id}:{日期}`，重复跑只会被唯一键挡掉。
 */
export async function generateRule(
  rule: RuleShape,
  options: { through?: string } = {},
): Promise<number> {
  const through = options.through ?? todayString();
  const book = rule.bookId ?? (await ensurePersonalBook(rule.userId)).id;
  const time = /^\d{2}:\d{2}$/.test(rule.time) ? rule.time : DEFAULT_RULE_TIME;

  let next = rule.nextRun;
  let guard = 0;
  let created = 0;

  while (next && guard < GENERATE_GUARD) {
    if (rule.endDate && next > rule.endDate) {
      next = null;
      break;
    }
    if (next > through) break;

    const externalId = `r${rule.id}:${next}`;
    const { skipped } = await insertTransaction(
      { id: rule.userId, role: "MEMBER" },
      {
        type: rule.type,
        amountCents: rule.amountCents,
        accountId: rule.accountId,
        toAccountId: rule.toAccountId,
        categoryId: rule.categoryId,
        occurredAt: `${next} ${time}:00`,
        payee: rule.payee || null,
        note: rule.note || null,
        bookId: book,
      },
      "RECURRING",
      externalId,
      rule.id,
    );
    if (!skipped) created += 1;

    next = advance(scheduleOf(rule), next);
    guard += 1;
  }

  await prisma.billRecurringRule.update({
    where: { id: rule.id },
    data: { nextRun: next ? isoToWallClock(next) : null },
  });
  rule.nextRun = next;
  return created;
}

/** 扫描所有到期规则并补账。userId 为空表示全量（定时任务用） */
export async function runDueRules(userId?: number) {
  const today = todayString();
  const rows = await prisma.billRecurringRule.findMany({
    where: {
      paused: false,
      nextRun: { not: null, lte: isoToWallClock(today) },
      ...(userId ? { ownerId: userId } : {}),
    },
  });
  let created = 0;
  for (const row of rows) {
    try {
      created += await generateRule(loadRule(row), { through: today });
    } catch (err) {
      // 单条规则出错不能拖垮整轮扫描
      console.error("定期入账失败 rule=", row.id, err instanceof Error ? err.message : err);
    }
  }
  return { rules: rows.length, created };
}

/**
 * 本月内「还没到」的预定账单日期，供日历页展示虚线预算。
 * 只列 today 之后的，已经入账的由流水本身体现。
 */
export function pendingInMonth(
  rule: RuleShape,
  monthStart: string,
  monthEnd: string,
  today: string,
): string[] {
  if (rule.paused || !rule.nextRun) return [];
  const dates: string[] = [];
  let cur: string | null = rule.nextRun;
  let guard = 0;
  while (cur && cur <= monthEnd && guard < 40) {
    if (rule.endDate && cur > rule.endDate) break;
    if (cur >= monthStart && cur > today) dates.push(cur);
    const next = advance(scheduleOf(rule), cur);
    if (!next || next <= cur) break;
    cur = next;
    guard += 1;
  }
  return dates;
}

// ---------------------------------------------------------------- 校验与增删改

/** 规则挂的账本：不传用个人账本，传了必须有记账权限 */
async function ruleBook(actor: Actor, bookId: unknown) {
  const book = bookId ? await canSeeBook(actor, Number(bookId)) : await ensurePersonalBook(actor.id);
  if (!book) throw new BillError("账本不存在", 404);
  if (!(await canWriteBook(actor, book))) throw new BillError("没有这个账本的记账权限", 403);
  return book;
}

const FREQUENCIES = ["daily", "weekly", "monthly", "yearly", "interval"];

/** 把请求体收敛成可靠的规则字段（旧 ruleFromBody） */
async function ruleFromBody(actor: Actor, body: Record<string, unknown>): Promise<RuleShape> {
  const type = String(body.type ?? "").toLowerCase();
  if (!["expense", "income", "transfer"].includes(type)) throw new BillError("类型不正确");

  const amountCents = body.amountCents != null ? Number(body.amountCents) : yuanToCents(body.amount);
  if (amountCents == null || !Number.isFinite(amountCents) || amountCents <= 0) {
    throw new BillError("金额不正确");
  }

  const account = await accountOwned(actor.id, Number(body.accountId));
  if (!account) throw new BillError("请选择账户");
  const toAccount = body.toAccountId ? await accountOwned(actor.id, Number(body.toAccountId)) : null;

  const frequency = String(body.frequency ?? "");
  if (!FREQUENCIES.includes(frequency)) throw new BillError("周期不正确");
  const startDate = String(body.startDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new BillError("开始日期不正确");
  const endDateRaw = String(body.endDate ?? "").slice(0, 10);
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(endDateRaw) ? endDateRaw : null;

  const weekdays = Array.isArray(body.weekdays)
    ? body.weekdays.map(Number).filter((n) => n >= 1 && n <= 7)
    : [];
  if (frequency === "weekly" && !weekdays.length) throw new BillError("请选择星期几");

  const time = /^\d{2}:\d{2}$/.test(String(body.time ?? "")) ? String(body.time) : DEFAULT_RULE_TIME;

  return {
    id: 0,
    userId: actor.id,
    bookId: null,
    type,
    amountCents,
    accountId: account.id,
    toAccountId: toAccount?.id ?? null,
    categoryId: body.categoryId ? Number(body.categoryId) : null,
    payee: String(body.payee ?? "").trim(),
    note: String(body.note ?? "").trim(),
    frequency,
    intervalDays: frequency === "interval" ? Math.max(1, Number(body.intervalDays) || 1) : null,
    weekdays,
    monthDay: body.monthDay ? Number(body.monthDay) : null,
    yearMonth: body.yearMonth ? Number(body.yearMonth) : null,
    yearDay: body.yearDay ? Number(body.yearDay) : null,
    startDate,
    endDate,
    time,
    nextRun: null,
    paused: !!body.paused,
  };
}

/** 对外的规则呈现（字段名与旧接口一致，金额转元） */
export function presentRule(rule: RuleShape) {
  return {
    id: rule.id,
    bookId: rule.bookId,
    type: rule.type,
    amount: centsToYuan(rule.amountCents),
    accountId: rule.accountId,
    toAccountId: rule.toAccountId,
    categoryId: rule.categoryId,
    payee: rule.payee,
    note: rule.note,
    frequency: rule.frequency,
    intervalDays: rule.intervalDays,
    weekdays: rule.weekdays,
    monthDay: rule.monthDay,
    yearMonth: rule.yearMonth,
    yearDay: rule.yearDay,
    startDate: rule.startDate,
    endDate: rule.endDate,
    time: rule.time,
    nextRun: rule.nextRun,
    paused: rule.paused,
  };
}

/** 某个账本范围下的规则 id 列表（不传 bookId 就是「我可见的全部账本」） */
export async function ruleBookIds(actor: Actor, bookId: unknown): Promise<number[]> {
  const asked = Number(bookId) || 0;
  if (asked) {
    const book = await canSeeBook(actor, asked);
    if (!book) throw new BillError("账本不存在", 404);
    return [asked];
  }
  return visibleBookIds(actor.id);
}

export async function listRules(actor: Actor, bookId?: unknown) {
  const ids = await ruleBookIds(actor, bookId);
  if (!ids.length) return [];
  const rows = await prisma.billRecurringRule.findMany({
    where: { ownerId: actor.id, bookId: { in: ids } },
    orderBy: [{ paused: "asc" }, { nextRun: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => presentRule(loadRule(row)));
}

export async function createRule(actor: Actor, body: Record<string, unknown>) {
  const book = await ruleBook(actor, body.bookId);
  const rule = await ruleFromBody(actor, body);
  const nextRun = initialNextRun(rule);

  const created = await prisma.billRecurringRule.create({
    data: {
      ownerId: actor.id,
      bookId: book.id,
      type: rule.type.toUpperCase() as BillTxType,
      amountCents: rule.amountCents,
      accountId: rule.accountId,
      toAccountId: rule.toAccountId,
      categoryId: rule.categoryId,
      payee: rule.payee || null,
      note: rule.note || null,
      frequency: rule.frequency,
      intervalDays: rule.intervalDays,
      weekdays: JSON.stringify(rule.weekdays),
      monthDay: rule.monthDay,
      yearMonth: rule.yearMonth,
      yearDay: rule.yearDay,
      startDate: isoToDateColumn(rule.startDate),
      endDate: rule.endDate ? isoToDateColumn(rule.endDate) : null,
      time: rule.time,
      nextRun: nextRun ? isoToWallClock(nextRun) : null,
    },
  });

  // 建规则时立刻把「今天及以前」的补上，不用等下一次扫描
  const stored = loadRule(created);
  await generateRule(stored, { through: todayString() });

  const fresh = await prisma.billRecurringRule.findUniqueOrThrow({ where: { id: created.id } });
  return presentRule(loadRule(fresh));
}

export async function updateRule(actor: Actor, id: number, body: Record<string, unknown>) {
  const current = await prisma.billRecurringRule.findFirst({
    where: { id: Number(id), ownerId: actor.id },
  });
  if (!current) throw new BillError("定期账单不存在", 404);
  if (current.bookId) {
    const book = await canSeeBook(actor, current.bookId);
    if (!book || !(await canWriteBook(actor, book))) {
      throw new BillError("没有这个账本的记账权限", 403);
    }
  }
  const existing = loadRule(current);

  // 「只点暂停/继续」这种单字段请求走捷径，不去重算排期
  if (body.paused != null && Object.keys(body).length === 1) {
    const updated = await prisma.billRecurringRule.update({
      where: { id: current.id },
      data: { paused: !!body.paused },
    });
    return presentRule(loadRule(updated));
  }

  const merged: Record<string, unknown> = {
    type: body.type ?? existing.type,
    amount: body.amount ?? centsToYuan(existing.amountCents),
    accountId: body.accountId ?? existing.accountId,
    toAccountId: body.toAccountId ?? existing.toAccountId,
    categoryId: body.categoryId ?? existing.categoryId,
    payee: body.payee ?? existing.payee,
    note: body.note ?? existing.note,
    frequency: body.frequency ?? existing.frequency,
    intervalDays: body.intervalDays ?? existing.intervalDays,
    weekdays: body.weekdays ?? existing.weekdays,
    monthDay: body.monthDay ?? existing.monthDay,
    yearMonth: body.yearMonth ?? existing.yearMonth,
    yearDay: body.yearDay ?? existing.yearDay,
    startDate: body.startDate ?? existing.startDate,
    endDate: body.endDate ?? existing.endDate,
    time: body.time ?? existing.time,
  };
  const rule = await ruleFromBody(actor, merged);
  // 改完从今天往后重新排期，过去生成的账单不动
  const nextRun = nextRunFrom(rule, todayString());

  const updated = await prisma.billRecurringRule.update({
    where: { id: current.id },
    data: {
      type: rule.type.toUpperCase() as BillTxType,
      amountCents: rule.amountCents,
      accountId: rule.accountId,
      toAccountId: rule.toAccountId,
      categoryId: rule.categoryId,
      payee: rule.payee || null,
      note: rule.note || null,
      frequency: rule.frequency,
      intervalDays: rule.intervalDays,
      weekdays: JSON.stringify(rule.weekdays),
      monthDay: rule.monthDay,
      yearMonth: rule.yearMonth,
      yearDay: rule.yearDay,
      startDate: isoToDateColumn(rule.startDate),
      endDate: rule.endDate ? isoToDateColumn(rule.endDate) : null,
      time: rule.time,
      nextRun: nextRun ? isoToWallClock(nextRun) : null,
      paused: body.paused != null ? !!body.paused : current.paused,
    },
  });

  // 按旧规则排到未来的账单先清掉，再按新规则补记到今天（同一天不会重复入账）
  await prisma.billTransaction.deleteMany({
    where: {
      ownerId: actor.id,
      recurringRuleId: current.id,
      occurredAt: { gt: new Date(`${todayString()}T23:59:59.999+08:00`) },
    },
  });
  await generateRule(loadRule(updated), { through: todayString() });

  const fresh = await prisma.billRecurringRule.findUniqueOrThrow({ where: { id: current.id } });
  return presentRule(loadRule(fresh));
}

export async function deleteRule(actor: Actor, id: number) {
  const current = await prisma.billRecurringRule.findFirst({
    where: { id: Number(id), ownerId: actor.id },
  });
  if (!current) throw new BillError("定期账单不存在", 404);
  if (current.bookId) {
    const book = await canSeeBook(actor, current.bookId);
    if (!book || !(await canWriteBook(actor, book))) {
      throw new BillError("没有这个账本的记账权限", 403);
    }
  }
  await prisma.billRecurringRule.delete({ where: { id: current.id } });
  return { ok: true };
}
