import type { Metadata, Viewport } from "next";
import { ThemeScript } from "@nas/ui";
import "@nas/ui/globals.css";
// 应用专有样式（弹窗、勾选框、图片缩略图），通用部分都在 globals 里
import "./todo.css";

export const metadata: Metadata = {
  title: "待办 · 家庭 NAS",
  description: "日常待办与购物清单，支持图片、归类与到期提醒",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 手机上当作 PWA 用时内容顶到状态栏下面，靠 CSS 的 safe-area 自己留白
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4fb" },
    { media: "(prefers-color-scheme: dark)", color: "#141218" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* 与门户同一套字体：Noto Sans SC 正文 + Source Serif 4 标题 */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Source+Serif+4:opsz,wght@8..60,560;8..60,680&display=swap"
          rel="stylesheet"
        />
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
