import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppAccess } from "@/auth";
import { getProject } from "@/server";
import { DeleteProject } from "../../delete-button";
import { PhaseSwitch } from "../../phase-switch";
import { PhaseBoard } from "../../phases";
import { IssuePanel } from "../../panels";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, access } = await requireAppAccess();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const item = await getProject(access, user.id, id);
  if (!item) notFound();

  return (
    <div>
      <Link href="/" className="link" style={{ display: "inline-block", marginBottom: 8 }}>
        全部项目
      </Link>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">
            {item.priorityLabel} · {item.phaseLabel}
            {item.code ? ` · ${item.code}` : ""}
          </span>
          <h1>{item.name}</h1>
        </div>
        {item.canManage ? (
          <div className="work-actions">
            <Link className="btn ghost" href={`/p/${item.id}/edit`}>
              修改
            </Link>
            <DeleteProject id={item.id} />
          </div>
        ) : null}
      </div>

      <div className="card work-overview" style={{ marginBottom: 22 }}>
        <div className="work-overview-stats">
          <div className="phase-stat">
            <span>实际进度</span>
            <b>{item.progress == null ? "—" : `${item.progress}%`}</b>
          </div>
          <div className="phase-stat">
            <span>预期进度</span>
            <b>{item.expected == null ? "—" : `${item.expected}%`}</b>
          </div>
          <div className="phase-stat">
            <span>阶段进度</span>
            <b>{item.stageTotal > 0 ? `${item.stageIndex}/${item.stageTotal}` : "—"}</b>
          </div>
          <div className={`phase-stat${item.phaseOverdue != null ? " is-late" : ""}`}>
            <span>{item.phaseOverdue != null ? "已逾期" : "当前阶段"}</span>
            <b>{item.phaseDueLabel.split(" · ")[1] || "—"}</b>
          </div>
        </div>
        <div className="work-overall">
          <div className="work-overall-track" aria-hidden="true">
            {item.expected != null ? <i className="expected" style={{ width: `${item.expected}%` }} /> : null}
            <i className="actual" style={{ width: `${item.progress ?? 0}%` }} />
          </div>
          <div className="work-meter-legend">
            <span className="actual-key">实际 {item.progress == null ? "—" : `${item.progress}%`}</span>
            <span className="expected-key">预期 {item.expected == null ? "未排期" : `${item.expected}%`}</span>
          </div>
          <p className="phase-hint-line">
            实际进度按「研发实施 / SIT测试 / UAT测试」填的百分比算，商务、筹备上线、上线阶段这些不计入。
          </p>
        </div>
        <div className="work-facts">
          <span>
            <i>上线</i>
            {item.launchLabel}
          </span>
          <span>
            <i>负责人</i>
            {item.ownerName}
          </span>
          <span>
            <i>周期</i>
            {item.dates}
          </span>
          <span>
            <i>阶段</i>
            {item.stageLabel}
          </span>
        </div>
        {item.description ? <p className="work-desc">{item.description}</p> : null}
        {item.showQuality ? (
          <div className="work-quality">
            <span className="stat">
              <b>{item.bug.total}</b>总bug
              <span>
                修复 {item.bug.fixed} / 剩余 {item.bug.remaining}
              </span>
            </span>
            <span className="stat">
              <b>{item.improvement.total}</b>总优化
              <span>
                修复 {item.improvement.fixed} / 剩余 {item.improvement.remaining}
              </span>
            </span>
          </div>
        ) : null}
      </div>

      <section className="section">
        <h2 className="section-title">阶段</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -8, marginBottom: 10 }}>
          当前走到 {item.stageLabel.split(" · ")[1] ?? ""}。点阶段改排期和事项；每个人的投入百分比和预计释放都挂在具体事项上。
        </p>
        <PhaseSwitch
          projectId={item.id}
          current={item.phase}
          phases={item.phases}
          canManage={item.canManage}
        />
        <PhaseBoard
          projectId={item.id}
          phases={item.phases}
          canManage={item.canManage}
          current={item.phase}
          participants={item.members.map((member) => member.nickname)}
        />
      </section>

      <section className="section">
        <h2 className="section-title">问题 · {item.openIssues}</h2>
        <div className="card">
          <IssuePanel projectId={item.id} issues={item.issues} phases={item.phases} />
        </div>
      </section>
    </div>
  );
}
