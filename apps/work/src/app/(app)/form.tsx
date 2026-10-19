"use client";

import { useState } from "react";
import type { WorkPhaseKind, WorkPriority } from "@nas/db";
import { PHASE_OPTIONS, PRIORITY_OPTIONS } from "@/lib/labels";
import type { ProjectDraft } from "@/server";
import { saveProjectAction } from "./mutate";
import { PersonPicker } from "./person-picker";

export function ProjectForm({
  initial,
  memberNames,
  suggestions = [],
}: {
  initial: ProjectDraft;
  memberNames: string[];
  suggestions?: string[];
}) {
  const [phase, setPhase] = useState<WorkPhaseKind>(initial.phase);
  const [priority, setPriority] = useState<WorkPriority>(initial.priority);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(event.currentTarget);
    form.set("phase", phase);
    form.set("priority", priority);
    const result = await saveProjectAction(form);
    if (result?.message) {
      setError(result.message);
      setBusy(false);
    }
  }

  return (
    <form className="card form-stack" onSubmit={onSubmit}>
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="phase" value={phase} />
      <input type="hidden" name="priority" value={priority} />
      {error ? <div className="notice">{error}</div> : null}

      <label className="form-label">
        名字
        <input className="field" name="name" defaultValue={initial.name} maxLength={40} required placeholder="比如 门户改版" />
      </label>

      <div className="form-row">
        <label className="form-label">
          代号
          <input
            className="field"
            name="code"
            defaultValue={initial.code}
            maxLength={16}
            placeholder="比如 5iDHL / Wecom / OSSP"
            list="work-platforms"
          />
          <datalist id="work-platforms">
            <option value="5iDHL" />
            <option value="Wecom" />
            <option value="OSSP" />
          </datalist>
        </label>
        <label className="form-label">
          上线时间
          <input className="field" name="launchDate" type="date" defaultValue={initial.launchDate} />
        </label>
      </div>

      <div className="form-label">
        优先级
        <div className="choice-row">
          {PRIORITY_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={priority === item.value ? "choice active" : "choice"}
              onClick={() => setPriority(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-label">
        当前阶段
        <div className="choice-row">
          {PHASE_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={phase === item.value ? "choice active" : "choice"}
              onClick={() => setPhase(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-row">
        <label className="form-label">
          开始
          <input className="field" name="startDate" type="date" defaultValue={initial.startDate} />
        </label>
        <label className="form-label">
          结束
          <input className="field" name="endDate" type="date" defaultValue={initial.endDate} />
        </label>
      </div>

      <div className="form-label">
        参加人员
        <PersonPicker
          suggestions={suggestions}
          fieldName="memberNames"
          initial={memberNames}
          placeholder="直接填名字，回车或逗号分隔，可多个"
        />
        <span className="muted" style={{ fontSize: 12 }}>
          参建的人大多不在本系统，直接写名字就行。排阶段时从这批人里挑。
        </span>
      </div>

      <label className="form-label">
        说明
        <textarea className="field" name="description" defaultValue={initial.description} maxLength={500} placeholder="这个项目在做什么" />
      </label>

      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        每个阶段自己的实际进度，到项目页点开那个阶段再改。预期进度按阶段日期算。
      </p>

      <button className="btn" type="submit" disabled={busy}>
        {busy ? "保存中" : initial.id ? "保存修改" : "新建项目"}
      </button>
    </form>
  );
}
