"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const LABEL: Record<Theme, string> = { light: "亮色", dark: "暗色", system: "跟随系统" };
const ORDER: Theme[] = ["system", "light", "dark"];

/** 主题切换：分段按钮，跟随系统 / 亮色 / 暗色 */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const saved = localStorage.getItem("nasx.theme") as Theme | null;
    if (saved && ORDER.includes(saved)) setTheme(saved);
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    localStorage.setItem("nasx.theme", next);
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolved = next === "dark" || (next === "system" && dark) ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    document.documentElement.dataset.resolved = resolved;
  }

  return (
    <div className="theme-segment" role="group" aria-label="主题切换">
      {ORDER.map((t) => (
        <button
          key={t}
          type="button"
          className={theme === t ? "active" : ""}
          onClick={() => apply(t)}
          aria-pressed={theme === t}
        >
          {LABEL[t]}
        </button>
      ))}
    </div>
  );
}
