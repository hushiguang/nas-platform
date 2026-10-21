import { prisma } from "@nas/db";
import { Prisma } from "@nas/db";
import { zonedDate, zonedTime, zonedMinutes, parseHm, addDays } from "@nas/core";
import { sendNotify, cancelTodoNotify } from "@nas/notify";
import type { CreateTodoInput, RemindRule } from "./types";

export * from "./types";
export * from "./lists";
export * from "./todo-ops";

/**
 * 待办引擎入口：各业务平台只负责产生事件，统一调这里收口。
 * source + sourceBizId + triggerDate 唯一，重复触发自动合并（幂等）。
 */
export async function createTodo(input: CreateTodoInput) {
  // PG 复合唯一键里 NULL 互不相等，无法去重；
  // 归一化为 "" 与 epoch，保证幂等键始终可比较。
  const data: Prisma.TodoCreateInput = {
    title: input.title,
    description: input.description,
    source: input.source ?? "MANUAL",
    sourceBizId: input.sourceBizId ?? "",
    priority: input.priority ?? "MEDIUM",
    dueTime: input.dueTime,
    remindRules: input.remindRules as Prisma.InputJsonValue | undefined,
    triggerDate: input.triggerDate ?? new Date(0),
    ...(input.listId ? { list: { connect: { id: input.listId } } } : {}),
    ...(input.images?.length ? { images: input.images as Prisma.InputJsonValue } : {}),
    owner: { connect: { id: input.ownerId } },
  };
  // upsert 实现幂等：重复触发不新增，返回已存在的待办
  return prisma.todo.upsert({
    where: {
      source_sourceBizId_triggerDate: {
        source: data.source!,
        sourceBizId: data.sourceBizId ?? "",
        triggerDate: input.triggerDate ?? new Date(0),
      },
    },
    update: {},
    create: data,
  });
}

/** 待办完成：撤销未发出的提醒，并留「完成回写来源业务状态」的钩子（P2 起各平台接入） */
export async function completeTodo(todoId: number, ownerId: number) {
  const updated = await prisma.todo.updateMany({
    where: { id: todoId, ownerId, status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] } },
    data: { status: "DONE", completedAt: new Date() },
  });
  if (updated.count > 0) await cancelTodoNotify(todoId);
  return updated;
}

/** 稍后提醒（snooze）：在 until 之前不再派发提醒 */
export async function snoozeTodo(todoId: number, ownerId: number, until: Date) {
  const updated = await prisma.todo.updateMany({
    where: { id: todoId, ownerId, status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] } },
    data: { snoozeUntil: until },
  });
  if (updated.count > 0) await cancelTodoNotify(todoId);
  return updated;
}

/** 逾期扫描：到期未完成的置为 OVERDUE（幂等，重复执行无副作用） */
export async function scanOverdueTodos(now = new Date()) {
  return prisma.todo.updateMany({
    where: {
      status: { in: ["PENDING", "IN_PROGRESS"] },
      dueTime: { lt: now },
    },
    data: { status: "OVERDUE" },
  });
}

function normalizeRules(rules: Prisma.JsonValue | null): RemindRule[] {
  if (!rules || !Array.isArray(rules)) return [];
  return rules.flatMap((r) => {
    if (typeof r !== "object" || r === null) return [];
    const offsetDays = Number((r as Record<string, unknown>).offsetDays);
    if (!Number.isFinite(offsetDays)) return [];
    const time = (r as Record<string, unknown>).time;
    const lastFired = (r as Record<string, unknown>).lastFired;
    return [
      {
        offsetDays,
        time: typeof time === "string" ? time : undefined,
        lastFired: typeof lastFired === "string" ? lastFired : undefined,
      },
    ];
  });
}

interface DueReminder {
  todoId: number;
  ownerId: number;
  title: string;
  description: string | null;
  due: Date;
  dueTime: Date | null;
  /** 这条待办的全部规则快照，写回 lastFired 时用 */
  rules: RemindRule[];
  /** 这一轮一并算作「已提醒」的规则：补扫时旧的提前提醒不再逐个补发 */
  firedRules: RemindRule[];
  rule: RemindRule;
  fireDate: string;
  key: string;
}

function dueText(item: DueReminder): string {
  return `到期：${zonedDate(item.due)}${item.dueTime ? ` ${zonedTime(item.dueTime)}` : ""}`;
}

function whenText(item: DueReminder): string {
  return item.rule.offsetDays === 0 ? "今天到期" : `提前 ${item.rule.offsetDays} 天提醒`;
}

