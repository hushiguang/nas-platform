'use client';

/**
 * 账单 UI 的 Next 接入层。
 *
 * 两层延迟，缺一不可：
 *
 *   1. dynamic + ssr:false —— 原 App.jsx 是按纯客户端 SPA 写的（Vite 起的项目，
 *      从来没有服务端渲染这一步），useState(readTheme) 这类初始化里直接读
 *      localStorage，放到 SSR 阶段就会「document is not defined」。
 *
 *   2. mounted 门控 —— 光有 ssr:false 还不够。BillShell 的 chunk 一旦被预加载，
 *      它会在**同一次 hydration commit** 里就 resolve，而 App.jsx 的 useTheme
 *      在 useEffect 里往 <html> 写 data-theme / data-resolved；这个 effect 会在
 *      hydration 收尾前 flush，React 19 的 hydration warning 又是延迟发出的，
 *      于是报 "some attributes of the server rendered HTML didn't match"。
 *
 *      用 mounted 把它推到 hydration 完成之后的独立渲染，写 DOM 就发生在
 *      hydration 之后，不再触发对比。（next-themes 处理同类问题也是这个套路。）
 *
 * 代价是首屏多一帧空壳；换来的是 5682 行 UI 一行不用改。
 */
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

// 首屏占位：样式由 root layout 引入的 styles.css 提供，这里只留一个撑高的空块，
// 避免 hydration 完成前页面塌成一条
const Booting = () => <div style={{ minHeight: "60vh" }} />;

const BillShell = dynamic(() => import("./BillShell").then((m) => m.BillShell), {
  ssr: false,
  loading: Booting,
});

export function BillApp({ portalHome }: { portalHome?: string | null }) {
  const [mounted, setMounted] = useState(false);

  // effect 一定在 hydration commit 之后才跑，所以这个 setState 触发的
  // 是 hydration 完成后的第二次渲染
  useEffect(() => setMounted(true), []);

  if (!mounted) return <Booting />;
  return <BillShell portalHome={portalHome} />;
}
