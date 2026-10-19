import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppAccess } from "@/auth";
import { getProject } from "@/server";
import { DeleteProject } from "../../delete-button";
import { PhaseMeter } from "../../meter";
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

      <div className="card" style={{ marginBottom: 22 }}>
        <div className="work-meter">
          <div className="work-meter-legend">
            <span className="actual-key">实际 {item.progress}%</span>
            <span className="expected-key">预期 {item.expected == null ? "未排期" : `${item.expected}%`}</span>
          </div>
          <PhaseMeter phases={item.phases} />
        </div>
        <dl className="work-meta">
          <div>
            <dt>上线时间</dt>
            <dd>{item.launchLabel}</dd>
          </div>
          <div>
            <dt>负责人</dt>
            <dd>{item.ownerName}</dd>
          </div>
          <div>
            <dt>周期</dt>
            <dd>{item.dates}</dd>
          </div>
          <div>
            <dt>当前阶段</dt>
            <dd>
              {item.stageLabel}
              <span className="muted"> · {item.phaseDueLabel.split(" · ")[1] ?? ""}</span>
            </dd>
          </div>
          {item.description ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <dt>说明</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{item.description}</dd>
            </div>
          ) : null}
        </dl>
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
          当前走到 {item.stageLabel.split(" · ")[1] ?? ""}。点阶段改实际进度、日期和人员；负责人可直接在上面切当前阶段。
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
