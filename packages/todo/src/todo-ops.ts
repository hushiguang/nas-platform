/**
 * 待办的读写：查询、修改、完成/重开、删除。
 *
 * 可见性口径（与账单的账本同思路）：
 *   - 未归类（listId = null）的待办只有本人看得见；
 *   - 挂在清单上的，以清单的可见性为准 —— owner 与成员都能看、都能勾；
 *   - 改/删同样按这条线判，不额外看待办的 ownerId（共享清单里谁都能改）。
 */
import { prisma } from "@nas/db";
import type { Prisma, Todo } from "@nas/db";
import { zonedDayRange } from "@nas/core";
import { cancelTodoNotify } from "@nas/notify";
import { accessibleListIds, todoVisibilityWhere } from "./lists";
import type { TodoQuery, TodoStats, UpdateTodoInput } from "./types";

/** 待办的对外形态：Prisma 行 + 归一化后的图片数组 */
export interface TodoView extends Todo {
  imageList: string[];
}

export function toView(row: Todo): TodoView {
  const raw = row.images;
  const imageList = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  return { ...row, imageList };
}

/**
 * 可见范围条件。所有查询都必须套上它，别处不要再自己拼。
 * 口径在 lists.todoVisibilityWhere 里，门户也调那一个。
 */
async function visibilityWhere(query: TodoQuery): Promise<Prisma.TodoWhereInput> {
  return todoVisibilityWhere(query.userId, query.isAdmin);
}

function scopeWhere(scope: TodoQuery["scope"]): Prisma.TodoWhereInput {
  switch (scope) {
    case "overdue":
      return { status: "OVERDUE" };
    case "done":
      return { status: "DONE" };
    case "all":
      return {};
    default:
      return { status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] } };
  }
}

/** 来源过滤。待办应用默认只看自己手动记的（source = MANUAL）；
 * 各平台收上来的（账单/纪念日/工作等）归门户「待办管理」页聚合展示。
 * 传 includeSources 可显式覆盖默认口径；excludeSources 保留兼容旧调用。 */
function sourceWhere(query: TodoQuery): Prisma.TodoWhereInput {
  if (query.includeSources?.length) return { source: { in: query.includeSources } };
  if (query.excludeSources?.length) return { source: { notIn: query.excludeSources } };
  return { source: "MANUAL" };
}

/** 单条待办能否被该用户看到/操作 */
export async function canAccessTodo(
  todoId: number,
  userId: number,
  isAdmin = false,
): Promise<boolean> {
  const todo = await prisma.todo.findUnique({ where: { id: todoId }, select: { listId: true, ownerId: true } });
  if (!todo) return false;
  if (isAdmin || todo.ownerId === userId) return true;
  if (todo.listId === null) return false;
  const ids = await accessibleListIds(userId);
  return ids.includes(todo.listId);
}

export async function listTodos(query: TodoQuery): Promise<TodoView[]> {
  const [visibility, scope] = [await visibilityWhere(query), scopeWhere(query.scope ?? "open")];
  const source = sourceWhere(query);
  const listFilter: Prisma.TodoWhereInput =
    query.listId === undefined
      ? {}
      : query.listId === null
        ? { listId: null }
        : { listId: query.listId };

  const search = String(query.search || "").trim();
  const rows = await prisma.todo.findMany({
    where: {
      ...visibility,
      ...scope,
      ...source,
      ...listFilter,
      ...(search
        ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }] }
        : {}),
    },
    // 未完成在前 → 逾期最前 → 到期时间近的在前
    orderBy: [{ status: "asc" }, { dueTime: "asc" }, { sort: "asc" }, { id: "desc" }],
    take: query.take ?? 300,
  });
  return rows.map(toView);
}

export async function getTodo(todoId: number): Promise<TodoView | null> {
  const row = await prisma.todo.findUnique({ where: { id: todoId } });
  return row ? toView(row) : null;
}

