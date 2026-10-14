/**
 * 账本数据访问层。
 *
 * 替代 cash-platform/server/src/books.js：账本、成员、参与人、分享链接、
 * 账单图片，以及「谁能看 / 谁能改 / 谁能记账」三档权限判定。
 *
 * 权限三档（沿用旧系统语义）：
 *   canSeeBook    看：owner / 成员 / 管理员
 *   canWriteBook  记账：owner / 成员 / 管理员
 *   canManageBook 改设置、加成员、开分享、删除：仅 owner / 管理员
 */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { BillBook, BillBookKind, Role } from "@prisma/client";
import { BillError } from "./errors";

export const BOOK_KINDS: BillBookKind[] = ["PERSONAL", "TRAVEL", "FAMILY", "AA"];

export function bookKindLabel(kind: BillBookKind): string {
  return (
    { PERSONAL: "个人", TRAVEL: "出游共享", FAMILY: "家庭", AA: "AA" } as Record<string, string>
  )[kind] || "账本";
}

/** 当前操作者的最小身份（管理员判定需要） */
export interface Actor {
  id: number;
  role: Role;
}

export async function bookById(id: number): Promise<BillBook | null> {
  return prisma.billBook.findUnique({ where: { id: Number(id) } });
}

/** 账本成员（带昵称），供前端展示与权限校验 */
export async function bookMembers(bookId: number) {
  const rows = await prisma.billBookMember.findMany({
    where: { bookId: Number(bookId) },
    orderBy: { id: "asc" },
  });
  if (!rows.length) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.userId) } },
    select: { id: true, username: true, nickname: true },
  });
  const map = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({
    user_id: r.userId,
    role: r.role,
    display_name: map.get(r.userId)?.nickname ?? "",
    username: map.get(r.userId)?.username ?? "",
  }));
}

