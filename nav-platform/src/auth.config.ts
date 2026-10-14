import type { NextAuthConfig } from "next-auth";

// 可被 Edge Runtime（middleware）安全引用的配置：
// 不引入 Prisma / bcrypt，只做粗粒度登录态判断。
// 真正的权限校验下沉到 layout / Server Action / 查询层。
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = !!auth?.user;

      // 免登录区域：登录页、Auth.js 自身接口、对外分享页、cron 入口（另有密钥校验）
      const publicPaths = ["/login", "/api/auth", "/share", "/api/cron"];
      const isPublic = publicPaths.some((p) => pathname.startsWith(p));

      if (isPublic) {
        // 已登录用户访问登录页直接回门户
        if (isLoggedIn && pathname.startsWith("/login")) {
          return Response.redirect(new URL("/", request.nextUrl));
        }
        return true;
      }
      return isLoggedIn;
    },
  },
  providers: [], // 在 auth.ts 里补全（那边可以用 Prisma）
} satisfies NextAuthConfig;
