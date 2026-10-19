/**
 * 账单平台迁移：SQLite (cash-platform) → PostgreSQL (nas-platform)
 *
 * 用法：
 *   npx tsx scripts/migrate-bills.ts --dry-run        # 只解析校验，不写库（先跑这个）
 *   npx tsx scripts/migrate-bills.ts                  # 正式导入（会先清空 bill_* 表）
 *   npx tsx scripts/migrate-bills.ts --source <path>  # 指定源库（默认读环境变量 MIGRATE_SOURCE，或 ./ledger.db）
 *   npx tsx scripts/migrate-bills.ts --keep           # 不清空目标表，追加写入
 *
 * 前置：必须先跑 `npx tsx scripts/migrate-users.ts`
 *   —— 用户 id 契约：门户 user.id ≡ 源库 users.id。本脚本不新建用户，
 *      未对齐直接中止（详见 [2/6] 段落注释）。
 *
 * 迁移口径（三条硬约定，改动前先想清楚）：
 *   1. 金额一律「整数分」：amount_cents → amountCents，不做任何换算，零精度损失。
 *      源库本身就是整数分，不要在这里引入浮点。
 *   2. occurred_at 是 'YYYY-MM-DD HH:MM:SS' 且不带时区，语义是记账当时的本地时间，
 *      按 Asia/Shanghai (+08:00) 解释；created_at 是 ISO-8601 带 Z，直接解析。
 *      ⚠ Prisma 的 DateTime 落到 PG 是 timestamp(3)（无时区，与全项目 57 个 DateTime 字段约定一致），
 *      里面存的是 UTC 墙钟：源库本地 '2026-09-04 21:23:27' → 库里 '2026-09-04 13:23:27'。
 *      回读时 Prisma 同样按 UTC 解释，瞬时自洽；写裸 SQL 校验时记得先按 UTC 解释再折算时区。
 *   3. 原 id 全量保留，便于与源库逐条对账；导完必须重置自增序列（脚本自动做），
 *      否则之后插入新账单会主键冲突。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const KEEP = hasFlag("--keep");

// ---------------------------------------------------------------- 源库快照
//
// 为什么不直接在源库上读：
//   1. 源库是 WAL 模式。SQLite 不允许在缺少 -shm 的情况下**只读**打开 WAL 库
//      —— 账单服务端干净退出后 -wal/-shm 会被合并删除，此时 `sqlite3 -readonly`
//      直接报 "unable to open database file (14)"。
//   2. 迁移期间若源库被写入，边读边写会读到不一致的中间状态。
// 所以统一先做一次冷快照（三件套一起拷），之后所有读取都在快照上跑。
let _snapshot: string | null = null;
function srcDb(): string {
  if (_snapshot) return _snapshot;
  const dir = mkdtempSync(join(tmpdir(), "ledger-src-"));
  const dst = join(dir, "ledger.db");
  copyFileSync(SOURCE, dst);
  for (const suffix of ["-wal", "-shm"]) {
    const f = `${SOURCE}${suffix}`;
    if (existsSync(f)) copyFileSync(f, `${dst}${suffix}`);
  }
  _snapshot = dst;
  return dst;
}

// ---------------------------------------------------------------- 读取 SQLite
/** 用 sqlite3 CLI 的 -json 模式整表读出。大表（transactions 约 16MB）需要放大 maxBuffer */
function readTable<T = Record<string, unknown>>(table: string): T[] {
  const out = execFileSync(
    "sqlite3",
    ["-json", srcDb(), `SELECT * FROM "${table}";`],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 512 },
  );
  const s = out.trim();
  return s ? (JSON.parse(s) as T[]) : [];
}

