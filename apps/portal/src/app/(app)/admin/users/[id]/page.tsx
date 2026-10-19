import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { prisma } from "@nas/db";
import {
  updateUser,
  resetPassword,
  deleteUser,
  saveUserPlatforms,
  saveNotifyChannels,
} from "@/server/rbac-actions";

// 用户详情（仅管理员）：基本信息 / 应用授权 / 通知渠道 / 密码
export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const admin = await requireUser();
  if (admin.role !== "ADMIN") {
    return <div className="card muted">仅管理员可访问</div>;
  }
  const { id } = await params;
  const { error, ok } = await searchParams;
  const userId = Number(id);
  if (!Number.isInteger(userId)) notFound();

  const target = await prisma.user.findUnique({
    where: { id: userId },
    include: { platforms: true, notifyChannels: true },
  });
  if (!target) notFound();

  const platforms = await prisma.platform.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] });
  const scopeOf = (platformId: number) =>
    target.platforms.find((p) => p.platformId === platformId)?.dataScope ?? "NONE";
  const channelOf = (type: "WECOM" | "MAIL") => target.notifyChannels.find((c) => c.type === type);
  const channelTarget = (type: "WECOM" | "MAIL") => {
    const cfg = channelOf(type)?.config;
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return "";
    const value = (cfg as Record<string, unknown>)[type === "WECOM" ? "toUser" : "to"];
    return typeof value === "string" ? value : "";
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">
            <Link href="/admin/users" className="link">← 用户管理</Link>
          </span>
          <h1>
            {target.nickname}
            <span className="muted" style={{ fontSize: 15, marginLeft: 8 }}>@{target.username}</span>
          </h1>
        </div>
      </div>

      {error && <div className="notice" style={{ marginBottom: 16 }}>{error}</div>}
      {ok && <div className="notice ok" style={{ marginBottom: 16 }}>{ok}</div>}
      {target.role === "ADMIN" && (
        <div className="card muted" style={{ fontSize: 13, marginBottom: 20 }}>
          管理员默认拥有全部应用的全部数据权限，下面的应用授权仅对成员生效。
        </div>
      )}

      <section className="card section">
        <div className="card-head">
          <h2>基本信息</h2>
        </div>
        <form
          action={updateUser}
          style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
        >
          <input type="hidden" name="id" value={target.id} />
          <input name="nickname" defaultValue={target.nickname} placeholder="昵称" required className="field" />
          <input name="email" defaultValue={target.email ?? ""} placeholder="邮箱" className="field" />
          <input name="wecomId" defaultValue={target.wecomId ?? ""} placeholder="企微 userid" className="field" />
          <select name="role" defaultValue={target.role} className="field">
            <option value="MEMBER">成员</option>
            <option value="ADMIN">管理员</option>
          </select>
          <select name="status" defaultValue={target.status} className="field">
            <option value="ACTIVE">启用</option>
            <option value="DISABLED">禁用</option>
          </select>
          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="btn">
              保存
            </button>
          </div>
        </form>
      </section>

      <section className="card section">
        <div className="card-head">
          <h2>应用授权</h2>
          <span className="muted" style={{ fontSize: 13 }}>可见性 + 数据范围</span>
        </div>
        <form action={saveUserPlatforms}>
          <input type="hidden" name="userId" value={target.id} />
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {platforms.map((p) => (
              <label
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "8px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                }}
              >
                <span>
                  {p.icon} {p.name}
                </span>
                <select name={`scope_${p.id}`} defaultValue={scopeOf(p.id)} className="field" style={{ width: 100 }}>
                  <option value="NONE">未授权</option>
                  <option value="SELF">仅本人</option>
                  <option value="ALL">全部数据</option>
                </select>
              </label>
            ))}
          </div>
          <button type="submit" className="btn" style={{ marginTop: 14 }}>
            保存授权
          </button>
        </form>
      </section>

      <section className="card section">
        <div className="card-head">
          <h2>通知渠道</h2>
          <Link href="/notify/channels" className="link" style={{ fontSize: 13 }}>应用参数 →</Link>
        </div>
        <form action={saveNotifyChannels} style={{ display: "grid", gap: 12, maxWidth: 560 }}>
          <input type="hidden" name="userId" value={target.id} />
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 72 }}>企业微信</span>
            <input
              name="ch_WECOM_target"
              defaultValue={channelTarget("WECOM")}
              placeholder="企微 userid（留空用用户资料的 wecomId）"
              className="field"
              style={{ flex: 1 }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
              <input type="checkbox" name="ch_WECOM_enabled" defaultChecked={channelOf("WECOM")?.enabled ?? false} />
              启用
            </label>
          </label>
          <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
            这里只填这个人的接收人 userid；发消息用的企业ID / 应用Secret / AgentId 是全站共用一份，
            在「通知渠道 → 企业微信应用」配置。
          </p>
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 72 }}>邮件</span>
            <input
              name="ch_MAIL_target"
              defaultValue={channelTarget("MAIL")}
              placeholder="收件邮箱（留空用用户资料的 email）"
              className="field"
              style={{ flex: 1 }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
              <input type="checkbox" name="ch_MAIL_enabled" defaultChecked={channelOf("MAIL")?.enabled ?? false} />
              启用
            </label>
          </label>
          <div>
            <button type="submit" className="btn">
              保存渠道
            </button>
          </div>
        </form>
      </section>

      <section className="card section">
        <div className="card-head">
          <h2>重置密码</h2>
        </div>
        <form action={resetPassword} style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <input type="hidden" name="id" value={target.id} />
          <input
            name="password"
            type="password"
            placeholder="新密码（≥8 位）"
            required
            className="field"
            style={{ maxWidth: 260 }}
          />
          <button type="submit" className="btn">
            重置
          </button>
        </form>
      </section>

      {target.id !== admin.id && (
        <form action={deleteUser}>
          <input type="hidden" name="id" value={target.id} />
          <button type="submit" className="btn ghost sm danger">
            删除该用户
          </button>
        </form>
      )}
    </div>
  );
}
