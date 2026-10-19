import Link from "next/link";
import { requireAppAccess } from "@/auth";
import { platformOf } from "@/lib/platform";
import { listProjects } from "@/server";
import { ProjectCard } from "./card";
import { ImportButton } from "./import-button";
import { PRI_DOT, PRI_ORDER } from "./pri-style";
import { WorkStatsSide } from "./stats-side";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ pri?: string; src?: string; plat?: string }>;
}) {
  const { user, access } = await requireAppAccess();
  const { pri, src, plat } = await searchParams;
  const all = await listProjects(access, user.id);
  const items = all.filter(
    (item) =>
      (!pri || item.priority === pri) &&
      (!src || (item.code || "未分组") === src) &&
      (!plat || platformOf(item.name) === plat),
  );
  const live = items.filter((item) => item.phase === "LIVE");
  const active = items.filter((item) => item.phase !== "LIVE");

  const priStats = PRI_ORDER.map((key) => ({
    key,
    label: all.find((i) => i.priority === key)?.priorityLabel ?? key,
    count: all.filter((i) => i.priority === key).length,
  }));
  const srcMap = new Map<string, { count: number; delayed: number }>();
  for (const item of all) {
    const code = item.code || "未分组";
    const cur = srcMap.get(code) ?? { count: 0, delayed: 0 };
    cur.count += 1;
    if (item.delayed > 0) cur.delayed += 1;
    srcMap.set(code, cur);
  }
  const srcStats = [...srcMap.entries()]
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.count - a.count);

  const platMap = new Map<string, { count: number; delayed: number }>();
  for (const item of all) {
    const key = platformOf(item.name);
    const cur = platMap.get(key) ?? { count: 0, delayed: 0 };
    cur.count += 1;
    if (item.delayed > 0) cur.delayed += 1;
    platMap.set(key, cur);
  }
  const platformStats = [...platMap.entries()]
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.count - a.count);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">阶段、进度与人员</span>
          <h1>项目管理</h1>
        </div>
        <div className="work-actions">
          <ImportButton />
          <a className="btn ghost" href="/api/export" download>
            导出 Excel
          </a>
          <Link href="/new" className="btn">
            新建项目
          </Link>
        </div>
      </div>

      <div className="work-layout">
        <div className="work-main">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <Link
              href="/"
              className={`badge${!pri ? "" : " soft"}`}
              style={!pri ? undefined : { textDecoration: "none" }}
            >
              全部 {all.length}
            </Link>
            {priStats.map((p) => (
              <Link
                key={p.key}
                href={pri === p.key ? "/" : `/?pri=${p.key}`}
                className={`badge${pri === p.key ? "" : " soft"}`}
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 999, background: PRI_DOT[p.key] }} />
                {p.label} {p.count}
              </Link>
            ))}
          </div>

          {items.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: 48 }}>
              <div style={{ fontFamily: "Source Serif 4, serif", fontSize: 22 }}>没有符合的项目</div>
              <p className="muted" style={{ fontSize: 13 }}>
                <Link href="/">清除筛选</Link> 看全部项目。
              </p>
            </div>
          ) : (
            <>
              <div className="work-grid work-grid-row">
                {active.map((item) => (
                  <ProjectCard key={item.id} item={item} />
                ))}
              </div>
              {live.length > 0 ? (
                <section className="section">
                  <h2 className="section-title">已上线 · {live.length}</h2>
                  <div className="work-grid work-grid-row">
                    {live.map((item) => (
                      <ProjectCard key={item.id} item={item} />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>

        <WorkStatsSide basePath="/" pris={priStats} sources={srcStats} platforms={platformStats} activePri={pri} activeSource={src} activePlatform={plat} />
      </div>
    </div>
  );
}
