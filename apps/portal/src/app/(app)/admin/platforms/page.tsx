import { requireUser } from "@/auth";
import { prisma } from "@nas/db";
import { createPlatform, updatePlatform, deletePlatform } from "@/server/rbac-actions";
import { PlatformDialog } from "./dialog";
import { DeleteButton } from "./delete-button";

type Platform = Awaited<ReturnType<typeof prisma.platform.findMany<{
  orderBy: { sort: "asc" }[];
  include: { _count: { select: { users: true } } };
}>>>[number];

// 应用注册表管理（仅管理员）：列表 + 弹窗。
// 表格只放主要信息，新增/编辑都走弹窗，删除行内确认。
export default async function AdminPlatformsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    return <div className="card muted">仅管理员可访问应用管理</div>;
  }
  const { error, ok } = await searchParams;
  const platforms = await prisma.platform.findMany({
    orderBy: [{ sort: "asc" }, { id: "asc" }],
    include: { _count: { select: { users: true } } },
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">管理员</span>
          <h1>应用管理</h1>
        </div>
        <div className="row-actions">
          <span className="badge soft">{platforms.length} 个</span>
          <PlatformDialog
            action={createPlatform}
            trigger={<button type="button" className="btn">+ 新增应用</button>}
          />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        这里注册的应用会出现在首页卡片网格里。独立应用填 URL 并勾选「外部」；nas-platform 内部模块不填 URL，走内部路由。
      </p>

      {error && <div className="notice" style={{ marginBottom: 16 }}>{error}</div>}
      {ok && <div className="notice ok" style={{ marginBottom: 16 }}>{ok}</div>}

      {platforms.length === 0 ? (
        <div className="card muted" style={{ fontSize: 13 }}>
          还没有应用，点右上角「新增应用」创建。
        </div>
      ) : (
        <section className="card">
          <div className="card-head">
            <h2>全部应用</h2>
            <span className="muted" style={{ fontSize: 13 }}>{platforms.length} 个</span>
          </div>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>应用</th>
                  <th>标识</th>
                  <th>分组</th>
                  <th>类型</th>
                  <th>链接 / 描述</th>
                  <th>排序</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {platforms.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>
                        <span className="platform-icon">{p.icon || "🧩"}</span>
                        {p.name}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        已授权 {p._count.users} 人
                      </div>
                    </td>
                    <td><code>{p.code}</code></td>
                    <td>{p.group || <span className="muted">未分组</span>}</td>
                    <td>
                      <span className="badge soft">{p.isExternal ? "外部" : "内置"}</span>
                    </td>
                    <td className="muted" style={{ fontSize: 13, maxWidth: 320 }}>
                      <div style={{ overflowWrap: "anywhere" }}>
                        {p.url || "—"}
                      </div>
                      {p.description && (
                        <div style={{ fontSize: 12, marginTop: 2 }}>{p.description}</div>
                      )}
                    </td>
                    <td>{p.sort}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <span className="row-ops">
                        <PlatformDialog
                          action={updatePlatform}
                          initial={{
                            id: p.id,
                            code: p.code,
                            name: p.name,
                            icon: p.icon,
                            cover: p.cover,
                            group: p.group,
                            sort: p.sort,
                            url: p.url,
                            isExternal: p.isExternal,
                            description: p.description,
                          }}
                          trigger={<button type="button" className="btn ghost sm">编辑</button>}
                        />
                        <DeleteButton action={deletePlatform} id={p.id} name={p.name} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
