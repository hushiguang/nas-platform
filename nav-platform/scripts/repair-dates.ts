/**
 * 修复 `@db.Date` 列的日期偏移（历史迁移缺陷）。
 *
 * 背景：v1 的 migrate-bills.ts 对 `recurring_rules.start_date / end_date` 误用了
 * parseLocal（按 +08:00 解释），而这两列在 PG 里是 `date` 类型 —— Prisma 只取 UTC 的
 * 年月日，于是 '2026-05-09' 被写成了 2026-05-08，整体早一天。
 * （`occurredAt` / `nextRun` 是 timestamp 列，走 UTC 墙钟口径，不受影响。）
 *
 * 本脚本按「UTC 午夜」口径重新写一遍这两列，**幂等**：
 *   npx tsx scripts/repair-dates.ts --dry-run
 *   npx tsx scripts/repair-dates.ts
 *
 * 迁移脚本本身已修好，正常重跑迁移不会再产生偏移；这个脚本是给已经导完的库打补丁。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const DRY_RUN = argv.includes("--dry-run");

const SOURCE =
  getArg("--source") ?? "/Users/leo/workspace/nas-platform/cash-platform/server/data/ledger.db";

function snapshotDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "ledger-repair-"));
  const dst = join(dir, "ledger.db");
  copyFileSync(SOURCE, dst);
  for (const suffix of ["-wal", "-shm"]) {
    const f = `${SOURCE}${suffix}`;
    if (existsSync(f)) copyFileSync(f, `${dst}${suffix}`);
  }
  return dst;
}

function readTable<T>(dbPath: string, table: string): T[] {
  const out = execFileSync("sqlite3", ["-json", dbPath, `SELECT * FROM "${table}";`], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 256,
  });
  const s = out.trim();
  return s ? (JSON.parse(s) as T[]) : [];
}

/** 'YYYY-MM-DD' → 写进 date 列的 UTC 午夜值 */
function dateOnly(v: unknown): Date | null {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** date 列回读（Prisma 给的是 UTC 午夜）→ 'YYYY-MM-DD' */
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

async function main() {
  console.log("=".repeat(78));
  console.log(`修复 date 列偏移${DRY_RUN ? "（dry-run，不写库）" : ""}`);
  console.log(`源库：${SOURCE}`);
  console.log("=".repeat(78));

  const db = snapshotDb();
  const rules = readTable<Record<string, unknown>>(db, "recurring_rules");
  console.log(`源库定期规则：${rules.length} 条\n`);

  let fixed = 0;
  let already = 0;
  for (const r of rules) {
    const id = Number(r.id);
    const row = await prisma.billRecurringRule.findUnique({ where: { id } });
    if (!row) {
      console.log(`  跳过 #${id}：目标库没有这条规则`);
      continue;
    }
    const wantStart = dateOnly(r.start_date);
    const wantEnd = dateOnly(r.end_date);
    if (!wantStart) {
      console.log(`  跳过 #${id}：源库 start_date 无法解析（${r.start_date}）`);
      continue;
    }
    const curStart = iso(row.startDate);
    const curEnd = iso(row.endDate);
    const nextStart = iso(wantStart);
    const nextEnd = iso(wantEnd);
    if (curStart === nextStart && curEnd === nextEnd) {
      already += 1;
      console.log(`  #${id} 已正确：${curStart} ~ ${curEnd ?? "-"}`);
      continue;
    }
    fixed += 1;
    console.log(
      `  #${id} 修正：${curStart}~${curEnd ?? "-"} → ${nextStart}~${nextEnd ?? "-"}`,
    );
    if (!DRY_RUN) {
      await prisma.billRecurringRule.update({
        where: { id },
        data: { startDate: wantStart, endDate: wantEnd },
      });
    }
  }

  console.log(`\n结果：修正 ${fixed} 条，本来就正确 ${already} 条${DRY_RUN ? "（未落库）" : ""}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
