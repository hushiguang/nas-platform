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
    return [{ offsetDays, time: typeof time === "string" ? time : undefined }];
  });
}

/**
 * 提醒派发：按 remindRules（提前 N 天 + 时点）计算应触发的提醒并投递到通知网关。
 * 幂等键 todo:{id}:{offsetDays}:{触发日期} —— 同一条提醒同一天只投一次。
 */
export async function dispatchTodoReminders(now = new Date()): Promise<number> {
  const todos = await prisma.todo.findMany({
    where: {
      status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
      remindRules: { not: Prisma.DbNull },
      OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }],
    },
  });

  const today = zonedDate(now);
  const nowMinutes = zonedMinutes(now);
  let sent = 0;

  for (const todo of todos) {
    const due = todo.dueTime ?? (todo.triggerDate && todo.triggerDate.getTime() > 0 ? todo.triggerDate : null);
    if (!due) continue;

    for (const rule of normalizeRules(todo.remindRules)) {
      // 触发日期 = 到期日 - 提前天数
      const fireDate = zonedDate(addDays(due, -rule.offsetDays));
      // 已过触发日，或当天且已到提醒时点
      const passed = fireDate < today || (fireDate === today && nowMinutes >= (parseHm(rule.time) ?? 0));
      if (!passed) continue;

      const dedupeKey = `todo:${todo.id}:${rule.offsetDays}:${fireDate}`;
      const result = await sendNotify({
        userId: todo.ownerId,
        todoId: todo.id,
        title: `【待办提醒】${todo.title}`,
        content: [
          todo.description,
          `到期：${zonedDate(due)}${todo.dueTime ? ` ${zonedTime(todo.dueTime)}` : ""}`,
          rule.offsetDays === 0 ? "今天到期" : `提前 ${rule.offsetDays} 天提醒`,
        ]
          .filter(Boolean)
          .join("\n"),
        dedupeKey,
      });
      sent += result.queued;
    }
  }
  return sent;
}
