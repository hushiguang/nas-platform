import { requireUser } from "@/modules/core/auth/session";
import { prisma } from "@/lib/prisma";
import { createPlatform, updatePlatform, deletePlatform } from "@/modules/core/rbac/actions";

function groupBy<T>(list: T[], key: (item: T) => string | null): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of list) {
    const g = key(item) ?? "未分组";
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(item);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

type Platform = Awaited<ReturnType<typeof prisma.platform.findMany<{
  orderBy: { sort: "asc" }[];
  include: { _count: { select: { users: true } } };
}>>>[number];

// 应用注册表管理（仅管理员）：卡片式紧凑编辑。
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
  const groups = groupBy(platforms, (p) => p.group);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">管理员</span>
          <h1>应用管理</h1>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
        这里注册的应用会出现在首页卡片网格里。独立应用填 URL 并勾选「外部」；nas-platform 内部模块不填 URL，走内部路由。
      </p>

      {error && <div className="notice" style={{ marginBottom: 16 }}>{error}</div>}
      {ok && <div className="notice ok" style={{ marginBottom: 16 }}>{ok}</div>}

      <section className="card section">
        <div className="card-head">
          <h2>新增应用</h2>
        </div>
        <form
          action={createPlatform}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <input name="code" placeholder="标识（如 ledger）" required className="field" />
            <input name="name" placeholder="名称（如 家庭记账）" required className="field" />
            <input name="icon" placeholder="图标 emoji（如 💰）" defaultValue="🧩" className="field" />
            <input name="group" placeholder="分组（如 财务）" className="field" />
            <input name="sort" type="number" placeholder="排序" defaultValue={99} className="field" />
            <input name="url" placeholder="外部链接（如 http://100.112.52.24:8080）" className="field" />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <input name="description" placeholder="描述" className="field" style={{ flex: 1, minWidth: 220 }} />
            <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, whiteSpace: "nowrap" }}>
              <input type="checkbox" name="isExternal" defaultChecked />
              外部独立应用
            </label>
            <button type="submit" className="btn">
              新增
            </button>
          </div>
        </form>
      </section>

      <section className="card section">
        <div className="card-head">
          <h2>应用列表</h2>
          <span className="badge soft">{platforms.length} 个</span>
        </div>

        {groups.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>还没有应用，点击上方「新增」创建。</p>
        ) : (
          groups.map(([group, items]) => (
            <div key={group} style={{ marginBottom: 18 }}>
              <div className="section-title">{group}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {items.map((p) => (
                  <PlatformRow key={p.id} platform={p} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function PlatformRow({ platform: p }: { platform: Platform }) {
  const formId = `update-p-${p.id}`;
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 12 }}>
      <form id={formId} action={updatePlatform}>
        <input type="hidden" name="id" value={p.id} />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <input name="icon" defaultValue={p.icon} className="field sm" style={{ width: 38, textAlign: "center" }} />
            <input name="name" defaultValue={p.name} className="field sm" style={{ width: 120 }} />
            <input name="group" defaultValue={p.group ?? ""} placeholder="分组" className="field sm" style={{ width: 90 }} />
            <input name="sort" type="number" defaultValue={p.sort} className="field sm" style={{ width: 60 }} />
            <span className="badge soft">已授权 {p._count.users} 人</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <input name="url" defaultValue={p.url ?? ""} placeholder={p.isExternal ? "外部链接" : "外部链接（不填则走内部路由）"} className="field sm" style={{ flex: 1, minWidth: 220 }} />
            <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, whiteSpace: "nowrap" }}>
              <input type="checkbox" name="isExternal" defaultChecked={p.isExternal} />
              外部
            </label>
            <input name="description" defaultValue={p.description ?? ""} placeholder="描述" className="field sm" style={{ flex: 1.5, minWidth: 220 }} />
          </div>
        </div>
      </form>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <button type="submit" form={formId} className="btn sm">
          保存
        </button>
        <DeleteButton id={p.id} />
      </div>
    </div>
  );
}

function DeleteButton({ id }: { id: number }) {
  return (
    <form action={deletePlatform} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="ghost" style={{ color: "var(--coral)" }}>
        删除
      </button>
    </form>
  );
}
