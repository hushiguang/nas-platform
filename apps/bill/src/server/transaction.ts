/**
 * 账单流水数据访问层。
 *
 * 替代 cash-platform/server/src/index.js 的 insertTransaction/presentWithTransaction
 * 以及 ledger.js 的分摊人编解码。
 *
 * 三条不能改的约定：
 *   1. 金额是整数分（amountCents），入口统一用 yuanToCents 转换，绝不出现浮点。
 *   2. 共享账本里，流水的 ownerId 记的是**账本 owner**，不是操作者 —— 账单归属跟着账本走。
 *   3. externalId 有值时要按 (ownerId, source, externalId) 去重，导入重复文件不能产生重复账单。
 */
import { prisma } from "@nas/db";
import type { BillFollowAction, BillTransaction, BillTxSource, BillTxType } from "@nas/db";
import { BillError } from "./errors";
import { hasFollowUp, removeBillFollowTodo, syncBillFollowTodo, withFollowNote } from "./follow";
import { centsToYuan, yuanToCents } from "./money";
import { normalizeClientDate, pad, todayString } from "./dates";
import { accountOwned, ensureAccount, resolveAccount } from "./account";
import { categoryOwned, ensureCategory } from "./category";
import type { Actor } from "./book";
import { canSeeBook, canWriteBook, ensurePersonalBook, saveImages, visibleBookIds } from "./book";

/** 带 join 出来的展示字段的流水行（来自 listTransactions 的裸 SQL） */
export interface TransactionRow extends BillTransaction {
  categoryName: string | null;
  parentName: string | null;
  accountName: string | null;
  toAccountName: string | null;
}

/**
 * 分摊人：存成 JSON 数组（Json 列）。null = 从没设过，算账时退回「全员平分」的老规矩。
 * 这里对 null 与「空数组」严格区分 —— 空数组表示「这笔我自己承担」，语义完全不同。
 */
export function parseShareWith(value: unknown): string[] | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const list = Array.isArray(value) ? value : null;
  if (!list) return null;
  return [...new Set(list.map((name) => String(name).trim()).filter(Boolean))];
}

/** 分摊人编码入库；传进来的不是数组就返回 null（= 不写这一列） */
export function encodeShareWith(list: unknown): string[] | null {
  if (!Array.isArray(list)) return null;
  return [...new Set(list.map((name) => String(name).trim()).filter(Boolean))];
}

export interface TxInput {
  type?: string;
  amount?: unknown;
  amountCents?: number | null;
  accountId?: number | null;
  accountName?: string | null;
  toAccountId?: number | null;
  toAccountName?: string | null;
  categoryId?: number | null;
  categoryName?: string | null;
  subcategoryName?: string | null;
  categoryLabel?: string | null;
  occurredAt?: unknown;
  payee?: string | null;
  note?: string | null;
  memberName?: string | null;
  bookId?: number | null;
  images?: unknown;
  shareWith?: unknown;
  /** 转入场景：表示「从对方账户收进来」，用来把转出/转入方向摆正 */
  incoming?: boolean;
  /** 后续跟进，比如这笔准备退款 */
  followNote?: string | null;
  /** 是否计入收支合计。不传视为计入 */
  countExpense?: boolean;
  followAction?: BillFollowAction | null;
  refundCents?: number | null;
  refundedAt?: Date | null;
}

/**
 * 写入一笔账单。
 *
 * 与旧实现的差异只有一处：旧代码用 `INSERT OR IGNORE` 靠唯一索引兜底，
 * 这里显式先查一次 externalId，重复就返回 skipped（导入时能准确报出「跳过 N 条」）。
 */
