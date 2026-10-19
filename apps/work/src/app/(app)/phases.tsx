"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { WorkPhaseKind } from "@nas/db";
import { MEMBER_ROLE_OPTIONS } from "@/lib/labels";
import type { PhaseView } from "@/server";
import { PhasePercent } from "./meter";
import { removePhaseMemberAction, savePhaseAction, savePhaseMembersAction } from "./mutate";
import { PersonPicker } from "./person-picker";

export function PhaseBoard({
  projectId,
  phases,
  canManage,
  current,
  participants,
}: {
  projectId: number;
  phases: PhaseView[];
  canManage: boolean;
  current: WorkPhaseKind;
  participants: string[];
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const phase = phases.find((item) => item.id === openId) ?? null;

  return (
    <>
      <div className="work-phase-rows">
        {phases.map((item) => {
          const names = item.members.map((member) => member.name);
          return (
            <button
              key={item.id}
              type="button"
              className={`work-phase-row${item.enabled ? "" : " off"}`}
              onClick={() => setOpenId(item.id)}
            >
              <span className="work-phase-name">
                <span className={item.kind === current ? "badge" : "badge soft"}>{item.label}</span>
              </span>
              <span className="work-phase-meta">
                {!item.enabled ? <span className="badge soft">未启用</span> : null}
                <span>{item.range || "未排期"}</span>
                {item.devEnterLabel ? <span>研发进入 {item.devEnterLabel}</span> : null}
                <span>{names.length > 0 ? names.join("、") : "无人"}</span>
              </span>
              <PhasePercent phase={item} />
              <span className="work-phase-edit">{canManage ? "编辑" : "查看"}</span>
            </button>
          );
        })}
      </div>
      {phase ? (
        <PhaseDialog
          key={phase.id}
          projectId={projectId}
          phase={phase}
          canManage={canManage}
          participants={participants}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}

function PhaseDialog({
  projectId,
  phase,
  canManage,
  participants,
  onClose,
}: {
  projectId: number;
  phase: PhaseView;
  canManage: boolean;
  participants: string[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [enabled, setEnabled] = useState(phase.enabled);
  const [memberKey, setMemberKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsDevEnter = phase.kind === "SIT" || phase.kind === "UAT";
  const taken = new Set(phase.members.map((member) => member.name));
  const available = participants.filter((name) => !taken.has(name));

  useEffect(() => {
    setEnabled(phase.enabled);
  }, [phase.enabled]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
  }, []);

  async function run(action: () => Promise<{ message: string } | void>, resetMember = false) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result?.message) setError(result.message);
      else {
        if (resetMember) setMemberKey((value) => value + 1);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="work-dialog"
      aria-labelledby="phase-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="work-dialog-head">
        <h2 id="phase-dialog-title">{phase.label}</h2>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          关闭
        </button>
      </div>
      {error ? <div className="notice">{error}</div> : null}

      {canManage ? (
        <form
          key={`${phase.progress}|${phase.startDate}|${phase.endDate}|${phase.devEnterDate}|${phase.enabled}`}
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            form.set("enabled", enabled ? "1" : "0");
            void run(() => savePhaseAction(form));
          }}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="phaseId" value={phase.id} />
          <label className="form-label">
            实际进度
            <input className="field" name="progress" type="number" min={0} max={100} step={1} defaultValue={phase.progress} />
          </label>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            预期 {phase.expected == null ? "未排期，填了日期才会出现" : `${phase.expected}%`}，按这个阶段的日期算，不能改。
          </p>
          <div className="form-row">
            <label className="form-label">
              开始
              <input className="field" name="startDate" type="date" defaultValue={phase.startDate} />
            </label>
            <label className="form-label">
              结束
              <input className="field" name="endDate" type="date" defaultValue={phase.endDate} />
            </label>
          </div>
          {needsDevEnter ? (
            <label className="form-label">
              研发进入
              <input className="field" name="devEnterDate" type="date" defaultValue={phase.devEnterDate} />
            </label>
          ) : null}
          <label className="work-check">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            这个项目使用该阶段
          </label>
          <button className="btn sm" type="submit" disabled={busy}>
            保存阶段
          </button>
        </form>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>
          {phase.range || "未排期"}
          {phase.devEnterLabel ? ` · 研发进入 ${phase.devEnterLabel}` : ""}
        </p>
      )}

      <h3 className="work-dialog-sub">人员</h3>
      <div className="work-list">
        {phase.members.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>这个阶段还没有人。</p> : null}
        {phase.members.map((member) => (
          <div className="work-row" key={member.id}>
            <div className="work-row-main">
              <div className="work-row-title">
                {member.name}
              </div>
              <div className="work-row-meta">
                {[member.role, member.span, member.release ? `预计释放 ${member.release}` : "释放时间未定"]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            {canManage ? (
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`把${member.name}移出这个阶段？`)) return;
                  void run(() => removePhaseMemberAction(projectId, member.id));
                }}
              >
                移出
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {canManage && enabled ? (
        <form
          key={memberKey}
          className="form-stack"
          style={{ marginTop: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(() => savePhaseMembersAction(form), true);
          }}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="phaseId" value={phase.id} />
          <div className="form-label">
            人员
            <PersonPicker
              suggestions={available}
              quickPick
              fieldName="names"
              placeholder="搜索预设人员，或直接写名字，回车添加"
              emptyHint="项目还没预设参加人员，直接在这里写名字也行"
            />
          </div>
          <div className="form-row">
            <label className="form-label">
              角色
              <select className="field" name="role" defaultValue="研发">
                {MEMBER_ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-label">
              预计释放
              <input className="field" name="endDate" type="date" />
            </label>
          </div>
          <button className="btn sm" type="submit" disabled={busy}>
            加入阶段
          </button>
        </form>
      ) : null}
    </dialog>
  );
}
