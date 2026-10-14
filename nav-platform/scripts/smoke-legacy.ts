/**
 * 旧账单 API 兼容层 端到端冒烟。
 *
 * 直接调用 `@/modules/bill/legacy` 的 handleLegacyRequest（不经过 Next 编译），
 * 用真实的 PostgreSQL 数据跑一遍：分发、双通道鉴权、响应外壳、分页与统计口径。
 *
 * 用法：npx tsx scripts/smoke-legacy.ts
 * 退出码非 0 表示有断言失败。
 */
import { execFileSync } from "node:child_process";

import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";
import { handleLegacyRequest } from "../src/modules/bill/legacy";

const prisma = new PrismaClient();

// ---------------------------------------------------------------- 环境
//
// 不要自己解析 .env！Prisma Client 在初始化时会自动加载 .env 并**去掉值两侧的引号**，
// 而手写解析拿到的是带引号的原始值（`"dev-xxx"`），两边算出的密钥不同，
// Bearer 会被全部判成未登录。直接读 process.env 即可。
const JWT_SECRET = process.env.BILL_JWT_SECRET || process.env.AUTH_SECRET || "";

// ---------------------------------------------------------------- 断言
type Result = { name: string; pass: boolean; detail: string };
const results: Result[] = [];
function check(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name.padEnd(30)} ${detail}`);
}

// ---------------------------------------------------------------- 调用工具
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

/** 伪造一个合法 Bearer（与 modules/bill/auth.ts 同密钥、同 issuer/audience） */
async function mintToken(id: number, username: string) {
  if (!JWT_SECRET) throw new Error("未取到 AUTH_SECRET / BILL_JWT_SECRET，无法签发测试令牌");
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT({ id, username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("qingji")
    .setAudience("qingji-app")
    .setExpirationTime("30d")
    .sign(secret);
}

const pgScalar = async (sql: string, ...params: unknown[]) => {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, ...params);
  return rows[0] ? Object.values(rows[0])[0] : null;
};

// ================================================================ 主流程
async function main() {
  console.log("=".repeat(72));
  console.log("旧账单 API 兼容层 端到端冒烟");
  console.log(`  挂载前缀：/legacy/api/*`);
  console.log("=".repeat(72));

  const token = await mintToken(1, "Leo");

  // ---- 1. 免登录与错误路径 ----
  console.log("\n[1] 免登录接口与错误路径");
  {
    const r = await call("GET", "health");
    check("GET /health", r.status === 200 && r.json?.ok === true, JSON.stringify(r.json));
  }
  {
    const r = await call("GET", "auth/config");
    check(
      "GET /auth/config",
      r.status === 200 && typeof r.json?.allowRegister === "boolean" && r.json?.hasUsers === true,
      JSON.stringify(r.json),
    );
  }
  {
    const r = await call("GET", "me");
    check("GET /me 无凭证 → 401", r.status === 401 && typeof r.json?.message === "string", `${r.status} ${JSON.stringify(r.json)}`);
  }
  {
    const r = await call("POST", "auth/login", { body: { username: "Leo", password: "__wrong__" } });
    check("POST /auth/login 错密码 → 401", r.status === 401, `${r.status} ${JSON.stringify(r.json)}`);
  }
  {
    const r = await call("GET", "users/99999/unknown", { token });
    check("未迁移路径 → 501", r.status === 501, `${r.status} ${JSON.stringify(r.json)}`);
  }

  // ---- 2. 双通道鉴权 ----
  console.log("\n[2] Bearer 通道");
  {
    const r = await call("GET", "me", { token });
    check(
      "GET /me（Bearer）",
      r.status === 200 && r.json?.user?.id === 1 && r.json?.user?.isAdmin === true,
      JSON.stringify(r.json),
    );
  }
  {
    const r = await call("GET", "me", { token: "not-a-token" });
    check("非法 Token → 401", r.status === 401, `${r.status}`);
  }

  // ---- 3. 基础数据 ----
  console.log("\n[3] 基础数据（用真实库核对）");
  const dbAccounts = Number(await pgScalar(`SELECT COUNT(*) FROM bill_account WHERE "ownerId" = 1`));
  {
    const r = await call("GET", "accounts", { token });
    check("GET /accounts 条数", r.status === 200 && r.json?.accounts?.length === dbAccounts, `接口 ${r.json?.accounts?.length} / 库 ${dbAccounts}`);
    const first = r.json?.accounts?.[0];
    check(
      "账户字段名与旧 API 一致",
      first && "id" in first && "kind" in first && "initial" in first && "balance" in first,
      Object.keys(first ?? {}).join(","),
    );
  }
  const dbCats = Number(await pgScalar(`SELECT COUNT(*) FROM bill_category WHERE "ownerId" = 1`));
  {
    const r = await call("GET", "categories", { token });
    const first = r.json?.categories?.[0];
    check("GET /categories 条数", r.status === 200 && r.json?.categories?.length === dbCats, `接口 ${r.json?.categories?.length} / 库 ${dbCats}`);
    check(
      "分类字段名与旧 API 一致",
      first && "parentId" in first && (first.kind === "expense" || first.kind === "income"),
      JSON.stringify(first),
    );
  }
  {
    // 管理员会额外看到别人的账本：自己 7 个 + liyanfei 的 1 个
    const dbTotal = Number(await pgScalar(`SELECT COUNT(*) FROM bill_book`));
    const r = await call("GET", "books", { token });
    const first = r.json?.books?.[0];
    check("GET /books（管理员看全部）", r.status === 200 && r.json?.books?.length === dbTotal, `条数 ${r.json?.books?.length} / 库 ${dbTotal}`);
    check(
      "账本字段名与旧 API 一致",
      first && "kindLabel" in first && "aaEnabled" in first && first.members?.every((m: any) => "id" in m && "name" in m && "role" in m),
      first ? `members[0]=${JSON.stringify(first.members?.[0])}` : "",
    );

    // 非管理员只看「自己拥有的 + 参与别人的」：liyanfei 自己 1 个，另参与 Leo 的 1 个
    const dbVisible = Number(
      await pgScalar(
        `SELECT COUNT(*) FROM bill_book
         WHERE "ownerId" = 4 OR id IN (SELECT "bookId" FROM bill_book_member WHERE "userId" = 4)`,
      ),
    );
    const r2 = await call("GET", "books", { token: await mintToken(4, "liyanfei") });
    check("GET /books（非管理员只看自己的）", r2.status === 200 && r2.json?.books?.length === dbVisible, `条数 ${r2.json?.books?.length} / 应为 ${dbVisible}`);
    check(
      "非管理员看不到别人的私有账本",
      (r2.json?.books ?? []).every((b: any) => b.ownerId === 4 || b.members?.some((m: any) => m.id === 4)),
      JSON.stringify((r2.json?.books ?? []).map((b: any) => `${b.id}:${b.name}`)),
    );
  }

  // ---- 4. 流水与统计 ----
  console.log("\n[4] 流水分页与统计口径");
  const dbTxCount = Number(await pgScalar(`SELECT COUNT(*) FROM bill_transaction WHERE "ownerId" = 1`));
  {
    const r = await call("GET", "transactions?limit=5", { token });
    check("GET /transactions 分页", r.status === 200 && r.json?.transactions?.length === 5, `返回 ${r.json?.transactions?.length} 条`);
    check("GET /transactions total", r.json?.total === dbTxCount, `接口 ${r.json?.total} / 库 ${dbTxCount}`);
    const t = r.json?.transactions?.[0];
    check(
      "流水字段名与旧 API 一致",
      t && "occurredAt" in t && "amount" in t && "categoryName" in t && "accountName" in t,
      Object.keys(t ?? {}).join(","),
    );
    check("summary 三件套", !!r.json?.summary && "expense" in r.json.summary && "income" in r.json.summary && "net" in r.json.summary, JSON.stringify(r.json?.summary));
  }
  {
    const r = await call("GET", "transactions/count", { token });
    check("GET /transactions/count", r.status === 200 && r.json?.count === dbTxCount, `接口 ${r.json?.count} / 库 ${dbTxCount}`);
  }
  {
    const r = await call("GET", "transactions?limit=5&type=expense", { token });
    check("筛选 ?type=expense 生效", r.status === 200 && r.json?.transactions?.every((t: any) => t.type === "expense"), `返回 ${r.json?.transactions?.length} 条`);
  }

  // ---- 5. 报表（与库直算对比当前月）----
  console.log("\n[5] 报表接口（当前月与库直算对比）");
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const dbMonth = await prisma.$queryRawUnsafe<Array<{ income: bigint; expense: bigint; n: bigint }>>(
    `SELECT COALESCE(SUM(CASE WHEN t.type='INCOME' THEN t."amountCents" END),0) AS income,
            COALESCE(SUM(CASE WHEN t.type='EXPENSE' THEN t."amountCents" END),0) AS expense,
            COUNT(*) AS n
     FROM bill_transaction t
     WHERE t."bookId" IN (SELECT id FROM bill_book WHERE "ownerId" = 1)
       AND ((t."occurredAt" + INTERVAL '8 hours')::date) >= make_date($1::int, $2::int, 1)
       AND ((t."occurredAt" + INTERVAL '8 hours')::date) <= (make_date($1::int, $2::int, 1) + INTERVAL '1 month - 1 day')::date`,
    y,
    m,
  );
  const expectExpense = (Number(dbMonth[0].expense) / 100).toFixed(2);
  {
    const r = await call("GET", `summary?year=${y}&month=${m}`, { token });
    const got = String(r.json?.expense ?? "");
    check("GET /summary 支出与库一致", r.status === 200 && Number(got) === Number(expectExpense), `接口 ${got} / 库 ${expectExpense}`);
    check("GET /summary 结构完整", Array.isArray(r.json?.categories) && Array.isArray(r.json?.accounts) && "aa" in (r.json ?? {}), `categories=${r.json?.categories?.length} accounts=${r.json?.accounts?.length}`);
    // 分类金额之和应等于总支出
    const sumCats = (r.json?.categories ?? []).reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
    check("分类合计 == 总支出", Math.abs(sumCats - Number(got)) < 0.01, `分类合计 ${sumCats.toFixed(2)}`);
  }
  {
    const r = await call("GET", `trend?range=month&year=${y}&month=${m}`, { token });
    const days = new Date(y, m, 0).getDate();
    check("GET /trend 天数完整", r.status === 200 && r.json?.points?.length === days && r.json?.unit === "day", `${r.json?.points?.length} 点 / 应为 ${days}`);
  }
  {
    const r = await call("GET", "trend?range=all", { token });
    check("GET /trend range=all", r.status === 200 && r.json?.unit === "month" && r.json?.points?.length > 0, `${r.json?.points?.length} 点，起点 ${r.json?.from}`);
  }

  // ---- 6. 用户接口 ----
  console.log("\n[6] 用户接口");
  {
    const r = await call("GET", "users/search?q=liy", { token });
    check("GET /users/search", r.status === 200 && r.json?.users?.[0]?.username === "liyanfei", JSON.stringify(r.json?.users));
    check("搜索结果字段名与旧 API 一致", !!r.json?.users?.[0]?.displayName, Object.keys(r.json?.users?.[0] ?? {}).join(","));
  }
  {
    const r = await call("GET", "users", { token });
    check("GET /users（管理员）", r.status === 200 && r.json?.users?.length >= 2, `条数 ${r.json?.users?.length}`);
  }
  {
    const r = await call("GET", "users", { token: await mintToken(4, "liyanfei") });
    check("GET /users 非管理员 → 403", r.status === 403, `${r.status}`);
  }

  // ---- 7. 注册 → 登录 闭环（用临时用户，跑完清理）----
  console.log("\n[7] 注册 / 登录 闭环（临时用户）");
  const tmpName = `__smoke_${Date.now()}`;
  let tmpId: number | null = null;
  try {
    const reg = await call("POST", "auth/register", { body: { username: tmpName, password: "smoke1234", displayName: "冒烟" } });
    tmpId = reg.json?.user?.id ?? null;
    check("POST /auth/register", reg.status === 200 && !!reg.json?.token && tmpId !== null, `id=${tmpId}`);

    const seededAccounts = tmpId ? Number(await pgScalar(`SELECT COUNT(*) FROM bill_account WHERE "ownerId" = $1`, tmpId)) : 0;
    const seededCats = tmpId ? Number(await pgScalar(`SELECT COUNT(*) FROM bill_category WHERE "ownerId" = $1`, tmpId)) : 0;
    const seededBooks = tmpId ? Number(await pgScalar(`SELECT COUNT(*) FROM bill_book WHERE "ownerId" = $1`, tmpId)) : 0;
    check("注册后已铺默认账户/分类/账本", seededAccounts === 7 && seededCats > 0 && seededBooks === 1, `账户${seededAccounts} 分类${seededCats} 账本${seededBooks}`);

    const login = await call("POST", "auth/login", { body: { username: tmpName, password: "smoke1234" } });
    check("POST /auth/login 新用户", login.status === 200 && !!login.json?.token, `${login.status}`);

    const upper = await call("POST", "auth/login", { body: { username: tmpName.toUpperCase(), password: "smoke1234" } });
    check("登录用户名大小写不敏感", upper.status === 200, `${upper.status}`);

    const dup = await call("POST", "auth/register", { body: { username: tmpName, password: "smoke1234" } });
    check("重复用户名 → 409", dup.status === 409, `${dup.status}`);
  } finally {
    if (tmpId) {
      // 清理：临时用户的账单侧数据
      await prisma.$transaction([
        prisma.billBookMember.deleteMany({ where: { userId: tmpId } }),
        prisma.billCategory.deleteMany({ where: { ownerId: tmpId } }),
        prisma.billAccount.deleteMany({ where: { ownerId: tmpId } }),
        prisma.billBook.deleteMany({ where: { ownerId: tmpId } }),
        prisma.user.delete({ where: { id: tmpId } }),
      ]);
      console.log(`  （已清理临时用户 id=${tmpId}）`);
    }
  }

  // ---- 汇总 ----
  const failed = results.filter((r) => !r.pass);
  console.log("\n" + "=".repeat(72));
  console.log(`冒烟结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) {
    console.log("\n未通过：");
    for (const f of failed) console.log(`  · ${f.name}：${f.detail}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("冒烟执行失败：", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
