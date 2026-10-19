/**
 * 用户迁移：SQLite (cash-platform users) → PostgreSQL (nas-platform user)
 *
 * 用法：
 *   npx tsx scripts/migrate-users.ts --dry-run   # 只报告差异，不写库（先跑这个）
 *   npx tsx scripts/migrate-users.ts             # 正式执行
 *   npx tsx scripts/migrate-users.ts --source <path>
 *   npx tsx scripts/migrate-users.ts --keep-password  # 保留门户已有密码，不覆盖
 *
 * ============================ 核心契约 ============================
 * **门户 user.id 必须与源库 users.id 逐位一致。**
 *
 * 账单侧 24,882 条流水，以及 accounts/categories/books/book_members/
 * transfer_rules/... 全部外键列（ownerId / userId）都直接沿用源库 id，
 * 代码里不做任何 id 映射表。这样：
 *   - 迁移脚本可以断言「门户已存在同 id 同名的用户」，不一致就中止；
 *   - bill 模块的权限判断（只看自己的数据）直接用 session.user.id，无需转换；
 *   - 将来新增用户时，两侧 id 语义天然一致。
 *
 * 因此本脚本按**显式 id** 写入，而不是让 PG 自增分配 id。
 *
 * ============================ 密码哈希 ============================
 * 两侧均为 bcrypt（`$2a$10$`，60 字符），哈希可逐位搬运，
 * Auth.js 的 `bcrypt.compare(password, user.passwordHash)` 能直接校验通过。
 * 默认用源库（账单平台）的哈希覆盖门户 —— 统一账户后应是同一个密码。
 * 若想保留门户现有密码，加 --keep-password。
 *
 * ============================ 执行顺序 ============================
 *   migrate-users  →  migrate-bills  →  verify-bills
 * （migrate-bills 会在用户 id 未对齐时直接中止并提示先跑本脚本）
 */
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@nas/db";

const prisma = new PrismaClient();

// ---------------------------------------------------------------- 参数解析
const argv = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const hasFlag = (name: string) => argv.includes(name);

const DEFAULT_SOURCE =
  process.env.MIGRATE_SOURCE ?? "./ledger.db";
const SOURCE = getArg("--source") ?? DEFAULT_SOURCE;
const DRY_RUN = hasFlag("--dry-run");
const KEEP_PASSWORD = hasFlag("--keep-password");

// ---------------------------------------------------------------- 读取 SQLite
function readTable<T = Record<string, unknown>>(table: string): T[] {
  const out = execFileSync(
    "sqlite3",
    ["-readonly", "-json", SOURCE, `SELECT * FROM "${table}";`],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
  );
  const s = out.trim();
  return s ? (JSON.parse(s) as T[]) : [];
}

const toBool = (v: unknown): boolean => v === 1 || v === "1" || v === true;

/** 门户里引用了 user.id 且带外键的表。改 id 前必须确认这些引用为空 */
const DEPENDENT_TABLES = ["user_platform", "todo", "notify_channel", "notify_log"];

type SrcUser = {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  is_admin: number;
  is_active: number;
  created_at: string;
};

type Desired = {
  id: number;
  username: string;
  passwordHash: string;
  nickname: string;
  role: "ADMIN" | "MEMBER";
  status: "ACTIVE" | "DISABLED";
  createdAt: Date;
};