export async function todoStats(query: TodoQuery): Promise<TodoStats> {
  const visibility = await visibilityWhere(query);
  const source = sourceWhere(query);
  const { start, end } = zonedDayRange(new Date());
  const [open, overdue, today, done] = await Promise.all([
    prisma.todo.count({ where: { ...visibility, ...source, status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] } } }),
    // 逾期按到期日算（今天之前的都算，今天到点的不算），和列表分组口径一致；
    // 顺带不受 status 里残留的旧 OVERDUE 影响。
    prisma.todo.count({
      where: { ...visibility, ...source, status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] }, dueTime: { lt: start } },
    }),
    prisma.todo.count({
      where: { ...visibility, ...source, status: { in: ["PENDING", "IN_PROGRESS"] }, dueTime: { gte: start, lte: end } },
    }),
    prisma.todo.count({ where: { ...visibility, ...source, status: "DONE" } }),
  ]);
  return { open, overdue, today, done };
}

/** 改待办。到期时间或提醒规则变了就撤销已入队未发的提醒，让引擎按新规则重算 */
export async function updateTodo(
  todoId: number,
  userId: number,
  data: UpdateTodoInput,
  isAdmin = false,
): Promise<Todo> {
  if (!(await canAccessTodo(todoId, userId, isAdmin))) throw new Error("待办不存在或无权修改");

  const title = data.title === undefined ? undefined : String(data.title).trim();
  if (title !== undefined && !title) throw new Error("请填写待办标题");

  // 清单变更也要校验可见性：不能把待办塞进一个自己看不到的清单
  if (data.listId !== undefined && data.listId !== null) {
    const ids = await accessibleListIds(userId);
    if (!isAdmin && !ids.includes(data.listId)) throw new Error("目标清单不存在或无权访问");
  }

  const remindChanged = data.remindRules !== undefined || data.dueTime !== undefined;
  const previous = remindChanged
    ? await prisma.todo.findUnique({
        where: { id: todoId },
        select: { remindRules: true, dueTime: true, status: true },
      })
    : null;

  // 到期时间变了就顺手把逾期状态摆正：清空或改到未来 = 不再逾期，改到过去 = 直接标逾期。
  // 不这么做的话，清掉「哪天」之后状态还停在 OVERDUE，行上会一直挂着「逾期」，
  // 只能等下一次扫描（每天一次）才消失。
  let status = data.status;
  if (data.dueTime !== undefined && status === undefined && previous) {
    const current = previous.status;
    if (current === "PENDING" || current === "IN_PROGRESS" || current === "OVERDUE") {
      const past = data.dueTime !== null && data.dueTime.getTime() < Date.now();
      status = past ? "OVERDUE" : current === "OVERDUE" ? "PENDING" : current;
    }
  }

  // 界面只提交「提前 N 天 + 时点」，引擎写回的 lastFired 按 offsetDays 继承下来，
  // 否则改个标题就会把当天已发过的提醒再补一遍。到期日改了则不继承：新日期该重新提醒。
  let remindRules = data.remindRules;
  if (remindRules && remindRules.length > 0 && previous) {
    const dueChanged =
      data.dueTime !== undefined && (data.dueTime?.getTime() ?? 0) !== (previous.dueTime?.getTime() ?? 0);
    if (!dueChanged && Array.isArray(previous.remindRules)) {
      const firedAt = new Map<number, string>();
      for (const raw of previous.remindRules) {
        if (typeof raw !== "object" || raw === null) continue;
        const offset = Number((raw as Record<string, unknown>).offsetDays);
        const last = (raw as Record<string, unknown>).lastFired;
        if (Number.isFinite(offset) && typeof last === "string") firedAt.set(offset, last);
      }
      remindRules = remindRules.map((rule) => {
        const last = firedAt.get(rule.offsetDays);
        return last ? { ...rule, lastFired: last } : rule;
      });
    }
  }

  const row = await prisma.todo.update({
    where: { id: todoId },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(data.description !== undefined ? { description: data.description || null } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.dueTime !== undefined ? { dueTime: data.dueTime } : {}),
      ...(remindRules !== undefined
        ? { remindRules: (remindRules ?? undefined) as Prisma.InputJsonValue | undefined }
        : {}),
      ...(status !== undefined
        ? { status, completedAt: status === "DONE" ? new Date() : null }
        : {}),
      ...(data.listId !== undefined ? { listId: data.listId } : {}),
      ...(data.images !== undefined ? { images: data.images as Prisma.InputJsonValue } : {}),
      ...(data.sort !== undefined ? { sort: data.sort } : {}),
      ...(data.snoozeUntil !== undefined ? { snoozeUntil: data.snoozeUntil } : {}),
    },
  });
  if (remindChanged) await cancelTodoNotify(todoId);
  return row;
}

