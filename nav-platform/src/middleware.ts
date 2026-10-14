import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// 粗粒度登录态判断（Edge Runtime，拿不到数据库）。
// 平台权限与数据范围的真正校验在 layout / Server Action / 查询层。
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/media).*)"],
};