export async function insertTransaction(
  actor: Actor,
  body: TxInput,
  source: BillTxSource = "MANUAL",
  externalId: string | null = null,
  recurringRuleId: number | null = null,
  keepId: number | null = null,
): Promise<{ id: number; skipped: boolean }> {
  const userId = actor.id;
  const type = String(body.type || "").toLowerCase() as Lowercase<BillTxType>;
  if (!["expense", "income", "transfer"].includes(type)) throw new BillError("类型不正确");

  const amountCents = body.amountCents ?? yuanToCents(body.amount);
  if (amountCents == null || amountCents <= 0) throw new BillError("金额不正确");

  // 账本：不传就用个人账本，传了必须有记账权限
  const book = body.bookId ? await canSeeBook(actor, Number(body.bookId)) : await ensurePersonalBook(userId);
  if (!book) throw new BillError("账本不存在", 404);
  if (!(await canWriteBook(actor, book))) throw new BillError("没有这个账本的记账权限", 403);

  // 共享账本可以不填账户；分类沿用账本 owner 的那一套
  const shared = book.kind !== "PERSONAL";
  const taxonomyUserId = book.ownerId;

  // 共享账本补账时不强求时间，默认记成现在
  const occurredAt =
    normalizeClientDate(body.occurredAt) ??
    (shared
      ? normalizeClientDate(
          `${todayString()} ${pad(new Date().getHours())}:${pad(new Date().getMinutes())}:00`,
        )
      : null);
  if (!occurredAt) throw new BillError("时间不正确");

  const namedAccount = async (name: string) =>
    (await resolveAccount(userId, name)) ?? (await ensureAccount(userId, name));

  let account = body.accountId
    ? await accountOwned(userId, Number(body.accountId))
    : body.accountName
      ? await namedAccount(String(body.accountName))
      : null;
  if (!account && (type === "transfer" || !shared)) throw new BillError("请选择账户");

  let toAccountId: number | null = null;
  let categoryId: number | null = null;
  let categoryLabel: string | null = null;

  if (type === "transfer") {
    const toName = String(body.toAccountName || "").trim();
    if (body.incoming) {
      const counterparty = await namedAccount(String(body.payee || "外部"));
      if (counterparty.id !== account!.id) {
        toAccountId = account!.id;
        account = counterparty;
      }
    } else if (body.toAccountId || toName) {
      const to = body.toAccountId
        ? await accountOwned(userId, Number(body.toAccountId))
        : await namedAccount(toName);
      if (!to || (to.id === account!.id && source === "MANUAL")) {
        throw new BillError("请选择不同的转入账户");
      }
      toAccountId = to.id;
    } else if (source === "MANUAL") {
      throw new BillError("请选择不同的转入账户");
    }
  } else if (body.categoryId) {
    const category = await categoryOwned(taxonomyUserId, Number(body.categoryId));
    if (!category || category.kind !== type.toUpperCase()) throw new BillError("分类不匹配");
    categoryId = category.id;
  } else if (body.categoryName || body.subcategoryName) {
    const category = await ensureCategory(
      taxonomyUserId,
      type.toUpperCase() as "EXPENSE" | "INCOME",
      body.categoryName,
      body.subcategoryName,
    );
    categoryId = category.id;
  } else if (body.categoryLabel) {
    // 共享账本里手写的分类：能对齐到已有分类就对齐，否则只存文本
    const label = String(body.categoryLabel).trim();
    if (label) {
      const hit = await prisma.billCategory.findFirst({
        where: { ownerId: taxonomyUserId, kind: type.toUpperCase() as "EXPENSE" | "INCOME", name: label },
      });
      if (hit) categoryId = hit.id;
      else categoryLabel = label;
    }
  }

  const memberName = String(body.memberName || "").trim() || null;
  // 分摊人：传了数组才写（空数组 = 这笔付款人自己承担）；没传保持 null = 全员平分
  const shareWith = Array.isArray(body.shareWith) ? encodeShareWith(body.shareWith) : null;

  const ownerId = book.ownerId;
  if (externalId) {
    const dup = await prisma.billTransaction.findFirst({
      where: { ownerId, source, externalId },
      select: { id: true },
    });
    if (dup) return { id: dup.id, skipped: true };
  }

  const countExpense = body.countExpense !== false;
  const followNote = String(body.followNote ?? "").trim() || null;
  const note = withFollowNote(body.note ? String(body.note) : null, countExpense);
  const followed = hasFollowUp({ followNote, countExpense });

  const created = await prisma.billTransaction.create({
    data: {
      ...(keepId ? { id: keepId } : {}),
      ownerId,
      bookId: book.id,
      type: type.toUpperCase() as BillTxType,
      amountCents,
      accountId: account ? account.id : null,
      toAccountId,
      categoryId,
      categoryLabel,
      occurredAt: new Date(`${occurredAt.replace(" ", "T")}+08:00`),
      payee: body.payee ? String(body.payee) : null,
      note,
      memberName,
      shareWith: shareWith ?? undefined,
      source,
      externalId,
      recurringRuleId,
      followNote,
      countExpense,
      followAction: body.followAction ?? "NONE",
      followStatus: followed ? "PENDING" : "NONE",
      refundCents: body.refundCents ?? null,
      refundedAt: body.refundedAt ?? null,
    },
    select: { id: true },
  });

  if (Array.isArray(body.images)) await saveImages(created.id, body.images);
  if (keepId != null || followed) {
    await syncBillFollowTodo({
      id: created.id,
      ownerId,
      amountCents,
      payee: body.payee ? String(body.payee) : null,
      note,
      followNote,
      categoryLabel,
      countExpense,
    });
  }
  return { id: created.id, skipped: false };
}

