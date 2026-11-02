import { prisma } from "@nas/db";
import {
  ATTACHMENT_SCOPE,
  attachmentResponse,
  discardAttachment,
  getAttachmentRecord,
  listAttachmentRecords,
  MediaError,
  presentAttachment,
  readAttachmentFile,
  saveAttachmentFile,
  type AttachmentRecord,
} from "@nas/media";
import { canAccessTodo, listByShareToken } from "@nas/todo";
import { getSessionUser } from "@/auth";

class TodoFileError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "TodoFileError";
    this.status = status;
  }
}

async function actor() {
  const user = await getSessionUser();
  if (!user) throw new TodoFileError("请先登录", 401);
  return user;
}

async function readable(id: number, userId: number, isAdmin: boolean): Promise<AttachmentRecord> {
  const record = await getAttachmentRecord(id);
  if (!record || record.scope !== ATTACHMENT_SCOPE.todo) throw new TodoFileError("附件不存在", 404);
  if (record.refId <= 0) {
    if (record.createdBy !== userId) throw new TodoFileError("附件不存在", 404);
    return record;
  }
  if (!(await canAccessTodo(record.refId, userId, isAdmin))) throw new TodoFileError("附件不存在", 404);
  return record;
}

export async function uploadTodoFile(form: FormData) {
  const user = await actor();
  const file = form.get("file");
  if (!(file instanceof File)) throw new TodoFileError("没有选到文件");
  const refId = Number(form.get("refId"));
  const bound = Number.isInteger(refId) && refId > 0 ? refId : 0;
  if (bound && !(await canAccessTodo(bound, user.id, user.role === "ADMIN"))) {
    throw new TodoFileError("这条待办不存在", 404);
  }
  const saved = await saveAttachmentFile({
    scope: ATTACHMENT_SCOPE.todo,
    refId: bound,
    userId: user.id,
    buffer: Buffer.from(await file.arrayBuffer()),
    filename: file.name,
    mimetype: file.type,
  });
  return { attachment: presentAttachment(saved) };
}

export async function openTodoFile(id: number, download: boolean) {
  const user = await actor();
  const record = await readable(id, user.id, user.role === "ADMIN");
  return attachmentResponse(record, await readAttachmentFile(record), download);
}

export async function deleteTodoFile(id: number) {
  const user = await actor();
  const record = await readable(id, user.id, user.role === "ADMIN");
  await discardAttachment(record);
  return { ok: true };
}

async function shareList(token: string) {
  const list = await listByShareToken(token);
  if (!list) throw new TodoFileError("链接已失效", 404);
  return list;
}

async function shareFile(token: string, id: number): Promise<{ record: AttachmentRecord; writable: boolean }> {
  const list = await shareList(token);
  const record = await getAttachmentRecord(id);
  if (!record || record.scope !== ATTACHMENT_SCOPE.todo) throw new TodoFileError("附件不存在", 404);
  if (record.refId <= 0) {
    if (record.createdBy !== list.ownerId) throw new TodoFileError("附件不存在", 404);
    return { record, writable: list.shareWritable };
  }
  const todo = await prisma.todo.findFirst({
    where: { id: record.refId, listId: list.id },
    select: { id: true },
  });
  if (!todo) throw new TodoFileError("附件不存在", 404);
  return { record, writable: list.shareWritable };
}

export async function uploadShareFile(token: string, form: FormData) {
  const list = await shareList(token);
  if (!list.shareWritable) throw new TodoFileError("这个分享是只读的", 403);
  const file = form.get("file");
  if (!(file instanceof File)) throw new TodoFileError("没有选到文件");
  const saved = await saveAttachmentFile({
    scope: ATTACHMENT_SCOPE.todo,
    refId: 0,
    userId: list.ownerId,
    buffer: Buffer.from(await file.arrayBuffer()),
    filename: file.name,
    mimetype: file.type,
  });
  return { attachment: presentAttachment(saved) };
}

export async function openShareFile(token: string, id: number, download: boolean) {
  const { record } = await shareFile(token, id);
  return attachmentResponse(record, await readAttachmentFile(record), download);
}

export async function deleteShareFile(token: string, id: number) {
  const { record, writable } = await shareFile(token, id);
  if (!writable) throw new TodoFileError("这个分享是只读的", 403);
  if (record.refId > 0) throw new TodoFileError("保存之后才能从清单里去掉", 400);
  await discardAttachment(record);
  return { ok: true };
}

export async function attachmentsByTodo(ids: number[]) {
  const map = await listAttachmentRecords(ATTACHMENT_SCOPE.todo, ids);
  return new Map([...map].map(([id, rows]) => [id, rows.map(presentAttachment)]));
}

export async function withTodoAttachments<T extends { id: number }>(todos: T[]) {
  const map = await attachmentsByTodo(todos.map((todo) => todo.id));
  return todos.map((todo) => ({ ...todo, attachments: map.get(todo.id) ?? [] }));
}

export function attachmentError(err: unknown, fallback: string) {
  if (err instanceof TodoFileError || err instanceof MediaError) {
    return { message: err.message, status: err.status };
  }
  console.error(err);
  return { message: fallback, status: 500 };
}
