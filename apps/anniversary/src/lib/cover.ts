import { galleryById, gradientById } from "@nas/media/catalog";
import type { AnniversaryType } from "@nas/db";

/** 没选背景时，按类型铺一层颜色，卡片不至于空着 */
const FALLBACK: Record<AnniversaryType, string> = {
  BIRTHDAY: "linear-gradient(145deg, #ff8a3d, #ff4d6a)",
  MARRIAGE: "linear-gradient(145deg, #ff5f8f, #7c5cfc)",
  PROPOSAL: "linear-gradient(160deg, #ffb067, #ff4d6a 55%, #7c5cfc)",
  COUNTDOWN: "linear-gradient(145deg, #3ecf8e, #2f9e8f)",
  OTHER: "linear-gradient(145deg, #3d8bfd, #7c5cfc)",
};

export function fallbackGradient(type: AnniversaryType): string {
  return FALLBACK[type];
}

/**
 * 把存库的背景字段变成能直接画的样式。
 * 图库和渐变走本应用；上传的图走图床代理，避免自签证书加载失败。
 */
export function coverPresentation(background: string | null | undefined): {
  image: string | null;
  gradient: string | null;
} {
  if (!background) return { image: null, gradient: null };
  if (background.startsWith("gallery:")) {
    const id = background.slice("gallery:".length);
    if (!galleryById(id)) return { image: null, gradient: null };
    return { image: `/api/media/gallery/${id}`, gradient: null };
  }
  if (background.startsWith("gradient:")) {
    const item = gradientById(background.slice("gradient:".length));
    return { image: null, gradient: item?.background ?? null };
  }
  return {
    image: `/api/media/image?u=${encodeURIComponent(background)}`,
    gradient: null,
  };
}
