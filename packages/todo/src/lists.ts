/**
 * 清单（归类容器）—— 日常待办、购物清单这类分组。
 *
 * 权限模型与账单的「账本」一致：
 *   - 清单归 owner 所有；
 *   - kind = SHARED 时挂成员，成员之间共享同一批待办（谁买了谁勾掉）；
 *   - 成员可以在清单里增删改待办，但**只有 owner 能改清单本身或删清单**。
 *
 * 可见性收敛在这里，别处不要再自己拼 where 条件。
 */
import { prisma } from "@nas/db";
import type { Prisma, TodoList, TodoListKind, TodoListRole } from "@nas/db";

/** 默认清单：新用户第一次进来时自动建好，省得面对一个空壳 */
export const DEFAULT_LISTS: Array<{ name: string; icon: string; kind: TodoListKind }> = [
  { name: "日常待办", icon: "📝", kind: "PERSONAL" },
  { name: "购物清单", icon: "🛒", kind: "SHARED" },
];

export interface ListWithCount extends TodoList {
  /** 未完成待办数（列表页左侧角标） */
  openCount: number;
  /** 当前用户在这个清单里的身份 */
  role: TodoListRole;
  memberCount: number;
}

/** 某用户能看到的全部清单 id */
export async function accessibleListIds(userId: number): Promise<number[]> {
  const [owned, joined] = await Promise.all([
    prisma.todoList.findMany({ where: { ownerId: userId }, select: { id: true } }),
    prisma.todoListMember.findMany({ where: { userId }, select: { listId: true } }),
  ]);
  return [...new Set([...owned.map((r) => r.id), ...joined.map((r) => r.listId)])];
}

/**
 * 待办的可见范围条件 —— **全项目口径收敛在这一处**，谁都不要再自己拼 where。
 *
 *   - 未归类（listId = null）的待办只有本人看得见；
 *   - 挂在清单上的，以清单的可见性为准：owner 与成员都能看（共享清单的意义就在这）；
 *   - 管理员看全部。
 *
 * 门户的「待办管理」和待办应用必须用同一个条件，否则会出现
 * 「待办应用里看得见、门户汇总里没有」——那是最容易踩的坑（曾经就是这样）。
 */
export async function todoVisibilityWhere(
  userId: number,
  isAdmin = false,
): Promise<Prisma.TodoWhereInput> {
  if (isAdmin) return {};
  const ids = await accessibleListIds(userId);
  return {
    OR: [{ listId: null, ownerId: userId }, { listId: { in: ids } }],
  };
}

/**
 * 当前用户在指定清单里的身份。
 * 返回 null 表示看不到这个清单（既不是 owner 也不是成员）。
 */
export async function roleInList(
  userId: number,
  listId: number,
  isAdmin = false,
): Promise<TodoListRole | null> {
  const list = await prisma.todoList.findUnique({
    where: { id: listId },
    select: { ownerId: true, members: { where: { userId }, select: { role: true } } },
  });
  if (!list) return null;
  if (list.ownerId === userId) return "OWNER";
  // 管理员能看全部，但账单那边同样的口径是「按成员对待」，避免误删他人清单
  const member = list.members[0];
  if (member) return member.role;
  return isAdmin ? "MEMBER" : null;
}

/**
 * 清单列表 + 未完成计数。
 * 计数用一次 groupBy 拿全，别在循环里逐条 count（N+1）。
 */
export async function listVisibleLists(
  userId: number,
  opts: { includeArchived?: boolean; isAdmin?: boolean } = {},
): Promise<ListWithCount[]> {
  const ids = await accessibleListIds(userId);
  const where = {
    ...(opts.includeArchived ? {} : { archived: false }),
    ...(opts.isAdmin ? {} : { id: { in: ids } }),
  };
  const lists = await prisma.todoList.findMany({
    where,
    orderBy: [{ archived: "asc" }, { sort: "asc" }, { id: "asc" }],
    include: { members: { select: { userId: true, role: true } } },
  });
  if (lists.length === 0) return [];

  const counts = await prisma.todo.groupBy({
    by: ["listId"],
    where: {
      listId: { in: lists.map((l) => l.id) },
      source: "MANUAL",
      status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
    },
    _count: { _all: true },
  });
  const countByList = new Map(counts.map((c) => [c.listId, c._count._all]));

  return lists.map((list) => {
    const member = list.members.find((m) => m.userId === userId);
    const { members, ...rest } = list;
    return {
      ...rest,
      openCount: countByList.get(list.id) ?? 0,
      role: list.ownerId === userId ? "OWNER" : (member?.role ?? "MEMBER"),
      memberCount: members.length,
    };
  });
}

export interface CreateListInput {
  name: string;
  icon?: string | null;
  color?: string | null;
  kind?: TodoListKind;
  ownerId: number;
}

