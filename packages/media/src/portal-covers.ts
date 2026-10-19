/**
 * 门户各应用的专属封面（Unsplash 直链，Unsplash License 可商用）。
 * 纪念日那套 gallery 是婚礼/庆祝风，放在记账/工作上不搭，所以这里按应用语义各配一张。
 * 用 images.unsplash.com 的 photo ID + 裁剪参数，稳定且免存本地。
 */
export interface AppCover {
  code: string;
  label: string;
  url: string;
}

const u = (id: string) => `https://images.unsplash.com/${id}?w=800&q=60&auto=format&fit=crop`;

export const APP_COVERS: AppCover[] = [
  { code: "bill", label: "记账 · 算盘", url: u("photo-1554224155-6726b3ff858f") },
  { code: "todo", label: "待办 · 书桌", url: u("photo-1484480974693-6ca0a78fb36b") },
  { code: "anniversary", label: "纪念 · 心形光斑", url: u("photo-1518199266791-5375a83190b7") },
  { code: "work", label: "工作 · 办公室", url: u("photo-1497366216548-37526070297c") },
  { code: "pregnancy", label: "孕期 · 新生", url: u("photo-1555252333-9f8e92e65df9") },
  { code: "travel", label: "旅行 · 地图", url: u("photo-1488646953014-85cb44e25828") },
  { code: "feiniu-album", label: "相册 · 相机", url: u("photo-1516035069371-29a1b244cc32") },
  { code: "portal", label: "门户 · 大厅", url: u("photo-1497366754035-f200968a6e72") },
];

export function appCoverByCode(code: string): AppCover | null {
  return APP_COVERS.find((c) => c.code === code) ?? null;
}
