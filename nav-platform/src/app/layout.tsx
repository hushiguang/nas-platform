import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "家庭 NAS · 应用门户",
  description: "家庭 NAS 应用导航与一体化平台",
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

// 主题：与 nas-ledger 一致，支持 light / dark / system，落 localStorage
const themeScript = `
(function () {
  try {
    var t = localStorage.getItem('nasx.theme');
    if (t !== 'light' && t !== 'dark') t = 'system';
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = t;
    document.documentElement.dataset.resolved = (t === 'dark' || (t === 'system' && dark)) ? 'dark' : 'light';
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* 与 nas-ledger 同一套字体：Noto Sans SC 正文 + Source Serif 4 标题 */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Source+Serif+4:opsz,wght@8..60,560;8..60,680&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
