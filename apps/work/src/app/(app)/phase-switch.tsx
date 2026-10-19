"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WorkPhaseKind } from "@nas/db";
import { PHASE_OPTIONS } from "@/lib/labels";
import type { PhaseView } from "@/server";
import { setCurrentPhaseAction } from "./mutate";

/**
 * 项目详情页顶部的当前阶段切换。一行六个阶段，点一下就切。
 * 未启用的阶段不能切，会提示先去阶段明细里启用。
 */
export function PhaseSwitch({
  projectId,
  current,
  phases,
  canManage,
}: {
  projectId: number;
  current: WorkPhaseKind;
  phases: Pick<PhaseView, "kind" | "enabled" | "label">[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const known = new Map(phases.map((phase) => [phase.kind, phase]));

  async function pick(kind: WorkPhaseKind) {
    if (busy) return;
    const phase = known.get(kind);
    if (!phase) {
      setError("这个阶段还没建");
      return;
    }
    if (!phase.enabled) {
      setError(`${phase.label}没启用，先在下面阶段清单里勾上「这个项目使用该阶段」`);
      return;
    }
    if (!window.confirm(`把当前阶段切到「${phase.label}」？`)) return;
    setBusy(kind);
    setError(null);
    try {
      const result = await setCurrentPhaseAction(projectId, kind);
      if (result?.message) {
        setError(result.message);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!canManage) return null;

  return (
    <div className="phase-switch">
      <div className="phase-switch-row">
        {PHASE_OPTIONS.map((option) => {
          const active = option.value === current;
          const phase = known.get(option.value);
          const off = phase ? !phase.enabled : false;
          const loading = busy === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`phase-switch-btn${active ? " on" : ""}${off ? " off" : ""}`}
              disabled={busy != null}
              onClick={() => void pick(option.value)}
              title={off ? "未启用，点开阶段明细启用后才能切" : undefined}
            >
              {loading ? "切换中…" : option.label}
            </button>
          );
        })}
      </div>
      {error ? (
        <div className="notice" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}