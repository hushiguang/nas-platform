/**
 * 账单迁移对账：逐项比对 SQLite 源库与 PostgreSQL 目标库
 *
 * 用法：
 *   npx tsx scripts/verify-bills.ts
 *   npx tsx scripts/verify-bills.ts --source <path>   # 指定源库
 *
 * 退出码非 0 表示对账失败，不要切流。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@nas/db";

const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const getArg = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const SOURCE =
  getArg("--source") ??
  process.env.MIGRATE_SOURCE ??
  "./ledger.db";

// ---------------------------------------------------------------- 源库快照
//
// 为什么不直接在源库上读：
//   1. 源库是 WAL 模式。SQLite 不允许在缺少 -shm 的情况下**只读**打开 WAL 库
//      —— 账单服务端干净退出后 -wal/-shm 会被合并删除，此时 `sqlite3 -readonly`
//      直接报 "unable to open database file (14)"。
//   2. 对账期间若源库被写入，边读边写会读到不一致的中间状态。
// 所以统一先做一次冷快照（三件套一起拷），之后所有查询都在快照上跑。
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

// ---------------------------------------------------------------- 查询helper
function sqliteJson<T = Record<string, unknown>>(sql: string): T[] {
  const out = execFileSync("sqlite3", ["-json", srcDb(), sql], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 256,
  });
  const s = out.trim();
  return s ? (JSON.parse(s) as T[]) : [];
}
function sqliteScalar(sql: string): string {
  return execFileSync("sqlite3", [srcDb(), sql], {
    encoding: "utf8",
  }).trim();
}
async function pgScalar(sql: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql);
  const first = rows[0];
  if (!first) return "";
  const v = Object.values(first)[0];
  return v === null || v === undefined ? "" : String(v);
}

// ---------------------------------------------------------------- 结果收集
type Result = { name: string; pass: boolean; detail: string };
const results: Result[] = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  PASS" : "  FAIL"}  ${name.padEnd(34)} ${detail}`);
}

// ================================================================ 1. 行数
// 预期差异：正式库所有行的外键都能对上用户，迁移不做跳过，故两边行数应完全相等
const EXPECTED_DIFF: Record<string, number> = {};

const ROW_CHECKS: Array<[string, string, string]> = [
  ["账户", "accounts", "bill_account"],
  ["分类", "categories", "bill_category"],
  ["账本", "books", "bill_book"],
  ["账本成员", "book_members", "bill_book_member"],
  ["账本参与人", "book_participants", "bill_book_participant"],
  ["账单流水", "transactions", "bill_transaction"],
  ["账单图片", "transaction_images", "bill_transaction_image"],
  ["定期规则", "recurring_rules", "bill_recurring_rule"],
  ["账户别名", "account_aliases", "bill_account_alias"],
  ["分类别名", "category_aliases", "bill_category_alias"],
  ["分类规则", "category_rules", "bill_category_rule"],
  ["转账规则", "transfer_rules", "bill_transfer_rule"],
  ["招行修正", "cmb_text_fixes", "bill_cmb_text_fix"],
  ["查重忽略", "duplicate_ignores", "bill_duplicate_ignore"],
  ["导入模板", "import_templates", "bill_import_template"],
  ["导入草稿", "import_drafts", "bill_import_draft"],
];

async function checkRows() {
  console.log("\n[1] 行数比对");
  for (const [label, srcTable, pgTable] of ROW_CHECKS) {
    const src = Number(sqliteScalar(`SELECT COUNT(*) FROM "${srcTable}";`));
    const dst = Number(await pgScalar(`SELECT COUNT(*) FROM "${pgTable}";`));
    const expect = src - (EXPECTED_DIFF[pgTable] ?? 0);
    const note =
      EXPECTED_DIFF[pgTable] != null ? `（源 ${src}，预期跳过 ${EXPECTED_DIFF[pgTable]} 条）` : "";
    check(`${label} ${pgTable}`, dst === expect, `目标 ${dst} / 预期 ${expect}${note}`);
  }
}

// ================================================================ 2. 金额
async function checkAmount() {
  console.log("\n[2] 金额合计（单位：分，必须精确一致）");
  const srcTotal = sqliteScalar("SELECT COALESCE(SUM(amount_cents),0) FROM transactions;");
  const dstTotal = await pgScalar('SELECT COALESCE(SUM("amountCents"),0)::text FROM bill_transaction;');
  check("流水金额合计", srcTotal === dstTotal, `源 ${srcTotal} / 目标 ${dstTotal}`);

  // 分类型金额
  const srcByType = sqliteJson<{ type: string; s: number }>(
    "SELECT type, COALESCE(SUM(amount_cents),0) AS s FROM transactions GROUP BY type ORDER BY type;",
  );
  const dstByType = await prisma.$queryRawUnsafe<Array<{ type: string; s: bigint }>>(
    'SELECT UPPER(type::text) AS type, COALESCE(SUM("amountCents"),0) AS s FROM bill_transaction GROUP BY type ORDER BY type;',
  );
  for (const row of srcByType) {
    // 源库全是小写，PG 枚举全大写，比对前统一大写
    const key = row.type.toUpperCase();
    const match = dstByType.find((d) => d.type === key);
    const dst = Number(match?.s ?? 0);
    check(`  ${key} 金额`, Number(row.s) === dst, `源 ${row.s} / 目标 ${dst}`);
  }

  // 账户初始余额
  const srcInit = sqliteScalar("SELECT COALESCE(SUM(initial_cents),0) FROM accounts;");
  const dstInit = await pgScalar('SELECT COALESCE(SUM("initialCents"),0)::text FROM bill_account;');
  check("账户初始余额合计", srcInit === dstInit, `源 ${srcInit} / 目标 ${dstInit}`);
}

// ================================================================ 3. 分布
async function checkDistribution() {
  console.log("\n[3] 枚举分布（type / source / account.kind）");

  const pairs: Array<[string, string, string]> = [
    [
      "流水 type",
      "SELECT UPPER(type) AS k, COUNT(*) AS n FROM transactions GROUP BY type ORDER BY type;",
      'SELECT type::text AS k, COUNT(*)::text AS n FROM bill_transaction GROUP BY type ORDER BY type;',
    ],
    [
      "流水 source",
      "SELECT UPPER(source) AS k, COUNT(*) AS n FROM transactions GROUP BY source ORDER BY source;",
      'SELECT source::text AS k, COUNT(*)::text AS n FROM bill_transaction GROUP BY source ORDER BY source;',
    ],
    [
      "账户 kind",
      "SELECT UPPER(kind) AS k, COUNT(*) AS n FROM accounts GROUP BY kind ORDER BY kind;",
      'SELECT kind::text AS k, COUNT(*)::text AS n FROM bill_account GROUP BY kind ORDER BY kind;',
    ],
  ];

  for (const [label, sqlSrc, sqlDst] of pairs) {
    const src = sqliteJson<{ k: string; n: number }>(sqlSrc);
    const dst = await prisma.$queryRawUnsafe<Array<{ k: string; n: bigint }>>(sqlDst);
    const srcStr = src.map((r) => `${r.k}:${r.n}`).sort().join(", ");
    const dstStr = dst.map((r) => `${r.k}:${Number(r.n)}`).sort().join(", ");
    check(label, srcStr === dstStr, srcStr === dstStr ? srcStr : `源 [${srcStr}] / 目标 [${dstStr}]`);
  }
}

// ================================================================ 4. 时间
async function checkTime() {
  console.log("\n[4] 时间范围与转换正确性");

  // occurredAt 列是 timestamp(3)（无时区），按项目统一约定存的是 UTC 墙钟时间：
  // 先按 UTC 解释成瞬时，再折算到 Asia/Shanghai 呈现，才能对上源库的本地时间字符串。
  const srcMin = sqliteScalar("SELECT MIN(occurred_at) FROM transactions;");
  const srcMax = sqliteScalar("SELECT MAX(occurred_at) FROM transactions;");
  const dstMin = await pgScalar(
    `SELECT to_char(MIN("occurredAt") AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') FROM bill_transaction;`,
  );
  const dstMax = await pgScalar(
    `SELECT to_char(MAX("occurredAt") AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') FROM bill_transaction;`,
  );
  check("occurredAt 最早", srcMin === dstMin, `源 ${srcMin} / 目标(还原) ${dstMin}`);
  check("occurredAt 最晚", srcMax === dstMax, `源 ${srcMax} / 目标(还原) ${dstMax}`);

  // createdAt 源库本身就是 UTC 墙钟，列里也是 UTC 墙钟，直接呈现，不要再做时区换算
  const srcCreatedMin = sqliteScalar("SELECT MIN(created_at) FROM transactions;");
  const dstCreatedMin = await pgScalar(
    `SELECT to_char(MIN("createdAt"), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM bill_transaction;`,
  );
  const sameMs = srcCreatedMin.slice(0, 19) === dstCreatedMin.slice(0, 19);
  check("createdAt 最早(UTC)", sameMs, `源 ${srcCreatedMin} / 目标 ${dstCreatedMin}`);
}

// ================================================================ 5. 布尔与JSON
async function checkFlagAndJson() {
  console.log("\n[5] 布尔 / JSON 字段转换");

  const archivedSrc = sqliteScalar("SELECT COUNT(*) FROM accounts WHERE archived = 1;");
  const archivedDst = await pgScalar('SELECT COUNT(*)::text FROM bill_account WHERE archived = true;');
  check("账户 archived=true", archivedSrc === archivedDst, `源 ${archivedSrc} / 目标 ${archivedDst}`);

  const shareWrittenSrc = sqliteScalar("SELECT COUNT(*) FROM books WHERE share_enabled = 1;");
  const shareWrittenDst = await pgScalar('SELECT COUNT(*)::text FROM bill_book WHERE "shareEnabled" = true;');
  check("账本 shareEnabled=true", shareWrittenSrc === shareWrittenDst, `源 ${shareWrittenSrc} / 目标 ${shareWrittenDst}`);

  const shareJsonSrc = sqliteScalar("SELECT COUNT(*) FROM transactions WHERE share_with IS NOT NULL;");
  const shareJsonDst = await pgScalar('SELECT COUNT(*)::text FROM bill_transaction WHERE "shareWith" IS NOT NULL;');
  check("流水 shareWith 非空", shareJsonSrc === shareJsonDst, `源 ${shareJsonSrc} / 目标 ${shareJsonDst}`);

  const extIdSrc = sqliteScalar("SELECT COUNT(*) FROM transactions WHERE external_id IS NOT NULL;");
  const extIdDst = await pgScalar('SELECT COUNT(*)::text FROM bill_transaction WHERE "externalId" IS NOT NULL;');
  check("流水 externalId 非空", extIdSrc === extIdDst, `源 ${extIdSrc} / 目标 ${extIdDst}`);
}

// ================================================================ 6. 抽样逐条
async function checkSampling() {
  console.log("\n[6] 抽样逐条比对（按 id 取首/中/末各 3 条）");

  // 注意：源库 id 不是从 1 开始（历史数据整体导入过，实际从 4 万多起），
  // 必须按真实 id 取首/中/末，绝不能用 1..total 拼 id 数组
  const pickIds = (sql: string) => sqliteJson<{ id: number }>(sql).map((r) => Number(r.id));
  const ids = [
    ...new Set([
      ...pickIds("SELECT id FROM transactions ORDER BY id LIMIT 3;"),
      ...pickIds(
        "SELECT id FROM transactions ORDER BY id LIMIT 1 OFFSET (SELECT COUNT(*) / 2 FROM transactions);",
      ),
      ...pickIds("SELECT id FROM transactions ORDER BY id DESC LIMIT 3;"),
    ]),
  ];
  const sample = sqliteJson<Record<string, unknown>>(
    `SELECT id, type, amount_cents, occurred_at, payee, source FROM transactions WHERE id IN (${ids.join(",")}) ORDER BY id;`,
  );

  let mismatch = 0;
  for (const s of sample) {
    const row = await prisma.billTransaction.findUnique({ where: { id: Number(s.id) } });
    if (!row) {
      mismatch++;
      console.log(`    id=${s.id} 目标库缺失`);
      continue;
    }
    const okType = row.type === String(s.type).toUpperCase();
    const okAmount = row.amountCents === Number(s.amount_cents);
    const okSource = row.source === String(s.source).toUpperCase();
    const okId = row.id === Number(s.id);
    if (!(okType && okAmount && okSource && okId)) {
      mismatch++;
      console.log(
        `    id=${s.id} 不一致：type ${row.type}/${s.type}，amount ${row.amountCents}/${s.amount_cents}，source ${row.source}/${s.source}`,
      );
    }
  }
  check(`抽样 ${sample.length} 条明细`, mismatch === 0, mismatch === 0 ? "全部一致" : `${mismatch} 条不一致`);
}

// ================================================================ 7. 序列
async function checkSequences() {
  console.log("\n[7] 自增序列（保留原 id 后必须已重置）");
  const tables = [
    "bill_account",
    "bill_category",
    "bill_book",
    "bill_transaction",
    "bill_transaction_image",
    "bill_recurring_rule",
  ];
  for (const t of tables) {
    const maxId = await pgScalar(`SELECT COALESCE(MAX(id),0)::text FROM "${t}";`);
    // pg_get_serial_sequence 返回带 schema 的全名（public.xxx_id_seq），
    // 而 pg_sequences.sequencename 不含 schema，直接按名字 join 会匹配不到 —— 取全名后直接读序列
    const seqName = await pgScalar(`SELECT pg_get_serial_sequence('${t}','id');`);
    if (!seqName) {
      check(`${t} 序列`, false, "找不到序列（id 非自增）");
      continue;
    }
    const seq = await pgScalar(`SELECT last_value::text FROM ${seqName};`);
    if (Number(maxId) === 0) {
      check(`${t} 序列`, true, "空表，跳过");
      continue;
    }
    // 保留原 id 后必须 setval 到 MAX(id)，否则下一条插入会主键冲突
    const ok = Number(seq) >= Number(maxId);
    check(`${t} 序列`, ok, `MAX(id)=${maxId} / last_value=${seq}`);
  }
}

// ---------------------------------------------------------------- 用户 ID 对齐
//
// 契约：门户 user.id ≡ 源库 users.id，且密码哈希逐位一致。
// 账单所有 ownerId / userId 都直接沿用源库 id，所以这一项不对就等于全盘错位。
async function checkUsers() {
  console.log("\n[8] 用户 ID 对齐（契约：门户 user.id ≡ 源库 users.id）");
  const srcUsers = sqliteJson<{
    id: number;
    username: string;
    password_hash: string;
    is_admin: number;
    is_active: number;
  }>("SELECT id, username, password_hash, is_admin, is_active FROM users ORDER BY id;");
  const pgUsers = await prisma.$queryRawUnsafe<
    Array<{ id: number; username: string; passwordHash: string; role: string; status: string }>
  >('SELECT id, username, "passwordHash", role::text AS role, status::text AS status FROM "user" ORDER BY id;');
  const lc = (s: string) => s.toLowerCase();

  for (const s of srcUsers) {
    const p = pgUsers.find((u) => u.id === Number(s.id));
    if (!p) {
      check(`用户 id=${s.id} 存在`, false, `门户缺少该 id（源库 ${s.username}）`);
      continue;
    }
    check(
      `用户 id=${s.id} 用户名`,
      lc(p.username) === lc(String(s.username)),
      `门户 ${p.username} / 源库 ${s.username}`,
    );
    check(
      `用户 id=${s.id} 密码哈希`,
      p.passwordHash === String(s.password_hash),
      "bcrypt 哈希逐位一致，Auth.js 可直接校验",
    );
    check(
      `用户 id=${s.id} 角色/状态`,
      p.role === (Number(s.is_admin) === 1 ? "ADMIN" : "MEMBER") &&
        p.status === (Number(s.is_active) === 1 ? "ACTIVE" : "DISABLED"),
      `门户 ${p.role}/${p.status}`,
    );
  }

  for (const s of srcUsers) {
    const dup = pgUsers.find((u) => lc(u.username) === lc(String(s.username)) && u.id !== Number(s.id));
    check(`用户 ${s.username} 无重名分身`, !dup, dup ? `门户另有 id=${dup.id}` : "唯一");
  }

  const seq = await pgScalar(`SELECT last_value::text FROM "user_id_seq";`);
  const maxId = await pgScalar('SELECT COALESCE(MAX(id),0)::text FROM "user";');
  check("user 自增序列", Number(seq) >= Number(maxId), `MAX(id)=${maxId} / last_value=${seq}`);

  // bill_* 与 user 之间刻意没有外键约束（保持模块解耦），所以孤儿只能靠这里守着
  const refs: Array<[string, string]> = [
    ["bill_account", "ownerId"],
    ["bill_account_alias", "ownerId"],
    ["bill_book", "ownerId"],
    ["bill_book_member", "userId"],
    ["bill_category", "ownerId"],
    ["bill_category_alias", "ownerId"],
    ["bill_category_rule", "ownerId"],
    ["bill_cmb_text_fix", "ownerId"],
    ["bill_duplicate_ignore", "ownerId"],
    ["bill_import_draft", "ownerId"],
    ["bill_import_template", "ownerId"],
    ["bill_recurring_rule", "ownerId"],
    ["bill_transaction", "ownerId"],
    ["bill_transfer_rule", "ownerId"],
  ];
  for (const [t, c] of refs) {
    const n = await pgScalar(
      `SELECT COUNT(*)::text FROM "${t}" x LEFT JOIN "user" u ON u.id = x."${c}" WHERE x."${c}" IS NOT NULL AND u.id IS NULL;`,
    );
    check(`${t}.${c} 无孤儿`, Number(n) === 0, Number(n) === 0 ? "全部指向真实用户" : `孤儿 ${n} 行`);
  }

  // bill_transaction_image 不挂用户，归属交易表，单独校验
  const imgOrphan = await pgScalar(
    'SELECT COUNT(*)::text FROM bill_transaction_image i LEFT JOIN bill_transaction t ON t.id = i."transactionId" WHERE t.id IS NULL;',
  );
  check(
    "bill_transaction_image.transactionId 无孤儿",
    Number(imgOrphan) === 0,
    Number(imgOrphan) === 0 ? "全部指向真实账单" : `孤儿 ${imgOrphan} 行`,
  );

  // 按用户分组对账：行数 + 金额
  const scopes: Array<[string, string, string, string]> = [
    ["账户", "accounts", "user_id", "bill_account"],
    ["分类", "categories", "user_id", "bill_category"],
    ["账本", "books", "owner_id", "bill_book"],
  ];
  for (const s of srcUsers) {
    const id = Number(s.id);
    for (const [label, st, scol, pt] of scopes) {
      const src = sqliteScalar(`SELECT COUNT(*) FROM ${st} WHERE ${scol} = ${id};`);
      const dst = await pgScalar(`SELECT COUNT(*)::text FROM "${pt}" WHERE "ownerId" = ${id};`);
      check(`用户 ${id} ${label}数`, src === dst, `源 ${src} / 目标 ${dst}`);
    }
    const srcTx = sqliteScalar(`SELECT COUNT(*) FROM transactions WHERE user_id = ${id};`);
    const dstTx = await pgScalar(`SELECT COUNT(*)::text FROM bill_transaction WHERE "ownerId" = ${id};`);
    check(`用户 ${id} 流水数`, srcTx === dstTx, `源 ${srcTx} / 目标 ${dstTx}`);

    const srcSum = sqliteScalar(`SELECT COALESCE(SUM(amount_cents),0) FROM transactions WHERE user_id = ${id};`);
    const dstSum = await pgScalar(
      `SELECT COALESCE(SUM("amountCents"),0)::text FROM bill_transaction WHERE "ownerId" = ${id};`,
    );
    check(`用户 ${id} 流水金额`, srcSum === dstSum, `源 ${srcSum} / 目标 ${dstSum}`);
  }
}

// ================================================================ 主流程
async function main() {
  console.log("=".repeat(72));
  console.log("账单迁移对账");
  console.log(`  源库：${SOURCE}`);
  console.log(`  快照：${srcDb()}（源库为 WAL，统一在冷快照上读）`);
  console.log("=".repeat(72));

  await checkRows();
  await checkAmount();
  await checkDistribution();
  await checkTime();
  await checkFlagAndJson();
  await checkSampling();
  await checkSequences();
  await checkUsers();

  const failed = results.filter((r) => !r.pass);
  console.log("\n" + "=".repeat(72));
  console.log(`对账结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) {
    console.log("\n未通过项：");
    for (const f of failed) console.log(`  · ${f.name}：${f.detail}`);
    console.log("\n⚠ 对账未全部通过，不要切换流量。");
    process.exit(1);
  }
  console.log("全部通过，可以切换流量。");
}

main()
  .catch((e) => {
    console.error("对账执行失败：", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
