/**
 * 跨应用内部调用的服务令牌。
 *
 * 门户首页要汇总各应用的数据（本月账单、待办条数……）。多应用架构下这些数据
 * 分属不同的库表，门户不去直读对方的表（那样等于把两个应用重新焊在一起），
 * 而是调各应用暴露的内部接口。这些接口不面向浏览器，只认这把令牌。
 */

/** 环境变量里的令牌；没配就是空串 */
export function serviceToken(): string {
  return process.env.SERVICE_TOKEN ?? "";
}

/** 定长比较，避免用 === 比较时按前缀提前返回、被时序探测出令牌内容 */
function equalsConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 校验内部调用的令牌。
 * 没配 SERVICE_TOKEN 时一律判不通过 —— 否则「空令牌等于放行」，
 * 这些内部接口会变成公网可读的数据出口。
 */
export function verifyServiceToken(req: Request): boolean {
  const expected = serviceToken();
  if (!expected) return false;
  return equalsConstantTime(req.headers.get("x-service-token") ?? "", expected);
}

export interface InternalCallOptions extends RequestInit {
  /** 超时毫秒数。单个应用挂了不能把门户首页拖住，默认 3 秒 */
  timeoutMs?: number;
}/**
 * 调其他应用的内部接口。失败一律返回 null，由调用方决定降级展示
 * （首页少一个数字，好过整页 500）。
 */
export async function callInternal<T>(
  url: string,
  options: InternalCallOptions = {},
): Promise<T | null> {
  const { timeoutMs = 3000, headers, ...rest } = options;
  try {
    const res = await fetch(url, {
      ...rest,
      headers: { ...(headers ?? {}), "x-service-token": serviceToken() },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // 调用方只能看到 null，日志里必须留下是哪一路、什么状态码。
      // 最常见的两种：地址是只有 AAAA 的域名（容器 ENETUNREACH，直接抛错）
      // 与 SERVICE_TOKEN 各容器不一致（401）。
      const text = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`[internal] ${rest.method ?? "GET"} ${url} -> ${res.status} ${text}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[internal] ${rest.method ?? "GET"} ${url} 失败: ${reason}`);
    return null;
  }
}

/**
 * 内部接口的守卫。用法：
 *
 *   const denied = serviceGuard(req);
 *   if (denied) return denied;
 *
 * 这些接口是绕过登录态的（服务端之间没有会话），所以令牌校验必须放在
 * 取数据之前，不能取完再判断。
 */
export function serviceGuard(req: Request): Response | null {
  if (verifyServiceToken(req)) return null;
  return Response.json({ message: "未授权" }, { status: 401 });
}
