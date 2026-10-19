import type { Metadata, Viewport } from "next";
import { ThemeScript } from "@nas/ui";
import "@nas/ui/globals.css";
import "./travel.css";

export const metadata: Metadata = {
  title: "旅行足迹",
  description: "城市、路线、相册与往年今日",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
        {/* 与 nas-ledger 同一套字体：Noto Sans SC 正文 + Source Serif 4 标题 */}
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
