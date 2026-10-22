"use server";

/**
 * 待办应用的全部写操作。页面是 Server Component，写完直接 revalidatePath
 * 刷数据；交互控件用原生 <form action={...}>，不额外引客户端状态库。
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@nas/db";
import { recordAudit, zonedDate, zonedTime } from "@nas/core";
import { flushNotifyLogs, sendNotify } from "@nas/notify";
import {
  addListMember,
  createList,
  createManualTodo,
  deleteList,
  deleteTodo,
  ensureDefaultLists,
  getTodo,
  removeListMember,
  setListShare,
  setTodoStatus,
  snoozeTodo,
  updateList,
  updateTodo,
} from "@nas/todo";
import { requireUser } from "@/auth";
import {
  optionalText,
  parseDue,
  parseImages,
  parseRemindRules,
  text,
  uploadFromForm,
} from "@/server/todo-form";
import { signOut } from "@/auth";

export async function logout() {
  await signOut({ redirectTo: "/login" });
}

/** 页面刷新统一走这里：列表、侧栏计数、统计卡片都在这些路径上 */
function refresh() {
  revalidatePath("/");
  revalidatePath("/today");
  revalidatePath("/done");
  revalidatePath("/lists");
  revalidatePath("/settings");
}

// ================================================================ 待办

export async function createTodoAction(form: FormData) {
  const user = await requireUser();
  await ensureDefaultLists(user.id);

  const listIdRaw = text(form, "listId");
  const images = [...parseImages(form), ...(await uploadFromForm(form))];

  const row = await createManualTodo({
    title: text(form, "title"),
    description: optionalText(form, "description"),
    priority: (text(form, "priority") || "MEDIUM") as "HIGH" | "MEDIUM" | "LOW",
    dueTime: parseDue(form),
    remindRules: parseRemindRules(form),
    listId: listIdRaw ? Number(listIdRaw) : null,
    images,
    ownerId: user.id,
  });

  await recordAudit({
    app: "todo",
    action: "create",
    target: "todo",
    targetId: row.id,
    summary: `新建待办「${row.title}」`,
    actorId: user.id,
    actorName: user.nickname,
  });
  refresh();
}

export async function updateTodoAction(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  if (!Number.isFinite(id)) return;

  const listIdRaw = text(form, "listId");
  const images = [...parseImages(form), ...(await uploadFromForm(form))];

  await updateTodo(
    id,
    user.id,
    {
      title: text(form, "title"),
      description: optionalText(form, "description"),
      priority: (text(form, "priority") || "MEDIUM") as "HIGH" | "MEDIUM" | "LOW",
      dueTime: parseDue(form),
      remindRules: parseRemindRules(form),
      listId: listIdRaw ? Number(listIdRaw) : null,
      images,
    },
    user.role === "ADMIN",
  );
  refresh();
}

/** 勾选 / 取消勾选。共享清单里谁都能勾，这是购物清单的核心交互 */export async function toggleTodoAction(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const done = String(form.get("done")) === "1";
  if (!Number.isFinite(id)) return;

  await setTodoStatus(id, user.id, done ? "DONE" : "PENDING", user.role === "ADMIN");
  refresh();
}

export async function deleteTodoAction(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  if (!Number.isFinite(id)) return;
  await deleteTodo(id, user.id, user.role === "ADMIN");
  refresh();
}

/** 稍后提醒：给几个常用档位，避免做成一个难用的时间选择器 */
export async function snoozeTodoAction(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const preset = text(form, "preset");
  if (!Number.isFinite(id)) return;

  const until = new Date();
  if (preset === "1h") until.setHours(until.getHours() + 1);
  else if (preset === "3h") until.setHours(until.getHours() + 3);
  else if (preset === "tomorrow") {
    until.setDate(until.getDate() + 1);
    until.setHours(9, 0, 0, 0);
    // 按钮承诺的是「截止日期延到明天」：只挪提醒时点的话，到期日还停在昨天，
    // 列表里会继续挂着「逾期」。只对已经过去的到期日生效，未来的日期不动。
    const current = await getTodo(id);
    if (current?.dueTime && current.dueTime.getTime() < Date.now()) {
      const time = zonedTime(current.dueTime);
      const next = new Date(`${zonedDate(until)}T${time}:00+08:00`);
      try {
        await updateTodo(id, user.id, { dueTime: next }, user.role === "ADMIN");
      } catch {
        // 共享清单里别人记的条目可能挪不动到期日，提醒照旧
      }
    }
  } else if (preset === "week") until.setDate(until.getDate() + 7);
  else return;

  await snoozeTodo(id, user.id, until);
  refresh();
}

// ================================================================ 清单

export async function createListAction(form: FormData) {
  const user = await requireUser();
  await createList({
    name: text(form, "name"),
    icon: optionalText(form, "icon"),
    kind: text(form, "kind") === "SHARED" ? "SHARED" : "PERSONAL",
    ownerId: user.id,
  });
  refresh();
}

