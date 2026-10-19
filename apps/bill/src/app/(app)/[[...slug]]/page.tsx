/**
 * 账单路由入口 —— 可选 catch-all，同时匹配 `/` 与所有子路径。
 *
 * 页面本身不渲染任何东西：界面全在 BillApp（原 cash-platform 的 App.jsx）里，
 * 由 react-router 按 location 决定显示总览 / 流水 / 账本……
 *
 * 之所以用 catch-all 而不是把 App.jsx 拆成十几个 Next 页面：
 * 那是已经写完、调好的 5682 行 UI，拆开等于重写，还会把内部跳转、
 * 弹窗状态、滚动位置这些一起打散。
 */
import { portalUrl } from "@nas/core";
import { BillApp } from "@/ui/BillApp";

// 每次都要看到最新流水，不做静态化
export const dynamic = "force-dynamic";

export default function BillPage() {
  return <BillApp portalHome={portalUrl() || null} />;
}
