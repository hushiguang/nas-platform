import Link from "next/link";
import { requireAppAccess } from "@/auth";
import { weeklyPlan, type WeeklyEntry } from "@/server";

export const dynamic = "force-dynamic";

function roleKind(role: string): "dev" | "qa" | null {
  if (role.includes("测试")) return "qa";
  if (/研发|开发|前端|后端/.test(role)) return "dev";
  return null;
}

/** 同一个人同一个项目这周可能跨多个阶段，按项目归一下，避免项目名重复出现。 */
function groupEntries(entries: WeeklyEntry[]) {
  const groups = new Map<number, { projectId: number; projectName: string; entries: WeeklyEntry[] }>();
  for (const entry of entries) {
    const group = groups.get(entry.projectId) ?? {
      projectId: entry.projectId,
      projectName: entry.projectName,
      entries: [],
    };
    group.entries.push(entry);
    groups.set(entry.projectId, group);
  }
  return [...groups.values()];
}

export default async function WeeklyPage() {
  const { user, access } = await requireAppAccess();
  const plan = await weeklyPlan(access, user);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">只统计研发 / 测试 · 按阶段排期和投入比例生成</span>
          <h1>周安排</h1>
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          上周做了什么 · 本周在做什么 · 下周要做什么
        </span>
      </div>

      <div className="weekly-grid">
        {plan.columns.map((column, index) => {
          const dev = column.people.filter((person) => person.roles.some((role) => roleKind(role) === "dev"));
          const qa = column.people.filter((person) => person.roles.some((role) => roleKind(role) === "qa"));
          const full = column.people.filter((person) => person.peak > 100);
          return (
            <section
              key={column.label}
              className={`card weekly-col${index === 1 ? " is-current" : ""}`}
            >
              <div className="weekly-col-head">
                <h2>{column.label}</h2>
                <span className="badge soft">{column.people.length} 人</span>
                <span className="weekly-count">
                  {column.from} ～ {column.to}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                研发 {dev.length} · 测试 {qa.length}
                {full.length > 0 ? (
                  <span style={{ color: "var(--coral)" }}> · {full.length} 人排满</span>
                ) : null}
              </div>

              {column.people.length === 0 ? (
                <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
                  这周没有研发 / 测试的排期。
                </p>
              ) : null}

              <div className="weekly-people">
                {column.people.map((person) => (
                  <article className="weekly-block" key={person.key}>
                    <div className="weekly-block-head">
                      <span className="weekly-person-name">{person.name}</span>
                      {person.roles.map((role) => (
                        <span key={role} className="badge soft">
                          {role}
                        </span>
                      ))}
                      <span
                        className={person.peak > 100 ? "badge warn" : "badge soft"}
                        title="按人员投入比例算：这一周平均每天占用 / 单日最高占用"
                      >
                        占用 {person.load}%
                        {person.peak > 100 ? ` · 峰值 ${person.peak}%` : ""}
                      </span>
                    </div>
                    <div className="weekly-entries">
                      {groupEntries(person.entries).map((group) => (
                        <div className="weekly-entry" key={group.projectId}>
                          <Link href={`/p/${group.projectId}`} className="weekly-entry-title">
                            {group.projectName}
                          </Link>
                          {group.entries.map((entry) => (
                            <span className="weekly-phase" key={entry.kind}>
                              <span className="muted">{entry.phaseLabel}</span>
                              {entry.items.length > 0 ? (
                                entry.items.map((item) => (
                                  <span key={item.name} className="weekly-item">
                                    {item.name} {item.progress}%
                                  </span>
                                ))
                              ) : (
                                <span className="muted">流程节点</span>
                              )}
                              <span className="weekly-ratio">投入 {entry.ratio}%</span>
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 24 }}>
        占用按每个阶段的人员投入比例逐日累加：同一周同时挂多个项目会叠加，超过 100% 说明这一周排满了。
        项目经理不参与统计。
      </p>
    </div>
  );
}