/** 某个门户 user.id 在各依赖表里的引用行数 */
async function dependencyCount(userId: number): Promise<number> {
  let total = 0;
  for (const t of DEPENDENT_TABLES) {
    const col = t === "user_platform" ? "userId" : t === "todo" ? "ownerId" : "userId";
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*) AS n FROM "${t}" WHERE "${col}" = $1`,
      userId,
    );
    total += Number(rows[0]?.n ?? 0);
  }
  return total;
}

// ---------------------------------------------------------------- 主流程
async function main() {
  console.log("=".repeat(72));
  console.log("用户迁移：cash-platform users → nas-platform user");
  console.log(`  源库：${SOURCE}`);
  console.log(`  模式：${DRY_RUN ? "DRY-RUN（不写库）" : "正式执行"}`);
  console.log(`  密码：${KEEP_PASSWORD ? "保留门户现有密码" : "用源库密码覆盖门户"}`);
  console.log("=".repeat(72));

  // ---- 1. 读源库用户 ----
  const srcRaw = readTable<SrcUser>("users").sort((a, b) => a.id - b.id);
  if (srcRaw.length === 0) throw new Error("源库没有任何用户，中止");

  const desired: Desired[] = srcRaw.map((u) => ({
    id: Number(u.id),
    username: String(u.username),
    passwordHash: String(u.password_hash),
    nickname: String(u.display_name ?? u.username),
    role: toBool(u.is_admin) ? "ADMIN" : "MEMBER",
    status: toBool(u.is_active) ? "ACTIVE" : "DISABLED",
    createdAt: new Date(String(u.created_at)),
  }));

  console.log(`\n[1/4] 源库用户 ${desired.length} 个`);
  for (const d of desired) {
    console.log(
      `  id=${d.id}  ${d.username.padEnd(12)} ${d.nickname.padEnd(8)} ${d.role.padEnd(6)} ${d.status}  hash=${d.passwordHash.slice(0, 16)}…`,
    );
  }

  // ---- 2. 读取门户现状并逐条判定动作 ----
  console.log("\n[2/4] 比对门户现状");
  const portal = await prisma.user.findMany({
    select: { id: true, username: true, nickname: true, passwordHash: true },
    orderBy: { id: "asc" },
  });
  const byId = new Map(portal.map((u) => [u.id, u]));
  const lc = (s: string) => s.toLowerCase();

  type Plan = {
    action: "create" | "update" | "relocate" | "conflict";
    want: Desired;
    /** relocate 时要删掉的门户旧行 id */
    dropId?: number;
    note?: string;
  };
  const plans: Plan[] = [];

  for (const want of desired) {
    const sameId = byId.get(want.id);
    if (sameId) {
      if (lc(sameId.username) === lc(want.username)) {
        plans.push({ action: "update", want, note: sameId.username === want.username ? undefined : `门户写作 ${sameId.username}` });
      } else {
        plans.push({
          action: "conflict",
          want,
          dropId: sameId.id,
          note: `目标 id=${want.id} 已被「${sameId.username}」占用`,
        });
      }
      continue;
    }
    const sameName = portal.find((p) => lc(p.username) === lc(want.username));
    if (sameName) {
      plans.push({
        action: "relocate",
        want,
        dropId: sameName.id,
        note: `门户在 id=${sameName.id}，需搬到 id=${want.id}`,
      });
    } else {
      plans.push({ action: "create", want });
    }
  }

  // 需要删除腾位的门户行（搬迁 / 冲突）
  const toDrop = plans
    .filter((p) => p.action === "relocate" || p.action === "conflict")
    .map((p) => p.dropId!);

  const portalOnly = portal.filter(
    (p) => !desired.some((d) => d.id === p.id) && !toDrop.includes(p.id),
  );

  for (const p of plans) {
    const tag =
      p.action === "create"
        ? "新建"
        : p.action === "update"
          ? "更新"
          : p.action === "relocate"
            ? "搬迁"
            : "冲突";
    console.log(`  [${tag}] id=${p.want.id} ${p.want.username}${p.note ? `   — ${p.note}` : ""}`);
  }
  for (const p of portalOnly) {
    console.log(`  [保留] id=${p.id} ${p.username}  （门户独有，源库无此用户）`);
  }
  if (plans.some((p) => p.action === "conflict")) {
    console.log("  ⚠ 存在「目标 id 被占用」冲突，脚本不会自动处理，请人工确认后再执行");
  }

  // ---- 3. 安全检查：要删除/改动的用户是否被其他模块引用 ----
  console.log("\n[3/4] 引用检查");
  let blocked = false;
  for (const id of toDrop) {
    const n = await dependencyCount(id);
    const who = portal.find((p) => p.id === id)?.username ?? "?";
    if (n > 0) {
      blocked = true;
      console.log(`  ✗ id=${id}（${who}）被其他模块引用 ${n} 行，不能直接删`);
    } else {
      console.log(`  ✓ id=${id}（${who}）无任何引用，可安全删除`);
    }
  }
  if (toDrop.length === 0) console.log("  无需删除任何行");

  if (blocked) {
    throw new Error("存在被引用的用户需要删除，中止（请先处理这些模块的数据）");
  }
  if (plans.some((p) => p.action === "conflict")) {
    throw new Error("存在 id 占用冲突，中止");
  }

  // ---- 4. 执行 ----
  console.log("\n[4/4] 写入");
  if (DRY_RUN) {
    console.log("  [dry-run] 未写入任何数据");
  } else {
    await prisma.$transaction(async (tx) => {
      // 先删（腾出 id），让位给同名的正确 id
      for (const p of plans) {
        if (p.dropId !== undefined) {
          await tx.user.delete({ where: { id: p.dropId } });
        }
      }
      // 再按显式 id 写入
      for (const p of plans) {
        const d = p.want;
        const payload = {
          username: d.username,
          nickname: d.nickname,
          role: d.role,
          status: d.status,
          ...(KEEP_PASSWORD && p.action === "update" ? {} : { passwordHash: d.passwordHash }),
        };
        const row = await tx.user.upsert({
          where: { id: d.id },
          create: { id: d.id, passwordHash: d.passwordHash, createdAt: d.createdAt, ...payload },
          update: payload,
        });
        console.log(`  ${p.action === "create" ? "已新建" : "已更新"} id=${row.id} ${row.username}`);
      }
    });

    // 序列对齐（显式 id 写入不会推进自增序列，必须手动 setval）
    const seq = await prisma.$queryRawUnsafe<Array<{ v: string }>>(
      `SELECT setval(pg_get_serial_sequence('"user"', 'id'), COALESCE((SELECT MAX(id) FROM "user"), 1))::text AS v`,
    );
    console.log(`  自增序列已对齐：last_value=${seq[0]?.v}`);
  }

  // ---- 结果复述 ----
  console.log("\n" + "=".repeat(72));
  const after = await prisma.user.findMany({
    select: { id: true, username: true, nickname: true, role: true, status: true, passwordHash: true },
    orderBy: { id: "asc" },
  });
  console.log(`门户当前用户（${after.length} 个）`);
  for (const u of after) {
    const srcCovered = desired.find((d) => d.id === u.id && lc(d.username) === lc(u.username));
    const hashOk = desired.find((d) => d.id === u.id)?.passwordHash === u.passwordHash;
    console.log(
      `  id=${u.id}  ${u.username.padEnd(12)} ${u.nickname.padEnd(8)} ${u.role.padEnd(6)} ${u.status.padEnd(8)}` +
        `${srcCovered ? "  [与源库对齐]" : ""}${hashOk ? "  [哈希一致]" : ""}`,
    );
  }
  const missing = desired.filter((d) => !after.some((u) => u.id === d.id && lc(u.username) === lc(d.username)));
  console.log(missing.length === 0 ? "\n✓ 用户 ID 已全部对齐，可以执行 migrate-bills" : `\n✗ 仍有 ${missing.length} 个未对齐`);
}

main()
  .catch((e) => {
    console.error(`\n失败：${e instanceof Error ? e.message : e}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