/** 逐笔呈现给前端，字段名保持与旧 API 一致（金额转元、枚举转小写） */
export function presentTransaction(row: TransactionRow, images: string[] = []) {
  const category = row.parentName
    ? `${row.parentName} / ${row.categoryName}`
    : row.categoryName || row.categoryLabel || "";
  return {
    id: row.id,
    bookId: row.bookId ?? null,
    type: row.type.toLowerCase(),
    amount: centsToYuan(row.amountCents),
    accountId: row.accountId,
    accountName: row.accountName,
    toAccountId: row.toAccountId,
    toAccountName: row.toAccountName,
    categoryId: row.categoryId,
    categoryName: category,
    categoryLabel: row.categoryLabel || "",
    memberName: row.memberName || "",
    // null 表示没设过（老账单），算账时按全员平分
    shareWith: parseShareWith(row.shareWith),
    occurredAt: `${fmtLocal(row.occurredAt)}`,
    payee: row.payee || "",
    note: row.note || "",
    source: row.source.toLowerCase(),
    images: images || [],
    // 后续动作 → 待办（新增字段）
    followAction: row.followAction.toLowerCase(),
    followStatus: row.followStatus.toLowerCase(),
    refundAmount: row.refundCents == null ? "" : centsToYuan(row.refundCents),
    refundedAt: row.refundedAt ? fmtLocal(row.refundedAt) : "",
    followNote: row.followNote || "",
    countExpense: row.countExpense !== false,
  };
}

/**
 * 库里存的是 UTC 墙钟（timestamp 无时区列），还原成「记账当时的本地时间」字符串。
 * 约定：本地 21:23:27 → 库里 13:23:27。
 */
function fmtLocal(d: Date): string {
  const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
}

/** 取单笔（带权限判定），找不到返回 null */
export async function getTransaction(actor: Actor, id: number): Promise<BillTransaction | null> {
  const row = await prisma.billTransaction.findUnique({ where: { id: Number(id) } });
  if (!row) return null;
  if (row.bookId) {
    const book = await canSeeBook(actor, row.bookId);
    if (!book) return null;
    return row;
  }
  if (row.ownerId !== actor.id && actor.role !== "ADMIN") return null;
  return row;
}

/** 删除单笔 */
export async function deleteTransaction(actor: Actor, id: number) {
  const row = await getTransaction(actor, id);
  if (!row) throw new BillError("账单不存在", 404);
  await removeBillFollowTodo(row.id);
  await prisma.billTransaction.delete({ where: { id: row.id } });
}

/**
 * 改一笔账单（旧 PATCH /api/transactions/:id）。
 *
 * 策略沿用旧实现：**先删再插**。改了金额/账户/分类之后，归属账本、分类树、
 * 账户归并都要重新走一遍，重新插一次最省事。差别在于这里不套外层事务：
 * `insertTransaction` 用的是全局 prisma，包在事务里它读不到未提交的删除，
 * 反而会因重复 externalId 判定成「跳过」而把账单弄丢。改成显式快照回滚 ——
 * 插失败就把原样写回去，语义与旧实现一致。
 */
