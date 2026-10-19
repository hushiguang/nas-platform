import type { Metadata, Viewport } from "next";
import "@/ui/styles.css";

export const metadata: Metadata = {
  title: "家庭记账",
  description: "流水记录、账本分摊与报表",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 与原生壳一致：内容顶到状态栏下面，由 CSS 的 safe-area 自己留白
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4fb" },
    { media: "(prefers-color-scheme: dark)", color: "#141218" },
  ],
};

/**
 * 这里刻意**不**放主题预置脚本。
 *
 * 原来写过一段内联脚本，在 React 挂载前把 data-theme / data-resolved 写到 <html> 上，
 * 目的是防深色模式首屏闪白。但服务端渲染的 <html> 没有这两个属性，脚本一加上就
 * 变成 server/client 属性不一致 —— React 19 会直接报
 * "A tree hydrated but some attributes ... didn't match"，且明确说不会帮你修。
 *
 * 而这个防闪本来就是多余的：账单 UI 走 dynamic + ssr:false（见 ui/BillApp.tsx），
 * 首屏 body 是个空占位，主题由 App.jsx 挂载时自己 applyTheme。
 * 和原 cash-platform（纯 SPA，body 本来就是空的）行为完全一致，不存在闪白。
 */

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning：账单 UI 挂载时会把 data-theme / data-resolved
    // 写到 <html> 上（见 App.jsx 的 applyTheme），而服务端渲染的 <html> 没有这两个属性。
    // 加这一层兜底，避免 React 把「客户端后来改的属性」当成 hydration 错误报出来。
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* 与原 cash-platform 同一套字体：Noto Sans SC */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
