/**
 * 账户数据访问层。
 *
 * 替代 cash-platform/server/src/ledger.js 里所有账户相关逻辑：
 * 归属校验、归并（merged_into）、别名解析、余额计算。
 *
 * 约定：模块外一律通过本文件访问 bill_account / bill_account_alias，
 * 不要直接 prisma.billAccount —— 归并、归档、别名这三件事必须一起处理才不会漏。
 */
import { Prisma } from "@prisma/client";
import type { BillAccount, BillAccountKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BillError } from "./errors";
import { accountKindOf, normalizeAccountName } from "./taxonomy";
import { centsToYuan, yuanToCents } from "./money";

/** 账户 + 余额（balanceCents 由 SQL 聚合出来，不是表里的列） */
export type AccountWithBalance = BillAccount & { balance_cents: bigint | number | null };

/** 取本人名下未归档的账户；不是自己的或已归档返回 null */
export async function accountOwned(userId: number, id: number | null | undefined) {
  if (!id) return null;
  return prisma.billAccount.findFirst({ where: { id, ownerId: userId, archived: false } });
}

/** 账户归并到哪个统一账户。凡是要落账、展示的地方都先过一遍。 */
export async function canonicalAccount(row: BillAccount | null): Promise<BillAccount | null> {
  if (!row || !row.mergedInto) return row;
  const parent = await prisma.billAccount.findUnique({ where: { id: row.mergedInto } });
  return parent ?? row;
}

/**
 * 按名字找账户，依次尝试：精确名 → 别名 → 名字里的末四位数字。
 * 末四位必须在「账户名」或「别名」里唯一命中，命中多个就当作没找到（宁可不猜）。
 */
export async function resolveAccount(userId: number, name: string): Promise<BillAccount | null> {
  const trimmed = normalizeAccountName(name);
  if (!trimmed || trimmed === "/") return null;

  const found = await prisma.billAccount.findFirst({ where: { ownerId: userId, name: trimmed } });
  if (found) return canonicalAccount(found);

  // schema 里刻意不声明 @relation（模块间解耦），所以这里手工 join，不能用 include
  const alias = await prisma.billAccountAlias.findFirst({
    where: { ownerId: userId, alias: trimmed },
  });
  if (alias) {
    const acc = await prisma.billAccount.findUnique({ where: { id: alias.accountId } });
    if (acc) return canonicalAccount(acc);
  }

  const digits = trimmed.match(/(\d{4})\s*\)?$/)?.[1];
  if (!digits) return null;

  const rows = await prisma.billAccount.findMany({
    where: { ownerId: userId, archived: false, name: { contains: digits } },
  });
  if (rows.length === 1) return canonicalAccount(rows[0]);

  const byAlias = await prisma.billAccountAlias.findMany({
    where: { ownerId: userId, alias: { contains: digits } },
  });
  if (byAlias.length === 1) {
    const acc = await prisma.billAccount.findUnique({ where: { id: byAlias[0].accountId } });
    if (acc) return canonicalAccount(acc);
  }
  return null;
}

/**
 * 记账时保证账户存在：找到就复用（顺带把被归档的重新启用），找不到就按名字新建。
 * name 为空时回退到「第一个未归并的账户」，一个都没有就抛错。
 */
export async function ensureAccount(userId: number, name: string | null | undefined) {
  const trimmed = normalizeAccountName(name);
  if (!trimmed) {
    const fallback = await prisma.billAccount.findFirst({
      where: { ownerId: userId, archived: false, mergedInto: null },
      orderBy: [{ sort: "asc" }, { id: "asc" }],
    });
    if (!fallback) throw new Error("请先创建账户");
    return fallback;
  }

  const found = await resolveAccount(userId, trimmed);
  if (found) {
    // 已归并出去的账户保持归档，别因为它又被提到就冒出来
    if (found.archived && !found.mergedInto) {
      return prisma.billAccount.update({ where: { id: found.id }, data: { archived: false } });
    }
    return found;
  }

  const max = await prisma.billAccount.aggregate({
    where: { ownerId: userId },
    _max: { sort: true },
  });
  return prisma.billAccount.create({
    data: {
      ownerId: userId,
      name: trimmed,
      kind: accountKindOf(trimmed),
      sort: (max._max.sort ?? 0) + 1,
    },
  });
}

