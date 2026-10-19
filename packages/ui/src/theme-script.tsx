import { THEME_STORAGE_KEY } from "./theme-switch";

/**
 * 主题初始化脚本。必须内联、同步、放在 <head> 里 —— 晚一步执行就会
 * 先闪一下亮色再变暗，暗色模式下观感很差。
 */
export const themeScript = `
(function () {
  try {
    var key = ${JSON.stringify(THEME_STORAGE_KEY)};
    var t = localStorage.getItem(key);
    if (t !== 'light' && t !== 'dark') t = 'system';
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = t;
    document.documentElement.dataset.resolved = (t === 'dark' || (t === 'system' && dark)) ? 'dark' : 'light';
  } catch (e) {}
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
