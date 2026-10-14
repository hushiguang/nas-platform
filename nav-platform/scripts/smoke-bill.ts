/**
 * bill 模块冒烟验证：拿迁移后的真实数据跑一遍核心查询，确认移植正确。
 *
 * 用法：npx tsx scripts/smoke-bill.ts
 *
 * 重点验三件事：
 *   1. 统计口径与库内直算一致（笔数 / 收支金额）
 *   2. **跨零点账单的本地日期筛选**正确 —— occurredAt 存的是 UTC 墙钟，
 *      筛选必须先 +8 小时，这块错了会把凌晨的账算到前一天
 *   3. AA 平摊（含 share_with 逐笔分摊）能跑通并配平
 */
import { prisma } from "../src/lib/prisma";
import type { Actor } from "../src/modules/bill/service/book";
import {
  computeAa,
  transactionRows,
  transactionTotal,
  type AaBillRow,
} from "../src/modules/bill/service/query";
import { listAccountsWithBalance } from "../src/modules/bill/service/account";
import { bookBillPeople, bookParticipants } from "../src/modules/bill/service/book";

const USER_ID = Number(process.env.SMOKE_USER_ID || 1);

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(38)} ${detail}`);
}

async function scalar(sql: string, ...params: unknown[]): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, ...params);
  const first = rows[0];
  if (!first) return "";
  const v = Object.values(first)[0];
  return v === null || v === undefined ? "" : String(v);
}

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });
  const actor: Actor = { id: user.id, role: user.role };
  console.log("=".repeat(74));
  console.log(`bill 模块冒烟验证 · 操作者 ${user.username}(${user.id}) role=${user.role}`);
  console.log("=".repeat(74));

  // ---------- 1. 统计口径 ----------
  console.log("\n[1] 统计口径（与库内直算比对）");
  const total = await transactionTotal(actor, {});
  const dbCount = await scalar(`SELECT COUNT(*) FROM bill_transaction WHERE "bookId" IS NOT NULL`);
  check("笔数", String(total.count) === dbCount, `服务层 ${total.count} / 库内 ${dbCount}`);

  const dbExpense = await scalar(
    `SELECT COALESCE(SUM("amountCents"),0) FROM bill_transaction WHERE type='EXPENSE' AND "bookId" IS NOT NULL`,
  );
  const dbIncome = await scalar(
    `SELECT COALESCE(SUM("amountCents"),0) FROM bill_transaction WHERE type='INCOME' AND "bookId" IS NOT NULL`,
  );
  check(
    "支出合计",
    String(total.expenseCents) === dbExpense,
    `服务层 ${total.expenseCents} / 库内 ${dbExpense}`,
  );
  check(
    "收入合计",
    String(total.incomeCents) === dbIncome,
    `服务层 ${total.incomeCents} / 库内 ${dbIncome}`,
  );

  // ---------- 2. 时区：跨零点筛选 ----------
  console.log("\n[2] 本地日期筛选（occurredAt 为 UTC 墙钟，必须 +8 小时）");
  const shifted = await scalar(
    `SELECT COUNT(*) FROM bill_transaction
     WHERE (("occurredAt" + INTERVAL '8 hours')::date <> "occurredAt"::date) AND "bookId" IS NOT NULL`,
  );
  check("存在跨零点账单", Number(shifted) > 0, `${shifted} 笔的本地日期与库内日期不同`);

  // 取一笔跨零点的账单，用它所在「本地日期」去筛，笔数必须与库内直算一致
  const probe = await prisma.$queryRawUnsafe<Array<{ id: number; day: string }>>(
    `SELECT id, ((("occurredAt" + INTERVAL '8 hours')::date)::text) AS day
     FROM bill_transaction
     WHERE ("occurredAt" + INTERVAL '8 hours')::date <> "occurredAt"::date AND "bookId" IS NOT NULL
     ORDER BY id LIMIT 1`,
  );
  if (probe.length) {
    const day = probe[0].day;
    const dbDayCount = await scalar(
      `SELECT COUNT(*) FROM bill_transaction WHERE ("occurredAt" + INTERVAL '8 hours')::date = $1::date AND "bookId" IS NOT NULL`,
      day,
    );
    const svc = await transactionTotal(actor, { from: day, to: day });
    check(`按本地日期 ${day} 筛选`, String(svc.count) === dbDayCount, `服务层 ${svc.count} / 库内 ${dbDayCount}`);
  } else {
    check("跨零点账单取样", false, "没有跨零点账单可验证");
  }

  // ---------- 3. 筛选能力 ----------
  console.log("\n[3] 筛选条件");
  const kw = "美团";
  const kwRows = await transactionRows(actor, { q: kw }, 5, 0);
  const dbKw = await scalar(
    `SELECT COUNT(*) FROM bill_transaction t
     WHERE (t.payee ILIKE $1 OR t.note ILIKE $1) AND t."bookId" IS NOT NULL`,
    `%${kw}%`,
  );
  const kwTotal = await transactionTotal(actor, { q: kw });
  check(
    `关键词「${kw}」`,
    kwTotal.count >= Number(dbKw),
    `服务层 ${kwTotal.count} 笔（含分类/账户/成员命中）/ 仅对方+备注 ${dbKw} 笔`,
  );
  check("分页 limit 生效", kwRows.length <= 5, `返回 ${kwRows.length} 条`);

  const typeTotal = await transactionTotal(actor, { type: "transfer" });
  const dbTransfer = await scalar(
    `SELECT COUNT(*) FROM bill_transaction WHERE type='TRANSFER' AND "bookId" IS NOT NULL`,
  );
  check("按类型 transfer 筛选", String(typeTotal.count) === dbTransfer, `${typeTotal.count} / ${dbTransfer}`);

  // ---------- 4. 账户与余额 ----------
  console.log("\n[4] 账户列表与余额");
  const accounts = await listAccountsWithBalance(actor.id);
  const dbAccounts = await scalar(`SELECT COUNT(*) FROM bill_account WHERE "ownerId" = $1`, actor.id);
  check("账户数量", String(accounts.length) === dbAccounts, `${accounts.length} / ${dbAccounts}`);
  const withBalance = accounts.filter((a) => a.balance_cents != null);
  check("余额已算出", withBalance.length === accounts.length, `${withBalance.length}/${accounts.length} 个账户有余额`);
  const merged = accounts.filter((a) => a.mergedInto);
  console.log(`        （其中已归并 ${merged.length} 个，${accounts.length - merged.length} 个主账户）`);

  // 余额合计的基线值取自**源库（SQLite）同一公式**的结果，作为移植基线钉在这里。
  // 注意它不是「收入 − 支出」：转账里「只转出、没转出方对冲」的那部分会留在余额里，
  // 所以不能用 income-expense 当预期。任何一个 +8 小时偏移写错、或归并展开漏一层，
  // 这个数都会变，因此它是个有效的回归哨兵。
  const BASELINE_MAIN_BALANCE = -45471368;
  const sumBalance = accounts
    .filter((a) => !a.mergedInto)
    .reduce((s, a) => s + Number(a.balance_cents ?? 0), 0);
  check(
    "主账户余额合计（对齐源库基线）",
    sumBalance === BASELINE_MAIN_BALANCE,
    `实际 ${sumBalance} / 源库基线 ${BASELINE_MAIN_BALANCE}`,
  );

  // 单账户抽查：这几个值同样是源库公式的结果，逐分对齐才算移植正确
  const PINNED: Array<[number, number]> = [
    [1, 0],
    [195, -13923],
    [196, -100],
  ];
  const balanceById = new Map(accounts.map((a) => [a.id, Number(a.balance_cents ?? 0)]));
  const mismatched = PINNED.filter(([id, expect]) => balanceById.get(id) !== expect);
  check(
    "单账户余额抽查",
    mismatched.length === 0,
    mismatched.length
      ? mismatched.map(([id, e]) => `#${id} 期望 ${e} 实得 ${balanceById.get(id)}`).join("; ")
      : PINNED.map(([id, e]) => `#${id}=${e}`).join(" "),
  );

  // ---------- 5. AA 平摊 ----------
  console.log("\n[5] AA 平摊");
  const aaBooks = await prisma.billBook.findMany({ where: { aaEnabled: true }, select: { id: true, name: true } });
  if (aaBooks.length) {
    const book = aaBooks[0];
    const preset = (await bookParticipants(book.id)).map((p) => p.name);
    const rows = await prisma.$queryRawUnsafe<AaBillRow[]>(
      `SELECT type AS kind, "memberName" AS member_name, "amountCents" AS amount_cents, "shareWith" AS share_with
       FROM bill_transaction WHERE "bookId" = $1 AND type IN ('EXPENSE','INCOME')`,
      book.id,
    );
    const aa = computeAa(rows, preset);
    const people = await bookBillPeople(book.id);
    check(`账本「${book.name}」平摊`, aa.memberCount > 0, `${aa.memberCount} 人参与，总摊 ${aa.total} 元`);
    console.log(`        预设参与人 ${preset.length} 人 / 账单里出现过 ${people.length} 人 / 生成转账 ${aa.transfers.length} 笔`);
    // 配平校验：所有差额之和必须为 0（否则 AA 算错了）
    const diffSum = aa.members.reduce((s, m) => s + Math.round(Number(m.diff) * 100), 0);
    check("AA 差额配平", Math.abs(diffSum) <= aa.members.length, `差额合计 ${diffSum} 分（应≈0）`);
  } else {
    check("AA 账本", false, "没有开启 AA 的账本");
  }

  console.log("\n" + "=".repeat(74));
  console.log(`结果：${pass}/${pass + fail} 通过`);
  if (fail) console.log("⚠ 有未通过项，需要排查");
  else console.log("全部通过。");
  console.log("=".repeat(74));
}

main()
  .catch((e) => {
    console.error("冒烟验证失败：", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
