/**
 * 旧账单 API 兼容层 —— 路径前缀 `/legacy/api/*`
 *
 * 为什么不是 `/api/*`：Auth.js 占用了 `/api/auth/[...nextauth]`，
 * 那是个 catch-all，会把老的 `/api/auth/login`、`/api/auth/register` 一并吞掉。
 * 所以整层统一挪到 `/legacy` 前缀下 —— 安卓端「轻记」只需把设置页里的
 * **服务器地址**改成 `http://<nas>:3000/legacy` 即可（`apiBase` 本来就是可配的），
 * 客户端里所有地址都用 apiUrl() 拼（连图片也是），所以前缀不会漏。
 * 不需要重新打包 APK。
 *
 * 职责边界：**只做协议适配，不写业务逻辑**。
 * 校验、SQL、规则一律走 `@/modules/bill` 的 service 层；这里只负责
 *   ① 按旧路径分发  ② 解析 Bearer / 会话  ③ 套上与旧接口一致的响应外壳。
 *
 * 响应约定（必须与 cash-platform 一致，前端按此解析）：
 *   成功：`{ ... }` 原样返回
 *   失败：`{ message }` + HTTP 状态码
 *
 * 覆盖情况（对照旧 index.js 的 72 个路由）：
 *   已迁：health / auth(config,login,register) / me / users(,search,PATCH) /
 *        accounts(,POST,PATCH,merge,unmerge) / account-aliases(,POST,DELETE) /
 *        categories(,POST,PATCH,DELETE,prune,merge-duplicates) /
 *        books(,POST,PATCH,DELETE,members,participants,share) /
 *        share/:token(,entries) / image（代理，上传接口见 imagehost）/
 *        transactions(,POST,PATCH,PATCH category,count,DELETE,DELETE :id) /
 *        summary / trend / calendar / duplicates(,ignore,resolve) /
 *        recurring(,POST,PATCH,DELETE) / category-rules(,POST,DELETE,apply) /
 *        transfer-rules(,POST,PATCH,DELETE) / cmb-text-fixes(,POST,PATCH,DELETE) /
 *        upload/image、share/:token/upload（图床未配置时返回 501）
 *   未迁：import(preview,commit,template) / export —— 一律返回 501 + { message }，
 *        不静默返回空数据。
 */
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  BillError,
  addBookMember,
  addBookParticipant,
  applyRules,
  billCalendar,
  billConfig,
  billSummary,
  billTrend,
  bookBillPeople,
  bookById,
  bookByShareToken,
  bookKindLabel,
  bookMembers,
  bookParticipants,
  bulkSetCategory,
  canSeeBook,
  centsToYuan,
  clearTransactions,
  computeAa,
  createAccount,
  createBook,
  createCategory,
  createCmbTextFix,
  createRule,
  createTransferRule,
  deleteAccountAlias,
  deleteBook,
  deleteCategory,
  deleteCategoryRule,
  deleteCmbTextFix,
  deleteRule,
  deleteTransaction,
  deleteTransferRule,
  ensurePersonalBook,
  findDuplicatePairs,
  fetchImage,
  groupDuplicates,
  ignorePairs,
  insertTransaction,
  isAllowedImageUrl,
  listAccountAliases,
  listAccountsWithBalance,
  listCategoryRules,
  listCmbTextFixes,
  listFlatCategories,
  listIgnores,
  listRules,
  listTransferRules,
  loginWithPassword,
  mergeAccount,
  mergeDuplicateCategories,
  presentAccount,
  presentBook,
  presentCmbFix,
  presentTransaction,
  presentTransferRule,
  presentWithImages,
  pruneCategories,
  publicUser,
  removeBookParticipant,
  removeBookMember,
  requireActor,
  requireAdmin,
  resolveDuplicates,
  roleInBook,
  runDueRules,
  saveAccountAlias,
  saveCategoryRule,
  seedAccounts,
  seedCategoryTree,
  setBookShare,
  signUser,
  toCategoryKind,
  toErrorResponse,
  transactionImages,
  transactionRows,
  transactionTotal,
  unignorePairs,
  unmergeAccount,
  updateAccount,
  updateBook,
  updateCategory,
  updateCmbTextFix,
  updateRule,
  updateTransaction,
  updateTransferRule,
  updateUser,
  uploadImage,
  type Actor,
} from "@/modules/bill";
import type { BillBook } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------- 上下文与路由表
interface Ctx {
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
  /** multipart 里的文件；JSON 请求下为空数组 */
  files: UploadedFile[];
  req: Request;
}

