import { getPlatformAccess } from "@nas/core";
import { prisma } from "@nas/db";
import {
  ATTACHMENT_SCOPE,
  attachmentResponse,
  discardAttachment,
  getAttachmentRecord,
  MediaError,
  presentAttachment,
  readAttachmentFile,
  saveAttachmentFile,
  type AttachmentRecord,
} from "@nas/media";
import { getSessionUser } from "@/auth";
import { canManage, visibleWhere } from "./access";
import { WorkError } from "./errors";

async function viewer() {
  const user = await getSessionUser();
  if (!user) throw new WorkError("请先登录", 401);
  const access = await getPlatformAccess(user, "work");
  if (!access) throw new WorkError("没有权限", 404);
  return { user, access };
}

async function visibleProject(userId: number, access: Awaited<ReturnType<typeof viewer>>["access"], projectId: number) {
  const row = await prisma.workProject.findFirst({
    where: { id: projectId, ...visibleWhere(access, userId) },
    select: { id: true, ownerId: true },
  });
  if (!row) throw new WorkError("找不到这个项目", 404);
  return row;
}

async function ownedFile(id: number): Promise<{ record: AttachmentRecord; canEdit: boolean }> {
  const { user, access } = await viewer();
  const record = await getAttachmentRecord(id);
  if (!record || record.scope !== ATTACHMENT_SCOPE.workProject) throw new WorkError("附件不存在", 404);
  if (record.refId <= 0) {
    if (record.createdBy !== user.id) throw new WorkError("附件不存在", 404);
    return { record, canEdit: true };
  }
  const project = await visibleProject(user.id, access, record.refId);
  return { record, canEdit: canManage(access, user.id, project.ownerId) };
}

export async function uploadProjectFile(form: FormData) {
  const { user, access } = await viewer();
  const projectId = Number(form.get("refId"));
  if (!Number.isInteger(projectId) || projectId <= 0) throw new WorkError("项目不对");
  const project = await visibleProject(user.id, access, projectId);
  if (!canManage(access, user.id, project.ownerId)) throw new WorkError("只有负责人能上传附件", 403);
  const file = form.get("file");
  if (!(file instanceof File)) throw new WorkError("没有选到文件");
  const saved = await saveAttachmentFile({
    scope: ATTACHMENT_SCOPE.workProject,
    refId: project.id,
    userId: user.id,
    buffer: Buffer.from(await file.arrayBuffer()),
    filename: file.name,
    mimetype: file.type,
  });
  return { attachment: presentAttachment(saved) };
}

export async function openProjectFile(id: number, download: boolean) {
  const { record } = await ownedFile(id);
  const body = await readAttachmentFile(record);
  return attachmentResponse(record, body, download);
}

export async function deleteProjectFile(id: number) {
  const { record, canEdit } = await ownedFile(id);
  if (!canEdit) throw new WorkError("只有负责人能删除附件", 403);
  await discardAttachment(record);
  return { ok: true };
}

export function attachmentError(err: unknown, fallback: string) {
  if (err instanceof WorkError || err instanceof MediaError) {
    return { message: err.message, status: err.status };
  }
  console.error(err);
  return { message: fallback, status: 500 };
}