/** 参与人：账本里预设的「都有谁」，不用登录账号也能算 AA，记账时当付款人候选 */
export async function bookParticipants(bookId: number) {
  return prisma.billBookParticipant.findMany({
    where: { bookId: Number(bookId) },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
}

/**
 * 账单里实际出现过的人：付款人（支出）+ 收款人（收入）。
 * 预设名单里没写的也要算进 AA，免得「付过钱但没预设」的人被漏掉、
 * 或者「只退款」的人被当成没参与。
 */
export async function bookBillPeople(bookId: number) {
  const rows = await prisma.billTransaction.findMany({
    where: {
      bookId: Number(bookId),
      type: { in: ["EXPENSE", "INCOME"] },
      memberName: { not: null },
    },
    select: { memberName: true, type: true },
    distinct: ["memberName", "type"],
  });
  const map = new Map<string, { name: string; expense: boolean; income: boolean }>();
  for (const row of rows) {
    const name = String(row.memberName || "").trim();
    if (!name) continue;
    const item = map.get(name) || { name, expense: false, income: false };
    if (row.type === "EXPENSE") item.expense = true;
    if (row.type === "INCOME") item.income = true;
    map.set(name, item);
  }
  return [...map.values()];
}

export async function addBookParticipant(bookId: number, name: string) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const max = await prisma.billBookParticipant.aggregate({
    where: { bookId: Number(bookId) },
    _max: { sort: true },
  });
  return prisma.billBookParticipant.upsert({
    where: { bookId_name: { bookId: Number(bookId), name: clean } },
    create: { bookId: Number(bookId), name: clean, sort: (max._max.sort ?? 0) + 1 },
    update: {},
    select: { id: true, name: true },
  });
}

export async function removeBookParticipant(bookId: number, participantId: number) {
  await prisma.billBookParticipant.deleteMany({
    where: { bookId: Number(bookId), id: Number(participantId) },
  });
}

/** 每个用户都要有自己的个人账本，找不到就建一个并把自己加成 owner */
export async function ensurePersonalBook(userId: number): Promise<BillBook> {
  const found = await prisma.billBook.findFirst({ where: { ownerId: userId, kind: "PERSONAL" } });
  if (found) return found;
  return prisma.$transaction(async (tx) => {
    const book = await tx.billBook.create({
      data: { ownerId: userId, name: "个人账本", kind: "PERSONAL" },
    });
    await tx.billBookMember.upsert({
      where: { bookId_userId: { bookId: book.id, userId } },
      create: { bookId: book.id, userId, role: "owner" },
      update: {},
    });
    return book;
  });
}

/** 我能看到的账本 id：自己建的 + 被加为成员的 */
export async function visibleBookIds(userId: number): Promise<number[]> {
  const [own, member] = await Promise.all([
    prisma.billBook.findMany({ where: { ownerId: userId }, select: { id: true } }),
    prisma.billBookMember.findMany({ where: { userId }, select: { bookId: true } }),
  ]);
  return [...new Set([...own.map((r) => r.id), ...member.map((r) => r.bookId)])];
}

export async function canSeeBook(actor: Actor, bookId: number): Promise<BillBook | null> {
  const row = await bookById(bookId);
  if (!row) return null;
  if (actor.role === "ADMIN") return row;
  if (row.ownerId === actor.id) return row;
  const member = await prisma.billBookMember.findUnique({
    where: { bookId_userId: { bookId: row.id, userId: actor.id } },
  });
  return member ? row : null;
}

export function canManageBook(actor: Actor, row: BillBook | null): boolean {
  if (!row) return false;
  return actor.role === "ADMIN" || row.ownerId === actor.id;
}

export async function canWriteBook(actor: Actor, row: BillBook | null): Promise<boolean> {
  if (!row) return false;
  if (actor.role === "ADMIN" || row.ownerId === actor.id) return true;
  const member = await prisma.billBookMember.findUnique({
    where: { bookId_userId: { bookId: row.id, userId: actor.id } },
  });
  return !!member;
}

export async function roleInBook(actor: Actor, row: BillBook | null): Promise<string | null> {
  if (!row) return null;
  if (row.ownerId === actor.id) return "owner";
  const member = await prisma.billBookMember.findUnique({
    where: { bookId_userId: { bookId: row.id, userId: actor.id } },
  });
  return member ? member.role : actor.role === "ADMIN" ? "admin" : null;
}

/** 分享令牌：9 字节随机，base64url（够短、可直接进 URL） */
export function newShareToken(): string {
  return crypto.randomBytes(9).toString("base64url");
}

/** 旧 API 传进来的账本类型是小写字符串 */
function toBookKind(value: unknown, fallback: BillBookKind): BillBookKind {
  const raw = String(value ?? "").trim().toUpperCase();
  return (BOOK_KINDS as string[]).includes(raw) ? (raw as BillBookKind) : fallback;
}

const SHARED_BOOK_KINDS: BillBookKind[] = ["TRAVEL", "FAMILY", "AA"];

/** 新建账本（旧 POST /api/books）。默认类型是出游（与旧实现一致）。 */
export async function createBook(
  actor: Actor,
  body: { name?: unknown; kind?: unknown; aaEnabled?: unknown },
): Promise<BillBook> {
  const name = String(body.name ?? "").trim();
  if (!name) throw new BillError("请填写账本名", 400);
  const kind = toBookKind(body.kind, "TRAVEL");
  if (kind === "PERSONAL") {
    const exists = await prisma.billBook.findFirst({
      where: { ownerId: actor.id, kind: "PERSONAL" },
      select: { id: true },
    });
    if (exists) throw new BillError("已经有一个个人账本了", 409);
  }
  // AA 账本默认开着；出游/家庭默认只记账，创建时可以自己勾上
  const aaEnabled = body.aaEnabled != null ? !!body.aaEnabled : kind === "AA";

  let book: BillBook;
  try {
    book = await prisma.$transaction(async (tx) => {
      const created = await tx.billBook.create({
        data: { ownerId: actor.id, name, kind, aaEnabled },
      });
      await tx.billBookMember.upsert({
        where: { bookId_userId: { bookId: created.id, userId: actor.id } },
        create: { bookId: created.id, userId: actor.id, role: "owner" },
        update: {},
      });
      return created;
    });
  } catch {
    throw new BillError("已经有同名账本了", 409);
  }
  return book;
}

/**
 * 改账本（旧 PATCH /api/books/:id）。
 * 个人账本不能改类型，AA 开关在个人账本上永远关、切到 AA 类型自动开。
 */
export async function updateBook(
  actor: Actor,
  id: number,
  body: { name?: unknown; kind?: unknown; archived?: unknown; aaEnabled?: unknown },
): Promise<BillBook> {
  const row = await canManageBookRow(actor, id);
  const name = body.name != null ? String(body.name).trim() : row.name;
  if (!name) throw new BillError("请填写账本名");
  const archived = body.archived != null ? !!body.archived : row.archived;
  const requestedKind =
    body.kind != null && ["TRAVEL", "FAMILY", "AA"].includes(String(body.kind).toUpperCase())
      ? (String(body.kind).toUpperCase() as BillBookKind)
      : null;
  const kind = requestedKind && row.kind !== "PERSONAL" ? requestedKind : row.kind;

  let aaEnabled = body.aaEnabled != null ? !!body.aaEnabled : row.aaEnabled;
  if (kind === "AA") aaEnabled = true;
  if (row.kind === "PERSONAL") aaEnabled = false;

  try {
    return await prisma.billBook.update({
      where: { id: row.id },
      data: { name, kind, archived, aaEnabled },
    });
  } catch {
    throw new BillError("已经有同名账本了", 409);
  }
}

/** 删账本：有流水就归档（并关掉分享），否则真删。个人账本不允许删。 */
export async function deleteBook(actor: Actor, id: number) {
  const row = await canManageBookRow(actor, id);
  if (row.kind === "PERSONAL") throw new BillError("个人账本不能删除");
  const used = await prisma.billTransaction.count({ where: { bookId: row.id } });
  if (used > 0) {
    await prisma.billBook.update({
      where: { id: row.id },
      data: { archived: true, shareEnabled: false },
    });
    return { archived: true, deleted: false };
  }
  await prisma.$transaction(async (tx) => {
    await tx.billBookMember.deleteMany({ where: { bookId: row.id } });
    await tx.billBookParticipant.deleteMany({ where: { bookId: row.id } });
    await tx.billBook.delete({ where: { id: row.id } });
  });
  return { archived: false, deleted: true };
}

/** 取出账本并断言「管得着」，否则一律按 404 处理（不泄露他人账本是否存在） */
async function canManageBookRow(actor: Actor, id: number): Promise<BillBook> {
  const row = await bookById(id);
  if (!row || !canManageBook(actor, row)) throw new BillError("账本不存在", 404);
  return row;
}

/**
 * 找要加进来的协作者：前端搜索后点选会带 userId；手输用户名则精确匹配，
 * 找不到再退化成模糊匹配 —— 模糊命中多个人时报 409 让用户从搜索结果里挑。
 */
export async function pickMemberUser(body: { userId?: unknown; username?: unknown }) {
  const userId = Number(body?.userId) || 0;
  if (userId) return prisma.user.findUnique({ where: { id: userId } });

  const keyword = String(body?.username ?? "").trim();
  if (!keyword) return null;
  const exact = await prisma.user.findFirst({
    where: { username: { equals: keyword, mode: "insensitive" } },
  });
  if (exact) return exact;

  const hits = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { username: { contains: keyword, mode: "insensitive" } },
        { nickname: { contains: keyword, mode: "insensitive" } },
      ],
    },
    take: 2,
  });
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return { ambiguous: true as const, keyword };
  return null;
}

