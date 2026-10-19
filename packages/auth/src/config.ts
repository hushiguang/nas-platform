import type { NextAuthConfig } from "next-auth";

/**
 * 会话 cookie 名。**所有应用必须完全一致**，这是跨子域 SSO 的全部秘密：
 *
 * 门户登录时签了一个加密 JWT 放进这个 cookie，domain 设成 .nas.local，
 * 浏览器就会把它带给 *.nas.local 的每一个请求；各应用拿同一个 AUTH_SECRET
 * 各自解密，于是都认出了同一个人。
 *
 * 好处是应用之间**互不依赖**：没有中心化的校验请求，门户挂了不影响账单，
 * 账单重启也不影响门户。代价是「强制下线」不能靠删会话表实现 ——
 * 真要踢人得换密钥（一次踢掉所有人），或改用数据库会话策略。
 */
export const SESSION_COOKIE = "nas.session";

/** 会话有效期。家里自用，别让用户三天两头登录 */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/**
 * cookie 的作用域。
 * 留空 → 只在同一 host 下共享（同域名不同端口也能用，cookie 本来就不区分端口）。
 * 填 .nas.local → 所有子域共享。**前面那个点不能省**，否则只对当前子域有效。
 */
export function cookieDomain(): string | undefined {
  const raw = env("AUTH_COOKIE_DOMAIN");
  // 浏览器会直接拒收不含点（或只有一点）的 Domain cookie，且拒收得毫无提示 ——
  // 表现是 cookie 存不下、登录一律 MissingCSRF，但服务端日志看不出原因。
  // 这种值基本只来自 NAS_ROOT_DOMAIN 漏配（compose 的默认值退化成 "."）。
  // 降级为 undefined（仅同 host 共享）至少让本应用还能登录，
  // 代价只是跨子域 SSO 失效，可用性远好于全线登不上。
  if (!raw || !raw.includes(".")) return undefined;
  return raw.startsWith(".") ? raw : `.${raw}`;
}

/** 只有走 https 时才置 true。内网 http 访问若置 true，浏览器根本不回传 cookie */
export function useSecureCookies(): boolean {
  return env("AUTH_COOKIE_SECURE").toLowerCase() === "true";
}

/** 免登录区域。内部接口靠服务令牌自证，不能要求会话，否则门户调不通 */
export const DEFAULT_PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/internal",
  "/api/cron",
  "/api/health",
  "/share",
];

/**
 * 可被 Edge Runtime（middleware）安全引用的配置：
 * 不引入 Prisma / bcrypt，只做粗粒度登录态判断。
 * 真正的权限校验下沉到各应用的 layout / Route Handler / 查询层。
 */
export const authConfig = {
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login" },
  // 自部署场景 Host 由我们自己的反代/直连决定，没有第三方 Host 注入面
  trustHost: true,
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE,
      options: { domain: cookieDomain(), secure: useSecureCookies() },
    },
    callbackUrl: { options: { domain: cookieDomain(), secure: useSecureCookies() } },
    csrfToken: { options: { domain: cookieDomain(), secure: useSecureCookies() } },
  },
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = !!auth?.user;
      const isPublic = DEFAULT_PUBLIC_PATHS.some((p) => pathname.startsWith(p));

      if (isPublic) {
        // 已登录用户访问登录页不必再登录一次，直接送回首页
        if (isLoggedIn && pathname.startsWith("/login")) {
          return Response.redirect(new URL("/", request.nextUrl));
        }
        return true;
      }
      return isLoggedIn;
    },
  },
  providers: [], // 在 createAuth 里补全（那边才可以用 Prisma）
} satisfies NextAuthConfig;
