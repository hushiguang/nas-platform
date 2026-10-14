import { requireUser } from "@/modules/core/auth/session";
import { getPlatformAccess } from "@/modules/core/rbac";

// 模块占位页：同时承担"平台权限最终校验点"的职责。
// 无平台权限的用户访问直接 403，而不是只藏入口。
export async function ModulePlaceholder({
  code,
  title,
  description,
}: {
  code: string;
  title: string;
  description?: string;
}) {
  const user = await requireUser();
  const access = await getPlatformAccess(user, code);

  if (!access) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 48 }}>
        <div style={{ fontSize: 28, fontFamily: "Source Serif 4, serif" }}>403</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          你没有「{title}」平台的访问权限
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">nas-platform 内部模块</span>
          <h1>{title}</h1>
        </div>
      </div>
      {description && (
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
          {description}
        </p>
      )}
      <div
        className="card"
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: 180,
          borderStyle: "dashed",
          fontSize: 13,
          color: "var(--muted)",
        }}
      >
        模块建设中（数据范围：{access.dataScope === "ALL" ? "全部数据" : "仅本人"}）
      </div>
    </div>
  );
}
