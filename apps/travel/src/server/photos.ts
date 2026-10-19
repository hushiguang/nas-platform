/**
 * 飞牛相册（fnOS）引用层。
 *
 * 只读挂载照片目录进容器（NAS_PHOTO_ROOT），这里做两件事：
 *   1. 浏览目录 —— 目录即「相册」，列出子目录与图片；
 *   2. 读取图片字节 —— 供 /api/media/photo 代理。
 *
 * 不复制任何文件：数据库里只存相对 NAS_PHOTO_ROOT 的路径。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { TravelError } from "./errors";

/** 照片源根目录。compose 里把飞牛相册目录只读挂到 /data/photos */
const ROOT = process.env.NAS_PHOTO_ROOT || path.resolve(process.cwd(), "../../data/photos");

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".heic",
  ".heif",
  ".bmp",
  ".tif",
  ".tiff",
]);

const CONTENT_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

export interface DirEntry {
  name: string;
  /** 相对 NAS_PHOTO_ROOT 的路径 */
  path: string;
}

export interface PhotoEntry {
  name: string;
  /** 相对 NAS_PHOTO_ROOT 的路径，存库用 */
  path: string;
  /** 展示用的代理地址 */
  url: string;
}

export interface BrowseResult {
  root: string;
  /** 当前目录（相对路径，根目录为 ""） */
  dir: string;
  /** 上级目录；根目录时为 null */
  parent: string | null;
  dirs: DirEntry[];
  photos: PhotoEntry[];
}

/** 照片源根目录，设置页与空状态展示用 */
export function photoRoot(): string {
  return ROOT;
}

/** 展示地址：一律经过代理，避免把磁盘路径暴露到前端 */
export function photoUrl(rel: string): string {
  return `/api/media/photo?path=${encodeURIComponent(rel)}`;
}

async function rootExists(): Promise<boolean> {
  try {
    return (await fs.stat(ROOT)).isDirectory();
  } catch {
    return false;
  }
}

/** 规范化相对路径，确保不越狱出 ROOT（杜绝 ../ 穿越） */
function resolveSafe(rel: string): string {
  const clean = String(rel || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const abs = path.resolve(ROOT, clean);
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (abs !== ROOT && !abs.startsWith(rootWithSep)) throw new TravelError("路径不合法", 400);
  return abs;
}

function toRel(abs: string): string {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

export async function browse(rel = ""): Promise<BrowseResult> {
  if (!(await rootExists())) {
    throw new TravelError(`照片目录不存在或不可读：${ROOT}`, 404);
  }
  const dir = resolveSafe(rel);
  let stat;
  try {
    stat = await fs.stat(dir);
  } catch {
    throw new TravelError("目录不存在", 404);
  }
  if (!stat.isDirectory()) throw new TravelError("不是目录", 400);

  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => {
    throw new TravelError("目录不可读", 403);
  });

  const dirs: DirEntry[] = [];
  const photos: PhotoEntry[] = [];
  for (const entry of entries) {
    // 跳过隐藏文件与飞牛/群晖的缩略图缓存目录（@eaDir / #recycle 等）
    if (entry.name.startsWith(".") || entry.name.startsWith("@") || entry.name.startsWith("#")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      dirs.push({ name: entry.name, path: toRel(abs) });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      const relPath = toRel(abs);
      photos.push({ name: entry.name, path: relPath, url: photoUrl(relPath) });
    }
  }

  const collator = new Intl.Collator("zh");
  dirs.sort((a, b) => collator.compare(a.name, b.name));
  photos.sort((a, b) => collator.compare(a.name, b.name));

  return {
    root: ROOT,
    dir: toRel(dir),
    parent: rel ? toRel(path.dirname(dir)) : null,
    dirs,
    photos,
  };
}

export async function readPhoto(rel: string): Promise<{ body: Buffer; contentType: string }> {
  if (!(await rootExists())) throw new TravelError("照片目录不存在", 404);
  const abs = resolveSafe(rel);
  const ext = path.extname(abs).toLowerCase();
  if (!IMAGE_EXT.has(ext)) throw new TravelError("不是图片", 400);
  try {
    const body = await fs.readFile(abs);
    return { body, contentType: CONTENT_TYPE[ext] ?? "application/octet-stream" };
  } catch {
    throw new TravelError("图片不存在", 404);
  }
}

/** 校验一组引用路径是否合法（越狱直接拒绝）。保存行程时用 */
export function assertSafePaths(paths: string[]): void {
  for (const p of paths) {
    if (p) resolveSafe(p);
  }
}