export async function updateListAction(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  if (!Number.isFinite(id)) return;
  await updateList(
    id,
    user.id,
    {
      name: text(form, "name"),
      icon: optionalText(form, "icon"),
      kind: text(form, "kind") === "SHARED" ? "SHARED" : "PERSONAL",
    },
    user.role === "ADMIN",
  );
  refresh();
}

export async function deleteListAction(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  if (!Number.isFinite(id)) return;
  await deleteList(id, user.id, user.role === "ADMIN");
  refresh();
}

/**
 * 清单分享开关。关掉只是让链接失效，token 留着 ——
 * 和账本分享一致：关了再开不会让已经发出去的旧链接复活。
 */
export async function setListShareAction(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  if (!Number.isFinite(id)) return;
  const writableRaw = text(form, "writable");
  await setListShare(
    id,
    user.id,
    {
      enabled: text(form, "enabled") === "1",
      ...(writableRaw ? { writable: writableRaw === "1" } : {}),
    },
    user.role === "ADMIN",
  );
  refresh();
}

/**
 * 清单编辑弹窗的一次性保存：基本字段 + 成员一起落。
 * 成员用差集同步 —— 勾上的加，没勾的移出（创建者自己不动）。
 */
export async function saveListAction(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  if (!Number.isFinite(id)) return;
  const kind = text(form, "kind") === "SHARED" ? "SHARED" : "PERSONAL";
  await updateList(
    id,
    user.id,
    { name: text(form, "name"), icon: optionalText(form, "icon"), kind },
    user.role === "ADMIN",
  );
  const want = new Set(
    form.getAll("memberIds").map((v) => Number(v)).filter((n) => Number.isFinite(n)),
  );
  const current = await prisma.todoListMember.findMany({
    where: { listId: id },
    select: { userId: true },
  });
  const list = await prisma.todoList.findUnique({ where: { id }, select: { ownerId: true } });
  for (const m of current) {
    if (m.userId !== list?.ownerId && !want.has(m.userId)) {
      await removeListMember(id, user.id, m.userId, user.role === "ADMIN");
    }
  }
  if (kind === "SHARED") {
    for (const uid of want) {
      if (uid !== list?.ownerId) {
        await addListMember(id, user.id, uid, user.role === "ADMIN");
      }
    }
  } else {
    // 切回「仅自己」顺手清空成员，语义干净
    for (const m of current) {
      if (m.userId !== list?.ownerId) {
        await removeListMember(id, user.id, m.userId, user.role === "ADMIN");
      }
    }
  }
  refresh();
}

export async function addMemberAction(form: FormData) {  const user = await requireUser();
  const listId = Number(form.get("listId"));
  const userId = Number(form.get("userId"));
  if (!Number.isFinite(listId) || !Number.isFinite(userId)) return;
  await addListMember(listId, user.id, userId, user.role === "ADMIN");
  refresh();
}

export async function removeMemberAction(form: FormData) {
  const user = await requireUser();
  const listId = Number(form.get("listId"));
  const userId = Number(form.get("userId"));
  if (!Number.isFinite(listId) || !Number.isFinite(userId)) return;
  await removeListMember(listId, user.id, userId, user.role === "ADMIN");
  refresh();
}

// ================================================================ 通知渠道

/**
 * 保存通知渠道。邮件是默认渠道，收件地址留空则回落到 user.email。
 * 只在启用时写一行；关掉就直接删掉这行（enabled=false 的行没意义，
 * 网关只挑 enabled 的）。
 */
export async function saveMailChannelAction(form: FormData) {
  const user = await requireUser();
  const enabled = text(form, "enabled") === "1";
  const to = text(form, "to");

  if (!enabled) {
    await prisma.notifyChannel.deleteMany({ where: { userId: user.id, type: "MAIL" } });
    refresh();
    return;
  }
  await prisma.notifyChannel.upsert({
    where: { userId_type: { userId: user.id, type: "MAIL" } },
    update: { enabled: true, config: { to } },
    create: { userId: user.id, type: "MAIL", enabled: true, config: { to } },
  });
  refresh();
}

/** 测试发送：立刻入队并尝试投递，把真实错误（SMTP 未配/账号密码错）带回去给用户看 */
export async function testMailAction(): Promise<void> {
  const user = await requireUser();
  const channel = await prisma.notifyChannel.findFirst({
    where: { userId: user.id, type: "MAIL", enabled: true },
  });
  if (!channel) throw new Error("还没启用邮件渠道");

  const result = await sendNotify({
    userId: user.id,
    title: "【待办】测试提醒",
    content: "收到这条说明邮件提醒已经通了。",
    // 每次点都能真发一条，所以不带幂等键
  });
  await flushNotifyLogs(20, user.id);
  if (result.queued === 0) throw new Error("没有可用的渠道，检查是否已启用");
  refresh();
}