/** 加协作成员（旧 POST /api/books/:id/members） */
export async function addBookMember(actor: Actor, id: number, body: { userId?: unknown; username?: unknown }) {
  const row = await canManageBookRow(actor, id);
  if (row.kind === "PERSONAL") throw new BillError("个人账本不能加成员");
  const target = await pickMemberUser(body);
  if (!target) throw new BillError("用户不存在", 404);
  if ("ambiguous" in target) {
    throw new BillError(`「${target.keyword}」匹配到多个人，请从搜索结果里选`, 409);
  }
  await prisma.billBookMember.upsert({
    where: { bookId_userId: { bookId: row.id, userId: target.id } },
    create: { bookId: row.id, userId: target.id, role: "member" },
    update: {},
  });
  return row;
}

/** 移除协作成员（所有者不能移） */
export async function removeBookMember(actor: Actor, id: number, userId: number) {
  const row = await canManageBookRow(actor, id);
  if (Number(userId) === row.ownerId) throw new BillError("不能移除账本所有者");
  await prisma.billBookMember.deleteMany({ where: { bookId: row.id, userId: Number(userId) } });
  return row;
}

/**
 * 分享开关（旧 POST /api/books/:id/share）：
 * 开就生成 token（已有则复用），关就只是把 shareEnabled 置 false，token 留着 ——
 * 这样「关了再开」不会让已经发出去的旧链接突然复活。
 */
