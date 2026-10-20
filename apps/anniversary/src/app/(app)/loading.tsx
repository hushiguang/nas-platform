import { SkeletonGrid, SkeletonPageHead } from "@nas/ui";

/**
 * 纪念日应用的加载骨架。
 * 页面要等 listAnniversaries 查询 + 农历换算，先画骨架占位。
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHead title="纪念日" />
      <SkeletonGrid count={6} />
    </div>
  );
}
