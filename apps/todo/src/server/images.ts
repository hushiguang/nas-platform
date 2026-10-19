/**
 * 待办的图片存取。
 *
 * 两套后端，自动选：
 *   1. 配了图床（IMAGE_HOST_URL / IMAGE_HOST_TOKEN）→ 走 @nas/media 转发上传，
 *      与账单、纪念日共用同一份配置；
 *   2. 没配图床 → 存 NAS 本地目录（TODO_UPLOAD_DIR，compose 里挂卷）。
 *
 * 之所以要第 2 条：图床是可选项，但「待办能加图片」是核心需求。没配就整块
 * 功能失效不可接受，所以给一个不依赖任何外部服务的兜底。
 *
 * 存进 todo.images 的是**原始地址**，展示一律经过 /api/image?u=... 这一层：
 *   - 本地图：`local:<文件名>`
 *   - 图床图：`https://...`（自签证书由服务端代理绕开）
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
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

  if (imageBackend() === "host") {
    try {
      const result = await uploadImage({ buffer, mimetype, filename: input.filename });
      return result.url;
    } catch (err) {
      // 图床配置在但传不上去（服务挂了/令牌过期），退回本地并留个日志，
      // 用户侧照常能记待办 —— 比直接报错有用得多
      console.error("[todo] 图床上传失败，改存本地：", err instanceof Error ? err.message : err);
    }
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

  if (!isAllowedImageUrl(address)) throw new MediaError("这个地址不允许", 400);
  return fetchImage(address);
}

function contentTypeOf(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const found = Object.entries(EXT_BY_TYPE).find(([, e]) => e === ext);
  return found ? found[0] : "application/octet-stream";
}