export async function updateTransaction(
  actor: Actor,
  id: number,
  body: TxInput,
): Promise<{ id: number; skipped: boolean }> {
  const current = await getTransaction(actor, id);
  if (!current) throw new BillError("账单不存在", 404);

  const book = current.bookId
    ? await canSeeBook(actor, current.bookId)
    : await ensurePersonalBook(actor.id);
  if (!book || !(await canWriteBook(actor, book))) {
    throw new BillError("没有这个账本的修改权限", 403);
  }

  const oldImages = (
    await prisma.billTransactionImage.findMany({
      where: { transactionId: current.id },
      orderBy: [{ sort: "asc" }, { id: "asc" }],
      select: { url: true },
    })
  ).map((row) => row.url);

  const payload: TxInput = {
    type: body.type ?? current.type.toLowerCase(),
    amountCents:
      body.amount != null ? (yuanToCents(body.amount) ?? current.amountCents) : current.amountCents,
    accountId: body.accountId !== undefined ? body.accountId : current.accountId,
    toAccountId: body.toAccountId !== undefined ? body.toAccountId : current.toAccountId,
    categoryId: body.categoryId !== undefined ? body.categoryId : current.categoryId,
    categoryLabel: body.categoryLabel !== undefined ? body.categoryLabel : current.categoryLabel,
    occurredAt: body.occurredAt ?? fmtLocal(current.occurredAt),
    payee: body.payee !== undefined ? body.payee : current.payee,
    note: body.note !== undefined ? body.note : current.note,
    memberName: body.memberName !== undefined ? body.memberName : current.memberName,
    bookId: current.bookId,
    // 图片：传了新数组就用新的，没传沿用原来的（避免改个备注把图弄丢）
    images: Array.isArray(body.images) ? body.images : oldImages,
    // 没传就沿用原来的分摊人（可能是 null = 全员平分）
    shareWith: Array.isArray(body.shareWith) ? body.shareWith : parseShareWith(current.shareWith),
    followNote: body.followNote !== undefined ? body.followNote : current.followNote,
    countExpense: body.countExpense !== undefined ? body.countExpense !== false : current.countExpense,
    followAction: current.followAction,
    refundCents: current.refundCents,
    refundedAt: current.refundedAt,
  };

  await prisma.billTransactionImage.deleteMany({ where: { transactionId: current.id } });
  await prisma.billTransaction.delete({ where: { id: current.id } });

  try {
    return await insertTransaction(
      actor,
      payload,
      current.source,
      current.externalId,
      current.recurringRuleId,
      current.id,
    );
  } catch (err) {
    // 回滚：把原样（含原 id）写回去，别让用户点一下「保存」就丢一条账单
    await prisma.billTransaction.create({
      data: {
        id: current.id,
        ownerId: current.ownerId,
        bookId: current.bookId,
        type: current.type,
        amountCents: current.amountCents,
        accountId: current.accountId,
        toAccountId: current.toAccountId,
        categoryId: current.categoryId,
        categoryLabel: current.categoryLabel,
        occurredAt: current.occurredAt,
        payee: current.payee,
        note: current.note,
        memberName: current.memberName,
        shareWith: parseShareWith(current.shareWith) ?? undefined,
        source: current.source,
        externalId: current.externalId,
        recurringRuleId: current.recurringRuleId,
        createdAt: current.createdAt,
        followAction: current.followAction,
        followStatus: current.followStatus,
        refundCents: current.refundCents,
        refundedAt: current.refundedAt,
        followNote: current.followNote,
        countExpense: current.countExpense,
      },
    });
    await saveImages(current.id, oldImages);
    throw err;
  }
}

/**
 * 清空流水（旧 DELETE /api/transactions）。必须显式传 confirm=确认。
 * 默认只清「当前可见账本范围」，传了 bookId 就只清那一个账本 —— 不会动别人的。
 */
export async function clearTransactions(actor: Actor, body: { confirm?: unknown; bookId?: unknown }) {
  if (String(body?.confirm ?? "").trim() !== "确认") throw new BillError("请输入确认");
  const asked = Number(body?.bookId) || 0;
  let ids: number[];
  if (asked) {
    const book = await canSeeBook(actor, asked);
    if (!book) throw new BillError("账本不存在", 404);
    ids = [book.id];
  } else {
    ids = await visibleBookIds(actor.id);
  }
  if (!ids.length) return { ok: true, deleted: 0 };
  const doomed = await prisma.billTransaction.findMany({
    where: { bookId: { in: ids } },
    select: { id: true },
  });
  if (doomed.length) {
    await prisma.todo.deleteMany({
      where: {
        source: "BILL",
        sourceBizId: { in: doomed.map((row) => `bill:${row.id}`) },
        status: { not: "DONE" },
      },
    });
  }
  const res = await prisma.billTransaction.deleteMany({ where: { bookId: { in: ids } } });
  return { ok: true, deleted: res.count };
}

/** 批量改分类：只改和分类同收支方向的账单 */
export async function bulkSetCategory(actor: Actor, ids: number[], categoryId: number | null) {
  const clean = ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!clean.length) throw new BillError("请先勾选账单");
  if (categoryId) {
    const category = await categoryOwned(actor.id, categoryId);
    if (!category) throw new BillError("分类不存在");
    const res = await prisma.billTransaction.updateMany({
      where: { ownerId: actor.id, type: category.kind, id: { in: clean } },
      data: { categoryId: category.id },
    });
    return { updated: res.count };
  }
  const res = await prisma.billTransaction.updateMany({
    where: { ownerId: actor.id, type: { in: ["EXPENSE", "INCOME"] }, id: { in: clean } },
    data: { categoryId: null },
  });
  return { updated: res.count };
}
