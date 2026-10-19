/** 环境变量取正整数，非法或非正数就退回默认值 */
function numEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * 图床（EasyImages）与图片代理。
 *
 * 账单和纪念日读的是同一组环境变量，所以上传地址、令牌、白名单只配一处。
 * 没配 IMAGE_HOST_URL / IMAGE_HOST_TOKEN 时上传关闭，内置图库仍可用。
 */
export const imageHostConfig = {
  /** 图床上传地址；不配就没有上传，接口返回 501 */
  url: process.env.IMAGE_HOST_URL || "",
  token: process.env.IMAGE_HOST_TOKEN || "",
  /** 允许回源的主机白名单（逗号分隔）；不填则仅放行 IMAGE_HOST_URL 的主机 */
  allowHosts: (process.env.IMAGE_HOST_ALLOW_HOSTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  cacheTtlSeconds: numEnv(process.env.IMAGE_PROXY_CACHE_TTL, 86400),
  /** 单张图片大小上限（图床端自己也有上限，这里只是提前拦截） */
  imageMaxBytes: numEnv(process.env.IMAGE_MAX_BYTES, 12 * 1024 * 1024),
  multipartMaxBytes: numEnv(process.env.UPLOAD_MAX_BYTES, 30 * 1024 * 1024),
};
