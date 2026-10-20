import { SkeletonLine, SkeletonList, SkeletonPageHead } from "@nas/ui";

/**
 * 账单的加载骨架。
 *
 * 账单界面是原 cash-platform 的一整块 SPA（react-router 内部跳转），
 * 这里只管「从别的应用第一次点进来」的那一段：HTML 到达后 JS 还在下载执行，
 * 先摆个骨架，避免白屏。
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHead title="账单" />
      <SkeletonList count={8} />
    </div>
  );
}