/**
 * 把 source 归并到 target：流水、初始余额一起搬过去，source 归档并留下旧名别名。
 *
 * ⚠ 整个过程必须在一个事务里，否则搬到一半失败会留下「流水已改、账户未归档」的脏状态。
 */
export async function mergeAccount(userId: number, sourceId: number, targetId: number) {
  const source = await prisma.billAccount.findFirst({
    where: { id: Number(sourceId), ownerId: userId },
  });
  let target = await prisma.billAccount.findFirst({
    where: { id: Number(targetId), ownerId: userId },
  });
  if (!source || !target || source.id === target.id) throw new Error("请选择两个不同的账户");
  if (source.mergedInto === target.id) return target;
  if (target.mergedInto) {
    // 目标本身也是归并出去的，实际落到它所属的主账户
    return mergeAccount(userId, sourceId, target.mergedInto);
  }

  const sourceName = source.name;
  const sourceInitial = source.initialCents;
  const sourceIdNum = source.id;
  const targetIdNum = target.id;

  const result = await prisma.$transaction(async (tx) => {
    // 如果 source 是别人的主账户，先把挂在它名下的账户接过来
    await tx.billAccount.updateMany({
      where: { mergedInto: sourceIdNum },
      data: { mergedInto: targetIdNum },
    });
    await tx.billTransaction.updateMany({
      where: { ownerId: userId, accountId: sourceIdNum },
      data: { accountId: targetIdNum },
    });
    await tx.billTransaction.updateMany({
      where: { ownerId: userId, toAccountId: sourceIdNum },
      data: { toAccountId: targetIdNum },
    });
    await tx.billRecurringRule.updateMany({
      where: { ownerId: userId, accountId: sourceIdNum },
      data: { accountId: targetIdNum },
    });
    await tx.billRecurringRule.updateMany({
      where: { ownerId: userId, toAccountId: sourceIdNum },
      data: { toAccountId: targetIdNum },
    });
    await tx.billAccount.update({
      where: { id: targetIdNum },
      data: { initialCents: { increment: sourceInitial } },
    });
    const archived = await tx.billAccount.update({
      where: { id: sourceIdNum },
      data: { mergedInto: targetIdNum, archived: true, initialCents: 0 },
    });
    for (const alias of new Set([sourceName, normalizeAccountName(sourceName)])) {
      if (!alias || alias === target!.name) continue;
      await tx.billAccountAlias.upsert({
        where: { ownerId_alias: { ownerId: userId, alias } },
        create: { ownerId: userId, alias, accountId: targetIdNum },
        update: { accountId: targetIdNum },
      });
    }
    return archived;
  });
  void result;
  target = await prisma.billAccount.findUniqueOrThrow({ where: { id: targetIdNum } });
  return target;
}

/** 解除归并：账户重新独立，已经并进去的流水留在原主账户。 */
export async function unmergeAccount(userId: number, accountId: number) {
  const row = await prisma.billAccount.findFirst({
    where: { id: Number(accountId), ownerId: userId },
  });
  if (!row || !row.mergedInto) throw new Error("该账户没有归并到别的账户");
  const parentId = row.mergedInto;
  const rowName = row.name;
  const rowId = row.id;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.billAccount.update({
      where: { id: rowId },
      data: { mergedInto: null, archived: false },
    });
    await tx.billAccountAlias.deleteMany({
      where: { ownerId: userId, accountId: parentId, alias: rowName },
    });
    return updated;
  });
}

