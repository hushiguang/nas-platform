import Link from "next/link";
import { requireUser } from "@/auth";
import { prisma } from "@nas/db";
import { createUser } from "@/server/rbac-actions";

// 用户管理（仅管理员）：列表 + 新建用户，授权与通知渠道进用户详情页配置。
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    return <div className="card muted">仅管理员可访问用户管理</div>;
  }
  const { error, ok } = await searchParams;

  const users = await prisma.user.findMany({
    orderBy: { id: "asc" },
    include: { platforms: { include: { platform: true } } },
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">管理员</span>
          <h1>用户管理</h1>
        </div>
        <Link href="/admin/platforms" className="btn ghost">
          应用管理 →
        </Link>
      </div>

      {error && <div className="notice" style={{ marginBottom: 16 }}>{error}</div>}
      {ok && <div className="notice ok" style={{ marginBottom: 16 }}>{ok}</div>}

      <section className="card section">
        <div className="card-head">
          <h2>新建用户</h2>
        </div>
        <form
          action={createUser}
          style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
        >
          <input name="username" placeholder="登录名" required className="field" />
          <input name="password" type="password" placeholder="初始密码（≥8 位）" required className="field" />
          <input name="nickname" placeholder="昵称" required className="field" />
          <input name="email" placeholder="邮箱（选填）" className="field" />
          <input name="wecomId" placeholder="企微 userid（选填）" className="field" />
          <select name="role" defaultValue="MEMBER" className="field">
            <option value="MEMBER">成员</option>
            <option value="ADMIN">管理员</option>
          </select>
          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="btn">
              创建
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>全部用户</h2>
          <span className="muted" style={{ fontSize: 13 }}>{users.length} 人</span>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>用户</th>
                <th>角色</th>
                <th>状态</th>
                <th>应用授权</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{u.nickname}</div>
                    <div className="muted" style={{ fontSize: 12 }}>@{u.username}</div>
                  </td>
                  <td>{u.role === "ADMIN" ? "管理员" : "成员"}</td>
                  <td>
                    <span className="badge soft">{u.status === "ACTIVE" ? "启用" : "禁用"}</span>
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {u.role === "ADMIN"
                      ? "全部应用"
                      : u.platforms.map((p) => `${p.platform.name}(${p.dataScope === "ALL" ? "全部" : "本人"})`).join("、") ||
                        "未授权"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Link href={`/admin/users/${u.id}`} className="btn ghost sm">
                      编辑
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