export async function setBookShare(
  actor: Actor,
  id: number,
  body: { enabled?: unknown; writable?: unknown },
): Promise<BillBook> {
  const row = await canManageBookRow(actor, id);
  if (row.kind === "PERSONAL") throw new BillError("个人账本不能分享");

  const enabled = !(body.enabled === false || body.enabled === "false");
  const token = enabled ? row.shareToken || newShareToken() : row.shareToken;

  let writable = row.shareWritable;
  if (body.writable === false || body.writable === "false" || body.writable === 0) writable = false;
  else if (body.writable === true || body.writable === "true" || body.writable === 1) writable = true;

  return prisma.billBook.update({
    where: { id: row.id },
    data: { shareEnabled: enabled, shareToken: token, shareWritable: writable },
  });
}


/** 免登录链接只能命中「开着分享」的账本 */
export async function bookByShareToken(token: string): Promise<BillBook | null> {
  const key = String(token || "").trim();
  if (!key) return null;
  return prisma.billBook.findFirst({ where: { shareToken: key, shareEnabled: true } });
}

/** 批量取账单图片，返回 transactionId → url[] */
export async function transactionImages(ids: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (!ids.length) return map;
  const rows = await prisma.billTransactionImage.findMany({
    where: { transactionId: { in: ids } },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
  });
  for (const row of rows) {
    const list = map.get(row.transactionId) || [];
    list.push(row.url);
    map.set(row.transactionId, list);
  }
  return map;
}

/** 覆盖式保存账单图片，最多 9 张 */
export async function saveImages(transactionId: number, images: unknown) {
  if (!Array.isArray(images)) return;
  const urls = images
    .map((url) => String(url || "").trim())
    .filter(Boolean)
    .slice(0, 9);
  await prisma.$transaction(async (tx) => {
    await tx.billTransactionImage.deleteMany({ where: { transactionId } });
    for (let i = 0; i < urls.length; i += 1) {
      await tx.billTransactionImage.create({
        data: { transactionId, url: urls[i], sort: i },
      });
    }
  });
}

/** 对外的账本呈现，字段名与旧 API 保持一致 */
export async function presentBook(
  row: BillBook,
  opts: {
    role?: string | null;
    ownerName?: string;
    members?: Awaited<ReturnType<typeof bookMembers>>;
    participants?: Array<{ id: number; name: string }>;
    billPeople?: Array<{ name: string; expense: boolean; income: boolean }>;
  } = {},
) {
  const { role = null, ownerName = "", members = [], participants = [], billPeople = [] } = opts;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind.toLowerCase(),
    kindLabel: bookKindLabel(row.kind),
    ownerId: row.ownerId,
    ownerName,
    role,
    archived: !!row.archived,
    shareEnabled: !!row.shareEnabled,
    shareToken: row.shareToken || "",
    shareWritable: !!row.shareWritable,
    aaEnabled: !!row.aaEnabled,
    members: members.map((m) => ({
      id: m.user_id,
      name: m.display_name,
      username: m.username,
      role: m.role,
    })),
    participants: participants.map((p) => ({ id: p.id, name: p.name })),
    billPeople: billPeople.map((p) => ({
      name: p.name,
      expense: !!p.expense,
      income: !!p.income,
    })),
  };
}
