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

/**
 * 回调地址 cookie 名。Auth.js 登录后用它记住「登录前想去哪」。
 *
 * 必须显式改名，不能沿用默认的 __Secure-authjs.callback-url ——
 * 前缀名在 https 下要求 Secure，且 csrf 那个 __Host- 前缀还额外禁止
 * 带 Domain 属性。而跨子域共享 cookie 就必须带 Domain。
 * 两个要求互斥，只能放弃前缀。
 */
export const CALLBACK_URL_COOKIE = "nas.callback-url";

/**
 * CSRF token cookie 名。
 *
 * 默认名在 https 下是 __Host-authjs.csrf-token，而 __Host- 前缀**禁止**
 * cookie 带 Domain 属性（浏览器会直接拒收，且不报错）。跨子域共享必须
 * 带 Domain，所以必须改用不带前缀的自定义名。
 * 带 Domain 却被拒的典型症状就是 MissingCSRF。
 */
export const CSRF_TOKEN_COOKIE = "nas.csrf-token";

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
  // cookie 名与作用域。
  //
  // 三个 cookie 都必须**显式给 name**，不能只改 options。
  //
  // Auth.js 的默认名带前缀：session 是 __Secure-authjs.session-token，
  // CSRF 更严，是 __Host-authjs.csrf-token。而前缀是浏览器强制校验的：
  //   __Secure- 要求 Secure 属性；
  //   __Host-  除了 Secure，还要求**不能有 Domain 属性**、Path 必须是 /。
  // 只要给 __Host- 的 cookie 带上 Domain，浏览器会**直接拒收**它，不报错、不提示。
  // 于是回调时服务端拿不到 CSRF token，报 MissingCSRF:
  //   "CSRF token was missing during an action callback"
  // 症状是「登录永远失败」，而日志里看不出任何 cookie 被拒的痕迹。
  //
  // 我们要跨子域共享 cookie，就必须加 Domain；加了 Domain 就不能再用
  // __Host- 前缀。所以这里把三个名字都换成自己的、不带前缀的名字 ——
  // 前缀带来的安全增益（防止子域越权写 cookie）在自建家用场景里
  // 抵不过「登录完全不可用」的代价。
  //
  // sessionToken 的名字尤其不能省：SSE（Server-Sent Events）无法自定义
  // header，Auth.js 只能把 token 放进名为 __Secure-authjs.session-token
  // 的 cookie 里传给浏览器；改了名就得同步告诉 Auth.js，
  // 否则 SSE 的流式响应根本收不到 session。
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE,
      options: { domain: cookieDomain(), secure: useSecureCookies() },
    },
    // callbackUrl / csrfToken 同样要显式改名，且与 Auth.js 内部引用保持一致
    callbackUrl: {
      name: CALLBACK_URL_COOKIE,
      options: { domain: cookieDomain(), secure: useSecureCookies() },
    },
    csrfToken: {
      name: CSRF_TOKEN_COOKIE,
      options: { domain: cookieDomain(), secure: useSecureCookies() },
    },
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
