"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setProgressAction } from "./mutate";

export function ActualProgress({
  projectId,
  value,
  canEdit,
}: {
  projectId: number;
  value: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(String(value));
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) return <b>{value}%</b>;

  return (
    <form
      className="work-progress-edit"
      onSubmit={(event) => {
        event.preventDefault();
        const next = Number(progress);
        setError(null);
        void setProgressAction(projectId, next).then((result) => {
          if (result?.message) setError(result.message);
          else router.refresh();
        });
      }}
    >
      <input
        className="field sm"
        type="number"
        min={0}
        max={100}
        step={1}
        value={progress}
        aria-label="实际进度"
        onChange={(event) => setProgress(event.target.value)}
      />
      <span>%</span>
      <button className="btn ghost sm" type="submit">
        保存
      </button>
      {error ? <span className="muted">{error}</span> : null}
    </form>
  );
}