/** 上传文件的统一形态（把 Web File 读成 Buffer，service 层不碰 Web API） */
export interface UploadedFile {
  field: string;
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

type Handler = (ctx: Ctx) => Promise<unknown>;

const ROUTES: Array<{ method: string; path: string[]; handler: Handler }> = [];

/** 注册一条路由；路径里的 `:xxx` 是占位段 */
function route(method: string, path: string, handler: Handler) {
  ROUTES.push({ method, path: path.split("/").filter(Boolean), handler });
}

function match(method: string, segments: string[]) {
  for (const r of ROUTES) {
    if (r.method !== method || r.path.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < r.path.length; i += 1) {
      const seg = r.path[i];
      if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(segments[i]);
      else if (seg !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

// ---------------------------------------------------------------- 小工具
/** 注册开关：与旧 config.js 的 boolEnv(ALLOW_REGISTER, true) 同义 */
const allowRegister = () => {
  const raw = process.env.ALLOW_REGISTER;
  if (raw === undefined || raw === "") return true;
  return !["0", "false", "no"].includes(raw.toLowerCase());
};

async function loadUser(id: number) {
  const row = await prisma.user.findUnique({ where: { id } });
  if (!row) throw new BillError("账号不存在", 401);
  return row;
}

/** 账本呈现（与旧 bookPayload 一致） */
async function bookPayload(actor: Actor, row: BillBook) {
  const members = await bookMembers(row.id);
  return presentBook(row, {
    role: await roleInBook(actor, row),
    ownerName: members.find((m) => m.user_id === row.ownerId)?.display_name || "",
    members,
    participants: await bookParticipants(row.id),
    billPeople: await bookBillPeople(row.id),
  });
}

/** 分类的对外形态（含归档，前端恢复时需要） */
function presentCategoryRow(row: {
  id: number;
  name: string;
  parentId: number | null;
  kind: string;
  sort: number;
  archived: boolean;
}) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    kind: row.kind.toLowerCase(),
    sort: row.sort,
    archived: row.archived,
  };
}

/** 账户 id → 带余额的完整对象（写完立刻回读，前端不用再拉一次列表） */
async function accountPayload(userId: number, id: number) {
  const rows = await listAccountsWithBalance(userId);
  const found = rows.find((row) => row.id === id);
  if (!found) throw new BillError("账户不存在", 404);
  return presentAccount(found);
}

/** 只有 owner 或管理员能管这个账本 */
async function ownedBook(actor: Actor, id: number): Promise<BillBook> {
  const row = await bookById(id);
  if (!row || !(actor.role === "ADMIN" || row.ownerId === actor.id)) {
    throw new BillError("账本不存在", 404);
  }
  return row;
}

// ================================================================ 健康检查 / 认证
route("GET", "health", async () => ({ ok: true }));

route("GET", "auth/config", async () => {
  const users = await prisma.user.count();
  return { allowRegister: allowRegister() || users === 0, hasUsers: users > 0 };
});

route("POST", "auth/login", async ({ body }) => {
  return loginWithPassword(String(body.username ?? ""), String(body.password ?? ""));
});

route("POST", "auth/register", async ({ body }) => {
  const users = await prisma.user.count();
  if (users > 0 && !allowRegister()) throw new BillError("已关闭注册", 403);
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const displayName = String(body.displayName ?? username).trim();
  if (username.length < 2 || username.length > 32) throw new BillError("用户名需要 2 到 32 个字符");
  if (password.length < 6) throw new BillError("密码至少 6 位");
  const exists = await prisma.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    select: { id: true },
  });
  if (exists) throw new BillError("用户名已存在", 409);

  const created = await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      nickname: displayName || username,
      role: users === 0 ? "ADMIN" : "MEMBER",
    },
  });
  // 旧系统注册后会 seedUser：默认账户 + 分类树 + 个人账本
  await seedAccounts(created.id);
  await seedCategoryTree(created.id);
  await ensurePersonalBook(created.id);

  return { token: await signUser(created), user: publicUser(created) };
});

