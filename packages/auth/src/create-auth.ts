import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { notFound, redirect } from "next/navigation";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";
import { z } from "zod";
import { getPlatformAccess, portalUrl, type PlatformAccess, type SessionUser } from "@nas/core";
import { prisma } from "@nas/db";
import { authConfig } from "./config";

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export interface CreateAuthOptions {
  /**
   * 应用平台 code（bill / anniversary / work / ...）。
   * 用于日志定位，也是 requireAppAccess 默认校验的平台。
   */
  app: string;
}

export interface AppAccess {
  user: SessionUser;
  access: PlatformAccess;
}

/**
 * 每个应用调一次，拿到属于本应用的认证入口。
 *
 * 各应用各自挂 /api/auth/[...nextauth] 和自己的 /login 页 —— 从任何入口进来
 * 都能就地登录，不依赖门户转发。登录成功写下的 cookie 作用域是全站的，
 * 所以在账单登录后打开纪念日，直接就是登录态。
 */
export function createAuth(options: CreateAuthOptions) {
  const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    providers: [
      Credentials({
        credentials: {
          username: { label: "用户名", type: "text" },
          password: { label: "密码", type: "password" },
        },
        async authorize(credentials) {
          const parsed = credentialsSchema.safeParse(credentials);
          if (!parsed.success) return null;
          const username = parsed.data.username.trim();

          // 大小写不敏感：数据是从旧库搬过来的，历史上存过首字母大写这种写法，
          // 用户不该因为大小写被挡在门外。
          const user = await prisma.user.findFirst({
            where: { username: { equals: username, mode: "insensitive" } },
          });
          // 用户不存在、被禁用、密码不对，一律返回 null：
          // 不区分具体原因，避免把「这个用户名存在」暴露出去。
          if (!user || user.status !== "ACTIVE") return null;
          const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
          if (!ok) return null;

          return {
            id: String(user.id),
            name: user.nickname,
            username: user.username,
            role: user.role,
          };
        },
      }),
    ],
    callbacks: {
      ...authConfig.callbacks,
      jwt({ token, user }) {
        if (user) {
          token.id = user.id;
          token.role = user.role;
          token.username = user.username;
        }
        return token;
      },
      session({ session, token }) {
        // 参数是 jwt / database 两种策略的联合类型，这里按 JWT 取
        const t = token as JWT;
        if (t?.id) session.user.id = t.id;
        if (t?.role) session.user.role = t.role;
        if (t?.username) session.user.username = t.username;
        return session;
      },
    },
  });

  /** 当前登录用户；未登录或脱离请求上下文（脚本、定时任务）返回 null */
  async function getSessionUser(): Promise<SessionUser | null> {
    // next-auth v5 的 auth 是「万能函数」：既能当 session() 用（无参），
    // 也能当 middleware 用（接 request/event）。ReturnType 会取到后一个重载，
    // 所以这里不用 ReturnType，显式按无参调用的结果来标注。
    let session: Session | null = null;
    try {
      session = (await (auth as () => Promise<Session | null>)()) ?? null;
    } catch {
      // auth() 在没有请求上下文时会抛错，按未登录处理而不是把调用方炸掉
      return null;
    }
    if (!session?.user?.id) return null;
    return {
      id: Number(session.user.id),
      username: session.user.username,
      nickname: session.user.name ?? session.user.username,
      role: session.user.role,
    };
  }

  /** 页面/Action 的登录门槛，未登录跳本应用的登录页 */
  async function requireUser(): Promise<SessionUser> {
    const user = await getSessionUser();
    if (!user) redirect("/login");
    return user;
  }

  /**
   * 应用访问门槛：先要登录，再要这个应用的可见性授权。
   * 没权限时返回 404 而不是 403 —— 不告诉对方「这里有个你看不了的应用」。
   */
  async function requireAppAccess(code: string = options.app): Promise<AppAccess> {
    const user = await requireUser();
    const access = await getPlatformAccess(user, code);
    if (!access) notFound();
    return { user, access };
  }

  return {
    app: options.app,
    handlers,
    auth,
    signIn,
    signOut,
    getSessionUser,
    requireUser,
    requireAppAccess,
    /** 便于「回到门户」的链接，未配置时返回 null */
    portalHome: () => portalUrl() || null,
  };
}

export type AppAuth = ReturnType<typeof createAuth>;
