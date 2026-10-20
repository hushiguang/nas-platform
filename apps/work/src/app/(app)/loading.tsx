import { SkeletonGrid, SkeletonPageHead } from "@nas/ui";

/**
 * 工作台的加载骨架。
 * 页面要等 listProjects（连同节点、成员、阶段一起展开），骨架先占位。
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHead title="项目管理" />
      <SkeletonGrid count={6} />
    </div>
  );
}
