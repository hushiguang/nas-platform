import { SkeletonBlock, SkeletonGrid, SkeletonPageHead } from "@nas/ui";

/**
 * 旅行足迹的加载骨架。
 * 页面要等城市、行程、地图点位三路查询，骨架先占位。
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHead title="旅行足迹" />
      <div className="stat-grid" aria-hidden="true">
        <div className="stat-card">
          <span className="skeleton" style={{ width: 40, height: 22 }} />
          <span>去过的城市</span>
        </div>
        <div className="stat-card">
          <span className="skeleton" style={{ width: 40, height: 22 }} />
          <span>国家 / 地区</span>
        </div>
        <div className="stat-card">
          <span className="skeleton" style={{ width: 40, height: 22 }} />
          <span>趟行程</span>
        </div>
      </div>
      <SkeletonBlock height={220} radius={16} />
      <SkeletonGrid count={4} />
    </div>
  );
}
