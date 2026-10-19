"use client";

import { useState } from "react";
import { removeProjectAction } from "./mutate";

export function DeleteProject({ id }: { id: number }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn ghost"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("删除这个项目？节点和问题会一起去掉。")) return;
          setPending(true);
          setError(null);
          void removeProjectAction(id).then((result) => {
            if (result?.message) {
              setPending(false);
              setError(result.message);
            }
          });
        }}
      >
        {pending ? "删除中" : "删除"}
      </button>
      {error ? <span className="muted">{error}</span> : null}
    </>
  );
}
