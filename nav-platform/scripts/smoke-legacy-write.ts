/**
 * 旧账单 API 兼容层 · 写入与配置类接口 端到端冒烟。
 *
 * 覆盖第二批迁移的 40+ 个路由：账户 / 分类 / 账本 / 流水 / 分享 / 查重 /
 * 定期 / 自动分类 / 转账规则 / 招行乱码 / 图床代理 / 未迁接口的 501。
 *
 * 做法：注册一个临时用户，全部操作都落在它身上 ——
 * 既验证了「新用户开箱可用」，也保证不碰正式数据（user 1 的 24,882 条流水）。
 * 结束时把这个用户和它的全部数据删干净。
 *
 * 用法：npx tsx scripts/smoke-legacy-write.ts
 */
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";
import { handleLegacyRequest } from "../src/modules/bill/legacy";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.BILL_JWT_SECRET || process.env.AUTH_SECRET || "";

type Result = { name: string; pass: boolean; detail: string };
const results: Result[] = [];
function check(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name.padEnd(34)} ${detail}`);
}

const BASE = "http://localhost/legacy/api";

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const segments = path.split("?")[0].split("/").filter(Boolean);
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const req = new Request(`${BASE}/${path}`, { method, headers, body });
  const res = await handleLegacyRequest(req, method, segments);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function mintToken(id: number, username: string) {
  if (!JWT_SECRET) throw new Error("未取到 AUTH_SECRET / BILL_JWT_SECRET");
  return new SignJWT({ id, username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("qingji")
    .setAudience("qingji-app")
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** 清理临时用户的全部账单数据（bill_* 之间没有外键，只能逐表删） */
async function purgeUser(userId: number) {
  const books = await prisma.billBook.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });
  const bookIds = books.map((b) => b.id);
  const txs = await prisma.billTransaction.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });
  await prisma.billTransactionImage.deleteMany({
    where: { transactionId: { in: txs.map((t) => t.id) } },
  });
  await prisma.billTransaction.deleteMany({ where: { ownerId: userId } });
  await prisma.billRecurringRule.deleteMany({ where: { ownerId: userId } });
  await prisma.billCategoryRule.deleteMany({ where: { ownerId: userId } });
  await prisma.billTransferRule.deleteMany({ where: { ownerId: userId } });
  await prisma.billCmbTextFix.deleteMany({ where: { ownerId: userId } });
  await prisma.billDuplicateIgnore.deleteMany({ where: { ownerId: userId } });
  await prisma.billAccountAlias.deleteMany({ where: { ownerId: userId } });
  await prisma.billCategoryAlias.deleteMany({ where: { ownerId: userId } });
  await prisma.billAccount.deleteMany({ where: { ownerId: userId } });
  await prisma.billCategory.deleteMany({ where: { ownerId: userId } });
  await prisma.billBookMember.deleteMany({ where: { bookId: { in: bookIds } } });
  await prisma.billBookParticipant.deleteMany({ where: { bookId: { in: bookIds } } });
  await prisma.billBook.deleteMany({ where: { ownerId: userId } });
  await prisma.todo.deleteMany({ where: { ownerId: userId } });
  await prisma.userPlatform.deleteMany({ where: { userId } });
  await prisma.notifyChannel.deleteMany({ where: { userId } });
  await prisma.notifyLog.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

// ================================================================ 主流程
async function main() {
  console.log("=".repeat(80));
  console.log("旧账单 API 兼容层 · 写入与配置类接口冒烟");
  console.log(`  挂载前缀：/legacy/api/*    基准时间：${new Date().toISOString().slice(0, 10)}`);
  console.log("=".repeat(80));

  const adminToken = await mintToken(1, "Leo");
  const suffix = Date.now().toString(36);
  const username = `smoke_w_${suffix}`;

  // ---- 1. 建临时用户 ----
  console.log("\n[1] 临时用户");
  const reg = await call("POST", "auth/register", {
    body: { username, password: "smoke123", displayName: "冒烟写入用户" },
  });
  const userId = reg.json?.user?.id as number;
  check("POST /auth/register", reg.status === 200 && !!userId, `id=${userId}`);
  if (!userId) {
    console.error("注册失败，终止");
    process.exit(1);
  }
  const token = await mintToken(userId, username);

  const accounts = (await call("GET", "accounts", { token })).json.accounts as Array<{
    id: number;
    name: string;
  }>;
  const cats = (await call("GET", "categories", { token })).json.categories as Array<{
    id: number;
    name: string;
    kind: string;
    parentId: number | null;
  }>;
  const expenseCat = cats.find((c) => c.kind === "expense" && c.parentId === null) ?? cats[0];
  const accA = accounts[0].id;
  const accB = accounts[1].id;
  check(
    "注册即铺默认账户/分类",
    accounts.length === 7 && cats.length === 65,
    `账户 ${accounts.length} / 分类 ${cats.length}`,
  );

  // ---- 2. 用户管理 ----
  console.log("\n[2] 用户管理");
  {
    const r = await call("PATCH", `users/${userId}`, {
      token,
      body: { displayName: "不该成功" },
    });
    check("PATCH /users 非管理员 → 403", r.status === 403, `${r.status}`);
  }
  {
    const r = await call("PATCH", `users/${userId}`, {
      token: adminToken,
      body: { displayName: "冒烟改名" },
    });
    check(
      "PATCH /users 管理员改昵称",
      r.status === 200 && r.json?.user?.displayName === "冒烟改名",
      r.json?.user?.displayName,
    );
  }
  {
    const r = await call("PATCH", `users/${userId}`, {
      token: adminToken,
      body: { password: "123" },
    });
    check("PATCH /users 弱密码 → 400", r.status === 400, r.json?.message);
  }
  {
    const r = await call("PATCH", `users/1`, { token: adminToken, body: { isAdmin: false } });
    check("PATCH /users 取消自己的管理员 → 400", r.status === 400, r.json?.message);
  }

  // ---- 3. 账户 ----
  console.log("\n[3] 账户");
  let createdAcc = 0;
  {
    const r = await call("POST", "accounts", {
      token,
      body: { name: "冒烟银行卡", kind: "bank", initial: 100.5 },
    });
    createdAcc = r.json?.account?.id;
    check(
      "POST /accounts",
      r.status === 200 && r.json?.account?.initial === "100.50" && r.json?.account?.kind === "bank",
      `id=${createdAcc} initial=${r.json?.account?.initial}`,
    );
  }
  {
    const r = await call("PATCH", `accounts/${createdAcc}`, {
      token,
      body: { name: "冒烟银行卡改", initial: 200 },
    });
    check(
      "PATCH /accounts 改名 + 改初始余额",
      r.status === 200 && r.json?.account?.name === "冒烟银行卡改" && r.json?.account?.initial === "200.00",
      `${r.json?.account?.name} ${r.json?.account?.initial}`,
    );
  }
  {
    const aliases = (await call("GET", "account-aliases", { token })).json.aliases as Array<{
      id: number;
    }>;
    const r = await call("POST", "account-aliases", {
      token,
      body: { alias: "冒烟叫法", accountId: createdAcc },
    });
    check(
      "POST /account-aliases",
      r.status === 200 && r.json?.aliases?.length === aliases.length + 1,
      `别名 ${r.json?.aliases?.length} 条`,
    );
    const aliasId = (r.json.aliases as Array<{ id: number; alias: string }>).find(
      (a) => a.alias === "冒烟叫法",
    )?.id;
    const del = await call("DELETE", `account-aliases/${aliasId}`, { token });
    check(
      "DELETE /account-aliases/:id",
      del.status === 200 && !(del.json.aliases as Array<{ alias: string }>).some((a) => a.alias === "冒烟叫法"),
      `剩 ${del.json?.aliases?.length} 条`,
    );
  }
  {
    const r = await call("POST", "accounts/merge", {
      token,
      body: { sourceId: createdAcc, targetId: accA },
    });
    check(
      "POST /accounts/merge",
      r.status === 200 && r.json?.account?.id === accA,
      `并入 #${accA}，余额 ${r.json?.account?.balance}`,
    );
    const back = await call("POST", "accounts/unmerge", { token, body: { accountId: createdAcc } });
    check(
      "POST /accounts/unmerge",
      back.status === 200 && back.json?.account?.mergedInto === null,
      `mergedInto=${back.json?.account?.mergedInto}`,
    );
  }

  // ---- 4. 分类 ----
  console.log("\n[4] 分类");
  {
    const r = await call("POST", "categories", {
      token,
      body: { name: "冒烟分类", kind: "expense" },
    });
    const id = r.json?.category?.id;
    check("POST /categories", r.status === 200 && !!id, `id=${id}`);
    const dup = await call("POST", "categories", { token, body: { name: "冒烟分类", kind: "expense" } });
    check("POST /categories 重名 → 409", dup.status === 409, dup.json?.message);
    const patch = await call("PATCH", `categories/${id}`, {
      token,
      body: { name: "冒烟分类改", parentId: expenseCat.id },
    });
    check(
      "PATCH /categories 改名 + 挂上级",
      patch.status === 200 && patch.json?.category?.parentId === expenseCat.id,
      `${patch.json?.category?.name} parent=${patch.json?.category?.parentId}`,
    );
    const del = await call("DELETE", `categories/${id}`, { token });
    check(
      "DELETE /categories 无人使用 → 真删",
      del.status === 200 && del.json?.deleted === true,
      JSON.stringify(del.json),
    );
  }
  {
    // 有账单在用的分类只能归档
    const tx = await call("POST", "transactions", {
      token,
      body: {
        type: "expense",
        amount: 9.9,
        occurredAt: "2026-10-14 09:00:00",
        accountId: accA,
        categoryId: expenseCat.id,
        payee: "冒烟锚点",
      },
    });
    const del = await call("DELETE", `categories/${expenseCat.id}`, { token });
    check(
      "DELETE /categories 有账单在用 → 只归档",
      del.status === 200 && del.json?.archived === true && del.json?.deleted === false,
      JSON.stringify(del.json),
    );
    await call("PATCH", `categories/${expenseCat.id}`, { token, body: { archived: false } });
    await call("DELETE", `transactions/${tx.json?.transaction?.id}`, { token });
  }
  {
    const r = await call("POST", "categories/prune", { token });
    check("POST /categories/prune", r.status === 200 && typeof r.json?.deleted === "number", JSON.stringify(r.json));
  }
  {
    const r = await call("POST", "categories/merge-duplicates", { token });
    check(
      "POST /categories/merge-duplicates",
      r.status === 200 && typeof r.json?.merged === "number",
      JSON.stringify(r.json),
    );
  }

  // ---- 5. 账本 ----
  console.log("\n[5] 账本");
  let bookId = 0;
  {
    const r = await call("POST", "books", { token, body: { name: "冒烟出游", kind: "travel" } });
    bookId = r.json?.book?.id;
    check(
      "POST /books",
      r.status === 200 && r.json?.book?.kind === "travel" && r.json?.book?.aaEnabled === false,
      `id=${bookId} kind=${r.json?.book?.kind} aa=${r.json?.book?.aaEnabled}`,
    );
    const dup = await call("POST", "books", { token, body: { name: "冒烟出游", kind: "travel" } });
    check("POST /books 同名 → 409", dup.status === 409, dup.json?.message);
  }
  {
    const r = await call("PATCH", `books/${bookId}`, { token, body: { aaEnabled: true } });
    check("PATCH /books 开 AA", r.status === 200 && r.json?.book?.aaEnabled === true, `${r.json?.book?.aaEnabled}`);
  }
  {
    const r = await call("POST", `books/${bookId}/participants`, { token, body: { name: "冒烟甲" } });
    check(
      "POST /books/:id/participants",
      r.status === 200 && (r.json?.book?.participants as unknown[]).length === 1,
      JSON.stringify(r.json?.book?.participants),
    );
    const pid = r.json.book.participants[0].id;
    const del = await call("DELETE", `books/${bookId}/participants/${pid}`, { token });
    check(
      "DELETE /books/:id/participants",
      del.status === 200 && (del.json?.book?.participants as unknown[]).length === 0,
      `剩 ${(del.json?.book?.participants as unknown[])?.length}`,
    );
  }
  {
    // 加成员：用管理员账号（user 1）当协作者
    const r = await call("POST", `books/${bookId}/members`, { token, body: { userId: 1 } });
    check(
      "POST /books/:id/members",
      r.status === 200 && (r.json?.book?.members as unknown[]).length === 2,
      `成员 ${(r.json?.book?.members as unknown[])?.length}`,
    );
    const del = await call("DELETE", `books/${bookId}/members/1`, { token });
    check(
      "DELETE /books/:id/members",
      del.status === 200 && (del.json?.book?.members as unknown[]).length === 1,
      `成员 ${(del.json?.book?.members as unknown[])?.length}`,
    );
    const self = await call("DELETE", `books/${bookId}/members/${userId}`, { token });
    check("移除账本所有者 → 400", self.status === 400, self.json?.message);
  }

  // ---- 6. 分享链接（免登录） ----
  console.log("\n[6] 分享链接");
  let shareToken = "";
  {
    const r = await call("POST", `books/${bookId}/share`, {
      token,
      body: { enabled: true, writable: true },
    });
    shareToken = r.json?.book?.shareToken;
    check(
      "POST /books/:id/share 开启可写分享",
      r.status === 200 && !!shareToken && r.json?.book?.shareWritable === true,
      `token=${shareToken}`,
    );
  }
  {
    const r = await call("GET", `share/${shareToken}`);
    check(
      "GET /share/:token 免登录可读",
      r.status === 200 && r.json?.book?.writable === true && Array.isArray(r.json?.entries),
      `book=${r.json?.book?.name} writable=${r.json?.book?.writable}`,
    );
  }
  {
    const r = await call("POST", `share/${shareToken}/entries`, {
      body: {
        memberName: "冒烟乙",
        type: "expense",
        amount: 33.3,
        payee: "分享页补账",
        occurredAt: "2026-10-14 12:00:00",
      },
    });
    check(
      "POST /share/:token/entries 免登录补账",
      r.status === 200 && r.json?.entry?.memberName === "冒烟乙",
      `#${r.json?.entry?.id} ${r.json?.entry?.amount}`,
    );
  }
  {
    const off = await call("POST", `books/${bookId}/share`, {
      token,
      body: { enabled: false, writable: false },
    });
    const read = await call("POST", `share/${shareToken}/entries`, {
      body: { memberName: "冒烟丙", type: "expense", amount: 1, occurredAt: "2026-10-14 12:10:00" },
    });
    check(
      "关掉分享后链接失效",
      off.json?.book?.shareEnabled === false && read.status === 404,
      `entry=${read.status}`,
    );
  }

  // ---- 7. 流水写入 ----
  console.log("\n[7] 流水写入");
  let txId = 0;
  {
    const r = await call("POST", "transactions", {
      token,
      body: {
        type: "expense",
        amount: 88.5,
        occurredAt: "2026-10-14 10:00:00",
        accountId: accA,
        categoryId: expenseCat.id,
        payee: "冒烟商户",
        note: "原始备注",
      },
    });
    txId = r.json?.transaction?.id;
    check(
      "POST /transactions",
      r.status === 200 && r.json?.transaction?.amount === "88.50",
      `#${txId} ${r.json?.transaction?.amount}`,
    );
  }
  {
    const r = await call("PATCH", `transactions/${txId}`, { token, body: { note: "改过的备注" } });
    const newId = r.json?.transaction?.id as number;
    check(
      "PATCH /transactions/:id",
      r.status === 200 && r.json?.transaction?.note === "改过的备注",
      `note=${r.json?.transaction?.note}`,
    );
    // 旧实现是「先删再插」，所以改完 id 会变 —— 这是与 cash-platform 一致的行为，
    // 前端必须用响应里的新 id，不能沿用旧的。这里显式钉住，避免以后被「优化」掉。
    check(
      "PATCH 后 id 变化（与旧实现一致）",
      newId !== txId && newId > 0,
      `${txId} → ${newId}`,
    );
    txId = newId;
  }
  {
    const cats2 = (await call("GET", "categories", { token })).json.categories as Array<{
      id: number;
      name: string;
      kind: string;
      parentId: number | null;
    }>;
    const other = cats2.find((c) => c.kind === "expense" && c.id !== expenseCat.id && c.parentId === null);
    const r = await call("PATCH", "transactions/category", {
      token,
      body: { ids: [txId], categoryId: other?.id },
    });
    check("PATCH /transactions/category 批量改分类", r.status === 200 && r.json?.updated === 1, JSON.stringify(r.json));
  }
  {
    const r = await call("GET", `transactions?q=${encodeURIComponent("改过的备注")}`, { token });
    check(
      "改完能按新备注搜到",
      r.status === 200 && r.json?.total === 1,
      `命中 ${r.json?.total} 条`,
    );
  }
  {
    const noConfirm = await call("DELETE", "transactions", { token, body: { bookId } });
    check("DELETE /transactions 缺确认 → 400", noConfirm.status === 400, noConfirm.json?.message);
    const badBook = await call("DELETE", "transactions", {
      token,
      body: { confirm: "确认", bookId: 999999 },
    });
    check("DELETE /transactions 不存在的账本 → 404", badBook.status === 404, badBook.json?.message);
  }
  {
    const del = await call("DELETE", `transactions/${txId}`, { token });
    check("DELETE /transactions/:id", del.status === 200 && del.json?.ok === true, JSON.stringify(del.json));
  }

  // ---- 8. 查重 ----
  console.log("\n[8] 查重");
  let pairA = 0;
  let pairB = 0;
  {
    const payload = {
      type: "expense",
      amount: 128,
      occurredAt: "2026-10-14 12:30:00",
      payee: "冒烟咖啡",
      note: "同一次支付的两边记录",
    };
    const a = await call("POST", "transactions", { token, body: { ...payload, accountId: accA } });
    const b = await call("POST", "transactions", { token, body: { ...payload, accountId: accB } });
    pairA = a.json?.transaction?.id;
    pairB = b.json?.transaction?.id;
    const r = await call("GET", "duplicates?type=expense", { token });
    const hit = (r.json?.groups as Array<{ ids: number[]; score: number; reasons: string[] }>)?.find((g) =>
      g.ids.includes(pairA),
    );
    check(
      "GET /duplicates 认出同额同刻同商户",
      r.status === 200 && !!hit && hit.ids.includes(pairB),
      hit ? `score=${hit.score} ${hit.reasons.join("/")}` : `未命中，pairs=${r.json?.pairs?.length}`,
    );
    check(
      "重复金额合计",
      r.json?.duplicateAmount === "128.00",
      `duplicateAmount=${r.json?.duplicateAmount}`,
    );
  }
  {
    const key = `${Math.min(pairA, pairB)}-${Math.max(pairA, pairB)}`;
    const ig = await call("POST", "duplicates/ignore", { token, body: { keys: [key] } });
    const after = await call("GET", "duplicates?type=expense", { token });
    check(
      "POST /duplicates/ignore",
      ig.status === 200 &&
        after.json?.ignoredCount === 1 &&
        !(after.json?.groups as Array<{ ids: number[] }>).some((g) => g.ids.includes(pairA)),
      `ignoredCount=${after.json?.ignoredCount}`,
    );
    const un = await call("DELETE", `duplicates/ignore?key=${key}`, { token });
    check("DELETE /duplicates/ignore", un.status === 200, JSON.stringify(un.json));
  }
  {
    const r = await call("POST", "duplicates/resolve", {
      token,
      body: { groups: [{ keepId: pairA, dropIds: [pairB] }] },
    });
    const left = await prisma.billTransaction.count({ where: { id: pairB } });
    check(
      "POST /duplicates/resolve 删重复留一条",
      r.status === 200 && r.json?.removed === 1 && left === 0,
      `removed=${r.json?.removed} skipped=${r.json?.skipped}`,
    );
  }

  // ---- 9. 定期账单 + 日历 ----
  console.log("\n[9] 定期账单与日历");
  let ruleId = 0;
  {
    const r = await call("POST", "recurring", {
      token,
      body: {
        type: "expense",
        amount: 100,
        accountId: accA,
        frequency: "monthly",
        monthDay: 1,
        startDate: "2026-09-01",
        time: "09:00",
        payee: "冒烟月供",
        note: "冒烟定期",
      },
    });
    ruleId = r.json?.rule?.id;
    check(
      "POST /recurring 建规则并补历史",
      r.status === 200 && r.json?.rule?.nextRun === "2026-11-01",
      `id=${ruleId} nextRun=${r.json?.rule?.nextRun}`,
    );
    const generated = await prisma.billTransaction.findMany({
      where: { ownerId: userId, source: "RECURRING" },
      select: { occurredAt: true, externalId: true },
      orderBy: { occurredAt: "asc" },
    });
    check(
      "已按规则生成 9 月/10 月两笔",
      generated.length === 2 &&
        generated[0].externalId === `r${ruleId}:2026-09-01` &&
        generated[1].externalId === `r${ruleId}:2026-10-01`,
      generated.map((g) => g.externalId).join(", "),
    );
  }
  {
    // 幂等：再跑一次不该重复入账
    const r = await call("POST", "recurring/run", { token });
    const n = await prisma.billTransaction.count({
      where: { ownerId: userId, source: "RECURRING" },
    });
    check("POST /recurring/run 幂等", n === 2 && r.json?.created === 0, `created=${r.json?.created} / 共 ${n} 笔`);
  }
  {
    const r = await call("GET", "calendar?year=2026&month=11", { token });
    const cell = (r.json?.days as Array<{ day: string; planned: unknown[] }>)?.find(
      (d) => d.day === "2026-11-01",
    );
    check(
      "GET /calendar 展示未到期的定期账单",
      r.status === 200 && cell?.planned?.length === 1,
      cell ? `${cell.day} planned=${cell.planned.length}` : "没有 11-01 的格子",
    );
  }
  {
    const r = await call("PATCH", `recurring/${ruleId}`, { token, body: { paused: true } });
    check("PATCH /recurring/:id 暂停", r.status === 200 && r.json?.rule?.paused === true, `${r.json?.rule?.paused}`);
    const del = await call("DELETE", `recurring/${ruleId}`, { token });
    check("DELETE /recurring/:id", del.status === 200 && del.json?.ok === true, JSON.stringify(del.json));
  }

  // ---- 10. 自动分类规则 ----
  console.log("\n[10] 自动分类规则");
  {
    const tx = await call("POST", "transactions", {
      token,
      body: {
        type: "expense",
        amount: 21,
        occurredAt: "2026-10-14 13:00:00",
        accountId: accA,
        payee: "冒烟测试店",
      },
    });
    const r = await call("POST", "category-rules", {
      token,
      body: { keyword: "冒烟测试店", categoryId: expenseCat.id },
    });
    const hit = await prisma.billTransaction.findUnique({ where: { id: tx.json.transaction.id } });
    check(
      "POST /category-rules 加完立刻归类",
      r.status === 200 && hit?.categoryId === expenseCat.id,
      `updated=${r.json?.updated} categoryId=${hit?.categoryId}`,
    );
    const list = await call("GET", "category-rules", { token });
    check(
      "GET /category-rules",
      list.status === 200 && (list.json?.rules as unknown[]).length === 1,
      JSON.stringify(list.json?.rules),
    );
    const dry = await call("POST", "category-rules/apply", { token, body: { dryRun: true } });
    check(
      "POST /category-rules/apply dryRun",
      dry.status === 200 && dry.json?.updated === 0,
      `matched=${dry.json?.matched} updated=${dry.json?.updated}`,
    );
    const ruleId2 = (list.json.rules as Array<{ id: number }>)[0].id;
    const del = await call("DELETE", `category-rules/${ruleId2}`, { token });
    check("DELETE /category-rules/:id", del.status === 200, JSON.stringify(del.json));
    await call("DELETE", `transactions/${tx.json.transaction.id}`, { token });
  }

  // ---- 11. 转账规则 ----
  console.log("\n[11] 转账规则");
  {
    const r = await call("POST", "transfer-rules", {
      token,
      body: {
        label: "冒烟还款",
        pattern: "冒烟还款|待清算冒烟",
        isRegex: true,
        targetAccountId: accA,
      },
    });
    const id = r.json?.rule?.id;
    check(
      "POST /transfer-rules",
      r.status === 200 && r.json?.rule?.is_regex === 1 && r.json?.rule?.target_account_id === accA,
      `id=${id} pattern=${r.json?.rule?.pattern}`,
    );
    const bad = await call("POST", "transfer-rules", {
      token,
      body: { label: "坏正则", pattern: "([", isRegex: true },
    });
    check("POST /transfer-rules 坏正则 → 400", bad.status === 400, bad.json?.message);
    const patch = await call("PATCH", `transfer-rules/${id}`, {
      token,
      body: { label: "冒烟还款改", pattern: "冒烟还款", isRegex: false, targetAccountId: accA },
    });
    check(
      "PATCH /transfer-rules/:id",
      patch.status === 200 && patch.json?.rule?.label === "冒烟还款改" && patch.json?.rule?.is_regex === 0,
      `${patch.json?.rule?.label} is_regex=${patch.json?.rule?.is_regex}`,
    );
    const list = await call("GET", "transfer-rules", { token });
    check(
      "GET /transfer-rules",
      list.status === 200 && (list.json?.rules as unknown[]).length === 1,
      `${(list.json?.rules as unknown[])?.length} 条`,
    );
    const del = await call("DELETE", `transfer-rules/${id}`, { token });
    check("DELETE /transfer-rules/:id", del.status === 200, JSON.stringify(del.json));
  }

  // ---- 12. 招行乱码修复 ----
  console.log("\n[12] 招行乱码修复");
  {
    const r = await call("POST", "cmb-text-fixes", {
      token,
      body: { garbled: "倿仕广", correct: "胡仕广", position: 0 },
    });
    const id = r.json?.fix?.id;
    check(
      "POST /cmb-text-fixes",
      r.status === 200 && r.json?.fix?.correct === "胡仕广",
      `id=${id}`,
    );
    const empty = await call("POST", "cmb-text-fixes", { token, body: { correct: "没乱码" } });
    check("POST /cmb-text-fixes 缺乱码 → 400", empty.status === 400, empty.json?.message);
    const patch = await call("PATCH", `cmb-text-fixes/${id}`, { token, body: { enabled: false } });
    check("PATCH /cmb-text-fixes/:id", patch.status === 200 && patch.json?.fix?.enabled === false, `${patch.json?.fix?.enabled}`);
    const list = await call("GET", "cmb-text-fixes", { token });
    check("GET /cmb-text-fixes", list.status === 200 && (list.json?.fixes as unknown[]).length === 1, `${(list.json?.fixes as unknown[])?.length} 条`);
    const del = await call("DELETE", `cmb-text-fixes/${id}`, { token });
    check("DELETE /cmb-text-fixes/:id", del.status === 200, JSON.stringify(del.json));
  }

  // ---- 13. 图床与未迁接口 ----
  console.log("\n[13] 图床与未迁接口");
  {
    const r = await call("GET", "image?u=http%3A%2F%2Fevil.example%2Fx.png");
    check("GET /image 白名单外 → 400", r.status === 400, r.json?.message);
  }
  {
    const r = await call("GET", "image");
    check("GET /image 缺地址 → 400", r.status === 400, r.json?.message);
  }
  {
    const r = await call("POST", "upload/image", { token, body: {} });
    check("POST /upload/image 未配图床 → 501", r.status === 501, r.json?.message);
  }
  for (const path of ["export", "import/template"]) {
    const r = await call("GET", path, { token });
    check(`GET /${path} 未迁 → 501`, r.status === 501, r.json?.message);
  }
  {
    const r = await call("POST", "import/preview", { token, body: {} });
    check("POST /import/preview 未迁 → 501", r.status === 501, r.json?.message);
  }
  {
    const r = await call("GET", "not-a-real-endpoint", { token });
    check("未知路径 → 501 且带 message", r.status === 501 && !!r.json?.message, r.json?.message);
  }

  // ---- 14. 清理 ----
  console.log("\n[14] 清理临时数据");
  await purgeUser(userId);
  const left = await prisma.user.count({ where: { id: userId } });
  const leftTx = await prisma.billTransaction.count({ where: { ownerId: userId } });
  check("临时用户及其数据已清除", left === 0 && leftTx === 0, `user=${left} tx=${leftTx}`);

  // ---- 汇总 ----
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${"=".repeat(80)}`);
  if (failed.length) {
    console.log(`冒烟结果：${passed}/${results.length} 通过，失败 ${failed.length} 项：`);
    for (const f of failed) console.log(`  · ${f.name}  ${f.detail}`);
  } else {
    console.log(`冒烟结果：${passed}/${results.length} 通过`);
  }
  console.log("=".repeat(80));
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
