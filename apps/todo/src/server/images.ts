/**
 * 待办的图片存取。
 *
 * 默认只走图床：配了 IMAGE_HOST_URL / IMAGE_HOST_TOKEN 就转发到 @nas/media，
 * 与账单、纪念日共用同一份配置；图床传不上去就报错，不再悄悄改存本地。
 *
 * 本地目录只在显式打开 TODO_IMAGE_LOCAL_FALLBACK=true 时才用（离线环境）。
 * 原因：本地兜底的文件在容器卷里，卷没挂好或容器重建就会留下 `local:`
 * 死链，表现是「图片不存在」，而上传时一切正常，很难第一时间发现。
 *
 * 存进 todo.images 的是**原始地址**，展示一律经过 /api/image?u=... 这一层：
 *   - 本地图：`local:<文件名>`（仅历史数据 / 显式兜底时出现）
 *   - 图床图：`https://...`（自签证书由服务端代理绕开）
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma, type Prisma } from "@nas/db";
import {
  fetchImage,
  imageHostConfigured,
  isAllowedImageUrl,
  MediaError,
  uploadImage,
} from "@nas/media";

/**
 * 本地兜底目录。挂在 NAS 共享目录上，容器重建也不丢。
 * 相对仓库根，与 docker-compose 里的卷挂载保持一致。
 */
const LOCAL_DIR = process.env.TODO_UPLOAD_DIR || path.resolve(process.cwd(), "../../data/uploads/todo");
const LOCAL_PREFIX = "local:";

/**
 * 是否允许「图床传不上去时改存本地」。默认关闭。
 * 打开后表现为上传永远成功，但图片可能落在容器卷里，换机器/重建即丢。
 */
const LOCAL_FALLBACK = /^(1|true|yes|on)$/i.test(process.env.TODO_IMAGE_LOCAL_FALLBACK || "");

/** 单张图片上限。图床自己也有上限，这里提前拦一道 */
const MAX_BYTES = Number(process.env.IMAGE_MAX_BYTES || 12 * 1024 * 1024);

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/avif": ".avif",
};

export type ImageBackend = "host" | "local";

/** 当前生效的后端。设置页会把它显示出来，让用户知道图片存在哪 */
export function imageBackend(): ImageBackend {
  return imageHostConfigured ? "host" : "local";
}

export interface SaveImageInput {
  buffer?: Buffer | Uint8Array | null;
  mimetype?: string;
  filename?: string;
}

/**
 * 存一张图，返回可写进 todo.images 的地址。
 * 图床可用就走图床；图床挂了（网络/证书/返回异常）自动退到本地，不让用户白传。
 */
export async function saveImage(input: SaveImageInput): Promise<string> {
  const buffer = input.buffer ? Buffer.from(input.buffer) : null;
  if (!buffer?.length) throw new MediaError("没有选到图片");
  if (buffer.length > MAX_BYTES) {
    throw new MediaError(`图片太大了（最多 ${Math.round(MAX_BYTES / 1024 / 1024)}MB）`);
  }
  const mimetype = String(input.mimetype || "").toLowerCase();
  if (mimetype && !mimetype.startsWith("image/")) throw new MediaError("只能传图片");

  if (imageHostConfigured) {
    try {
      const result = await uploadImage({ buffer, mimetype, filename: input.filename });
      return result.url;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (!LOCAL_FALLBACK) {
        // 默认路径：图床失败就失败，绝不再落到本地目录 ——
        // 本地文件一旦丢了，库里只会留下一批「图片不存在」的死链
        console.error("[todo] 图床上传失败（本地兜底已关闭）：", detail);
        throw new MediaError(`图床上传失败：${detail}`, 502);
      }
      console.error("[todo] 图床上传失败，按 TODO_IMAGE_LOCAL_FALLBACK 改存本地：", detail);
    }
  } else if (!LOCAL_FALLBACK) {
    throw new MediaError(
      "图床还没配置（IMAGE_HOST_URL / IMAGE_HOST_TOKEN），且本地兜底已关闭；" +
        "确实需要离线可用时把 TODO_IMAGE_LOCAL_FALLBACK 设为 true",
      501,
    );
  }

  return saveLocal(buffer, mimetype || "image/jpeg");
}

