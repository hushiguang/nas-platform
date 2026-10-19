/**
 * 独立部署的业务应用。这些 code 与 Platform 表的 code 一一对应。
 *
 * todo 与其余应用不同：它既是**底座**（各平台产生的事件都收口到 todo 表，
 * 门户的「待办管理」跨应用汇总），又有一个**独立站点**（个人清单 + 家庭
 * 共享清单的读写入口）。所以它两处都在 —— 门户卡片跳过去，门户待办页
 * 汇总它产生的内容。
 */
export const APP_CODES = ["todo", "bill", "anniversary", "work", "pregnancy", "travel"] as const;
export type AppCode = (typeof APP_CODES)[number];

/** 门户自己也是一个可访问入口，但不在应用注册表里 */
export const PORTAL_CODE = "portal";

/** 用户看得到哪些平台，由 Platform 表决定；这里只管「地址从哪个环境变量读」 */
const BASE_URL_ENV: Record<AppCode, string> = {
  todo: "TODO_BASE_URL",
  bill: "BILL_BASE_URL",
  anniversary: "ANNIVERSARY_BASE_URL",
  work: "WORK_BASE_URL",
  pregnancy: "PREGNANCY_BASE_URL",
  travel: "TRAVEL_BASE_URL",
};

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** 门户地址。各应用用它拼「回到门户」链接，以及未登录时跳登录页 */
export function portalUrl(): string {
  return trimSlash(process.env.PORTAL_URL ?? "");
}

/**
 * 某个应用的对外地址。
 *
 * 子域名方案下形如 http://bill.nas.local:3211；同域方案下可以是
 * http://nas.local:3211。两种都只体现在环境变量里，代码不关心。
 */
export function appBaseUrl(code: AppCode): string {
  return trimSlash(process.env[BASE_URL_ENV[code]] ?? "");
}

/** 某张应用卡片点进去应该去哪里：数据库里配了 url 就用它，否则回退到环境变量 */
export function resolvePlatformHref(code: string, configuredUrl?: string | null): string {
  if (configuredUrl) return trimSlash(configuredUrl);
  if (code === PORTAL_CODE) return portalUrl();
  return (APP_CODES as readonly string[]).includes(code)
    ? appBaseUrl(code as AppCode)
    : portalUrl();
}

/**
 * 登录后跳转目标的白名单校验。
 *
 * `?next=` 是从 URL 来的，直接 router.push 就是一个开放重定向漏洞 ——
 * 攻击者构造 /login?next=https://evil.example 就能把人骗走。
 * 这里只放行两类目标：站内路径，以及本平台自己配置好的应用地址。
 */
export function safeNextUrl(raw?: string | null): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  // 站内路径。以 // 开头的其实是协议相对地址，会跳到外站，必须排除
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  const allowed = [portalUrl(), ...APP_CODES.map((code) => appBaseUrl(code))].filter(Boolean);
  return allowed.some((base) => value === base || value.startsWith(`${base}/`)) ? value : null;
}

