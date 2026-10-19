'use client';

/**
 * 账单 UI 的挂载壳 —— 顶替原来 Vite 的 main.tsx。
 *
 * 只做三件事：
 *   1. 把原 main.tsx 的启动副作用搬进 useEffect（浏览器里才跑）
 *   2. 套上 BrowserRouter：App.jsx 内部是 react-router，路由一个字没动
 *   3. 引入原 styles.css
 *
 * 这个组件**不在服务端渲染**（见 BillApp.tsx 的 dynamic + ssr: false）：
 * App.jsx 是当年按纯客户端 SPA 写的，useState(readTheme) 这类初始化里直接读
 * localStorage，放到 SSR 阶段就会「document is not defined」。
 */
import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';
import { initTokenStore } from './api';
import { initH5Shell, initNativeShell, syncStatusBar } from './platform';

export function BillShell({ portalHome }: { portalHome?: string | null }) {
  useEffect(() => {
    void (async () => {
      await initTokenStore();
      await initNativeShell();
      initH5Shell();
    })();

    // 主题切换后同步状态栏（data-theme / data-resolved 由 App.jsx 写在 <html> 上）
    const observer = new MutationObserver(() => {
      void syncStatusBar();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-resolved'],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <BrowserRouter>
      <App portalHome={portalHome} />
    </BrowserRouter>
  );
}
