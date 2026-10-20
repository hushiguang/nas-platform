import { SkeletonBlock, SkeletonGrid, SkeletonLine, SkeletonPageHead } from "@nas/ui";

/**
 * 门户首页的加载骨架。
 *
 * 首页要等两件事：各应用的概览（跨容器调内部接口）与待办收数。
 * 这些都是网络往返，等的时候浏览器只有白屏，用户会以为点不动。
 * 这里先把卡片网格画出来，数据到了再顶替。
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHead title="家庭 NAS" />
      <div className="overview" aria-hidden="true">
        <span className="overview-title">今日概览</span>
        <span className="skeleton" style={{ width: 92, height: 26, borderRadius: 8 }} />
        <span className="skeleton" style={{ width: 92, height: 26, borderRadius: 8 }} />
        <span className="skeleton" style={{ width: 92, height: 26, borderRadius: 8 }} />
      </div>
      <SkeletonGrid count={6} />
    </div>
  );
}
