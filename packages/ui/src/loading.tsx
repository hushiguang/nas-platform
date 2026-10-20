/**
 * 全站共用的加载骨架。
 *
 * 为什么需要它：这些应用的页面几乎都是 Server Component，页面要等数据库查询
 * （甚至等跨容器的内部接口）才出内容。等待期间浏览器只有一片空白，用户
 * 以为「卡死了」。Next 的 App Router 里，`loading.tsx` 会给该路由段套一层
 * Suspense 边界：骨架先画出来，数据到了再替换掉它。
 *
 * 所以这里的组件有两个用途：
 *   1. 各应用的 `loading.tsx` 直接用它们；
 *   2. 页面内部自己拿 Suspense 包裹慢数据时，fallback 也用同一套，
 *      保证全站骨架长得一样。
 *
 * 纯服务端组件，不带 "use client"：骨架没有任何交互，也不该占客户端包体积。
 */

/** 一条灰色占位条。width 传数字会被当成 px */
export function SkeletonLine({
  width = "100%",
  height = 14,
  radius,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
}) {
  return (
    <span
      className="skeleton"
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

/** 一块占位（比 line 粗），用于图表、封面这类大块区域 */
export function SkeletonBlock({
  height = 120,
  radius = 12,
  width = "100%",
}: {
  height?: number;
  radius?: number;
  width?: number | string;
}) {
  return (
    <span
      className="skeleton"
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

/** 一张卡片的骨架：标题 + 两行文字 */
export function SkeletonCard() {
  return (
    <div className="card skeleton-card" aria-hidden="true">
      <SkeletonLine width="45%" height={18} />
      <SkeletonLine width="88%" />
      <SkeletonLine width="62%" />
    </div>
  );
}

/** 卡片网格。门户首页、平台列表都是这个形状 */
export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}

/** 列表骨架。每行左边一个圆点、右边一条横线 */
export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton skeleton-dot" />
          <SkeletonLine height={12} />
        </div>
      ))}
    </div>
  );
}

/** 页面级加载态：转圈 + 文案。用在不确定内容形状的地方 */
export function PageLoading({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="page-loading" role="status" aria-live="polite" aria-label={label}>
      <span className="page-loading-dot" aria-hidden="true" />
      <span className="page-loading-text">{label}</span>
    </div>
  );
}

/**
 * 页面标题区的骨架。各应用首页都有「页头 + 内容」的结构，
 * 路由 loading 用它比空白条更贴近真实布局，切换时不会跳。
 */
export function SkeletonPageHead({ title = "" }: { title?: string }) {
  return (
    <div className="page-head" aria-hidden="true">
      <div>
        <span className="page-eyebrow">加载中</span>
        <h1>{title}</h1>
      </div>
    </div>
  );
}