// ================================================================ 用户
route("GET", "me", async ({ req }) => {
  const actor = await requireActor(req);
  return { user: publicUser(await loadUser(actor.id)) };
});

route("GET", "users", async ({ req }) => {
  await requireAdmin(req);
  const rows = await prisma.user.findMany({ orderBy: { id: "asc" } });
  return { users: rows.map(publicUser) };
});

route("GET", "users/search", async ({ req, query }) => {
  await requireActor(req);
  const raw = String(query.q ?? "").trim();
  if (!raw) return { users: [] };
  const limit = Math.min(Number(query.limit) || 20, 50);
  // % 和 _ 是 LIKE 通配符，先转义，否则输个下划线会变成「任意一个字符」
  const escaped = raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const like = `%${escaped}%`;
  const prefix = `${escaped}%`;
  const bookId = Number(query.excludeBookId) || 0;

  const params: unknown[] = [like, like];
  let sql = `
    SELECT u.id, u.username, u.nickname AS display_name
    FROM "user" u
    WHERE u.status = 'ACTIVE'
      AND (u.username ILIKE $1 OR u.nickname ILIKE $2)`;
  if (bookId) {
    params.push(bookId);
    // 已经是这个账本成员的不用再列出来
    sql += ` AND NOT EXISTS (
      SELECT 1 FROM bill_book_member m WHERE m."bookId" = $${params.length} AND m."userId" = u.id
    )`;
  }
  const at = params.length;
  sql += ` ORDER BY (u.username = $${at + 1}) DESC, (u.username ILIKE $${at + 2}) DESC, u.username LIMIT $${at + 3}`;
  params.push(raw, prefix, limit);

  const rows = await prisma.$queryRawUnsafe<Array<{ id: number; username: string; display_name: string }>>(
    sql,
    ...params,
  );
  return {
    users: rows.map((r) => ({ id: Number(r.id), username: r.username, displayName: r.display_name })),
  };
});

route("PATCH", "users/:id", async ({ req, params, body }) => {
  const actor = await requireAdmin(req);
  const row = await updateUser(actor, Number(params.id), body);
  return { user: publicUser(row) };
});

// ================================================================ 账户
route("GET", "accounts", async ({ req }) => {
  const actor = await requireActor(req);
  return { accounts: (await listAccountsWithBalance(actor.id)).map(presentAccount) };
});

route("POST", "accounts", async ({ req, body }) => {
  const actor = await requireActor(req);
  const created = await createAccount(actor.id, body);
  return { account: await accountPayload(actor.id, created.id) };
});

route("POST", "accounts/merge", async ({ req, body }) => {
  const actor = await requireActor(req);
  const target = await mergeAccount(actor.id, Number(body.sourceId), Number(body.targetId));
  return { account: await accountPayload(actor.id, target.id) };
});

route("POST", "accounts/unmerge", async ({ req, body }) => {
  const actor = await requireActor(req);
  const row = await unmergeAccount(actor.id, Number(body.accountId));
  return { account: await accountPayload(actor.id, row.id) };
});

route("PATCH", "accounts/:id", async ({ req, params, body }) => {
  const actor = await requireActor(req);
  const updated = await updateAccount(actor.id, Number(params.id), body);
  return { account: await accountPayload(actor.id, updated.id) };
});

