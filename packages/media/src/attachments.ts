/**
 * 项目、待办、账单共用的附件。
 *
 * 图片继续走图床；这里收的是合同、表格、PDF 这类文件，连同原始文件名一起留下。
 * 文件落在 ATTACHMENT_DIR（容器里挂到 NAS），库里只存文件名和随机存储键。
 * 展示一律经过各应用自己的下载接口：先核对这条记录当前用户能不能看，再把文件吐出去。
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@nas/db";
import { MediaError } from "./errors";

export const ATTACHMENT_SCOPE = {
  workProject: "work_project",
  todo: "todo",
  bill: "bill_tx",
} as const;

export const ATTACHMENT_MAX_BYTES = Number(process.env.ATTACHMENT_MAX_BYTES || 32 * 1024 * 1024);
export const ATTACHMENT_MAX_COUNT = 20;

const BLOCKED_EXT = new Set([
  "exe", "dll", "bat", "cmd", "com", "msi", "scr", "ps1", "vbs",
  "js", "mjs", "cjs", "html", "htm", "svg", "xhtml", "hta", "sh",
]);

/** 浏览器里可以直接打开的类型。其余一律当下载，避免把网页/脚本内嵌进页面。 */
const INLINE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/csv",
]);

export interface AttachmentRecord {
  id: number;
  scope: string;
  refId: number;
  filename: string;
  mime: string;
  size: number;
  storageKey: string;
  createdBy: number;
}

export interface AttachmentPublic {
  id: number;
  filename: string;
  mime: string;
  size: number;
}

export function presentAttachment(row: Pick<AttachmentRecord, "id" | "filename" | "mime" | "size">): AttachmentPublic {
  return { id: row.id, filename: row.filename, mime: row.mime, size: row.size };
}

function attachmentRoot(): string {
  const fromEnv = process.env.ATTACHMENT_DIR?.trim();
  if (fromEnv) return fromEnv;
  // next dev 的工作目录是应用目录；Docker / 脚本的工作目录是仓库根
  const atRoot = path.resolve(process.cwd(), "data/uploads/files");
  const atApp = path.resolve(process.cwd(), "../../data/uploads/files");
  return process.cwd().includes(`${path.sep}apps${path.sep}`) ? atApp : atRoot;
}

function assertScope(scope: string): string {
  if (!/^[a-z0-9_]{1,32}$/.test(scope)) throw new MediaError("附件分类不对");
  return scope;
}

export function cleanFilename(filename: string): string {
  const base = path.basename(String(filename || "").replace(/[\u0000-\u001f]/g, "")).trim();
  return base.slice(0, 180) || "未命名附件";
}

function cleanMime(mimetype: string): string {
  const mime = String(mimetype || "").toLowerCase().split(";")[0].trim();
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) return "application/octet-stream";
  if (mime === "text/html" || mime === "image/svg+xml" || mime === "application/xhtml+xml") {
    return "application/octet-stream";
  }
  return mime;
}

function safeExt(filename: string): string {
  const base = path.basename(filename);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  const ext = base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!ext || ext.length > 8) return "";
  if (BLOCKED_EXT.has(ext)) throw new MediaError("不支持这个文件类型");
  return `.${ext}`;
}

function resolveKey(storageKey: string): string {
  if (!/^[a-z0-9_]+\/[a-z0-9][a-z0-9._-]{0,80}$/.test(storageKey)) {
    throw new MediaError("附件不存在", 404);
  }
  const root = path.resolve(attachmentRoot());
  const full = path.resolve(root, storageKey);
  if (full !== root && !full.startsWith(root + path.sep)) throw new MediaError("附件不存在", 404);
  return full;
}

function toRecord(row: {
  id: number;
  scope: string;
  refId: number;
  filename: string;
  mime: string;
  size: number;
  storageKey: string;
  createdBy: number;
}): AttachmentRecord {
  return {
    id: row.id,
    scope: row.scope,
    refId: row.refId,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    storageKey: row.storageKey,
    createdBy: row.createdBy,
  };
}

/** 表单里的附件 id。可以是数字、数字字符串，或 `{ id }`。 */
export function parseAttachmentIds(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [];
  const ids: number[] = [];
  for (const item of list) {
    const raw = typeof item === "object" && item && "id" in item ? (item as { id: unknown }).id : item;
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, ATTACHMENT_MAX_COUNT);
}

async function sweepUnbound(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await prisma.fileAttachment.findMany({
    where: { refId: 0, createdAt: { lt: cutoff } },
    take: 40,
  });
  for (const row of rows) {
    await discardRow(toRecord(row));
  }
}

