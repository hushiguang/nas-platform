import { SkeletonLine, SkeletonList, SkeletonPageHead } from "@nas/ui";

/**
 * 待办应用的加载骨架。
 *
 * 页面要等 listTodos / todoStats 两次查询，骨架先占住位置，
 * 免得「点了没反应」。
 */
export default function Loading() {
  return (
    <div className="todo-home">
      <SkeletonPageHead title="待办" />
      <div className="stat-grid" aria-hidden="true">
        <div className="stat-card">
          <SkeletonLine width={48} height={22} />
          <span>进行中</span>
        </div>
        <div className="stat-card">
          <SkeletonLine width={48} height={22} />
          <span>今日到期</span>
        </div>
        <div className="stat-card">
          <SkeletonLine width={48} height={22} />
          <span>已完成</span>
        </div>
      </div>
      <SkeletonList count={6} />
    </div>
  );
}
