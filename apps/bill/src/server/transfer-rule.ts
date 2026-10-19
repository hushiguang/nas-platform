/**
 * 转账规则：全部由用户在页面上配置，代码里**不写死任何个人账号 / 姓名**。
 *
 * 一条规则 = 「账单的 对方/备注/分类 里出现某关键词（或正则），就把这笔当成转账，
 * 可选地指定转入账户（从用户自己的账户里选）」。
 *
 * 导入预览与存量修补共用这一份引擎，两边逻辑不会跑偏。
 * 移植自 cash-platform/server/src/transfer-rules.js。
 */
import { prisma } from "@nas/db";
import type { BillTransferRule } from "@nas/db";
import { BillError } from "./errors";
import { accountOwned } from "./account";

/**
 * 正则是否可用。
 *
 * ⚠ 这里**故意偏离**旧实现。旧代码写的是 `safeRegexTest(pattern, '')`，
 *   也就是拿空串去 test —— 结果是「只有能匹配空串的正则才算合法」，
 *   于是 '信用卡还款|待清算信用卡' 这类正常正则会被判成「正则表达式无效」，
 *   整个「用正则配转账规则」的功能其实是废的（库里那 14 条是迁移脚本直接插进去的）。
 *   这里改成只校验能否编译：原来能通过的仍然能通过，原来被误拒的现在可用。
 */
function isCompilableRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, "i");
    return true;
  } catch {
    return false;
  }
}

/** 匹配时用：正则写错了不能让整个导入挂掉，静默判为不命中 */
function safeRegexTest(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return false;
  }
}

export async function listTransferRules(userId: number) {
  return prisma.billTransferRule.findMany({
    where: { ownerId: userId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
}

/** 对外的规则呈现（字段名与旧接口一致） */
export function presentTransferRule(row: BillTransferRule) {
  return {
    id: row.id,
    label: row.label,
    pattern: row.pattern,
    is_regex: row.isRegex ? 1 : 0,
    target_account_id: row.targetAccountId,
    enabled: row.enabled ? 1 : 0,
    position: row.position,
  };
}

interface ValidatedRule {
  label: string;
  pattern: string;
  isRegex: boolean;
  targetAccountId: number | null;
  enabled: boolean;
}

async function validateBody(
  userId: number,
  body: Record<string, unknown>,
): Promise<ValidatedRule> {
  const label = String(body.label ?? "").trim();
  const pattern = String(body.pattern ?? "").trim();
  if (!label) throw new BillError("请填写规则名称");
  if (!pattern) throw new BillError("请填写匹配关键词或正则");
  const isRegex = !!body.isRegex;
  if (isRegex && !isCompilableRegex(pattern)) throw new BillError("正则表达式无效");

  let targetAccountId: number | null = null;
  if (body.targetAccountId) {
    const account = await accountOwned(userId, Number(body.targetAccountId));
    if (!account) throw new BillError("转入账户不存在");
    targetAccountId = account.id;
  }
  const enabled = body.enabled === false ? false : true;
  return { label, pattern, isRegex, targetAccountId, enabled };
}

export async function createTransferRule(userId: number, body: Record<string, unknown>) {
  const valid = await validateBody(userId, body);
  const max = await prisma.billTransferRule.aggregate({
    where: { ownerId: userId },
    _max: { position: true },
  });
  return prisma.billTransferRule.create({
    data: { ownerId: userId, ...valid, position: (max._max.position ?? 0) + 1 },
  });
}

export async function updateTransferRule(
  userId: number,
  id: number,
  body: Record<string, unknown>,
) {
  const existing = await prisma.billTransferRule.findFirst({
    where: { id: Number(id), ownerId: userId },
  });
  if (!existing) throw new BillError("规则不存在", 404);
  const valid = await validateBody(userId, body);
  return prisma.billTransferRule.update({ where: { id: existing.id }, data: valid });
}

export async function deleteTransferRule(userId: number, id: number) {
  const existing = await prisma.billTransferRule.findFirst({
    where: { id: Number(id), ownerId: userId },
  });
  if (!existing) throw new BillError("规则不存在", 404);
  await prisma.billTransferRule.delete({ where: { id: existing.id } });
  return existing;
}

/** 在 payee / note / categoryName 拼成的文本上匹配，返回命中的第一条启用规则 */
export function matchTransferRule(
  rules: BillTransferRule[],
  fields: { payee?: unknown; note?: unknown; categoryName?: unknown },
): BillTransferRule | null {
  const haystack = [fields.payee || "", fields.note || "", fields.categoryName || ""].join(" ");
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const hit = rule.isRegex
      ? safeRegexTest(rule.pattern, haystack)
      : haystack.includes(rule.pattern);
    if (hit) return rule;
  }
  return null;
}

/** 导入解析阶段用：命中规则就把这笔改成转账，并按需补上转入账户（供预览展示） */
export async function applyTransferRules<T extends {
  type?: unknown;
  categoryName?: unknown;
  categoryLabel?: unknown;
  accountId?: unknown;
  toAccountId?: unknown;
  toAccountName?: unknown;
}>(userId: number, row: T): Promise<T> {
  const rules = await listTransferRules(userId);
  if (!rules.length) return row;
  const rule = matchTransferRule(rules, row as { payee?: unknown; note?: unknown; categoryName?: unknown });
  if (!rule) return row;

  row.type = "transfer";
  // 转账不计收支，清掉分类
  row.categoryName = "";
  row.categoryLabel = "";
  if (rule.targetAccountId) {
    const account = await accountOwned(userId, rule.targetAccountId);
    if (account && account.id !== Number(row.accountId)) {
      row.toAccountId = account.id;
      row.toAccountName = account.name;
    }
  }
  return row;
}