// ================================================================ 账户别名
route("GET", "account-aliases", async ({ req }) => {
  const actor = await requireActor(req);
  return { aliases: await listAccountAliases(actor.id) };
});

route("POST", "account-aliases", async ({ req, body }) => {
  const actor = await requireActor(req);
  await saveAccountAlias(actor.id, String(body.alias ?? ""), Number(body.accountId));
  return { aliases: await listAccountAliases(actor.id) };
});

route("DELETE", "account-aliases/:id", async ({ req, params }) => {
  const actor = await requireActor(req);
  await deleteAccountAlias(actor.id, Number(params.id));
  return { aliases: await listAccountAliases(actor.id) };
});

// ================================================================ 分类
route("GET", "categories", async ({ req }) => {
  const actor = await requireActor(req);
  return { categories: (await listFlatCategories(actor.id)).map(presentCategoryRow) };
});

route("POST", "categories", async ({ req, body }) => {
  const actor = await requireActor(req);
  const created = await createCategory(
    actor.id,
    toCategoryKind(body.kind),
    String(body.name ?? ""),
    body.parentId ? Number(body.parentId) : null,
  );
  return {
    category: presentCategoryRow({
      id: created.id,
      name: created.name,
      parentId: created.parentId,
      kind: created.kind,
      sort: created.sort,
      archived: created.archived,
    }),
  };
});

// 这两个批量接口必须注册在 :id 之前，否则会被当成 id=prune 的单条接口
route("POST", "categories/merge-duplicates", async ({ req }) => {
  const actor = await requireActor(req);
  return mergeDuplicateCategories(actor.id);
});

route("POST", "categories/prune", async ({ req }) => {
  const actor = await requireActor(req);
  return pruneCategories(actor.id);
});

route("PATCH", "categories/:id", async ({ req, params, body }) => {
  const actor = await requireActor(req);
  const row = await updateCategory(actor.id, Number(params.id), body);
  return {
    category: presentCategoryRow({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      kind: row.kind,
      sort: row.sort,
      archived: row.archived,
    }),
  };
});

route("DELETE", "categories/:id", async ({ req, params }) => {
  const actor = await requireActor(req);
  return deleteCategory(actor.id, Number(params.id));
});

// ================================================================ 账本
route("GET", "books", async ({ req }) => {
  const actor = await requireActor(req);
  const memberBookIds = (
    await prisma.billBookMember.findMany({
      where: { userId: actor.id },
      select: { bookId: true },
    })
  ).map((r) => r.bookId);

  const mine = await prisma.billBook.findMany({
    where: { OR: [{ ownerId: actor.id }, { id: { in: memberBookIds } }] },
    orderBy: [{ archived: "asc" }, { kind: "asc" }, { id: "asc" }],
  });
  let rows = mine;
  if (actor.role === "ADMIN") {
    // 管理员额外能看到所有人的账本
    const others = await prisma.billBook.findMany({
      where: { ownerId: { not: actor.id }, id: { notIn: memberBookIds } },
      orderBy: [{ ownerId: "asc" }, { id: "asc" }],
    });
    rows = [...mine, ...others];
  }
  return { books: await Promise.all(rows.map((row) => bookPayload(actor, row))) };
});

route("POST", "books", async ({ req, body }) => {
  const actor = await requireActor(req);
  const row = await createBook(actor, body);
  return { book: await bookPayload(actor, row) };
});

route("GET", "books/:id", async ({ req, params }) => {
  const actor = await requireActor(req);
  const row = await bookById(Number(params.id));
  if (!row) throw new BillError("账本不存在", 404);
  const payload = await bookPayload(actor, row);
  if (!payload.role) throw new BillError("账本不存在", 404);
  return { book: payload };
});

route("PATCH", "books/:id", async ({ req, params, body }) => {
  const actor = await requireActor(req);
  const row = await updateBook(actor, Number(params.id), body);
  return { book: await bookPayload(actor, row) };
});

