import Link from "next/link";
import type { ProjectView } from "@/server";
import { PRI_TOP } from "./pri-style";

/** 卡片只需要项目概览，节点 / 问题 / 草稿不进列表的序列化数据 */
export type ProjectCardItem = Omit<ProjectView, "nodes" | "issues" | "draft">;

/**
 * 项目列表行：优先级用行首色条表达一次，名称 / 阶段 / 进度 / 到期横向铺开，
 * 一屏能扫十几个项目。
 */
export function ProjectCard({ item }: { item: ProjectCardItem }) {
  const crew = [
    ...new Set(
      item.phases.flatMap((phase) => phase.members.map((member) => member.name)).filter((name) => name !== item.ownerName),
    ),
  ];
  const shown = crew.slice(0, 4);
  const extra = crew.length - shown.length;
  const bugLeft = item.bug.remaining + item.improvement.remaining;
  const stripped = item.phaseDueLabel.replace(`${item.phaseLabel} · `, "");
  const due = item.phase === "LIVE" || stripped === item.phaseLabel ? "" : stripped;
  const late = item.phaseOverdue != null;
  const launch = item.launchLabel === "未定" ? "上线时间未定" : `${item.launchLabel}上线`;

  return (
    <article className="work-line" style={{ boxShadow: `inset 3px 0 0 ${PRI_TOP[item.priority] ?? "var(--line)"}` }}>
      <div className="work-line-main">
        <h3 className="work-line-name">
          {late ? (
            <span className="work-line-alert" title={due} aria-label="已逾期">
              ⚠
            </span>
          ) : null}
          <Link href={`/p/${item.id}`}>{item.name}</Link>
          {item.code ? <span className="work-line-code">{item.code}</span> : null}
        </h3>
        <p className="work-line-sub">
          {item.ownerName}
          {shown.length > 0 ? ` · ${shown.join("、")}${extra > 0 ? ` 等 ${crew.length} 人` : ""}` : ""}
        </p>
        <span className="badge soft work-line-phase-m">{item.phaseLabel}</span>
      </div>

      <div className="work-line-phase">
        <span className="badge soft">{item.phaseLabel}</span>
        {item.stageNodeLabel ? <span className="work-line-node">{item.stageNodeLabel}</span> : null}
      </div>

      <div className="work-line-progress">
        <div className="work-progress-row">
          <span className="work-progress-label">研发</span>
          <span className="work-progress-track" aria-hidden="true">
            <i className="dev" style={{ width: `${item.devProgress ?? 0}%` }} />
          </span>
          <b>{item.devProgress == null ? "—" : `${item.devProgress}%`}</b>
        </div>
        <div className="work-progress-row">
          <span className="work-progress-label">测试</span>
          <span className="work-progress-track" aria-hidden="true">
            <i className="qa" style={{ width: `${item.testProgress ?? 0}%` }} />
          </span>
          <b>{item.testProgress == null ? "—" : `${item.testProgress}%`}</b>
        </div>
      </div>

      <div className="work-line-stats">
        <span>阶段 {item.stageTotal > 0 ? `${item.stageIndex}/${item.stageTotal}` : "—"}</span>
        {bugLeft > 0 ? <span>待修 {bugLeft}</span> : null}
      </div>

      <div className="work-line-due">
        <b>{launch}</b>
        <span className={late ? "work-line-late" : undefined}>{due}</span>
      </div>

      <Link className="work-hit" href={`/p/${item.id}`} aria-label={item.name} />
    </article>
  );
}
