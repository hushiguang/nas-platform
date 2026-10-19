import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { galleryById } from "./catalog";

/**
 * 图库目录在不同运行方式下位置不一样：
 * - `next dev` 的工作目录是应用目录（apps/anniversary）
 * - Docker standalone 的工作目录是仓库根（/app）
 */
function galleryRoot(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "packages/media/gallery"),
    path.resolve(process.cwd(), "../../packages/media/gallery"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

/** 按图库 id 读出图片。id 只能命中目录里登记过的文件，不会变成任意路径读取。 */
export function readGalleryFile(id: string): { body: Buffer; contentType: string } | null {
  const item = galleryById(id);
  if (!item) return null;
  const root = galleryRoot();
  if (!root) return null;
  const file = path.join(root, item.file);
  if (!existsSync(file)) return null;
  return { body: readFileSync(file), contentType: "image/jpeg" };
}
