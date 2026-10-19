import NextAuth from "next-auth";
import { authConfig } from "./config";

/**
 * 各应用 middleware.ts 用这个。
 *
 * 单独一个入口是为了把 Prisma 挡在外面：middleware 跑在 Edge Runtime，
 * 一旦从这里间接引到 Prisma，整个应用会因为加载不了原生模块而起不来。
 * 所以这里只引 config（纯配置 + cookie 解密），不引 createAuth。
 *
 * 它只做粗粒度判断（cookie 有没有、能不能解开）。平台权限与数据范围的
 * 真正校验在 layout / Route Handler / 查询层。
 */
export function createAuthMiddleware() {
  return NextAuth(authConfig).auth;
}

export { SESSION_COOKIE } from "./config";
