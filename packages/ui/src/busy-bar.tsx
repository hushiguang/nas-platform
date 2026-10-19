"use client";

import { useEffect, useState } from "react";

const QUIET_HEADERS = ["next-router-prefetch", "next-router-segment-prefetch", "next-hmr-refresh"];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** 预取、热更新和静态资源不该把进度条点亮 */
function isQuiet(input: RequestInfo | URL, init?: RequestInit): boolean {
  const bags = [init?.headers, input instanceof Request ? input.headers : undefined];
  for (const bag of bags) {
    if (!bag) continue;
    const headers = new Headers(bag);
    if (QUIET_HEADERS.some((name) => headers.has(name))) return true;
  }
  const url = requestUrl(input);
  if (url.includes("/_next/")) return true;
  return /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|map|woff2?|ttf)(?:$|\?)/i.test(url);
}

/**
 * 顶部进度条。和账单一样：有请求在飞就显示，全部结束就收起。
 * 挂在外壳和登录页上，各应用不用再各写一遍。
 */
export function BusyBar() {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const original = window.fetch.bind(window);
    let count = 0;

    const done = () => {
      count = Math.max(0, count - 1);
      if (count === 0) setBusy(false);
    };

    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (isQuiet(input, init)) return original(input, init);
      count += 1;
      setBusy(true);
      try {
        return original(input, init).finally(done);
      } catch (error) {
        done();
        throw error;
      }
    };

    return () => {
      window.fetch = original;
    };
  }, []);

  if (!busy) return null;

  return (
    <div className="busy-bar" role="status" aria-live="polite" aria-label="加载中">
      <span />
    </div>
  );
}