/** 批量提醒的幂等键：把这一批的 key 压成短串，免得 dedupeKey 撞索引长度上限 */
function batchHash(keys: string[]): string {
  const text = [...keys].sort().join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${keys.length}-${hash.toString(36)}`;
}

/**
 * 提醒派发：按 remindRules（提前 N 天 + 时点）算出这一轮该提醒的待办，然后**按人合并**发出。
 *
 * - 一条待办同时过了好几条规则（比如补扫时 7 天 / 3 天 / 1 天 / 当天都到点了）只发一条，
 *   取最接近到期的那条；发过的规则写回 lastFired，之后不再重复补发。
 * - 同一个人这一轮到点的待办合成一条消息（`【待办提醒】N 条`），不再一条一个推送。
 *
 * 只发用户自己记的待办（source = MANUAL）。工作台 / 纪念日 / 账单自动收上来的
 * 待办本身就是每日汇总里的那些行（风险预报、待修问题、纪念日、待办清单），
 * 再按条单推一次等于同一件事发两遍，所以这里直接跳过。
 */
export async function dispatchTodoReminders(now = new Date()): Promise<number> {
  const todos = await prisma.todo.findMany({
    where: {
      source: "MANUAL",
      status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
      remindRules: { not: Prisma.DbNull },
      OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }],
    },
  });

  const today = zonedDate(now);
  const nowMinutes = zonedMinutes(now);
  const dueItems: DueReminder[] = [];

  for (const todo of todos) {
    const due = todo.dueTime ?? (todo.triggerDate && todo.triggerDate.getTime() > 0 ? todo.triggerDate : null);
    if (!due) continue;

    const rules = normalizeRules(todo.remindRules);
    let hit: { rule: RemindRule; fireDate: string } | null = null;
    const passedRules: RemindRule[] = [];
    for (const rule of rules) {
      // 触发日期 = 到期日 - 提前天数
      const fireDate = zonedDate(addDays(due, -rule.offsetDays));
      // 这条规则已经提醒过（哪怕是因为补扫迟发的），不再重复
      if (rule.lastFired && rule.lastFired >= fireDate) continue;
      // 已过触发日，或当天且已到提醒时点
      const passed = fireDate < today || (fireDate === today && nowMinutes >= (parseHm(rule.time) ?? 0));
      if (!passed) continue;
      passedRules.push(rule);
      if (!hit || rule.offsetDays < hit.rule.offsetDays) hit = { rule, fireDate };
    }
    if (!hit) continue;

    dueItems.push({
      todoId: todo.id,
      ownerId: todo.ownerId,
      title: todo.title,
      description: todo.description,
      due,
      dueTime: todo.dueTime,
      rules,
      firedRules: passedRules,
      rule: hit.rule,
      fireDate: hit.fireDate,
      key: `todo:${todo.id}:${hit.rule.offsetDays}:${hit.fireDate}`,
    });
  }

  const byUser = new Map<number, DueReminder[]>();
  for (const item of dueItems) {
    const list = byUser.get(item.ownerId) ?? [];
    list.push(item);
    byUser.set(item.ownerId, list);
  }

  let queued = 0;
  const fired: DueReminder[] = [];
  for (const [userId, items] of byUser) {
    const result =
      items.length === 1
        ? await sendNotify({
            userId,
            todoId: items[0].todoId,
            title: `【待办提醒】${items[0].title}`,
            content: [items[0].description, dueText(items[0]), whenText(items[0])].filter(Boolean).join("\n"),
            dedupeKey: items[0].key,
          })
        : await sendNotify({
            userId,
            title: `【待办提醒】${items.length} 条`,
            content: items
              .map((item) => `- ${item.title}（${whenText(item)}｜${dueText(item).replace("到期：", "")}）`)
              .join("\n"),
            dedupeKey: `todo-batch:${userId}:${batchHash(items.map((item) => item.key))}`,
          });
    queued += result.queued;
    // 入队成功才算提醒过：没配渠道 / 全部幂等冲突时留到下一轮再试
    if (result.queued > 0) fired.push(...items);
  }

  for (const item of fired) {
    // 标今天而不是规则自己的触发日：补扫时 7 天 / 3 天 / 1 天这些早就过点的规则
    // 一并算作已提醒，否则下一轮又会挑出下一条旧的挨个补发。
    const firedOffsets = new Set(item.firedRules.map((rule) => rule.offsetDays));
    const next = item.rules.map((rule) =>
      firedOffsets.has(rule.offsetDays)
        ? { offsetDays: rule.offsetDays, time: rule.time, lastFired: today }
        : rule,
    );
    await prisma.todo.update({
      where: { id: item.todoId },
      data: { remindRules: next as unknown as Prisma.InputJsonValue },
    });
  }

  return queued;
}

/**
 * 清掉还排在队列里的「自动待办」提醒（PENDING）。
 *
 * 停掉这类单条推送后，之前已经入队、还没发出去的那批会被 notify-retry
 * 一条条补发出去 —— 部署后仍会看到旧提醒冒出来。这里在派发任务里顺手清一次，
 * 只动自动来源（工作台 / 纪念日 / 账单等）的待办提醒，每日汇总没有 todoId，不受影响。
 */
export async function purgeAutoTodoReminders(): Promise<number> {
  const purged = await prisma.notifyLog.deleteMany({
    where: {
      status: "PENDING",
      todo: { is: { source: { not: "MANUAL" } } },
    },
  });
  return purged.count;
}
