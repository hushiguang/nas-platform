"use server";

/**
 * 免登录分享页的写操作。
 *
 * 没有会话，授权凭证就是 URL 里的 token：每次调用都先按 token 找回「开着分享」
 * 的清单，再校验 shareWritable，最后只允许动这个清单里的待办 ——
 * 任何一步不满足都静默返回，不泄露清单是否存在。
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@nas/db";
import { createManualTodo, listByShareToken, setTodoStatus, updateTodo } from "@nas/todo";
import { saveImage } from "@/server/images";
import { optionalText, parseImages, text } from "@/server/todo-form";

/** 单张/合计体积门槛：与 next.config 的 serverActions.bodySizeLimit=30mb 对齐 */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 28 * 1024 * 1024;

export interface GuestWriteResult {
  ok: boolean;
  message?: string;
}

function tokenOf(form: FormData): string {
  return String(form.get("token") ?? "").trim();
}

/** 收集并校验访客上传的图片：最多 9 张、单张 12MB、合计 28MB */
function pickFiles(form: FormData): { files: File[] } | { message: string } {
  const files = form
    .getAll("files")
    .filter((file): file is File => file instanceof File && file.size > 0)
    .slice(0, 9);
  const tooBig = files.find((file) => file.size > MAX_IMAGE_BYTES);
  if (tooBig) {
    return {
      message: `「${tooBig.name}」太大了，单张图片不能超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB`,
    };
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return { message: "图片总大小超过 28MB，请少选几张或压缩后再试" };
  }
  return { files };
}

async function uploadFiles(files: File[]): Promise<string[]> {
  // 并行上传：图片要过图床，串行传 9 张能让按钮转很久
  return Promise.all(
    files.map(async (file) => {
      const buffer = Buffer.from(await file.arrayBuffer());
      return saveImage({ buffer, mimetype: file.type, filename: file.name });
    }),
  );
}

function failureMessage(err: unknown): string {
  const detail = err instanceof Error ? err.message : "未知错误";
  return `图片上传失败：${detail}`;
}

/** 勾选 / 取消勾选：共享购物清单的核心交互，可勾选模式下免登录也能用 */
export async function guestToggleTodoAction(form: FormData) {
  const token = tokenOf(form);
  const list = await listByShareToken(token);
  if (!list || !list.shareWritable) return;

  const id = Number(form.get("id"));
  if (!Number.isFinite(id)) return;
  const todo = await prisma.todo.findUnique({ where: { id }, select: { listId: true } });
  if (!todo || todo.listId !== list.id) return;

  const done = String(form.get("done")) === "1";
  await setTodoStatus(id, list.ownerId, done ? "DONE" : "PENDING");
  revalidatePath(`/share/${token}`);
}

/**
 * 免登录编辑条目：只放行标题、备注、图片三项 —— 清单归属、优先级、日期、
 * 提醒这些属于「主人的安排」，拿到链接的人不该动，弹窗里也不展示。
 * 更新是部分字段更新，没提交的字段原样保留。
 */
export async function guestUpdateTodoAction(form: FormData): Promise<GuestWriteResult> {
  const token = tokenOf(form);
  const list = await listByShareToken(token);
  if (!list || !list.shareWritable) {
    return { ok: false, message: "这个分享链接已经关闭，或者不允许修改条目" };
  }

  const id = Number(form.get("id"));
  if (!Number.isFinite(id)) return { ok: false, message: "这条待办不存在了" };
  const todo = await prisma.todo.findUnique({ where: { id }, select: { listId: true } });
  if (!todo || todo.listId !== list.id) return { ok: false, message: "这条待办不在这个清单里" };

  const title = text(form, "title").slice(0, 200);
  if (!title) return { ok: false, message: "请填写标题" };

  const picked = pickFiles(form);
  if ("message" in picked) return { ok: false, message: picked.message };

  let uploaded: string[] = [];
  if (picked.files.length > 0) {
    try {
      uploaded = await uploadFiles(picked.files);
    } catch (err) {
      return { ok: false, message: failureMessage(err) };
    }
  }

  await updateTodo(id, list.ownerId, {
    title,
    description: optionalText(form, "description"),
    images: [...parseImages(form), ...uploaded],
  });
  revalidatePath(`/share/${token}`);
  return { ok: true };
}

/**
 * 补条目：以清单所有者的身份落库，来源仍是手动待办（照常进入待办应用）。
 * 备注与图片跟应用内新建一致 —— 图片走 saveImage（图床优先），最多 9 张。
 *
 * 返回结果而不是抛异常：图片过大、图床挂了这类错误要原样显示给访客，
 * 抛出去只会变成 Next 的错误页，他连「为什么失败」都看不到。
 */
export async function guestAddTodoAction(form: FormData): Promise<GuestWriteResult> {
  const token = tokenOf(form);
  const list = await listByShareToken(token);
  if (!list || !list.shareWritable) {
    return { ok: false, message: "这个分享链接已经关闭，或者不允许添加条目" };
  }

  const title = String(form.get("title") ?? "").trim().slice(0, 200);
  if (!title) return { ok: false, message: "请填写标题" };
  const description = String(form.get("description") ?? "").trim().slice(0, 2000) || null;

  const picked = pickFiles(form);
  if ("message" in picked) return { ok: false, message: picked.message };

  let images: string[] = [];
  if (picked.files.length > 0) {
    try {
      images = await uploadFiles(picked.files);
    } catch (err) {
      return { ok: false, message: failureMessage(err) };
    }
  }

  await createManualTodo({
    title,
    description,
    listId: list.id,
    ownerId: list.ownerId,
    images,
  });
  revalidatePath(`/share/${token}`);
  return { ok: true };
}
