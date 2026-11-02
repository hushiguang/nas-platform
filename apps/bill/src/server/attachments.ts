import { prisma } from "@nas/db";
import {
  ATTACHMENT_SCOPE,
  attachmentResponse,
  getAttachmentRecord,
  listAttachmentRecords,
  MediaError,
  presentAttachment,
  readAttachmentFile,
  saveAttachmentFile,
} from "@nas/media";
import { bookByShareToken, type Actor } from "./book";
import { BillError } from "./errors";
import { getTransaction } from "./transaction";

function rethrow(err: unknown): never {
  if (err instanceof MediaError) throw new BillError(err.message, err.status);
  throw err;
}

export async function uploadBillFile(
  actor: Actor,
  file: { buffer?: Buffer | null; filename?: string; mimetype?: string } | undefined,
) {
  if (!file?.buffer?.length) throw new BillError("没有选到文件");
  try {
    const saved = await saveAttachmentFile({
      scope: ATTACHMENT_SCOPE.bill,
      refId: 0,
      userId: actor.id,
      buffer: Buffer.from(file.buffer),
      filename: file.filename || "附件",
      mimetype: file.mimetype,
    });
    return { attachment: presentAttachment(saved) };
  } catch (err) {
    rethrow(err);
  }
}

export async function openBillFile(actor: Actor, id: number, download: boolean) {
  const record = await getAttachmentRecord(id);
  if (!record || record.scope !== ATTACHMENT_SCOPE.bill) throw new BillError("附件不存在", 404);
  if (record.refId <= 0) {
    if (record.createdBy !== actor.id && actor.role !== "ADMIN") throw new BillError("附件不存在", 404);
  } else if (!(await getTransaction(actor, record.refId))) {
    throw new BillError("附件不存在", 404);
  }
  try {
    return attachmentResponse(record, await readAttachmentFile(record), download);
  } catch (err) {
    rethrow(err);
  }
}

export async function uploadShareBillFile(
  token: string,
  file: { buffer?: Buffer | null; filename?: string; mimetype?: string } | undefined,
) {
  const book = await bookByShareToken(token);
  if (!book) throw new BillError("链接已失效", 404);
  if (!book.shareWritable) throw new BillError("这个分享是只读的，不能上传", 403);
  if (!file?.buffer?.length) throw new BillError("没有选到文件");
  try {
    const saved = await saveAttachmentFile({
      scope: ATTACHMENT_SCOPE.bill,
      refId: 0,
      userId: book.ownerId,
      buffer: Buffer.from(file.buffer),
      filename: file.filename || "附件",
      mimetype: file.mimetype,
    });
    return { attachment: presentAttachment(saved) };
  } catch (err) {
    rethrow(err);
  }
}

export async function openShareBillFile(token: string, id: number, download: boolean) {
  const book = await bookByShareToken(token);
  if (!book) throw new BillError("链接已失效", 404);
  const record = await getAttachmentRecord(id);
  if (!record || record.scope !== ATTACHMENT_SCOPE.bill) throw new BillError("附件不存在", 404);
  if (record.refId <= 0) {
    if (record.createdBy !== book.ownerId) throw new BillError("附件不存在", 404);
  } else {
    const row = await prisma.billTransaction.findFirst({
      where: { id: record.refId, bookId: book.id },
      select: { id: true },
    });
    if (!row) throw new BillError("附件不存在", 404);
  }
  try {
    return attachmentResponse(record, await readAttachmentFile(record), download);
  } catch (err) {
    rethrow(err);
  }
}

export async function billAttachmentMap(ids: number[]) {
  const map = await listAttachmentRecords(ATTACHMENT_SCOPE.bill, ids);
  return new Map([...map].map(([id, rows]) => [id, rows.map(presentAttachment)]));
}