// ---------------------------------------------------------------- 类型转换
/** 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM:SS' → Date，按 Asia/Shanghai 解释 */
function parseLocal(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(`${t}T00:00:00+08:00`);
  const iso = t.includes(" ") ? t.replace(" ", "T") : t;
  const d = new Date(`${iso}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 纯日期串 → Date，**按 UTC 午夜**解释。
 *
 * ⚠ 只能用在 `@db.Date` 列（bill_recurring_rule.start_date / end_date 等）上。
 *   这两类列的语义完全不同：
 *     · timestamp 列（occurredAt / nextRun）—— Prisma 写「UTC 墙钟」，必须用 parseLocal
 *       把本地时刻换算过去，读的时候再加 8 小时还原；
 *     · date 列 —— Prisma 只取 UTC 的年月日，用 parseLocal 会整体早一天
 *       （'2026-05-09' → 2026-05-08T16:00Z → 存成 2026-05-08）。
 *   历史遗留：v1 版本的迁移脚本对 date 列误用了 parseLocal，见 scripts/repair-dates.ts。
 */
function parseLocalDateOnly(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO-8601（带 Z）→ Date */
function parseIso(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

const toBool = (v: unknown): boolean => v === 1 || v === "1" || v === true;
const toInt = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);
const toStr = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.trim() === "" ? null : s;
};

/** JSON 数组字符串 → Json；解析失败或非数组返回 null（不阻断迁移） */
function parseJsonArray(v: unknown): unknown[] | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 枚举安全转换：源库是自由文本，只接受 schema 里声明的值 */
function pickEnum<T extends string>(
  allowed: readonly T[],
  raw: unknown,
  fallback: T,
  onUnknown?: (value: string) => void,
): T {
  const v = String(raw ?? "").trim().toUpperCase();
  if ((allowed as readonly string[]).includes(v)) return v as T;
  if (v) onUnknown?.(v);
  return fallback;
}

// ---------------------------------------------------------------- 枚举白名单（与 prisma/schema.prisma 保持一致）
const TX_TYPE = ["EXPENSE", "INCOME", "TRANSFER"] as const;
const TX_SOURCE = ["MANUAL", "ALIPAY", "WECHAT", "CMB", "JD", "CUSTOM", "RECURRING"] as const;
const ACC_KIND = ["ALIPAY", "BANK", "CASH", "CREDIT", "JD", "OTHER", "WECHAT"] as const;
const CAT_KIND = ["EXPENSE", "INCOME"] as const;
const BOOK_KIND = ["PERSONAL", "FAMILY", "TRAVEL", "AA"] as const;

// 未知枚举值收集（迁移后要人工确认，不能静默丢掉）
const unknownEnums = new Map<string, number>();
const noteUnknown = (field: string) => (v: string) => {
  const key = `${field}=${v}`;
  unknownEnums.set(key, (unknownEnums.get(key) ?? 0) + 1);
};

// 因数据问题被跳过的行
const skipped: string[] = [];
const skip = (what: string) => {
  skipped.push(what);
  console.warn(`  ! 跳过 ${what}`);
};

// ---------------------------------------------------------------- 目标表
// 顺序无关（schema 里没声明 @relation / 外键），但清空时按倒序更符合直觉
const TARGET_TABLES = [
  "bill_transaction_image",
  "bill_transaction",
  "bill_recurring_rule",
  "bill_transfer_rule",
  "bill_cmb_text_fix",
  "bill_category_rule",
  "bill_category_alias",
  "bill_account_alias",
  "bill_duplicate_ignore",
  "bill_import_draft",
  "bill_import_template",
  "bill_book_participant",
  "bill_book_member",
  "bill_book",
  "bill_category",
  "bill_account",
] as const;

async function truncateAll() {
  for (const t of TARGET_TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  }
  console.log(`已清空 ${TARGET_TABLES.length} 张目标表`);
}

/** 保留原 id 后必须把序列推到 MAX(id)，否则后续插入会主键冲突 */
async function resetSequences() {
  for (const t of TARGET_TABLES) {
    await prisma.$executeRawUnsafe(`
      SELECT setval(
        pg_get_serial_sequence('${t}', 'id'),
        COALESCE((SELECT MAX(id) FROM "${t}"), 1),
        (SELECT COUNT(*) > 0 FROM "${t}")
      )
    `);
  }
  console.log("已重置全部自增序列");
}

/** 分批写入，避免单条 SQL 参数过多 */
async function insertAll<T>(
  label: string,
  rows: T[],
  fn: (chunk: T[]) => Promise<{ count: number }>,
  size = 800,
): Promise<number> {
  if (rows.length === 0) {
    console.log(`  ${label}: 0 行（跳过）`);
    return 0;
  }
  let done = 0;
  for (let i = 0; i < rows.length; i += size) {
    const r = await fn(rows.slice(i, i + size));
    done += r.count;
  }
  console.log(`  ${label}: ${done} 行`);
  return done;
}

// ================================================================ 主流程
async function main() {
  console.log("=".repeat(72));
  console.log("账单迁移：SQLite → PostgreSQL");
  console.log(`  源库：${SOURCE}`);
  console.log(`  快照：${srcDb()}（源库为 WAL，统一在冷快照上读）`);
  console.log(`  模式：${DRY_RUN ? "DRY-RUN（不写库）" : KEEP ? "追加写入" : "清空后导入"}`);
  console.log("=".repeat(72));

  // ---- 1. 源数据全量读入 ----
  console.log("\n[1/6] 读取源库");
  const src = {
    users: readTable<Record<string, unknown>>("users"),
    accounts: readTable<Record<string, unknown>>("accounts"),
    categories: readTable<Record<string, unknown>>("categories"),
    books: readTable<Record<string, unknown>>("books"),
    bookMembers: readTable<Record<string, unknown>>("book_members"),
    bookParticipants: readTable<Record<string, unknown>>("book_participants"),
    tx: readTable<Record<string, unknown>>("transactions"),
    txImages: readTable<Record<string, unknown>>("transaction_images"),
    recurring: readTable<Record<string, unknown>>("recurring_rules"),
    accountAliases: readTable<Record<string, unknown>>("account_aliases"),
    categoryAliases: readTable<Record<string, unknown>>("category_aliases"),
    categoryRules: readTable<Record<string, unknown>>("category_rules"),
    transferRules: readTable<Record<string, unknown>>("transfer_rules"),
    cmbFixes: readTable<Record<string, unknown>>("cmb_text_fixes"),
    dupIgnores: readTable<Record<string, unknown>>("duplicate_ignores"),
    importTemplates: readTable<Record<string, unknown>>("import_templates"),
    importDrafts: readTable<Record<string, unknown>>("import_drafts"),
  };
  for (const [k, v] of Object.entries(src)) console.log(`  ${k}: ${v.length}`);
  if (src.users.length === 0) throw new Error("源库没有任何用户，中止");

  // ---- 2. 用户对齐校验（契约，不建映射表）----
  //
  // 契约：门户 user.id ≡ 源库 users.id。步骤顺序必须是
  //       migrate-users  →  migrate-bills  →  verify-bills
  //
  // 这里刻意**不新建用户**：所有 ownerId / userId 直接沿用源库 id。
  // 若门户用户未先由 migrate-users 按显式 id 建好，就中止 ——
  // 否则会静默地按自增分配出新 id，导致同一人在两侧 id 不同，
  // 之后账单权限判断（只看自己的数据）会整体错位。
  console.log("\n[2/6] 校验用户 ID 对齐（契约：门户 user.id ≡ 源库 users.id）");
  const portalUsers = await prisma.user.findMany({ select: { id: true, username: true } });
  const lc = (s: string) => s.toLowerCase();
  const problems: string[] = [];

  for (const u of src.users) {
    const id = Number(u.id);
    const username = String(u.username);
    const hit = portalUsers.find((p) => p.id === id);
    if (!hit) {
      problems.push(`门户缺少 id=${id}（源库 ${username}）`);
    } else if (lc(hit.username) !== lc(username)) {
      problems.push(`id=${id} 用户名不一致：门户「${hit.username}」/ 源库「${username}」`);
    }
  }
  // 反向检查：门户里若存在同名但 id 不同的用户，会变成两个账号
  for (const u of src.users) {
    const username = String(u.username);
    const dup = portalUsers.find((p) => lc(p.username) === lc(username) && p.id !== Number(u.id));
    if (dup) {
      problems.push(`门户存在重名用户「${dup.username}」(id=${dup.id})，与源库 id=${Number(u.id)} 冲突`);
    }
  }

  if (problems.length > 0) {
    console.error("  用户 ID 未对齐：");
    for (const p of problems) console.error(`    ✗ ${p}`);
    if (DRY_RUN) {
      console.warn("  [dry-run] 仅告警，继续用恒等映射试跑解析（正式执行会中止）");
    } else {
      console.error("\n请先执行： npx tsx scripts/migrate-users.ts");
      process.exit(1);
    }
  } else {
    console.log(
      `  ✓ 已对齐 ${src.users.length} 个用户：` +
        src.users.map((u) => `id=${Number(u.id)}:${String(u.username)}`).join("  "),
    );
  }

  /** 恒等映射：源库 user id 就是门户 user id。门户缺该 id 时返回 null，由调用方跳过该行 */
  const mapUser = (v: unknown): number | null => {
    const id = Number(v);
    return portalUsers.some((p) => p.id === id) ? id : null;
  };

  // ---- 3. 各表数据转换 ----
  console.log("\n[3/6] 转换数据");

  // 账户
  const accounts = src.accounts.flatMap((r) => {
    const ownerId = mapUser(r.user_id);
    if (ownerId === null) {
      skip(`账户 ${r.id}（user_id=${r.user_id} 无对应用户）`);
      return [];
    }
    return [
      {
        id: Number(r.id),
        ownerId,
        name: String(r.name ?? ""),
        kind: pickEnum(ACC_KIND, r.kind, "OTHER", noteUnknown("accounts.kind")),
        initialCents: Number(r.initial_cents ?? 0),
        sort: Number(r.sort ?? 0),
        archived: toBool(r.archived),
        mergedInto: toInt(r.merged_into),
        // 源库后补的列，绝大多数为 NULL，原样带过去
        createdAt: parseIso(r.created_at),
      },
    ];
  });

  // 分类
  const categories = src.categories.flatMap((r) => {
    const ownerId = mapUser(r.user_id);
    if (ownerId === null) {
      skip(`分类 ${r.id}（user_id=${r.user_id} 无对应用户）`);
      return [];
    }
    return [
      {
        id: Number(r.id),
        ownerId,
        name: String(r.name ?? ""),
        parentId: toInt(r.parent_id),
        kind: pickEnum(CAT_KIND, r.kind, "EXPENSE", noteUnknown("categories.kind")),
        sort: Number(r.sort ?? 0),
        archived: toBool(r.archived),
      },
    ];
  });

  // 账本：owner 对不上用户的一律跳过（源库若存在 owner 已删除的残留账本）
  const validBookIds = new Set<number>();
  const books = src.books.flatMap((r) => {
    const ownerId = mapUser(r.owner_id);
    if (ownerId === null) {
      skip(`账本 ${r.id}「${r.name}」（owner_id=${r.owner_id} 无对应用户）`);
      return [];
    }
    validBookIds.add(Number(r.id));
    return [
      {
        id: Number(r.id),
        ownerId,
        name: String(r.name ?? ""),
        kind: pickEnum(BOOK_KIND, r.kind, "PERSONAL", noteUnknown("books.kind")),
        shareToken: toStr(r.share_token),
        shareEnabled: toBool(r.share_enabled),
        shareWritable: toBool(r.share_writable),
        aaEnabled: toBool(r.aa_enabled),
        archived: toBool(r.archived),
        createdAt: parseIso(r.created_at) ?? new Date(),
      },
    ];
  });

  const bookMembers = src.bookMembers.flatMap((r) => {
    if (!validBookIds.has(Number(r.book_id))) return [];
    const userId = mapUser(r.user_id);
    if (userId === null) {
      skip(`账本成员 ${r.id}（user_id=${r.user_id} 无对应用户）`);
      return [];
    }
    return [
      {
        id: Number(r.id),
        bookId: Number(r.book_id),
        userId,
        role: String(r.role ?? "member"),
        createdAt: parseIso(r.created_at) ?? new Date(),
      },
    ];
  });

  const bookParticipants = src.bookParticipants.flatMap((r) =>
    validBookIds.has(Number(r.book_id))
      ? [
          {
            id: Number(r.id),
            bookId: Number(r.book_id),
            name: String(r.name ?? ""),
            sort: Number(r.sort ?? 0),
            createdAt: parseIso(r.created_at) ?? new Date(),
          },
        ]
      : [],
  );

  // 账单流水（核心表）
  let orphanOccurredAt = 0;
  const transactions = src.tx.flatMap((r) => {
    const ownerId = mapUser(r.user_id);
    if (ownerId === null) {
      skip(`账单 ${r.id}（user_id=${r.user_id} 无对应用户）`);
      return [];
    }
    const occurredAt = parseLocal(r.occurred_at);
    if (!occurredAt) {
      // occurred_at 是 NOT NULL，解析不出来只能跳过（源库已校验为 0 条，属于兜底）
      orphanOccurredAt++;
      skip(`账单 ${r.id}（occurred_at 无法解析：${r.occurred_at}）`);
      return [];
    }
    return [
      {
        id: Number(r.id),
        ownerId,
        bookId: toInt(r.book_id),
        type: pickEnum(TX_TYPE, r.type, "EXPENSE", noteUnknown("transactions.type")),
        amountCents: Number(r.amount_cents ?? 0),
        accountId: toInt(r.account_id),
        toAccountId: toInt(r.to_account_id),
        categoryId: toInt(r.category_id),
        categoryLabel: toStr(r.category_label),
        occurredAt,
        payee: toStr(r.payee),
        note: toStr(r.note),
        memberName: toStr(r.member_name),
        shareWith: parseJsonArray(r.share_with) ?? undefined,
        source: pickEnum(TX_SOURCE, r.source, "MANUAL", noteUnknown("transactions.source")),
        externalId: toStr(r.external_id),
        recurringRuleId: toInt(r.recurring_rule_id),
        createdAt: parseIso(r.created_at) ?? new Date(),
      },
    ];
  });

  const txImages = src.txImages.map((r) => ({
    id: Number(r.id),
    transactionId: Number(r.transaction_id),
    url: String(r.url ?? ""),
    sort: Number(r.sort ?? 0),
    createdAt: parseIso(r.created_at) ?? new Date(),
  }));

  const recurringRules = src.recurring.flatMap((r) => {
    const ownerId = mapUser(r.user_id);
    if (ownerId === null) {
      skip(`定期规则 ${r.id}（user_id=${r.user_id} 无对应用户）`);
      return [];
    }
    const startDate = parseLocalDateOnly(r.start_date);
    if (!startDate) {
      skip(`定期规则 ${r.id}（start_date 无法解析：${r.start_date}）`);
      return [];
    }
    return [
      {
        id: Number(r.id),
        ownerId,
        bookId: toInt(r.book_id),
        type: pickEnum(TX_TYPE, r.type, "EXPENSE", noteUnknown("recurring_rules.type")),
        amountCents: Number(r.amount_cents ?? 0),
        accountId: Number(r.account_id),
        toAccountId: toInt(r.to_account_id),
        categoryId: toInt(r.category_id),
        payee: toStr(r.payee),
        note: toStr(r.note),
        frequency: String(r.frequency ?? "monthly"),
        intervalDays: toInt(r.interval_days),
        weekdays: toStr(r.weekdays),
        monthDay: toInt(r.month_day),
        yearMonth: toInt(r.year_month),
        yearDay: toInt(r.year_day),
        startDate,
        endDate: parseLocalDateOnly(r.end_date),
        time: String(r.time ?? "09:00"),
        nextRun: parseLocal(r.next_run),
        paused: toBool(r.paused),
        createdAt: parseIso(r.created_at) ?? new Date(),
      },
    ];
  });

  const accountAliases = src.accountAliases.flatMap((r) => {
    const ownerId = mapUser(r.user_id);
    if (ownerId === null) return [];
    return [
      {
        id: Number(r.id),
        ownerId,
        alias: String(r.alias ?? ""),
        accountId: Number(r.account_id),
      },
    ];
  });

  const categoryAliases = src.categoryAliases.flatMap((r) => {
    const ownerId = mapUser(r.user_id);
    if (ownerId === null) return [];
    return [
      {
        id: Number(r.id),
        ownerId,
        kind: pickEnum(CAT_KIND, r.kind, "EXPENSE", noteUnknown("category_aliases.kind")),
        alias: String(r.alias ?? ""),
        categoryId: Number(r.category_id),
      },
    ];
  });

  const categoryRules = src.categoryRules.flatMap((r) => {
    const ownerId = mapUser(r.user_id);
    if (ownerId === null) return [];
    return [
      {
        id: Number(r.id),
        ownerId,
        keyword: String(r.keyword ?? ""),
        categoryId: Number(r.category_id),
        createdAt: parseIso(r.created_at) ?? new Date(),
      },
    ];
  });

  const transferRules = src.transferRules.flatMap((r) => {
    const ownerId = mapUser(r.user_id);
    if (ownerId === null) return [];
    return [
      {
        id: Number(r.id),
        ownerId,
        label: String(r.label ?? ""),
        pattern: String(r.pattern ?? ""),
        isRegex: toBool(r.is_regex),
        targetAccountId: toInt(r.target_account_id),
        enabled: toBool(r.enabled),
        position: Number(r.position ?? 0),
        createdAt: parseIso(r.created_at) ?? new Date(),
      },
    ];
  });

  const cmbFixes = src.cmbFixes.flatMap((r) => {
    const ownerId = mapUser(r.user_id);
    if (ownerId === null) return [];
    return [
      {
        id: Number(r.id),
        ownerId,
        garbled: String(r.garbled ?? ""),
        correct: String(r.correct ?? ""),
        enabled: toBool(r.enabled),
        position: Number(r.position ?? 0),
        createdAt: parseIso(r.created_at) ?? new Date(),
      },
    ];
  });

  const dupIgnores = src.dupIgnores.flatMap((r) => {
    const ownerId = mapUser(r.user_id);
    if (ownerId === null) return [];
    return [
      {
        id: Number(r.id),
        ownerId,
        pairKey: String(r.pair_key ?? ""),
        createdAt: parseIso(r.created_at) ?? new Date(),
      },
    ];
  });

  const importTemplates = src.importTemplates.flatMap((r) => {
    const ownerId = mapUser(r.user_id);
    if (ownerId === null) return [];
    return [
      {
        id: Number(r.id),
        ownerId,
        name: String(r.name ?? ""),
        mapping: (JSON.parse(String(r.mapping ?? "{}")) ?? {}) as object,
        createdAt: parseIso(r.created_at) ?? new Date(),
      },
    ];
  });

  const importDrafts = src.importDrafts.flatMap((r) => {
    const ownerId = mapUser(r.user_id);
    if (ownerId === null) return [];
    return [
      {
        id: Number(r.id),
        ownerId,
        source: String(r.source ?? ""),
        filename: toStr(r.filename),
        payload: (JSON.parse(String(r.payload ?? "{}")) ?? {}) as object,
        // 源库这一列是毫秒时间戳（INTEGER）
        createdAt: new Date(Number(r.created_at)),
      },
    ];
  });

  // ---- 3.5 转换结果摘要 ----
  const srcAmountSum = src.tx.reduce((s, r) => s + Number(r.amount_cents ?? 0), 0);
  const dstAmountSum = transactions.reduce((s, r) => s + r.amountCents, 0);
  console.log(`  账单 ${transactions.length} 条，金额合计 ${dstAmountSum} 分`);
  if (dstAmountSum !== srcAmountSum) {
    throw new Error(`金额合计不一致！源 ${srcAmountSum} vs 转换后 ${dstAmountSum}`);
  }
  console.log(`  金额合计与源库一致（${srcAmountSum} 分）`);

  const plan: Array<[string, unknown[], (c: unknown[]) => Promise<{ count: number }>]> = [
    ["bill_account", accounts, (c) => prisma.billAccount.createMany({ data: c as never })],
    ["bill_category", categories, (c) => prisma.billCategory.createMany({ data: c as never })],
    ["bill_book", books, (c) => prisma.billBook.createMany({ data: c as never })],
    ["bill_book_member", bookMembers, (c) => prisma.billBookMember.createMany({ data: c as never })],
    ["bill_book_participant", bookParticipants, (c) => prisma.billBookParticipant.createMany({ data: c as never })],
    ["bill_transaction", transactions, (c) => prisma.billTransaction.createMany({ data: c as never })],
    ["bill_transaction_image", txImages, (c) => prisma.billTransactionImage.createMany({ data: c as never })],
    ["bill_recurring_rule", recurringRules, (c) => prisma.billRecurringRule.createMany({ data: c as never })],
    ["bill_account_alias", accountAliases, (c) => prisma.billAccountAlias.createMany({ data: c as never })],
    ["bill_category_alias", categoryAliases, (c) => prisma.billCategoryAlias.createMany({ data: c as never })],
    ["bill_category_rule", categoryRules, (c) => prisma.billCategoryRule.createMany({ data: c as never })],
    ["bill_transfer_rule", transferRules, (c) => prisma.billTransferRule.createMany({ data: c as never })],
    ["bill_cmb_text_fix", cmbFixes, (c) => prisma.billCmbTextFix.createMany({ data: c as never })],
    ["bill_duplicate_ignore", dupIgnores, (c) => prisma.billDuplicateIgnore.createMany({ data: c as never })],
    ["bill_import_template", importTemplates, (c) => prisma.billImportTemplate.createMany({ data: c as never })],
    ["bill_import_draft", importDrafts, (c) => prisma.billImportDraft.createMany({ data: c as never })],
  ];

  // ---- 4. 写入 ----
  if (DRY_RUN) {
    console.log("\n[4/6] DRY-RUN，跳过写入。计划写入：");
    for (const [label, rows] of plan) console.log(`  ${label}: ${rows.length}`);
  } else {
    console.log("\n[4/6] 写入目标库");
    if (!KEEP) await truncateAll();
    await prisma.$transaction(async () => {
      for (const [label, rows, fn] of plan) {
        await insertAll(label, rows, fn as (c: unknown[]) => Promise<{ count: number }>);
      }
    }, { timeout: 600_000 });
  }

  // ---- 5. 重置序列 ----
  console.log("\n[5/6] 重置自增序列");
  if (DRY_RUN) console.log("  DRY-RUN，跳过");
  else await resetSequences();

  // ---- 6. 报告 ----
  console.log("\n[6/6] 迁移摘要");
  if (unknownEnums.size > 0) {
    console.log("  ⚠ 遇到未声明的枚举值（已用兜底值写入，需人工确认）：");
    for (const [k, n] of unknownEnums) console.log(`    ${k} × ${n}`);
  } else {
    console.log("  枚举值全部落在白名单内");
  }
  if (skipped.length > 0) {
    console.log(`  ⚠ 跳过 ${skipped.length} 行（来源数据不完整）：`);
    for (const s of skipped.slice(0, 20)) console.log(`    ${s}`);
    if (skipped.length > 20) console.log(`    …… 另有 ${skipped.length - 20} 行`);
  } else {
    console.log("  没有跳过的行");
  }
  console.log("\n完成。接着跑对账：npx tsx scripts/verify-bills.ts");
}

main()
  .catch((e) => {
    console.error("\n迁移失败：", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