export async function saveAccountAlias(userId: number, alias: string, accountId: number) {
  const name = String(alias || "").trim();
  const account = await prisma.billAccount.findFirst({
    where: { id: Number(accountId), ownerId: userId },
  });
  if (!name || !account) throw new Error("请填写别名并选择账户");
  const canonical = await canonicalAccount(account);
  const targetId = canonical!.id;
  return prisma.billAccountAlias.upsert({
    where: { ownerId_alias: { ownerId: userId, alias: name } },
    create: { ownerId: userId, alias: name, accountId: targetId },
    update: { accountId: targetId },
  });
}

export async function deleteAccountAlias(userId: number, id: number) {
  await prisma.billAccountAlias.deleteMany({ where: { id: Number(id), ownerId: userId } });
}

export async function listAccountAliases(userId: number) {
  const rows = await prisma.billAccountAlias.findMany({
    where: { ownerId: userId },
    orderBy: { alias: "asc" },
  });
  if (!rows.length) return [];
  const accounts = await prisma.billAccount.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.accountId))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));
  return rows.map((r) => ({
    id: r.id,
    alias: r.alias,
    account_id: r.accountId,
    account_name: nameById.get(r.accountId) ?? "",
  }));
}

/** 归并关系：主账户 = 自己 + 所有归属它的账户 */
const GROUP_MATCH = `(base.id = a.id OR base."mergedInto" = a.id)`;

/**
 * 账户列表 + 实时余额。
 *
 * 余额 = 组内所有账户的初始余额 + 收入 - 支出 - 转出 + 转入。
 * 用一条 SQL 算完 —— 逐个账户查会变成 N+1，25k 条流水下明显卡。
 */
export async function listAccountsWithBalance(userId: number): Promise<AccountWithBalance[]> {
  return prisma.$queryRaw<AccountWithBalance[]>`
    SELECT a.*,
      (SELECT COALESCE(SUM(base."initialCents"), 0) FROM bill_account base WHERE ${Prisma.raw(GROUP_MATCH)})
      + COALESCE((SELECT SUM(t."amountCents") FROM bill_transaction t JOIN bill_account base ON base.id = t."accountId" WHERE ${Prisma.raw(GROUP_MATCH)} AND t.type = 'INCOME'), 0)
      - COALESCE((SELECT SUM(t."amountCents") FROM bill_transaction t JOIN bill_account base ON base.id = t."accountId" WHERE ${Prisma.raw(GROUP_MATCH)} AND t.type = 'EXPENSE'), 0)
      - COALESCE((SELECT SUM(t."amountCents") FROM bill_transaction t JOIN bill_account base ON base.id = t."accountId" WHERE ${Prisma.raw(GROUP_MATCH)} AND t.type = 'TRANSFER'), 0)
      + COALESCE((SELECT SUM(t."amountCents") FROM bill_transaction t JOIN bill_account base ON base.id = t."toAccountId" WHERE ${Prisma.raw(GROUP_MATCH)} AND t.type = 'TRANSFER'), 0)
      AS balance_cents
    FROM bill_account a
    WHERE a."ownerId" = ${userId}
    ORDER BY a.sort, a.id
  `;
}

/** 账户归档 / 取消归档（带本人归属校验） */
export async function setAccountArchived(userId: number, id: number, archived: boolean) {
  const row = await prisma.billAccount.findFirst({ where: { id: Number(id), ownerId: userId } });
  if (!row) throw new Error("账户不存在");
  return prisma.billAccount.update({ where: { id: row.id }, data: { archived } });
}

/** 重命名账户，并把旧名保留成别名，避免导入时又建出一个新账户 */
export async function renameAccount(userId: number, id: number, name: string) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("请填写账户名");
  const row = await prisma.billAccount.findFirst({ where: { id: Number(id), ownerId: userId } });
  if (!row) throw new Error("账户不存在");
  const oldName = row.name;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.billAccount.update({ where: { id: row.id }, data: { name: clean } });
    if (oldName && oldName !== clean) {
      await tx.billAccountAlias.upsert({
        where: { ownerId_alias: { ownerId: userId, alias: oldName } },
        create: { ownerId: userId, alias: oldName, accountId: row.id },
        update: { accountId: row.id },
      });
    }
    return updated;
  });
}