route("DELETE", "books/:id", async ({ req, params }) => {
  const actor = await requireActor(req);
  return deleteBook(actor, Number(params.id));
});

route("POST", "books/:id/members", async ({ req, params, body }) => {
  const actor = await requireActor(req);
  const row = await addBookMember(actor, Number(params.id), body);
  return { book: await bookPayload(actor, row) };
});

route("DELETE", "books/:id/members/:userId", async ({ req, params }) => {
  const actor = await requireActor(req);
  const row = await removeBookMember(actor, Number(params.id), Number(params.userId));
  return { book: await bookPayload(actor, row) };
});

// 参与人：账本里预设「都有谁」，AA 平摊按这批人算，记账时也是付款人的候选
route("POST", "books/:id/participants", async ({ req, params, body }) => {
  const actor = await requireActor(req);
  const row = await ownedBook(actor, Number(params.id));
  if (row.kind === "PERSONAL") throw new BillError("个人账本不用设参与人");
  const name = String(body.name ?? "").trim();
  if (!name) throw new BillError("请填写名字");
  if (name.length > 24) throw new BillError("名字太长了");
  await addBookParticipant(row.id, name);
  return { book: await bookPayload(actor, row) };
});

route("DELETE", "books/:id/participants/:participantId", async ({ req, params }) => {
  const actor = await requireActor(req);
  const row = await ownedBook(actor, Number(params.id));
  await removeBookParticipant(row.id, Number(params.participantId));
  return { book: await bookPayload(actor, row) };
});

// 分享链接：开就生成 token，关就作废。writable 为真才能在分享页补账
route("POST", "books/:id/share", async ({ req, params, body }) => {
  const actor = await requireActor(req);
  const row = await setBookShare(actor, Number(params.id), body);
  return { book: await bookPayload(actor, row) };
});

// ================================================================ 账单流水
route("GET", "transactions", async ({ req, query }) => {
  const actor = await requireActor(req);
  const limit = Math.min(
    Math.max(Number(query.limit) || billConfig.pagination.transactionsDefault, 1),
    billConfig.pagination.transactionsMax,
  );
  const offset = Math.max(Number(query.offset) || 0, 0);

  const rows = await transactionRows(actor, query, limit, offset);
  const totals = await transactionTotal(actor, query);
  const images = await transactionImages(rows.map((row) => row.id));

  return {
    transactions: rows.map((row) => presentTransaction(row, images.get(row.id) || [])),
    total: totals.count,
    summary: {
      expense: centsToYuan(totals.expenseCents),
      income: centsToYuan(totals.incomeCents),
      net: centsToYuan(totals.incomeCents - totals.expenseCents),
    },
  };
});

route("POST", "transactions", async ({ req, body }) => {
  const actor = await requireActor(req);
  const { id } = await insertTransaction(actor, body as never);
  return { transaction: await presentWithImages(actor, id) };
});

// 批量改分类。必须放在 transactions/:id 前面，否则会被当成 id=category 的单条接口
route("PATCH", "transactions/category", async ({ req, body }) => {
  const actor = await requireActor(req);
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
  const categoryId = body.categoryId ? Number(body.categoryId) : null;
  return bulkSetCategory(actor, ids, categoryId);
});

route("GET", "transactions/count", async ({ req, query }) => {
  const actor = await requireActor(req);
  return { count: (await transactionTotal(actor, query)).count };
});

route("PATCH", "transactions/:id", async ({ req, params, body }) => {
  const actor = await requireActor(req);
  const { id } = await updateTransaction(actor, Number(params.id), body as never);
  return { transaction: await presentWithImages(actor, id) };
});

route("DELETE", "transactions", async ({ req, body }) => {
  const actor = await requireActor(req);
  return clearTransactions(actor, body);
});

route("DELETE", "transactions/:id", async ({ req, params }) => {
  const actor = await requireActor(req);
  await deleteTransaction(actor, Number(params.id));
  return { ok: true };
});

