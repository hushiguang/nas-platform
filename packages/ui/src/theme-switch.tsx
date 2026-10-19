"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const LABEL: Record<Theme, string> = { light: "亮色", dark: "暗色", system: "跟随系统" };
const ORDER: Theme[] = ["system", "light", "dark"];

/** 主题存储键。各应用共用同一个键 —— 在账单切成暗色，进纪念日也是暗色 */
export const THEME_STORAGE_KEY = "nasx.theme";

/** 主题切换：分段按钮，跟随系统 / 亮色 / 暗色 */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    if (saved && ORDER.includes(saved)) setTheme(saved);
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolved = next === "dark" || (next === "system" && dark) ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    document.documentElement.dataset.resolved = resolved;
  }

  return (
    <div className="theme-segment" role="group" aria-label="主题切换" suppressHydrationWarning>
      {ORDER.map((t) => (
        <button
          key={t}
          type="button"
          className={mounted && theme === t ? "active" : ""}
          onClick={() => apply(t)}
          aria-pressed={mounted && theme === t}
        >
          {LABEL[t]}
        </button>
      ))}
    </div>
  );
}
