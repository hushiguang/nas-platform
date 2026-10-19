import Link from "next/link";
import type { ProjectView } from "@/server";
import { PRI_DOT, PRI_TOP } from "./pri-style";

export function ProjectCard({ item }: { item: ProjectView }) {
  const crew = [
    ...new Set(
      item.phases.flatMap((phase) => phase.members.map((member) => member.name)).filter((name) => name !== item.ownerName),
    ),
  ];
  const shown = crew.slice(0, 4);
  const extra = crew.length - shown.length;
  const bugLeft = item.bug.remaining + item.improvement.remaining;

  return (
    <article className="work-card work-card-row" style={{ padding: 0, gap: 0, minHeight: 0, overflow: "hidden" }}>
      <div aria-hidden="true" style={{ height: 4, background: PRI_TOP[item.priority] ?? "var(--line)" }} />
      <div className="work-card-row-body">
        <div className="work-card-row-main">
          <div className="work-card-top">
            <span
              aria-hidden="true"
              style={{ width: 8, height: 8, borderRadius: 999, background: PRI_DOT[item.priority] ?? "var(--muted)" }}
            />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{item.priorityLabel}</span>
            {item.code ? (
              <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
                {item.code}
              </span>
            ) : null}
          </div>

          <h3 className="work-name">
            <Link href={`/p/${item.id}`} style={{ position: "relative", zIndex: 2 }}>
              {item.name}
            </Link>
          </h3>

          <div className="muted" style={{ fontSize: 12.5 }}>
            {item.stageLabel} · {item.ownerName} · {item.launchLabel}上线
          </div>

          {shown.length > 0 ? (
            <div className="muted work-card-row-crew">
              {shown.join("、")}
              {extra > 0 ? ` 等 ${crew.length} 人` : ""}
            </div>
          ) : null}
        </div>

        <div className="work-card-row-side">
          <div className="work-bar lg" aria-hidden="true" style={{ position: "relative", height: 6 }}>
            <span style={{ width: `${item.progress}%` }} />
            {item.expected != null ? (
              <span
                style={{
                  position: "absolute",
                  left: `${item.expected}%`,
                  top: -3,
                  width: 2,
                  height: 12,
                  borderRadius: 2,
                  background: "var(--ink)",
                  opacity: 0.55,
                }}
              />
            ) : null}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            实际 {item.progress}%{item.expected == null ? " · 未排期" : ` · 预期 ${item.expected}%`}
          </div>
          <div
            className="muted work-card-row-stats"
            style={{
              borderTop: "1px solid var(--line)",
              paddingTop: 10,
              fontSize: 12.5,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>阶段 {item.stageTotal > 0 ? `${item.stageIndex}/${item.stageTotal}` : "—"}</span>
            {bugLeft > 0 ? <span>待修 {bugLeft}</span> : null}
            <span style={{ marginLeft: "auto", color: item.phaseOverdue != null ? "var(--coral)" : undefined }}>
              {item.phaseDueLabel}
            </span>
          </div>
        </div>
      </div>
      <Link className="work-hit" href={`/p/${item.id}`} aria-label={item.name} />
    </article>
  );
}