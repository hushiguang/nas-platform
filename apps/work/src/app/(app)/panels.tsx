"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useImagePaste } from "@nas/ui";
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

function proxyUrl(url: string): string {
  return `/api/media/image?u=${encodeURIComponent(url)}`;
}

/** 逐张上传，遇到失败就停下，已传好的保留给用户继续用。 */
async function uploadImages(files: File[]): Promise<{ urls: string[]; message?: string }> {
  const urls: string[] = [];
  for (const file of files) {
    const body = new FormData();
    body.set("image", file);
    try {
      const res = await fetch("/api/media/upload", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!res.ok || !json.url) return { urls, message: json.message || "上传失败" };
      urls.push(json.url);
    } catch {
      return { urls, message: "上传失败，检查网络后重试" };
    }
  }
  return { urls };
}

const IMAGE_LIMIT = 9;

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
  const [quickBusy, setQuickBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const quickRef = useRef<HTMLInputElement>(null);

  // 大图 Esc 关闭；捕获阶段掐断传播，避免把同页的编辑弹窗一起关掉
  useEffect(() => {
    if (!lightbox) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setLightbox(null);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [lightbox]);

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

  async function quickUpload(files: File[]) {
    if (!files.length) return;
    setError(null);
    setQuickBusy(true);
    try {
      const { urls, message } = await uploadImages(files.slice(0, IMAGE_LIMIT));
      if (message) {
        setError(message);
        if (!urls.length) return;
      }
      const form = new FormData();
      form.set("projectId", String(projectId));
      form.set("description", "");
      form.set("images", JSON.stringify(urls));
      const result = await saveIssueAction(form);
      if (result?.message) {
        setError(result.message);
        return;
      }
      router.refresh();
    } finally {
      setQuickBusy(false);
      if (quickRef.current) quickRef.current.value = "";
    }
  }

  /** 一键读取剪贴板里的截图，不用先打开记问题弹窗。 */
  async function pasteFromClipboard() {
    if (!navigator.clipboard?.read) {
      setError("当前浏览器不支持直接读剪贴板，请在「记问题」弹窗里按 ⌘/Ctrl+V 粘贴");
      return;
    }
    setError(null);
    setQuickBusy(true);
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        for (const type of item.types) {
          if (!type.startsWith("image/")) continue;
          const blob = await item.getType(type);
          const ext = type.split("/")[1] || "png";
          files.push(new File([blob], `clipboard-${Date.now()}.${ext}`, { type }));
        }
      }
      if (!files.length) {
        setError("剪贴板里没有图片");
        return;
      }
      await quickUpload(files);
    } catch {
      setError("读取剪贴板失败，请在「记问题」弹窗里直接粘贴");
    } finally {
      setQuickBusy(false);
    }
  }

  return (
    <div>
      <div className="work-issue-bar">
        <input
          ref={quickRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => void quickUpload([...(event.currentTarget.files ?? [])])}
        />
        <button
          type="button"
          className="btn ghost sm"
          disabled={quickBusy || busy}
          onClick={() => void pasteFromClipboard()}
        >
          粘贴截图
        </button>
        <button
          type="button"
          className="btn ghost sm"
          disabled={quickBusy || busy}
          onClick={() => quickRef.current?.click()}
        >
          {quickBusy ? "上传中…" : "只传图"}
        </button>
        <button type="button" className="btn sm" onClick={() => openForm(null)}>
          记问题
        </button>
      </div>
      {!open && error ? <div className="notice" style={{ marginBottom: 10 }}>{error}</div> : null}
      {issues.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>还没有卡住的问题。</p> : null}

      <div className="work-timeline">
        {issues.map((issue) => (
          <article className="work-timeline-item" key={issue.id}>
            <span className="work-timeline-dot" style={{ background: issueColor(issue.status) }} />
            <div className="work-timeline-card">
              <div className="work-timeline-main">
                <div className="work-timeline-top">
                  <time className="work-timeline-time" dateTime={issue.createdAt} title={issue.createdLabel}>
                    {issue.createdLabel}
                  </time>
                  <span className={issue.status === "RESOLVED" ? "badge soft" : "badge"}>{issue.statusLabel}</span>
                  <span className="badge soft">{issue.kindLabel}</span>
                </div>
                {issue.description ? <div className="work-timeline-title">{issue.description}</div> : null}
                {issue.phaseLabel || issue.handler ? (
                  <div className="work-timeline-meta">
                    {[issue.phaseLabel, issue.handler].filter(Boolean).join(" · ")}
                  </div>
                ) : null}
                {issue.impact ? <div className="work-timeline-meta">影响 {issue.impact}</div> : null}
                {issue.solution ? <div className="work-timeline-meta">办法 {issue.solution}</div> : null}

                {issue.images.length > 0 ? (
                  <div className="work-timeline-images">
                    {issue.images.map((url, index) => (
                      <button
                        key={`${issue.id}-${index}`}
                        type="button"
                        className="work-timeline-thumb"
                        onClick={() => setLightbox(url)}
                        aria-label={`查看第 ${index + 1} 张截图`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={proxyUrl(url)} alt={`问题截图 ${index + 1}`} loading="lazy" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="work-timeline-actions">
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
          </article>
        ))}
      </div>

      {lightbox ? (
        <div className="work-lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          {/* 点大图本身也直接关闭（与待办应用的灯箱保持一致） */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={proxyUrl(lightbox)} alt="问题截图" />
          <button type="button" className="btn ghost sm" onClick={() => setLightbox(null)}>
            关闭
          </button>
        </div>
      ) : null}

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
  const [images, setImages] = useState<string[]>(initial?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addImages(files: File[]) {
    if (!files.length || uploading) return;
    const slots = IMAGE_LIMIT - images.length;
    if (slots <= 0) {
      setUploadError(`最多 ${IMAGE_LIMIT} 张图`);
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const { urls, message } = await uploadImages(files.slice(0, slots));
      if (message) setUploadError(message);
      if (urls.length) setImages((rows) => [...rows, ...urls].slice(0, IMAGE_LIMIT));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  useImagePaste((files) => void addImages(files));

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
    if (!files.length) {
      setUploadError("只能拖入图片文件");
      return;
    }
    void addImages(files);
  }

  return (
    <form
      className="form-stack"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        form.set("status", status);
        form.set("kind", kind);
        form.set("images", JSON.stringify(images));
        onSubmit(form);
      }}
    >
      <input type="hidden" name="projectId" value={projectId} />
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="images" value={JSON.stringify(images)} />
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
        <textarea
          className="field"
          name="description"
          defaultValue={initial?.description ?? ""}
          maxLength={200}
          placeholder="不写文字也可以，传张图就行"
        />
      </label>

      <div className="form-label">
        截图
        <div
          className={dragging ? "issue-images is-dragging" : "issue-images"}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {images.map((url, index) => (
            <span className="issue-image" key={`${url}-${index}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={proxyUrl(url)} alt={`截图 ${index + 1}`} />
              <button
                type="button"
                className="issue-image-x"
                aria-label="移除这张图"
                onClick={() => setImages((rows) => rows.filter((_, at) => at !== index))}
              >
                ×
              </button>
            </span>
          ))}
          {images.length < IMAGE_LIMIT ? (
            <button
              type="button"
              className="issue-image-add"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "上传中…" : "+ 图片"}
            </button>
          ) : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => void addImages([...(event.currentTarget.files ?? [])])}
        />
        {uploadError ? <span className="notice">{uploadError}</span> : null}
        <span className="muted" style={{ fontSize: 12 }}>
          最多 {IMAGE_LIMIT} 张，可以只传图不写文字；支持粘贴截图（⌘/Ctrl+V）或拖入图片。
        </span>
      </div>

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
        <button className="btn sm" type="submit" disabled={busy || uploading}>
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