// ================================================================ 报表
route("GET", "summary", async ({ req, query }) => {
  const actor = await requireActor(req);
  return billSummary(actor, query);
});

route("GET", "trend", async ({ req, query }) => {
  const actor = await requireActor(req);
  return billTrend(actor, query);
});

route("GET", "calendar", async ({ req, query }) => {
  const actor = await requireActor(req);
  return billCalendar(actor, query);
});

// ================================================================ 查重
route("GET", "duplicates", async ({ req, query }) => {
  const actor = await requireActor(req);
  const bookId = Number(query.bookId) || 0;
  if (bookId && !(await canSeeBook(actor, bookId))) throw new BillError("账本不存在", 404);

  const pairs = await findDuplicatePairs(actor, {
    bookId,
    type: query.type,
    window: query.window,
    minScore: query.minScore,
    minAmount: query.minAmount,
    from: query.from,
    to: query.to,
    sort: query.sort,
  });
  const ignored = new Set(await listIgnores(actor.id));
  const groups = groupDuplicates(pairs, { sort: query.sort }).filter(
    (group) => !ignored.has(group.key),
  );
  return {
    pairs,
    groups,
    ignoredCount: ignored.size,
    // 能省下的钱 = 每组留一条，其余都算重复
    duplicateAmount: groups
      .reduce((sum, group) => sum + Number(group.amount) * (group.count - 1), 0)
      .toFixed(2),
  };
});

// 支持一次忽略多对：body { key } 或 { keys: [...] }
route("POST", "duplicates/ignore", async ({ req, body, query }) => {
  const actor = await requireActor(req);
  const keys = Array.isArray(body.keys)
    ? body.keys.map((k) => String(k || "")).filter(Boolean)
    : [String(body.key || query.key || "")].filter(Boolean);
  if (!keys.length) throw new BillError("缺少 key");
  return ignorePairs(actor.id, keys);
});

route("DELETE", "duplicates/ignore", async ({ req, query }) => {
  const actor = await requireActor(req);
  return unignorePairs(actor.id, query.key ?? null);
});

route("POST", "duplicates/resolve", async ({ req, body }) => {
  const actor = await requireActor(req);
  return resolveDuplicates(actor, body);
});

// ================================================================ 定期账单
route("GET", "recurring", async ({ req, query }) => {
  const actor = await requireActor(req);
  return { rules: await listRules(actor, query.bookId) };
});

route("POST", "recurring", async ({ req, body }) => {
  const actor = await requireActor(req);
  return { rule: await createRule(actor, body) };
});

// 手动触发一轮定期入账（排查用；正常情况下由 worker 定时扫描）
route("POST", "recurring/run", async ({ req }) => {
  const actor = await requireActor(req);
  return runDueRules(actor.id);
});

route("PATCH", "recurring/:id", async ({ req, params, body }) => {
  const actor = await requireActor(req);
  return { rule: await updateRule(actor, Number(params.id), body) };
});

route("DELETE", "recurring/:id", async ({ req, params }) => {
  const actor = await requireActor(req);
  return deleteRule(actor, Number(params.id));
});

// ================================================================ 自动分类规则
route("GET", "category-rules", async ({ req }) => {
  const actor = await requireActor(req);
  return { rules: await listCategoryRules(actor.id) };
});

route("POST", "category-rules", async ({ req, body }) => {
  const actor = await requireActor(req);
  return saveCategoryRule(actor.id, String(body.keyword ?? ""), Number(body.categoryId));
});

route("DELETE", "category-rules/:id", async ({ req, params }) => {
  const actor = await requireActor(req);
  return deleteCategoryRule(actor.id, Number(params.id));
});

// 把规则套到已有账单上。默认只补未分类的，避免覆盖已经分好的
route("POST", "category-rules/apply", async ({ req, body }) => {
  const actor = await requireActor(req);
  const dryRun = !!body.dryRun;
  const onlyUncategorized = body.onlyUncategorized !== false;
  return applyRules(actor.id, onlyUncategorized, dryRun);
});

