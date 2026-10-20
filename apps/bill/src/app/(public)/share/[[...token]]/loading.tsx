import { SkeletonBlock, SkeletonLine } from "@nas/ui";

/**
 * 分享账本的加载骨架。
 * 分享页要按 token 查账本与流水，骨架先占位。
 */
export default function Loading() {
  return (
    <div style={{ padding: 16 }}>
      <SkeletonLine width={140} height={22} />
      <SkeletonBlock height={180} radius={16} />
    </div>
  );
}
