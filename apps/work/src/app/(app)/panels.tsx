"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ISSUE_KIND_OPTIONS, ISSUE_OPTIONS, NODE_OPTIONS } from "@/lib/labels";
import type { IssueView, MemberView, NodeView, PersonOption, PhaseView } from "@/server";
import {
  removeIssueAction,
  removeMemberAction,
  removeNodeAction,
  saveIssueAction,
  saveMemberAction,
  saveNodeAction,
  setIssueStatusAction,
  setNodeStatusAction,
} from "./mutate";

function nodeColor(status: NodeView["status"], days: number): string {
  if (status === "DONE") return "var(--mint)";
  if (status === "DELAYED" || days < 0) return "var(--coral)";
  if (days === 0) return "var(--orange)";
  return "var(--sky)";
}

function issueColor(status: IssueView["status"]): string {
  if (status === "RESOLVED") return "var(--mint)";
  if (status === "RESOLVING") return "var(--orange)";
  return "var(--coral)";
}

export function NodePanel({
  projectId,
  nodes,
  people,
}: {
  projectId: number;
  nodes: NodeView[];
  people: PersonOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<NodeView | null>(null);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ message: string } | void>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result?.message) {
        setError(result.message);
        return;
      }
      setEditing(null);
      setNonce((value) => value + 1);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error ? <div className="notice" style={{ marginBottom: 10 }}>{error}</div> : null}
      {nodes.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>还没有节点，先定一个计划日。</p> : null}
      <div className="work-list">
        {nodes.map((node) => (
          <div className="work-row" key={node.id}>
            <span className="todo-dot" style={{ background: nodeColor(node.status, node.days) }} />
            <div className="work-row-main">
              <div className="work-row-title">{node.name}</div>
              <div className="work-row-meta">
                {node.planLabel} · {node.when}
                {node.ownerName ? ` · ${node.ownerName}` : ""}
              </div>
            </div>
            <div className="work-actions">
              {node.status !== "DONE" ? (
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy}
                  onClick={() => void run(() => setNodeStatusAction(projectId, node.id, "DONE"))}
                >
                  完成
                </button>
              ) : (
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy}
                  onClick={() => void run(() => setNodeStatusAction(projectId, node.id, "PENDING"))}
                >
                  改回待完成
                </button>
              )}
              {node.status === "PENDING" ? (
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy}
                  onClick={() => void run(() => setNodeStatusAction(projectId, node.id, "DELAYED"))}
                >
                  标为延期
                </button>
              ) : null}
              {node.status === "DELAYED" && node.days >= 0 ? (
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy}
                  onClick={() => void run(() => setNodeStatusAction(projectId, node.id, "PENDING"))}
                >
                  改回待完成
                </button>
              ) : null}
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setEditing(node)}>
                修改
              </button>
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("删除这个节点？")) return;
                  void run(() => removeNodeAction(projectId, node.id));
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="work-split" />
      <NodeForm
        key={`${editing?.id ?? "new"}-${nonce}`}
        projectId={projectId}
        people={people}
        initial={editing}
        busy={busy}
        onSubmit={(form) => run(() => saveNodeAction(form))}
        onCancel={editing ? () => setEditing(null) : undefined}
      />
    </div>
  );
}