// ================================================================ 转账规则
route("GET", "transfer-rules", async ({ req }) => {
  const actor = await requireActor(req);
  return { rules: (await listTransferRules(actor.id)).map(presentTransferRule) };
});

route("POST", "transfer-rules", async ({ req, body }) => {
  const actor = await requireActor(req);
  return { rule: presentTransferRule(await createTransferRule(actor.id, body)) };
});

route("PATCH", "transfer-rules/:id", async ({ req, params, body }) => {
  const actor = await requireActor(req);
  return { rule: presentTransferRule(await updateTransferRule(actor.id, Number(params.id), body)) };
});

route("DELETE", "transfer-rules/:id", async ({ req, params }) => {
  const actor = await requireActor(req);
  await deleteTransferRule(actor.id, Number(params.id));
  return { ok: true };
});

// ================================================================ 招行乱码修复
route("GET", "cmb-text-fixes", async ({ req }) => {
  const actor = await requireActor(req);
  return { fixes: await listCmbTextFixes(actor.id) };
});

route("POST", "cmb-text-fixes", async ({ req, body }) => {
  const actor = await requireActor(req);
  return { fix: presentCmbFix(await createCmbTextFix(actor.id, body)) };
});

route("PATCH", "cmb-text-fixes/:id", async ({ req, params, body }) => {
  const actor = await requireActor(req);
  return { fix: presentCmbFix(await updateCmbTextFix(actor.id, Number(params.id), body)) };
});

route("DELETE", "cmb-text-fixes/:id", async ({ req, params }) => {
  const actor = await requireActor(req);
  return deleteCmbTextFix(actor.id, Number(params.id));
});

// ================================================================ 图片（图床）
// 服务端转发到图床，token 不出服务端；未配置图床时返回 501
route("POST", "upload/image", async ({ req, files }) => {
  await requireActor(req);
  const file = files[0];
  return uploadImage({
    buffer: file?.buffer,
    mimetype: file?.mimetype,
    filename: file?.filename,
  });
});

