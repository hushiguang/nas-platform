import { SkeletonBlock, SkeletonPageHead } from "@nas/ui";

/**
 * 孕期应用的加载骨架。
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHead title="孕期" />
      <SkeletonBlock height={180} radius={16} />
    </div>
  );
}
