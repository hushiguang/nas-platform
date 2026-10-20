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
  /**
   * 服务端回源用的地址（可选）。只替换请求的协议/主机/端口，路径保持不变。
   *
   * 对外地址可能是只有 AAAA 记录的域名（经反向代理暴露），而 Docker 默认
   * 桥接网络没有 IPv6，容器直接回源就是 ENETUNREACH —— 表现为全站图片裂开。
   * 配成容器能走通的 IPv4 地址（如 https://192.168.1.10:1443 或另一个容器
   * 的服务名），图片代理与上传都改走这里；白名单和图床上返回的 URL 不变。
   * 图床通常是自签证书，这里本来就关掉了证书校验，用 IP 访问没有问题。
   */
  fetchBase: process.env.IMAGE_HOST_FETCH_BASE || "",
  /**
   * 只把域名解析固定到某个 IPv4（不改变 URL 的 Host/SNI），和 fetchBase 二选一。
   *
   * 比 fetchBase 更适合「图床挂在反向代理后面、反代按域名分流」的场景：
   * URL 仍然是 https://image.<root>:1443/...，Host 和 SNI 都正确，只是
   * 实际连到 NAS 的局域网 IPv4。fnos/Lucky 这类反代用 IP 直连时可能匹配
   * 不到站点，用这个就能绕开 IPv6 又保持域名路由。
   */
  fetchIp: process.env.IMAGE_HOST_FETCH_IP || "",
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
