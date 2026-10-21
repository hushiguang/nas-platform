"use client";

import { useEffect } from "react";

/**
 * 弹窗/抽屉打开时锁住页面滚动。
 *
 * 只锁 body 不够：iOS 上滚动常常落在 html（documentElement）上，
 * 手势一划背景列表照样滑。两处都按住，再关掉过度滚动，
 * 弹窗内部自己的滚动不受影响。
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return undefined;
    const root = document.documentElement;
    const previousBody = document.body.style.overflow;
    const previousRoot = root.style.overflow;
    document.body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    root.classList.add("is-scroll-locked");
    return () => {
      document.body.style.overflow = previousBody;
      root.style.overflow = previousRoot;
      root.classList.remove("is-scroll-locked");
    };
  }, [active]);
}
