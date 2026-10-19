/**
 * 纪念日背景图库。
 *
 * 照片来自 Unsplash（https://unsplash.com/license），可随产品分发，这里只作界面背景。
 * 渐变不依赖文件，图床没配、图片加载失败时也能用。
 *
 * 这一文件不碰 Node API，浏览器组件可以直接引用。
 */

export interface GalleryPhoto {
  id: string;
  name: string;
  /** 对应 packages/media/gallery 下的文件名 */
  file: string;
}

export interface GalleryGradient {
  id: string;
  name: string;
  background: string;
}

export const GALLERY: GalleryPhoto[] = [
  { id: "cake", name: "蜡烛", file: "cake.jpg" },
  { id: "aisle", name: "礼堂", file: "aisle.jpg" },
  { id: "bloom", name: "花束", file: "bloom.jpg" },
  { id: "lanterns", name: "庆祝", file: "lanterns.jpg" },
  { id: "balloons", name: "气球", file: "balloons.jpg" },
  { id: "sunset", name: "晚霞", file: "sunset.jpg" },
  { id: "sea", name: "海面", file: "sea.jpg" },
  { id: "stars", name: "星空", file: "stars.jpg" },
  { id: "woods", name: "林间", file: "woods.jpg" },
  { id: "fireworks", name: "烟花", file: "fireworks.jpg" },
];

export const GRADIENTS: GalleryGradient[] = [
  { id: "dawn", name: "晨光", background: "linear-gradient(145deg, #ffb067, #ff4d6a)" },
  { id: "dusk", name: "暮紫", background: "linear-gradient(145deg, #7c5cfc, #ff5f8f)" },
  { id: "tide", name: "潮汐", background: "linear-gradient(145deg, #3d8bfd, #12b981)" },
  { id: "ember", name: "烛火", background: "linear-gradient(160deg, #241c33, #ff8a3d)" },
];

export function galleryById(id: string): GalleryPhoto | null {
  return GALLERY.find((item) => item.id === id) ?? null;
}

export function gradientById(id: string): GalleryGradient | null {
  return GRADIENTS.find((item) => item.id === id) ?? null;
}