async function saveLocal(buffer: Buffer, mimetype: string): Promise<string> {
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  const ext = EXT_BY_TYPE[mimetype] || ".jpg";
  // 随机名，不可枚举；同时避免任何来自用户输入的文件名落到磁盘上
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  await fs.writeFile(path.join(LOCAL_DIR, name), buffer);
  return `${LOCAL_PREFIX}${name}`;
}

/** 该地址是不是本地兜底的图片 */
export function isLocalImage(address: string): boolean {
  return address.startsWith(LOCAL_PREFIX);
}

/**
 * 读图。`u` 要么是 `local:<文件名>`，要么是白名单内的图床地址。
 * 文件名只取 basename，杜绝 ../ 这类路径穿越。
 */
export async function readImage(u: string): Promise<{ body: Uint8Array; contentType: string }> {
  const address = String(u || "").trim();
  if (!address) throw new MediaError("缺少图片地址", 400);

  if (isLocalImage(address)) {
    const name = path.basename(address.slice(LOCAL_PREFIX.length));
    if (!name || name.startsWith(".")) throw new MediaError("图片地址不合法", 400);
    try {
      const body = await fs.readFile(path.join(LOCAL_DIR, name));
      return { body: new Uint8Array(body), contentType: contentTypeOf(name) };
    } catch {
      throw new MediaError("图片不存在", 404);
    }
  }

  const [allowed, reason] = isAllowedImageUrl(address);
  if (!allowed) throw new MediaError(reason ?? "这个地址不允许", 400);
  return fetchImage(address);
}

function contentTypeOf(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const found = Object.entries(EXT_BY_TYPE).find(([, e]) => e === ext);
  return found ? found[0] : "application/octet-stream";
}

export interface LocalImageMigration {
  /** 含 local: 图片的待办数 */
  scanned: number;
  /** 成功传到图床并替换的图片数 */
  migrated: number;
  /** 本地文件已丢失、只能保留原引用的图片数 */
  missing: number;
  /** 上传失败的图片数 */
  failed: number;
  details: string[];
}

/**
 * 把历史遗留的 `local:` 图片搬到图床，并把 todo.images 改写成图床地址。
 *
 * 只处理文件还在本地目录里的；文件已经丢了的原样保留（避免静默删数据），
 * 由调用方根据 missing 决定是否人工清理。可重复执行：已经搬过的不会重复上传。
 */
export async function migrateLocalImages(): Promise<LocalImageMigration> {
  if (!imageHostConfigured) throw new MediaError("图床还没配置，先把 IMAGE_HOST_URL / TOKEN 填上", 501);

  const rows = await prisma.todo.findMany({ select: { id: true, images: true } });
  const details: string[] = [];
  let scanned = 0;
  let migrated = 0;
  let missing = 0;
  let failed = 0;

  for (const row of rows) {
    const list = Array.isArray(row.images) ? row.images : [];
    if (!list.some((value) => typeof value === "string" && isLocalImage(value))) continue;
    scanned += 1;

    const next: Prisma.JsonValue[] = [];
    let changed = false;
    for (const value of list) {
      if (typeof value !== "string" || !isLocalImage(value)) {
        next.push(value);
        continue;
      }
      const name = path.basename(value.slice(LOCAL_PREFIX.length));
      try {
        const body = await fs.readFile(path.join(LOCAL_DIR, name));
        const result = await uploadImage({
          buffer: body,
          filename: name,
          mimetype: contentTypeOf(name),
        });
        next.push(result.url);
        migrated += 1;
        changed = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
          missing += 1;
          details.push(`#${row.id} ${name}: 本地文件不存在，保留原引用`);
        } else {
          failed += 1;
          details.push(`#${row.id} ${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
        next.push(value);
      }
    }

    if (changed) {
      await prisma.todo.update({
        where: { id: row.id },
        data: { images: next as Prisma.InputJsonValue },
      });
    }
  }

  console.log(
    `[todo] local 图迁移：扫描 ${scanned} 条待办，成功 ${migrated}，缺失 ${missing}，失败 ${failed}`,
  );
  return { scanned, migrated, missing, failed, details };
}