export async function createList(input: CreateListInput): Promise<TodoList> {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("请填写清单名称");
  // 排在最后
  const last = await prisma.todoList.findFirst({
    where: { ownerId: input.ownerId },
    orderBy: { sort: "desc" },
    select: { sort: true },
  });
  return prisma.todoList.create({
    data: {
      name,
      icon: input.icon || null,
      color: input.color || null,
      kind: input.kind ?? "PERSONAL",
      ownerId: input.ownerId,
      sort: (last?.sort ?? 0) + 10,
    },
  });
}

export interface UpdateListInput {
  name?: string;
  icon?: string | null;
  color?: string | null;
  kind?: TodoListKind;
  archived?: boolean;
  sort?: number;
}

/** 改清单本身：只有 owner 能改 */
export async function updateList(
  listId: number,
  actorId: number,
  data: UpdateListInput,
  isAdmin = false,
): Promise<TodoList> {
  const list = await prisma.todoList.findUnique({ where: { id: listId }, select: { ownerId: true } });
  if (!list) throw new Error("清单不存在");
  if (list.ownerId !== actorId && !isAdmin) throw new Error("只有创建者能修改这个清单");

  const name = data.name === undefined ? undefined : String(data.name).trim();
  if (name !== undefined && !name) throw new Error("请填写清单名称");
  return prisma.todoList.update({
    where: { id: listId },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(data.icon !== undefined ? { icon: data.icon || null } : {}),
      ...(data.color !== undefined ? { color: data.color || null } : {}),
      ...(data.kind !== undefined ? { kind: data.kind } : {}),
      ...(data.archived !== undefined ? { archived: data.archived } : {}),
      ...(data.sort !== undefined ? { sort: data.sort } : {}),
    },
  });
}

/**
 * 删清单。清单里的待办**不删**，只把 listId 置空退回收件箱
 * （外键已是 onDelete: SetNull，但这里显式写一次，不依赖数据库行为）。
 */
export async function deleteList(listId: number, actorId: number, isAdmin = false) {
  const list = await prisma.todoList.findUnique({ where: { id: listId }, select: { ownerId: true } });
  if (!list) throw new Error("清单不存在");
  if (list.ownerId !== actorId && !isAdmin) throw new Error("只有创建者能删除这个清单");
  return prisma.$transaction(async (tx) => {
    await tx.todo.updateMany({ where: { listId }, data: { listId: null } });
    await tx.todoListMember.deleteMany({ where: { listId } });
    return tx.todoList.delete({ where: { id: listId } });
  });
}

export interface ListMemberView {
  userId: number;
  nickname: string;
  username: string;
  role: TodoListRole;
}

export async function listMembers(listId: number): Promise<ListMemberView[]> {
  const list = await prisma.todoList.findUnique({
    where: { id: listId },
    select: {
      ownerId: true,
      owner: { select: { nickname: true, username: true } },
      members: {
        orderBy: { id: "asc" },
        select: { userId: true, role: true, user: { select: { nickname: true, username: true } } },
      },
    },
  });
  if (!list) return [];
  return [
    {
      userId: list.ownerId,
      nickname: list.owner.nickname,
      username: list.owner.username,
      role: "OWNER" as TodoListRole,
    },
    ...list.members
      .filter((m) => m.userId !== list.ownerId)
      .map((m) => ({
        userId: m.userId,
        nickname: m.user.nickname,
        username: m.user.username,
        role: m.role,
      })),
  ];
}

/** 加成员（只有 owner 能加）。重复添加幂等 */
export async function addListMember(
  listId: number,
  actorId: number,
  userId: number,
  isAdmin = false,
): Promise<void> {
  const list = await prisma.todoList.findUnique({ where: { id: listId }, select: { ownerId: true } });
  if (!list) throw new Error("清单不存在");
  if (list.ownerId !== actorId && !isAdmin) throw new Error("只有创建者能添加成员");
  if (list.ownerId === userId) return; // owner 不需要挂成员行
  await prisma.todoListMember.upsert({
    where: { listId_userId: { listId, userId } },
    update: {},
    create: { listId, userId, role: "MEMBER" },
  });
}

export async function removeListMember(
  listId: number,
  actorId: number,
  userId: number,
  isAdmin = false,
): Promise<void> {
  const list = await prisma.todoList.findUnique({ where: { id: listId }, select: { ownerId: true } });
  if (!list) throw new Error("清单不存在");
  // 自己退出，或 owner/管理员把人移出
  if (list.ownerId !== actorId && actorId !== userId && !isAdmin) {
    throw new Error("只有创建者能移除成员");
  }
  if (list.ownerId === userId) throw new Error("创建者不能移出自己");
  await prisma.todoListMember.deleteMany({ where: { listId, userId } });
}

/**
 * 新用户初始化：没有任何可见清单时建好默认清单。
 * 幂等 —— 已有清单时什么都不做。
 */
export async function ensureDefaultLists(userId: number): Promise<void> {
  const existing = await prisma.todoList.count({ where: { ownerId: userId } });
  if (existing > 0) return;
  for (const item of DEFAULT_LISTS) {
    await createList({ name: item.name, icon: item.icon, kind: item.kind, ownerId: userId });
  }
}