export async function saveAttachmentFile(input: {
  scope: string;
  refId?: number;
  userId: number;
  buffer: Buffer;
  filename: string;
  mimetype?: string;
}): Promise<AttachmentRecord> {
  const scope = assertScope(input.scope);
  const buffer = input.buffer;
  if (!buffer?.length) throw new MediaError("没有选到文件");
  if (buffer.length > ATTACHMENT_MAX_BYTES) {
    throw new MediaError(`文件太大了（最多 ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB）`);
  }
  const filename = cleanFilename(input.filename);
  const ext = safeExt(filename);
  const refId = Number.isInteger(input.refId) && (input.refId ?? 0) > 0 ? (input.refId as number) : 0;

  const existing = await prisma.fileAttachment.count({
    where: refId > 0 ? { scope, refId } : { scope, refId: 0, createdBy: input.userId },
  });
  if (existing >= ATTACHMENT_MAX_COUNT) throw new MediaError(`最多 ${ATTACHMENT_MAX_COUNT} 个附件`);

  const storageKey = `${scope}/${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}${ext}`;
  const full = resolveKey(storageKey);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);

  try {
    const row = await prisma.fileAttachment.create({
      data: {
        scope,
        refId,
        filename,
        mime: cleanMime(input.mimetype || ""),
        size: buffer.length,
        storageKey,
        createdBy: input.userId,
      },
    });
    void sweepUnbound().catch((err) => console.error("[attachments] 清理未保存附件失败", err));
    return toRecord(row);
  } catch (err) {
    await fs.unlink(full).catch(() => undefined);
    throw err;
  }
}

export async function listAttachmentRecords(scope: string, refIds: number[]): Promise<Map<number, AttachmentRecord[]>> {
  const map = new Map<number, AttachmentRecord[]>();
  const ids = [...new Set(refIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return map;
  const rows = await prisma.fileAttachment.findMany({
    where: { scope: assertScope(scope), refId: { in: ids } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const row of rows) {
    const list = map.get(row.refId) ?? [];
    list.push(toRecord(row));
    map.set(row.refId, list);
  }
  return map;
}

export async function getAttachmentRecord(id: number): Promise<AttachmentRecord | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await prisma.fileAttachment.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

export async function readAttachmentFile(record: AttachmentRecord): Promise<Buffer> {
  try {
    return await fs.readFile(resolveKey(record.storageKey));
  } catch {
    throw new MediaError("附件文件不见了", 404);
  }
}

/**
 * 把一条记录上的附件收成 `ids` 这一份。
 * 已经挂在这条记录上的可以留；还没挂上的（refId = 0）只有上传者本人能绑过来。
 * 不在名单里的旧附件会删掉。
 */
export async function syncAttachmentRefs(input: {
  scope: string;
  refId: number;
  ids: number[];
  claimUserId: number;
}): Promise<void> {
  const scope = assertScope(input.scope);
  const refId = input.refId;
  if (!Number.isInteger(refId) || refId <= 0) throw new MediaError("附件还没挂到记录上");
  const ids = [...new Set(input.ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, ATTACHMENT_MAX_COUNT);

  if (ids.length) {
    const rows = await prisma.fileAttachment.findMany({ where: { id: { in: ids } } });
    if (rows.length !== ids.length) throw new MediaError("有附件找不到了，请重新上传");
    for (const row of rows) {
      if (row.scope !== scope) throw new MediaError("附件不属于这里");
      const kept = row.refId === refId;
      const claim = row.refId === 0 && row.createdBy === input.claimUserId;
      if (!kept && !claim) throw new MediaError("不能使用这个附件", 403);
    }
  }

  const current = await prisma.fileAttachment.findMany({ where: { scope, refId } });
  const keep = new Set(ids);
  for (const row of current) {
    if (!keep.has(row.id)) await discardRow(toRecord(row));
  }
  if (ids.length) {
    await prisma.fileAttachment.updateMany({
      where: { id: { in: ids }, scope },
      data: { refId },
    });
  }
}

export async function removeAttachmentRefs(scope: string, refId: number): Promise<void> {
  if (!Number.isInteger(refId) || refId <= 0) return;
  const rows = await prisma.fileAttachment.findMany({
    where: { scope: assertScope(scope), refId },
  });
  for (const row of rows) await discardRow(toRecord(row));
}

export async function discardAttachment(record: AttachmentRecord): Promise<void> {
  await discardRow(record);
}

async function discardRow(record: AttachmentRecord): Promise<void> {
  await prisma.fileAttachment.delete({ where: { id: record.id } }).catch(() => undefined);
  try {
    await fs.unlink(resolveKey(record.storageKey));
  } catch {
    // 文件已经不在了也没关系，库里的记录上面已经删掉
  }
}

function disposition(filename: string, download: boolean): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "file";
  const kind = download ? "attachment" : "inline";
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** 浏览走 inline（仅安全类型），下载走 attachment，文件名用上传时的原名。 */
export function attachmentResponse(record: Pick<AttachmentRecord, "filename" | "mime">, body: Buffer, download: boolean): Response {
  const inline = !download && INLINE_MIME.has(record.mime);
  const headers = new Headers();
  headers.set("Content-Type", inline || INLINE_MIME.has(record.mime) ? record.mime : "application/octet-stream");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", disposition(record.filename, !inline));
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(new Uint8Array(body), { headers });
}
