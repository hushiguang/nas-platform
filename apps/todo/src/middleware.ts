import { createAuthMiddleware } from "@nas/auth/edge";

// 只做粗粒度登录态判断（cookie 有没有、能不能解开）。平台权限与数据范围的
// 真正校验在 (app)/layout.tsx 与各 Route Handler 里。
//
// 免登录路径由 @nas/auth 的 DEFAULT_PUBLIC_PATHS 统一维护（/login、/api/auth、
// /api/health…），这里不再重复声明，避免两处口径漂移。
export default createAuthMiddleware();

export const config = {
  // api/media 必须排除：图片代理要返回图片字节，未登录时被中间件拦成 307
  // 跳登录页，前端拿到的是一段 HTML，表现为「图片全裂」。其余六个应用都有这一项。
  // api/internal 走 SERVICE_TOKEN（门户/运维脚本调用），没有会话 cookie。
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/media|api/internal).*)"],
};
