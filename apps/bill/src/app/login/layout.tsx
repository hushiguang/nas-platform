/**
 * 登录页专用 layout。
 *
 * 账单是唯一还在用 cash-platform 遗留样式表（@/ui/styles.css）的应用，
 * 根 layout 只引了那一份，而登录表单（@nas/ui 的 LoginForm）用的
 * .auth-wrap / .field / .btn / .notice 只定义在 globals.css 里，
 * 于是 /login 的排版全是浏览器默认样式。
 *
 * 为什么不直接在根 layout 补引 globals.css：那份文件带 Tailwind preflight，
 * 会把 h1/p/button 的默认 margin 与字体全部重置。账单正文的 UI 是按
 * styles.css 里既有的默认排版调过间距的，整站一起引会大面积跑版。
 * App Router 的 CSS 按路由分包，引在这里只作用于 /login 及其子路由。
 */
import "@nas/ui/globals.css";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}