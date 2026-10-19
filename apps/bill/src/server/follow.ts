/**
 * 账单后续跟进 → 待办。
 *
 * 两种情况都算有跟进：写了「后续跟进」，或者取消「计入账单费用」。
 * 取消计入时备注里补一句「后续有跟进事项」，方便在流水里直接看见。
 * 同一笔账单只保留一条待办（source + sourceBizId + triggerDate）。
 */
import { prisma } from "@nas/db";
import { centsToYuan } from "./money";

export const FOLLOW_MARK = "后续有跟进事项";

const TODO_EPOCH = new Date(0);

export function withFollowNote(note: string | null | undefined, countExpense: boolean): string | null {
  const text = String(note ?? "").trim();
  if (countExpense) return text || null;
  if (text.includes(FOLLOW_MARK)) return text;
  return text ? `${text}\n${FOLLOW_MARK}` : FOLLOW_MARK;
}

export function hasFollowUp(input: { followNote?: string | null; countExpense?: boolean }): boolean {
  return input.countExpense === false || Boolean(String(input.followNote ?? "").trim());
}

export interface FollowBill {
  id: number;
  ownerId: number;
  amountCents: number;
  payee?: string | null;
  note?: string | null;
  followNote?: string | null;
  categoryLabel?: string | null;
  countExpense: boolean;
}

/** 有跟进就写/更新待办；跟进清掉后，未完成的待办一起删掉 */
export async function syncBillFollowTodo(row: FollowBill): Promise<void> {
  const sourceBizId = `bill:${row.id}`;
  if (!hasFollowUp(row)) {
    await prisma.todo.deleteMany({
      where: { source: "BILL", sourceBizId, status: { not: "DONE" } },
    });
    return;
  }

  const who = String(row.payee || row.categoryLabel || "一笔账单").trim() || "一笔账单";
  const title = `跟进 · ${who}`.slice(0, 80);
  const description = [
    String(row.followNote ?? "").trim(),
    row.countExpense ? null : "这笔不计入账单费用",
    String(row.note ?? "").trim(),
    `金额 ¥${centsToYuan(row.amountCents)}`,
  ]
    .filter(Boolean)
    .join("\n");

  await prisma.todo.upsert({
    where: {
      source_sourceBizId_triggerDate: {
        source: "BILL",
        sourceBizId,
        triggerDate: TODO_EPOCH,
      },
    },
    create: {
      title,
      description,
      source: "BILL",
      sourceBizId,
      priority: "MEDIUM",
      triggerDate: TODO_EPOCH,
      owner: { connect: { id: row.ownerId } },
    },
    update: { title, description },
  });
}

export async function removeBillFollowTodo(id: number): Promise<void> {
  await prisma.todo.deleteMany({
    where: { source: "BILL", sourceBizId: `bill:${id}`, status: { not: "DONE" } },
  });
}

/** 把库里所有还在跟进的账单收成待办，并清掉已经不再跟进的未完成待办 */
export async function syncAllBillFollowTodos(): Promise<number> {
  const rows = await prisma.billTransaction.findMany({
    where: {
      OR: [{ countExpense: false }, { NOT: { followNote: null } }],
    },
    select: {
      id: true,
      ownerId: true,
      amountCents: true,
      payee: true,
      note: true,
      followNote: true,
      categoryLabel: true,
      countExpense: true,
    },
  });
  const active = rows.filter((row) => hasFollowUp(row));
  for (const row of active) await syncBillFollowTodo(row);

  const keep = active.map((row) => `bill:${row.id}`);
  await prisma.todo.deleteMany({
    where: {
      source: "BILL",
      status: { not: "DONE" },
      ...(keep.length > 0 ? { sourceBizId: { notIn: keep } } : {}),
    },
  });
  return active.length;
}