// 图床是自签证书，浏览器直连会加载失败，统一走这里代理
route("GET", "image", async ({ query }) => {
  const url = String(query.u || "");
  if (!url) throw new BillError("缺少地址");
  if (!isAllowedImageUrl(url)) throw new BillError("这个地址不允许");
  const { body, contentType } = await fetchImage(url);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${billConfig.imageProxy.cacheTtlSeconds}`,
    },
  });
});

// ================================================================ 免登录分享
route("GET", "share/:token", async ({ params, query }) => {
  const book = await bookByShareToken(String(params.token));
  if (!book) throw new BillError("链接已失效", 404);
  // 分享页以「账本 owner」的身份读：这里没有登录态，权限判定必须收在 bookId 上，
  // 绝不能顺着 query 放开到别的账本
  const owner: Actor = { id: book.ownerId, role: "MEMBER" };
  const scope = { bookId: book.id };

  const rows = await transactionRows(owner, scope, 200);
  const totals = await transactionTotal(owner, scope);
  const images = await transactionImages(rows.map((row) => row.id));

  // AA 要按每笔账单自己勾选的分摊人算，所以逐笔取
  const billRows = await prisma.$queryRawUnsafe<
    Array<{ kind: string; member_name: string; amount_cents: bigint; share_with: unknown }>
  >(
    `SELECT LOWER(t.type::text) AS kind,
            COALESCE(NULLIF(TRIM(t."memberName"), ''), '未填') AS member_name,
            t."amountCents" AS amount_cents,
            t."shareWith" AS share_with
     FROM bill_transaction t
     WHERE t."bookId" = $1 AND t.type IN ('EXPENSE', 'INCOME')`,
    book.id,
  );
  const presetNames = (await bookParticipants(book.id)).map((p) => p.name);
  // 没开 AA 的账本只记账不算账，分享页也不展示平摊
  const aa = book.aaEnabled ? computeAa(billRows, presetNames) : null;
  // 参与人 = 预设 + 账单里付过款/收过款的人，补账下拉里都能直接选
  const allParticipants = [
    ...new Set([...presetNames, ...(await bookBillPeople(book.id)).map((p) => p.name)]),
  ];

  return {
    book: {
      id: book.id,
      name: book.name,
      kind: book.kind.toLowerCase(),
      kindLabel: bookKindLabel(book.kind),
      aaEnabled: !!book.aaEnabled,
      writable: !!book.shareWritable,
      // 参与人带过去，补账时不用自己打名字，免得同一个人打成两个名字、AA 算错
      participants: book.aaEnabled ? allParticipants : [],
    },
    summary: {
      expense: centsToYuan(totals.expenseCents),
      income: centsToYuan(totals.incomeCents),
      net: centsToYuan(totals.incomeCents - totals.expenseCents),
    },
    aa,
    entries: rows.map((row) => presentTransaction(row, images.get(row.id) || [])),
  };
});

route("POST", "share/:token/entries", async ({ params, body }) => {
  const book = await bookByShareToken(String(params.token));
  if (!book) throw new BillError("链接已失效", 404);
  if (!book.shareWritable) throw new BillError("这个分享是只读的，不能补账", 403);
  const memberName = String(body.memberName ?? "").trim();
  if (!memberName) throw new BillError("请填写你的名字");
  const owner: Actor = { id: book.ownerId, role: "MEMBER" };
  const { id } = await insertTransaction(
    owner,
    { ...(body as Record<string, unknown>), bookId: book.id, memberName } as never,
    "CUSTOM",
  );
  return { entry: await presentWithImages(owner, id) };
});

route("POST", "share/:token/upload", async ({ params, files }) => {
  const book = await bookByShareToken(String(params.token));
  if (!book) throw new BillError("链接已失效", 404);
  if (!book.shareWritable) throw new BillError("这个分享是只读的，不能上传图片", 403);
  const file = files[0];
  return uploadImage({
    buffer: file?.buffer,
    mimetype: file?.mimetype,
    filename: file?.filename,
  });
});

// ================================================================ 分发
const MAX_UPLOAD_FILES = 30;

/**
 * 适配层入口。**只用 Web 标准 Request/Response**，不依赖 next/server ——
 * 这样它能被脚本直接调用做端到端验证，也不会把 Next 的类型带进模块层。
 *
 * @param req       原始请求（取 header / body / url）
 * @param method    HTTP 方法
 * @param segments  `/legacy/api/` 之后的路径段，例如 ['transactions','count']
 */
export async function handleLegacyRequest(
  req: Request,
  method: string,
  segments: string[],
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const data = await dispatch(req, method.toUpperCase(), segments, query);
    if (data instanceof Response) return data;
    return Response.json(data ?? {});
  } catch (err) {
    const { message, status } = toErrorResponse(err);
    return Response.json({ message }, { status });
  }
}

/** query 来自 URL，body/files 视 content-type 从请求体里取 */
async function dispatch(
  req: Request,
  method: string,
  segments: string[],
  query: Record<string, string>,
) {
  const contentType = req.headers.get("content-type") || "";
  const body: Record<string, unknown> = {};
  const files: UploadedFile[] = [];

  if (method !== "GET" && contentType.includes("application/json")) {
    Object.assign(body, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  } else if (method !== "GET" && contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (form) {
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") {
          body[key] = value;
          continue;
        }
        if (files.length >= MAX_UPLOAD_FILES) continue;
        files.push({
          field: key,
          filename: value.name || "upload",
          mimetype: value.type || "application/octet-stream",
          buffer: Buffer.from(await value.arrayBuffer()),
        });
      }
    }
  }

  const hit = match(method, segments);
  if (!hit) throw new BillError(`接口尚未迁移：${method} /legacy/api/${segments.join("/")}`, 501);
  return hit.handler({ params: hit.params, query, body, files, req });
}
