"use server";

/**
 * 待办应用的全部写操作。页面是 Server Component，写完直接 revalidatePath
 * 刷数据；交互控件用原生 <form action={...}>，不额外引客户端状态库。
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@nas/db";
import { recordAudit } from "@nas/core";
import { flushNotifyLogs, sendNotify } from "@nas/notify";
import {
  addListMember,
  createList,
  createManualTodo,
  deleteList,
  deleteTodo,
  ensureDefaultLists,
  removeListMember,
  setListShare,
  setTodoStatus,
  snoozeTodo,
  updateList,
  updateTodo,
  type RemindRule,
} from "@nas/todo";
import { requireUser } from "@/auth";
import { MediaError } from "@nas/media";
import { saveImage } from "@/server/images";
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

/** 表单里的空串一律当"没填"，避免把 "" 写进时间/数字字段 */
function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optionalText(form: FormData, key: string): string | null {
  const value = text(form, key);
  return value || null;
}

/**
 * 到期时间：日期必填才解析，时间缺省 08:00。
 * 一律按本地时区（Asia/Shanghai）拼，再交给 Date 解析 —— 全项目时间口径一致。
 */
function parseDue(form: FormData): Date | null {
  const date = text(form, "dueDate");
  if (!date) return null;
  const time = text(form, "dueTime") || "08:00";
  const parsed = new Date(`${date}T${time}:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * 提醒规则：界面给的是「提前 N 天 + 时点」一组多选，这里拼成引擎认识的数组。
 * 一个都没勾 = 不提醒（remindRules 为空数组，引擎不会派发）。
 */
function parseRemindRules(form: FormData): RemindRule[] {
  const offsets = form.getAll("remindOffsets").map((v) => Number(v));
  const time = text(form, "remindTime") || "09:00";
  return offsets
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((offsetDays) => ({ offsetDays, time }));
}

/** 从表单里取已有图片地址（编辑时保留的） */
function parseImages(form: FormData): string[] {
  return form
    .getAll("images")
    .map((v) => String(v))
    .filter((v) => v.length > 0);
}

/** 上传表单里的图片文件，返回存好的地址列表 */
async function uploadFromForm(form: FormData): Promise<string[]> {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const urls: string[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    urls.push(await saveImage({ buffer, mimetype: file.type, filename: file.name }));
  }
  return urls;
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

/** 勾选 / 取消勾选。共享清单里谁都能勾，这是购物清单的核心交互 */
export async function toggleTodoAction(form: FormData) {
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
