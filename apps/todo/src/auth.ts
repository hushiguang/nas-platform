import { createAuth } from "@nas/auth";

// 本应用的认证入口。各应用各建一个实例，但共用同一个 AUTH_SECRET、
// 同一个会话 cookie 名与同一个 cookie 作用域 —— 登录态因此全站相通，
// 门户登录后来这里不用再登一次。
export const {
  handlers,
  auth,
  signIn,
  signOut,
  getSessionUser,
  requireUser,
  requireAppAccess,
} = createAuth({ app: "todo" });
