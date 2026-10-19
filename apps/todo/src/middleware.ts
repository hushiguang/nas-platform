import { createAuthMiddleware } from "@nas/auth/edge";

// 只做粗粒度登录态判断（cookie 有没有、能不能解开）。平台权限与数据范围的
// 真正校验在 (app)/layout.tsx 与各 Route Handler 里。
//
// 免登录路径由 @nas/auth 的 DEFAULT_PUBLIC_PATHS 统一维护（/login、/api/auth、
// /api/health…），这里不再重复声明，避免两处口径漂移。
export default createAuthMiddleware();

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
