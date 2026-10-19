import { NextResponse } from "next/server";
import { createAuthMiddleware } from "@nas/auth/edge";

const auth = createAuthMiddleware();

/**
 * 免登录前缀。
 *
 * - /share/*：账本分享页。App.jsx 内部本来就不要求登录（靠 URL 里的 token 授权），
 *   在这一层放行，否则分享链接会被直接弹到登录页。
 * - /legacy/api/*：安卓端「轻记」的旧接口通道，走 Bearer Token，
 *   没有会话 cookie。身份由路由层自己校验，中间件不该插手。
 * - /api/internal/*：门户 / Worker 的服务间调用，用 SERVICE_TOKEN 鉴权。
 */
const PUBLIC_PREFIXES = ["/share", "/legacy/api/", "/api/internal/"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }
  // 其余路径交回 Auth.js 默认处理（未登录重定向到登录页）
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/media).*)"],
};