function NodeForm({
  projectId,
  people,
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  projectId: number;
  people: PersonOption[];
  initial: NodeView | null;
  busy: boolean;
  onSubmit: (form: FormData) => void;
  onCancel?: () => void;
}) {
  const [status, setStatus] = useState(initial?.status ?? "PENDING");
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        form.set("status", status);
        onSubmit(form);
      }}
    >
      <input type="hidden" name="projectId" value={projectId} />
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="status" value={status} />
      <div className="muted" style={{ fontSize: 12 }}>{initial ? "修改节点" : "加一个节点"}</div>
      <div className="form-row">
        <label className="form-label">
          名字
          <input className="field" name="name" defaultValue={initial?.name ?? ""} maxLength={40} required placeholder="比如 设计评审" />
        </label>
        <label className="form-label">
          计划日
          <input className="field" name="planDate" type="date" defaultValue={initial?.planDate ?? ""} required />
        </label>
      </div>
      <label className="form-label">
        谁来盯
        <select className="field" name="ownerId" defaultValue={initial?.ownerId ?? ""}>
          <option value="">未指定</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.nickname}
            </option>
          ))}
        </select>
      </label>
      <div className="choice-row">
        {NODE_OPTIONS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={status === item.value ? "choice active" : "choice"}
            onClick={() => setStatus(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="work-actions">
        <button className="btn sm" type="submit" disabled={busy}>
          {busy ? "保存中" : initial ? "保存节点" : "加上"}
        </button>
        {onCancel ? (
          <button className="btn ghost sm" type="button" onClick={onCancel}>
            取消
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function IssuePanel({
  projectId,
  issues,
  phases,
}: {
  projectId: number;
  issues: IssueView[];
  phases: PhaseView[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<IssueView | null>(null);
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openForm(issue: IssueView | null) {
    setError(null);
    setEditing(issue);
    setOpen(true);
  }

  async function run(action: () => Promise<{ message: string } | void>, closeForm = false) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result?.message) {
        setError(result.message);
        return;
      }
      if (closeForm) {
        setOpen(false);
        setEditing(null);
      }
      setNonce((value) => value + 1);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="work-issue-bar">
        <button type="button" className="btn sm" onClick={() => openForm(null)}>
          记问题
        </button>
      </div>
      {!open && error ? <div className="notice" style={{ marginBottom: 10 }}>{error}</div> : null}
      {issues.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>还没有卡住的问题。</p> : null}
      <div className="work-list">
        {issues.map((issue) => (
          <div className="work-row" key={issue.id}>
            <span className="todo-dot" style={{ background: issueColor(issue.status) }} />
            <div className="work-row-main">
              <div className="work-row-title">{issue.description}</div>
              <div className="work-row-meta">
                {issue.kindLabel} · {issue.statusLabel}
                {issue.phaseLabel ? ` · ${issue.phaseLabel}` : ""}
                {issue.handler ? ` · ${issue.handler}` : ""}
              </div>
              {issue.impact ? <div className="work-row-meta">影响 {issue.impact}</div> : null}
              {issue.solution ? <div className="work-row-meta">办法 {issue.solution}</div> : null}
            </div>
            <div className="work-actions">
              {issue.status === "OPEN" ? (
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy}
                  onClick={() => void run(() => setIssueStatusAction(projectId, issue.id, "RESOLVING"))}
                >
                  开始处理
                </button>
              ) : null}
              {issue.status !== "RESOLVED" ? (
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy}
                  onClick={() => void run(() => setIssueStatusAction(projectId, issue.id, "RESOLVED"))}
                >
                  已解决
                </button>
              ) : (
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy}
                  onClick={() => void run(() => setIssueStatusAction(projectId, issue.id, "OPEN"))}
                >
                  重新打开
                </button>
              )}
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => openForm(issue)}>
                修改
              </button>
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("删除这个问题？")) return;
                  void run(() => removeIssueAction(projectId, issue.id));
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {open ? (
        <IssueDialog
          key={`${editing?.id ?? "new"}-${nonce}`}
          projectId={projectId}
          phases={phases}
          initial={editing}
          busy={busy}
          error={error}
          onSubmit={(form) => run(() => saveIssueAction(form), true)}
          onClose={() => {
            setOpen(false);
            setEditing(null);
            setError(null);
          }}
        />
      ) : null}
    </div>
  );
}

function IssueDialog({
  projectId,
  phases,
  initial,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  projectId: number;
  phases: PhaseView[];
  initial: IssueView | null;
  busy: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="work-dialog"
      aria-labelledby="issue-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <div className="work-dialog-head">
        <h2 id="issue-dialog-title">{initial ? "修改问题" : "记问题"}</h2>
        <button type="button" className="btn ghost sm" onClick={() => dialogRef.current?.close()}>
          关闭
        </button>
      </div>
      {error ? <div className="notice" style={{ marginBottom: 10 }}>{error}</div> : null}
      <IssueForm
        projectId={projectId}
        phases={phases}
        initial={initial}
        busy={busy}
        onSubmit={onSubmit}
        onCancel={() => dialogRef.current?.close()}
      />
    </dialog>
  );
}

function IssueForm({
  projectId,
  phases,
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  projectId: number;
  phases: PhaseView[];
  initial: IssueView | null;
  busy: boolean;
  onSubmit: (form: FormData) => void;
  onCancel?: () => void;
}) {
  const [status, setStatus] = useState(initial?.status ?? "OPEN");
  const [kind, setKind] = useState(initial?.kind ?? "BUG");
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        form.set("status", status);
        form.set("kind", kind);
        onSubmit(form);
      }}
    >
      <input type="hidden" name="projectId" value={projectId} />
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="kind" value={kind} />
      <div className="choice-row">
        {ISSUE_KIND_OPTIONS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={kind === item.value ? "choice active" : "choice"}
            onClick={() => setKind(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <label className="form-label">
        问题
        <textarea className="field" name="description" defaultValue={initial?.description ?? ""} maxLength={200} required placeholder="卡在哪里" />
      </label>
      <div className="form-row">
        <label className="form-label">
          影响
          <input className="field" name="impact" defaultValue={initial?.impact ?? ""} maxLength={200} placeholder="会耽误什么" />
        </label>
        <label className="form-label">
          挂在节点
          <select className="field" name="phaseId" defaultValue={initial?.phaseId ?? ""}>
            <option value="">不挂</option>
            {phases.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="form-label">
        办法
        <textarea className="field" name="solution" defaultValue={initial?.solution ?? ""} maxLength={500} placeholder="准备怎么处理" />
      </label>
      <label className="form-label">
        谁来处理
        <input className="field" name="handler" defaultValue={initial?.handler ?? ""} maxLength={40} placeholder="写上名字" />
      </label>
      <div className="choice-row">
        {ISSUE_OPTIONS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={status === item.value ? "choice active" : "choice"}
            onClick={() => setStatus(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="work-actions">
        <button className="btn sm" type="submit" disabled={busy}>
          {busy ? "保存中" : initial ? "保存问题" : "记下"}
        </button>
        {onCancel ? (
          <button className="btn ghost sm" type="button" onClick={onCancel}>
            取消
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function MemberPanel({
  projectId,
  ownerId,
  ownerName,
  members,
  canManage,
}: {
  projectId: number;
  ownerId: number;
  ownerName: string;
  members: MemberView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const others = members.filter((member) => member.userId !== ownerId);

  async function run(action: () => Promise<{ message: string } | void>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result?.message) {
        setError(result.message);
        return;
      }
      setNonce((value) => value + 1);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error ? <div className="notice" style={{ marginBottom: 10 }}>{error}</div> : null}
      <div className="work-list">
        <div className="work-row">
          <div className="work-row-main">
            <div className="work-row-title">{ownerName}</div>
            <div className="work-row-meta">负责人</div>
          </div>
        </div>
        {others.map((member) => (
          <div className="work-row" key={member.id}>
            <div className="work-row-main">
              <div className="work-row-title">{member.nickname}</div>
              <div className="work-row-meta">
                {[member.userId ? null : "系统外", member.role, member.ratio !== 100 ? `投入 ${member.ratio}%` : ""]
                  .filter(Boolean)
                  .join(" · ") || "成员"}
              </div>
            </div>
            {canManage ? (
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("把这个人移出项目？")) return;
                  void run(() => removeMemberAction(projectId, member.id));
                }}
              >
                移出
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {canManage ? (
        <form
          key={nonce}
          className="form-stack"
          style={{ marginTop: 14 }}
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => saveMemberAction(new FormData(event.currentTarget)));
          }}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <div className="muted" style={{ fontSize: 12 }}>加一个人</div>
          <div className="form-row">
            <label className="form-label">
              谁
              <input className="field" name="name" maxLength={20} required placeholder="直接写名字" />
            </label>
            <label className="form-label">
              角色
              <input className="field" name="role" maxLength={20} placeholder="开发 / 设计" />
            </label>
          </div>
          <label className="form-label">
            投入比例
            <input className="field" name="ratio" type="number" min={0} max={100} step={1} defaultValue={100} />
          </label>
          <button className="btn sm" type="submit" disabled={busy}>
            {busy ? "保存中" : "加入"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
