"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import type { WorkPhaseKind } from "@nas/db";
import type { PhaseItemView, PhaseView } from "@/server";
import { PhasePercent } from "./meter";
import {
  addPhaseReworkAction,
  removePhaseItemMemberAction,
  removePhaseReworkAction,
  savePhaseAction,
  savePhaseItemMemberAction,
  savePhaseItemsAction,
} from "./mutate";

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
              className={`work-phase-row${item.kind === current ? " is-current" : ""}${item.enabled ? "" : " off"}`}
              onClick={() => setOpenId(item.id)}
              title={item.label}
            >
              <span className="work-phase-line work-phase-line-head">
                <span className="work-phase-name">
                  {item.label}
                  {item.kind === current ? <span className="work-phase-current">当前</span> : null}
                  {!item.enabled ? <span className="work-phase-current">未启用</span> : null}
                </span>
                <span className="work-phase-when">
                  {[
                    item.range || "未排期",
                    item.days != null ? `共 ${item.days} 天` : "天数未定",
                    item.devEnterLabel ? `研发进入 ${item.devEnterLabel}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <PhasePercent phase={item} />
                <span className="work-phase-edit" aria-hidden="true">
                  ›
                </span>
              </span>
              <span className="work-phase-line work-phase-line-items">
                <span className="phase-item-count">
                  事项{" "}
                  <b>
                    {item.itemDone}/{item.itemTotal}
                  </b>
                </span>
                <span className="phase-checks">
                  {item.items.map((answer) => (
                    <span
                      key={answer.id}
                      className={`phase-check is-${answer.status.toLowerCase()}${answer.rework ? " is-rework" : ""}`}
                      title={`${answer.name} · ${answer.statusLabel}${answer.rework && answer.span ? ` · ${answer.span}` : ""}${answer.rework && answer.devEnterLabel ? ` · 研发进入 ${answer.devEnterLabel}` : ""}${answer.trackProgress || answer.rework ? ` · ${answer.progress}%` : ""}`}
                    >
                      <i aria-hidden="true">
                        {answer.status === "DONE" ? "✓" : answer.status === "BLOCKED" ? "!" : answer.status === "DOING" ? "●" : "○"}
                      </i>
                      {answer.rework ? <em>新增</em> : null}
                      {answer.name}
                      {answer.trackProgress || answer.rework ? <b>{answer.progress}%</b> : null}
                    </span>
                  ))}
                </span>
                <span className="work-phase-people" title={names.join("、")}>
                  {names.length > 0 ? names.join("、") : "无人"}
                </span>
              </span>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsDevEnter = phase.kind === "SIT" || phase.kind === "UAT";
  const hasItems = phase.items.length > 0;

  useEffect(() => {
    setEnabled(phase.enabled);
  }, [phase.enabled]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
  }, []);

  async function run(action: () => Promise<{ message: string } | void>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result?.message) setError(result.message);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="work-dialog phase-dialog"
      aria-labelledby="phase-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="work-dialog-head phase-dialog-head">
        <div className="phase-dialog-head-main">
          <h2 id="phase-dialog-title" className="phase-dialog-title">
            {phase.label}
          </h2>
          <span className="muted phase-dialog-head-meta">
            {phase.range || "未排期"}
            {phase.devEnterLabel ? ` · 研发进入 ${phase.devEnterLabel}` : ""}
          </span>
        </div>
        <button type="button" className="phase-dialog-close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>
      {error ? <div className="notice">{error}</div> : null}

      <div className="phase-dialog-body">
        <section className="phase-col phase-col-settings">
          <h3 className="work-dialog-sub">阶段设置</h3>
          <div className="phase-stat-row">
            <div className="phase-stat">
              <span>实际进度</span>
              <b>{phase.progress}%</b>
            </div>
            <div className="phase-stat">
              <span>预期进度</span>
              <b>{phase.expected == null ? "—" : `${phase.expected}%`}</b>
            </div>
            <div className="phase-stat">
              <span>所需天数</span>
              <b>{phase.days == null ? "—" : `${phase.days} 天`}</b>
            </div>
          </div>
          {canManage ? (
            <form
              key={`${phase.startDate}|${phase.endDate}|${phase.devEnterDate}|${phase.enabled}`}
              className="form-stack phase-setting-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                form.set("enabled", enabled ? "1" : "0");
                void run(() => savePhaseAction(form));
              }}
            >
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="phaseId" value={phase.id} />
              <div className="phase-setting">
                <div className="phase-setting-label">排期</div>
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
                {phase.kind === "UAT" ? (
                  <p className="phase-hint-line">
                    这里记研发第一次进入的日子。后面的新增需求写在右边，每条自己排起始、结束和进入日。
                  </p>
                ) : null}
                <p className="phase-hint-line">
                  天数和预期按开始、结束日自动算（含首尾），填了日期才会出现预期。
                </p>
              </div>
              {!hasItems ? (
                <div className="phase-setting">
                  <div className="phase-setting-label">进度</div>
                  <label className="form-label">
                    实际进度 %
                    <input className="field" name="progress" type="number" min={0} max={100} step={1} defaultValue={phase.progress} />
                  </label>
                </div>
              ) : (
                <p className="phase-hint-line">
                  实际进度按事项自动算，当前 {phase.progress}%，研发实施 / SIT / UAT 的百分比在右边事项里填。
                </p>
              )}
              <label className="work-check">
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                这个项目使用该阶段
              </label>
              <button className="btn sm" type="submit" disabled={busy}>
                保存阶段
              </button>
            </form>
          ) : (
            <div className="muted phase-readonly">
              <p>
                {phase.range || "未排期"}
                {phase.devEnterLabel ? ` · 研发进入 ${phase.devEnterLabel}` : ""}
              </p>
            </div>
          )}
        </section>

        <section className="phase-col phase-col-items">
          <h3 className="work-dialog-sub">
            阶段事项
            <span className="muted phase-col-hint">{hasItems ? "勾选即保存" : "暂无事项"}</span>
          </h3>
          {canManage ? (
            <PhaseItemsForm
              key={`${phase.id}-${phase.items
                .map(
                  (item) =>
                    `${item.id}:${item.status}:${item.progress}:${item.trackProgress}:${item.rework}:${item.name}:${item.startDate}:${item.endDate}:${item.devEnterDate}:${item.members.map((member) => `${member.id}@${member.ratio}@${member.endDate}`).join(",")}`,
                )
                .join("|")}`}
              projectId={projectId}
              phase={phase}
              participants={participants}
              busy={busy}
              onSubmit={(form) => run(() => savePhaseItemsAction(form))}
              onCrew={(action) => run(action)}
            />
          ) : (
            <ItemList items={phase.items} />
          )}
        </section>
      </div>
    </dialog>
  );
}

function ItemList({ items }: { items: PhaseItemView[] }) {
  return (
    <div className="phase-item-list">
      {items.map((item) => (
        <div className={`phase-item-row${item.status === "DONE" ? " is-done" : ""}`} key={item.id}>
          <span className={`phase-item-mark is-${item.status.toLowerCase()}`} aria-hidden="true">
            {item.status === "DONE" ? "✓" : item.status === "BLOCKED" ? "!" : item.status === "DOING" ? "●" : ""}
          </span>
          <span className="phase-item-name">
            {item.rework ? <em className="phase-item-rework-tag">新增</em> : null}
            {item.link ? (
              <a href={item.link} target="_blank" rel="noreferrer" className="link">
                {item.name} ↗
              </a>
            ) : (
              item.name
            )}
          </span>
          <span className="phase-item-tools">
            {item.status === "DOING" || item.status === "BLOCKED" ? (
              <span className={`badge soft item-${item.status.toLowerCase()}`}>{item.statusLabel}</span>
            ) : null}
            {item.trackProgress || item.rework ? <span className="phase-item-pct">{item.progress}%</span> : null}
          </span>
          {item.rework ? (
            <span className="phase-item-rework-enter">
              {item.span || "未排期"}
              {item.devEnterLabel ? ` · 研发进入 ${item.devEnterLabel}` : ""}
            </span>
          ) : null}
          {item.note ? <span className="muted phase-item-note">{item.note}</span> : null}
          {item.members.length > 0 ? (
            <span className="phase-item-crew">
              {item.members.map((member) => (
                <span className="phase-item-crew-person" key={member.id}>
                  {member.name}
                  <b>{member.ratio}%</b>
                  {member.release ? <span className="muted">释放 {member.release}</span> : null}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PhaseItemsForm({
  projectId,
  phase,
  participants,
  busy,
  onSubmit,
  onCrew,
}: {
  projectId: number;
  phase: PhaseView;
  participants: string[];
  busy: boolean;
  onSubmit: (form: FormData) => void;
  onCrew: (action: () => Promise<{ message: string } | void>) => void;
}) {
  const [items, setItems] = useState(() => phase.items.map((item) => ({ ...item })));
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [linkOpen, setLinkOpen] = useState(
    () => new Set(phase.items.filter((item) => item.link).map((item) => item.id)),
  );
  // 百分比输入框保留正在输入的原样文本，避免清空时被强行补成 0。
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [addingRework, setAddingRework] = useState(false);

  function showsProgress(item: PhaseItemView) {
    return item.trackProgress || item.rework;
  }

  function submitRows(rows: PhaseItemView[]) {
    const form = new FormData();
    form.set("projectId", String(projectId));
    form.set("phaseId", String(phase.id));
    form.set(
      "items",
      JSON.stringify(
        rows.map((item) => ({
          id: item.id,
          name: item.name,
          status: item.status,
          progress: item.progress,
          trackProgress: item.trackProgress,
          startDate: item.startDate,
          endDate: item.endDate,
          devEnterDate: item.devEnterDate,
          link: item.link,
          note: item.note,
        })),
      ),
    );
    onSubmit(form);
  }

  function patch(id: number, next: Partial<PhaseItemView>, persist = false) {
    const rows = items.map((row) => (row.id === id ? { ...row, ...next } : row));
    setItems(rows);
    if (persist) submitRows(rows);
  }

  function toggleDone(item: PhaseItemView, done: boolean) {
    patch(item.id, done ? { status: "DONE", progress: 100 } : { status: "PENDING", progress: 0 }, true);
  }

  function toggleBlocked(item: PhaseItemView) {
    const blocked = item.status === "BLOCKED";
    const status = blocked
      ? showsProgress(item) && item.progress > 0
        ? "DOING"
        : "PENDING"
      : "BLOCKED";
    patch(item.id, { status }, true);
  }

  function statusForProgress(item: PhaseItemView, value: number): PhaseItemView["status"] {
    if (item.status === "DONE") return "DONE";
    if (item.status === "BLOCKED") return "BLOCKED";
    return value >= 100 ? "DONE" : value > 0 ? "DOING" : "PENDING";
  }

  function changeProgress(item: PhaseItemView, raw: string) {
    const clean = raw.replace(/\D/g, "").slice(0, 3).replace(/^0+(?=\d)/, "");
    const value = clean === "" ? 0 : Math.max(0, Math.min(100, Number(clean)));
    const nextDrafts = { ...draftsRef.current, [item.id]: clean };
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
    const rows = itemsRef.current.map((row) =>
      row.id === item.id ? { ...row, progress: value, status: statusForProgress(row, value) } : row,
    );
    itemsRef.current = rows;
    setItems(rows);
    // 到 100 会收起输入框，松手和失焦都接不到，这里直接存。
    if (value >= 100) submitRows(rows);
  }

  function commitProgress(item: PhaseItemView) {
    const raw = draftsRef.current[item.id];
    const current = itemsRef.current.find((row) => row.id === item.id);
    const value =
      raw === undefined
        ? (current?.progress ?? item.progress)
        : raw === ""
          ? 0
          : Math.max(0, Math.min(100, Number(raw)));
    const rows = itemsRef.current.map((row) =>
      row.id === item.id ? { ...row, progress: value, status: statusForProgress(row, value) } : row,
    );
    itemsRef.current = rows;
    setItems(rows);
    const nextDrafts = { ...draftsRef.current };
    delete nextDrafts[item.id];
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
    submitRows(rows);
  }

  function commitSlider(item: PhaseItemView, raw: string) {
    const value = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    const rows = itemsRef.current.map((row) =>
      row.id === item.id ? { ...row, progress: value, status: statusForProgress(row, value) } : row,
    );
    itemsRef.current = rows;
    setItems(rows);
    if (draftsRef.current[item.id] !== undefined) {
      const nextDrafts = { ...draftsRef.current };
      delete nextDrafts[item.id];
      draftsRef.current = nextDrafts;
      setDrafts(nextDrafts);
    }
    submitRows(rows);
  }

  return (
    <div className="form-stack">
      <div className="phase-item-edit-list">
        {items.map((item, index) => {
          const done = item.status === "DONE";
          const blocked = item.status === "BLOCKED";
          const doing = item.status === "DOING";
          const progress = showsProgress(item);
          const reworkHead = item.rework && !items[index - 1]?.rework;
          return (
            <Fragment key={item.id}>
            {reworkHead ? <div className="phase-rework-head">新增需求</div> : null}
            <div className={`phase-item-edit is-${item.status.toLowerCase()}${item.rework ? " is-rework" : ""}`}>
              <button
                type="button"
                className="phase-item-dot"
                role="checkbox"
                aria-checked={done}
                aria-label={`${done ? "取消完成" : "标记完成"}：${item.name}`}
                disabled={busy}
                title={done ? "点一下取消完成" : "点一下标记完成"}
                onClick={() => toggleDone(item, !done)}
              >
                {done ? "✓" : blocked ? "!" : doing ? "●" : ""}
              </button>
              {item.rework ? (
                <input
                  className="phase-item-rework-name"
                  value={item.name}
                  disabled={busy}
                  aria-label="需求名称"
                  onChange={(event) => patch(item.id, { name: event.target.value })}
                  onBlur={(event) => {
                    const next = event.relatedTarget;
                    if (next instanceof HTMLElement && next.classList.contains("phase-item-drop")) return;
                    const name = event.currentTarget.value.replace(/\s+/g, " ").trim();
                    const saved = phase.items.find((row) => row.id === item.id);
                    if (saved && saved.name === name) return;
                    const rows = itemsRef.current.map((row) => (row.id === item.id ? { ...row, name } : row));
                    setItems(rows);
                    submitRows(rows);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <span className="phase-item-name">{item.name}</span>
              )}
              <span className="phase-item-tools">
                {progress ? done ? (
                  <span className="phase-item-pct muted">{item.progress}%</span>
                ) : (
                  <span className="phase-item-progress">
                    <input
                      className="field"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={drafts[item.id] ?? item.progress}
                      disabled={busy}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => changeProgress(item, event.target.value)}
                      onBlur={(event) => {
                        if (!event.currentTarget.isConnected) return;
                        commitProgress(item);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <i aria-hidden="true">%</i>
                  </span>
                ) : null}
                {!done ? (
                  <button
                    type="button"
                    className={`phase-item-flag${blocked ? " is-on" : ""}`}
                    disabled={busy}
                    aria-pressed={blocked}
                    title={blocked ? "取消卡住" : "标记卡住"}
                    onClick={() => toggleBlocked(item)}
                  >
                    !
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`phase-item-link-toggle${item.link ? " has-link" : ""}`}
                  title={item.link ? "编辑链接" : "添加链接"}
                  onClick={() =>
                    setLinkOpen((current) => {
                      const next = new Set(current);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })
                  }
                >
                  ↗
                </button>
                {item.rework ? (
                  <button
                    type="button"
                    className="phase-item-drop"
                    disabled={busy}
                    onClick={() => void onCrew(() => removePhaseReworkAction(projectId, item.id))}
                  >
                    删除
                  </button>
                ) : null}
              </span>
              {item.rework ? (
                <div className="phase-item-rework-enter">
                  {(
                    [
                      ["startDate", "起始"],
                      ["endDate", "结束"],
                      ["devEnterDate", "研发进入"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        className="field"
                        type="date"
                        value={item[key]}
                        disabled={busy}
                        aria-label={`${item.name}的${label}`}
                        onChange={(event) => patch(item.id, { [key]: event.target.value })}
                        onBlur={(event) => {
                          if (!event.currentTarget.isConnected) return;
                          const next = event.relatedTarget;
                          if (next instanceof HTMLElement && next.classList.contains("phase-item-drop")) return;
                          const value = event.currentTarget.value;
                          const saved = phase.items.find((row) => row.id === item.id);
                          if (saved && saved[key] === value) return;
                          const rows = itemsRef.current.map((row) =>
                            row.id === item.id ? { ...row, [key]: value } : row,
                          );
                          itemsRef.current = rows;
                          setItems(rows);
                          submitRows(rows);
                        }}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
              {progress && !done ? (
                <input
                  className="phase-item-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                    value={drafts[item.id] === undefined || drafts[item.id] === "" ? item.progress : Number(drafts[item.id])}
                    style={{
                      ["--pct" as string]: `${drafts[item.id] === undefined || drafts[item.id] === "" ? item.progress : Number(drafts[item.id])}%`,
                    }}
                    disabled={busy}
                  aria-label={`${item.name}进度`}
                  onChange={(event) => changeProgress(item, event.target.value)}
                  onPointerUp={(event) => {
                    if (!event.currentTarget.isConnected) return;
                    commitSlider(item, event.currentTarget.value);
                  }}
                  onKeyUp={(event) => {
                    if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
                      commitSlider(item, event.currentTarget.value);
                    }
                  }}
                  onBlur={(event) => {
                    if (!event.currentTarget.isConnected) return;
                    commitSlider(item, event.currentTarget.value);
                  }}
                />
              ) : null}
              {linkOpen.has(item.id) ? (
                <input
                  className="field phase-item-link"
                  value={item.link}
                  placeholder="粘贴 ChangeList / Jira 链接（可选）"
                  onChange={(event) => patch(item.id, { link: event.target.value })}
                  onBlur={() => submitRows(items)}
                />
              ) : null}
              <ItemCrew
                projectId={projectId}
                item={item}
                suggestions={[...new Set([...participants, ...phase.members.map((member) => member.name)])]}
                busy={busy}
                onCrew={onCrew}
              />
            </div>
            </Fragment>
          );
        })}
      </div>
      {phase.kind === "UAT" ? (
        addingRework ? (
          <form
            className="phase-rework-add"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              form.set("projectId", String(projectId));
              form.set("phaseId", String(phase.id));
              void onCrew(() => addPhaseReworkAction(form));
            }}
          >
            <input className="field" name="name" placeholder="需求名称，例如导出对账" required disabled={busy} />
            <label>
              起始
              <input className="field" name="startDate" type="date" disabled={busy} />
            </label>
            <label>
              结束
              <input className="field" name="endDate" type="date" disabled={busy} />
            </label>
            <label>
              研发进入
              <input className="field" name="devEnterDate" type="date" disabled={busy} />
            </label>
            <button className="btn sm" type="submit" disabled={busy}>
              添加
            </button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setAddingRework(false)}>
              取消
            </button>
          </form>
        ) : (
          <button type="button" className="phase-rework-open" disabled={busy} onClick={() => setAddingRework(true)}>
            新增需求
          </button>
        )
      ) : null}
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        点圆点即完成。研发实施、SIT 测试、UAT 测试可以拖滑条，也可以直接填百分比。
        {phase.kind === "UAT"
          ? "新增需求填起始和结束后，进度按这段天数和 UAT 测试一起算进阶段实际进度。"
          : ""}
      </p>
    </div>
  );
}

function ItemCrew({
  projectId,
  item,
  suggestions,
  busy,
  onCrew,
}: {
  projectId: number;
  item: PhaseItemView;
  suggestions: string[];
  busy: boolean;
  onCrew: (action: () => Promise<{ message: string } | void>) => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const taken = new Set(item.members.map((member) => member.name));
  const options = suggestions.filter((name) => name && !taken.has(name));

  return (
    <div className="phase-item-crew">
      {item.members.map((member) => (
        <form
          className="phase-item-crew-person"
          key={member.id}
          onSubmit={(event) => {
            event.preventDefault();
            void onCrew(() => savePhaseItemMemberAction(new FormData(event.currentTarget)));
          }}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="name" value={member.name} />
          <span className="phase-item-crew-name">{member.name}</span>
          <label className="phase-item-crew-ratio">
            投入
            <input
              className="field"
              name="ratio"
              type="number"
              min={0}
              max={100}
              step={5}
              defaultValue={member.ratio}
              disabled={busy}
              aria-label={`${member.name}在${item.name}的投入百分比`}
              onBlur={(event) => {
                const form = event.currentTarget.form;
                if (!form || Number(event.currentTarget.value) === member.ratio) return;
                form.requestSubmit();
              }}
            />
            <i>%</i>
          </label>
          <label className="phase-item-crew-release">
            释放
            <input
              className="field"
              name="endDate"
              type="date"
              defaultValue={member.endDate}
              disabled={busy}
              aria-label={`${member.name}在${item.name}的预计释放`}
              onBlur={(event) => {
                const form = event.currentTarget.form;
                if (!form || event.currentTarget.value === member.endDate) return;
                form.requestSubmit();
              }}
            />
          </label>
          <button
            type="button"
            className="phase-item-crew-x"
            disabled={busy}
            aria-label={`把${member.name}移出${item.name}`}
            onClick={() => void onCrew(() => removePhaseItemMemberAction(projectId, member.id))}
          >
            ×
          </button>
        </form>
      ))}
      {adding ? (
        <form
          className="phase-item-crew-add"
          onSubmit={(event) => {
            event.preventDefault();
            void onCrew(() => savePhaseItemMemberAction(new FormData(event.currentTarget)));
          }}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="itemId" value={item.id} />
          <input className="field" name="name" list={`crew-${item.id}`} placeholder="姓名" required disabled={busy} />
          <datalist id={`crew-${item.id}`}>
            {options.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <label className="phase-item-crew-ratio">
            投入
            <input
              className="field"
              name="ratio"
              type="number"
              min={0}
              max={100}
              step={5}
              defaultValue={100}
              disabled={busy}
              aria-label="投入百分比"
            />
            <i>%</i>
          </label>
          <label className="phase-item-crew-release">
            释放
            <input className="field" name="endDate" type="date" disabled={busy} aria-label="预计释放" />
          </label>
          <button className="btn sm phase-item-join" type="submit" disabled={busy}>
            加入
          </button>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setAdding(false)}>
            取消
          </button>
        </form>
      ) : (
        <button type="button" className="phase-item-crew-open" disabled={busy} onClick={() => setAdding(true)}>
          加人
        </button>
      )}
    </div>
  );
}
