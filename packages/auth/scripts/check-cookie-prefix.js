#!/usr/bin/env node
// 校验 Auth.js 的 cookie 配置不会被浏览器的前缀规则拒收。
//
// 背景：跨子域 SSO 要求 cookie 带 Domain 属性，而浏览器对 __Host- / __Secure-
// 前缀有强制规则 —— __Host- 额外要求「不能有 Domain」，违反就静默拒收。
// 静默拒收的后果是 CSRF cookie 到不了服务端，登录报
//   MissingCSRF: CSRF token was missing during an action callback
// 而日志里没有任何「cookie 被拒」的痕迹，极难定位。
//
// 本脚本用 @auth/core 真实的 defaultCookies + merge 逻辑，
// 断言最终下发的三个 cookie 都能被浏览器接受。
// 放在 packages/auth/scripts 下是因为它要 import 仓库里的 @auth/core。

const path = require("path");
const fs = require("fs");

const repoRoot = path.resolve(__dirname, "../../..");
const cookieModule = path.join(repoRoot, "node_modules/@auth/core/lib/utils/cookie.js");
const { defaultCookies } = require(cookieModule);

/** @auth/core 的深合并逻辑，原样搬过来（见 node_modules/@auth/core/lib/utils/merge.js） */
function merge(target, ...sources) {
  const isObject = (i) => i !== null && typeof i === "object";
  if (!sources.length) return target;
  const source = sources.shift();
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!isObject(target[key])) target[key] = Array.isArray(source[key]) ? [] : {};
        merge(target[key], source[key]);
      } else if (source[key] !== undefined) target[key] = source[key];
    }
  }
  return merge(target, ...sources);
}

/** 浏览器对 cookie 名前缀的强制校验规则 */
function browserRejects(name, options) {
  if (name.startsWith("__Host-")) {
    if (options.domain) return "__Host- 不允许带 Domain 属性";
    if (!options.secure) return "__Host- 要求 Secure";
    if (options.path !== "/") return "__Host- 要求 Path=/";
  }
  if (name.startsWith("__Secure-") && !options.secure) return "__Secure- 要求 Secure";
  return null;
}

// 从源码里抽出实际的 cookies 配置，避免脚本与实现脱节
const configSrc = fs.readFileSync(path.join(repoRoot, "packages/auth/src/config.ts"), "utf8");
const names = {
  sessionToken: /sessionToken:\s*\{\s*name:\s*([A-Z_]+)/.exec(configSrc),
  callbackUrl: /callbackUrl:\s*\{\s*name:\s*([A-Z_]+)/.exec(configSrc),
  csrfToken: /csrfToken:\s*\{\s*name:\s*([A-Z_]+)/.exec(configSrc),
};

const consts = {};
for (const m of configSrc.matchAll(/export const ([A-Z_]+) = "([^"]+)";/g)) consts[m[1]] = m[2];

const missing = Object.entries(names).filter(([, m]) => !m);
if (missing.length) {
  console.error(
    "以下 cookie 没有显式指定 name，name 会沿用 Auth.js 的默认值，" +
      "而默认值带 __Host-/__Secure- 前缀：\n  " +
      missing.map(([k]) => k).join("\n  ")
  );
  console.error("跨子域 SSO 需要 cookie 带 Domain，与 __Host- 前缀互斥，必须显式改名。");
  process.exit(1);
}

const cookieCfg = {
  sessionToken: { name: consts[names.sessionToken[1]], options: { domain: ".example.com", secure: true } },
  callbackUrl: { name: consts[names.callbackUrl[1]], options: { domain: ".example.com", secure: true } },
  csrfToken: { name: consts[names.csrfToken[1]], options: { domain: ".example.com", secure: true } },
};

const merged = merge(defaultCookies(true), cookieCfg);

let failed = false;
console.log("合并后的 cookie（https + 跨子域）：");
for (const [key, v] of Object.entries(merged)) {
  const hasDomain = Boolean(v.options.domain);
  const reason = browserRejects(v.name, v.options);
  const mark = reason ? "✗" : "✓";
  if (reason && hasDomain && ["sessionToken", "callbackUrl", "csrfToken"].includes(key)) failed = true;
  console.log(`  ${mark} ${key.padEnd(13)} ${v.name}`);
  if (reason) console.log(`      → ${reason}`);
}

if (failed) {
  console.error("\n校验失败：跨子域 SSO 的 cookie 会被浏览器静默拒收，登录会报 MissingCSRF。");
  process.exit(1);
}
console.log("\n校验通过：三个 cookie 都能被浏览器接受，跨子域 SSO 与登录都可用。");