/** 新用户的默认账户，与旧系统 seedUser 一致（名称与类型都照搬） */
const DEFAULT_ACCOUNTS: Array<[string, BillAccountKind]> = [
  ["现金", "CASH"],
  ["微信零钱", "WECHAT"],
  ["支付宝余额", "ALIPAY"],
  ["余额宝", "ALIPAY"],
  ["花呗", "ALIPAY"],
  ["银行卡", "BANK"],
  ["京东小金库", "JD"],
];

/** 注册新用户时铺一套默认账户 */
export async function seedAccounts(userId: number) {
  for (let i = 0; i < DEFAULT_ACCOUNTS.length; i += 1) {
    const [name, kind] = DEFAULT_ACCOUNTS[i];
    await prisma.billAccount.create({ data: { ownerId: userId, name, kind, sort: i } });
  }
}

/** 旧 API 传进来的 kind 是小写字符串，统一收敛成枚举；认不出来按名字猜 */
const ACCOUNT_KINDS: BillAccountKind[] = [
  "ALIPAY",
  "BANK",
  "CASH",
  "CREDIT",
  "JD",
  "OTHER",
  "WECHAT",
];

export function toAccountKind(value: unknown, name: string): BillAccountKind {
  const raw = String(value ?? "").trim().toUpperCase();
  if ((ACCOUNT_KINDS as string[]).includes(raw)) return raw as BillAccountKind;
  return accountKindOf(name);
}

/** 新建账户（旧 POST /api/accounts） */
export async function createAccount(
  userId: number,
  body: { name?: unknown; kind?: unknown; initial?: unknown },
): Promise<BillAccount> {
  const name = String(body.name ?? "").trim();
  if (!name) throw new BillError("请填写账户名");
  const initialCents = yuanToCents(body.initial ?? 0) ?? 0;
  const max = await prisma.billAccount.aggregate({
    where: { ownerId: userId },
    _max: { sort: true },
  });
  return prisma.billAccount.create({
    data: {
      ownerId: userId,
      name,
      kind: toAccountKind(body.kind, name),
      initialCents,
      sort: (max._max.sort ?? 0) + 1,
    },
  });
}

/**
 * 改账户（旧 PATCH /api/accounts/:id）：名称 / 类型 / 归档 / 初始余额一起处理。
 * 改名时把旧名留成别名，否则下次导入又会按旧名建出一个新账户。
 */
export async function updateAccount(
  userId: number,
  id: number,
  body: { name?: unknown; kind?: unknown; archived?: unknown; initial?: unknown },
): Promise<BillAccount> {
  const row = await prisma.billAccount.findFirst({ where: { id: Number(id), ownerId: userId } });
  if (!row) throw new BillError("账户不存在", 404);

  const name = body.name != null ? String(body.name).trim() : row.name;
  if (!name) throw new BillError("请填写账户名");
  const kind = body.kind != null ? toAccountKind(body.kind, name) : row.kind;
  const archived = body.archived != null ? !!body.archived : row.archived;
  const initialCents =
    body.initial != null ? (yuanToCents(body.initial) ?? row.initialCents) : row.initialCents;

  const oldName = row.name;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.billAccount.update({
      where: { id: row.id },
      data: { name, kind, archived, initialCents },
    });
    if (oldName && oldName !== name) {
      await tx.billAccountAlias.upsert({
        where: { ownerId_alias: { ownerId: userId, alias: oldName } },
        create: { ownerId: userId, alias: oldName, accountId: row.id },
        update: { accountId: row.id },
      });
    }
    return updated;
  });
}

/** 对外的账户呈现：金额转成元字符串，字段名保持与旧 API 一致 */
export function presentAccount(row: AccountWithBalance) {
  const balanceCents = row.balance_cents == null ? null : Number(row.balance_cents);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind.toLowerCase(),
    initial: centsToYuan(row.initialCents),
    balance: balanceCents == null ? null : centsToYuan(balanceCents),
    archived: !!row.archived,
    mergedInto: row.mergedInto ? Number(row.mergedInto) : null,
  };
}
