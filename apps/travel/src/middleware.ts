import { createAuthMiddleware } from "@nas/auth/edge";

// 只做粗粒度登录态判断。真实权限（平台可见性 + 数据范围）在
// (app)/layout.tsx 与各 Route Handler 里校验。
export default createAuthMiddleware();

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/media|api/internal).*)"],
};