/**
 * 勾选/取消勾选。共享清单里任何人都能勾 —— 这正是购物清单的用法，
 * 所以不走 ownerId 校验，只看清单可见性。
 */
export async function setTodoStatus(
  todoId: number,
  userId: number,
  status: "PENDING" | "DONE" | "IN_PROGRESS" | "CANCELLED",
  isAdmin = false,
): Promise<Todo> {
  if (!(await canAccessTodo(todoId, userId, isAdmin))) throw new Error("待办不存在或无权操作");
  const row = await prisma.todo.update({
    where: { id: todoId },
    data: { status, completedAt: status === "DONE" ? new Date() : null },
  });
  // 完成/取消后未发出的提醒就没意义了，撤掉
  if (status === "DONE" || status === "CANCELLED") await cancelTodoNotify(todoId);
  return row;
}

export async function deleteTodo(todoId: number, userId: number, isAdmin = false): Promise<void> {
  if (!(await canAccessTodo(todoId, userId, isAdmin))) throw new Error("待办不存在或无权删除");
  await cancelTodoNotify(todoId);
  await prisma.todo.delete({ where: { id: todoId } });
}

/**
 * 手动新建待办。
 *
 * 为什么不复用 createTodo 的幂等 upsert：那条路是给「事件触发的待办」准备的，
 * 靠 (source, sourceBizId, triggerDate) 唯一键做去重。手动待办没有业务来源，
 * 所有行的这三个字段会算出同一个键 —— 第二条起就被当成重复而静默忽略，
 * 结果是「只能存在一条手动待办」。所以这里直接 create，不走幂等路径。
 */
export async function createManualTodo(input: {
  title: string;
  description?: string | null;
  priority?: Todo["priority"];
  dueTime?: Date | null;
  remindRules?: UpdateTodoInput["remindRules"];
  listId?: number | null;
  images?: string[];
  ownerId: number;
}): Promise<Todo> {
  const title = String(input.title || "").trim();
  if (!title) throw new Error("请填写待办标题");
  return prisma.todo.create({
    data: {
      title,
      description: input.description || null,
      source: "MANUAL",
      priority: input.priority ?? "MEDIUM",
      dueTime: input.dueTime ?? null,
      remindRules: (input.remindRules ?? undefined) as Prisma.InputJsonValue | undefined,
      listId: input.listId ?? null,
      images: input.images?.length ? (input.images as Prisma.InputJsonValue) : undefined,
      ownerId: input.ownerId,
    },
  });
}

/** 今日到期（含逾期）—— 给「今天」视图用 */
export async function todayTodos(query: TodoQuery): Promise<TodoView[]> {
  const visibility = await visibilityWhere(query);
  const source = sourceWhere(query);
  const { end } = zonedDayRange(new Date());
  const rows = await prisma.todo.findMany({
    where: {
      ...visibility,
      ...source,
      status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
      dueTime: { not: null, lte: end },
    },
    orderBy: [{ status: "asc" }, { dueTime: "asc" }],
    take: 200,
  });
  return rows.map(toView);
}
