import Link from "next/link";
import { requireAppAccess } from "@/auth";
import { listPersonSummary, type PersonSummary } from "@/server";
import { PersonTags } from "../stats-side";

export const dynamic = "force-dynamic";

function roleKind(role: string): "dev" | "qa" | null {
  if (role.includes("测试")) return "qa";
  if (role.includes("研发") || role.includes("开发") || role.includes("前端") || role.includes("后端")) return "dev";
  return null;
}

function dayDiff(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

function personTags(person: PersonSummary, today: string): string[] {
  const tags: string[] = [];
  if (person.conflict) tags.push("时间冲突");
  if (person.peakRatio > 100) tags.push(`峰值投入 ${person.peakRatio}%`);
  if (person.projects.length >= 4) tags.push(`多项目×${person.projects.length}`);
  if (person.projects.length > 0 && person.projects.every((p) => !p.from && !p.to)) tags.push("时间未定");
  const ends = person.projects.map((p) => p.to).filter(Boolean).sort();
  if (ends.length > 0) {
    const last = ends[ends.length - 1];
    const d = dayDiff(last, today);
    if (d >= 0 && d <= 7) tags.push("即将释放");
    if (d < 0) tags.push(`逾期 ${-d} 天`);
  }
  return tags;
}

export default async function PeoplePage() {
  const { user, access } = await requireAppAccess();
  const people = await listPersonSummary(access, user);
  const today = new Date().toISOString().slice(0, 10);
  const tagged = people.map((p) => ({ person: p, tags: personTags(p, today) }));
  const devCount = people.filter((p) => p.roles.some((r) => roleKind(r) === "dev")).length;
  const qaCount = people.filter((p) => p.roles.some((r) => roleKind(r) === "qa")).length;
  const conflictCount = tagged.filter((t) => t.tags.length > 0).length;
  const byLoad = [...tagged].sort((a, b) => b.person.projects.length - a.person.projects.length);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">占用与释放</span>
          <h1>人员汇总</h1>
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          研发 {devCount} 人 · 测试 {qaCount} 人
        </span>
      </div>

      {people.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontFamily: "Source Serif 4, serif", fontSize: 22 }}>还没有排人</div>
          <p className="muted" style={{ fontSize: 13 }}>
            到项目里的每个阶段加上人，系统里的和外部的都可以。
          </p>
        </div>
      ) : (
        <div className="work-layout">
          <div className="work-main">
            <div className="work-list" style={{ gap: 12 }}>
              {tagged.map(({ person, tags }) => {
                const kinds = new Set(person.roles.map(roleKind));
                return (
                  <div
                    key={person.key}
                    className="work-row"
                    style={
                      person.conflict
                        ? { borderLeft: "3px solid var(--coral)", alignItems: "flex-start", padding: "14px 18px" }
                        : { alignItems: "flex-start", padding: "14px 18px" }
                    }
                  >
                    <div className="work-row-main" style={{ gap: 8 }}>
                      <span className="work-row-title" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 15 }}>
                        {person.name}
                        {kinds.has("dev") ? <span className="badge soft">研发</span> : null}
                        {kinds.has("qa") ? <span className="badge soft">测试</span> : null}
                        {person.external ? <span className="badge soft">外部</span> : null}
                        <PersonTags tags={tags} />
                      </span>
                      <span style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                        {person.projects.map((project) => (
                          <Link
                            key={project.projectId}
                            href={`/p/${project.projectId}`}
                            title={`${project.projectName} · ${project.phases} · ${project.span} · 投入 ${project.ratio}% · 预计释放 ${project.release}`}
                            style={{
                              fontSize: 12.5,
                              padding: "5px 12px",
                              borderRadius: 999,
                              border: "1px solid var(--line)",
                              textDecoration: "none",
                              color: project.conflictWith.length > 0 ? "var(--coral)" : "inherit",
                              borderColor: project.conflictWith.length > 0 ? "var(--coral)" : undefined,
                              maxWidth: 220,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {project.projectName}
                            {project.ratio < 100 ? ` · ${project.ratio}%` : ""}
                          </Link>
                        ))}
                        <Link
                          href={`/board?view=person&person=${encodeURIComponent(person.key)}`}
                          style={{ fontSize: 12.5, padding: "5px 12px", color: "var(--coral)" }}
                        >
                          看排期 →
                        </Link>
                      </span>
                      <span className="work-row-meta" style={{ marginTop: 2 }}>
                        {person.roles.join(" / ")}
                        {person.roles.length > 0 ? " · " : ""}
                        {person.projects.map((p) => p.span).filter((s, i, a) => a.indexOf(s) === i).slice(0, 2).join("；")}
                        {person.peakRatio > 0 ? ` · 峰值投入 ${person.peakRatio}%` : ""}
                      </span>
                      <details className="person-plan">
                        <summary>时间规划（{person.projects.reduce((count, p) => count + p.segments.length, 0)} 段）</summary>
                        <div className="person-plan-list">
                          {person.projects.flatMap((project) =>
                            project.segments.length > 0
                              ? project.segments.map((segment) => (
                                  <div className="person-plan-row" key={`${project.projectId}-${segment.kind}`}>
                                    <span>
                                      {project.projectName} · {segment.label}
                                    </span>
                                    <span className="muted">
                                      {segment.from} ～ {segment.to}
                                    </span>
                                    <b>{segment.ratio}%</b>
                                  </div>
                                ))
                              : [
                                  <div className="person-plan-row" key={`${project.projectId}-none`}>
                                    <span>{project.projectName}</span>
                                    <span className="muted">时间未定</span>
                                    <b>{project.ratio}%</b>
                                  </div>,
                                ],
                          )}
                        </div>
                      </details>
                    </div>
                    <span style={{ textAlign: "right", flexShrink: 0, paddingTop: 2 }}>
                      <span style={{ fontFamily: "Source Serif 4, serif", fontSize: 26, fontWeight: 650 }}>
                        {person.projects.length}
                      </span>
                      <span className="muted" style={{ fontSize: 12, display: "block", marginTop: 2 }}>
                        个项目
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="work-side">
            <div className="card work-side-card">
              <div className="work-side-title">人员项目汇总</div>
              <div className="work-side-row">
                研发
                <b>{devCount}</b>
              </div>
              <div className="work-side-row">
                测试
                <b>{qaCount}</b>
              </div>
              <div className="work-side-row">
                有问题标记
                <b>{conflictCount}</b>
              </div>
              <div className="work-side-title" style={{ marginTop: 12 }}>
                按项目数排序
              </div>
              {byLoad.map(({ person, tags }) => (
                <div className="work-side-row" key={person.key}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {person.name}
                  </span>
                  {tags.length > 0 ? <span className="badge warn">{tags[0]}</span> : null}
                  <b>{person.projects.length}</b>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
