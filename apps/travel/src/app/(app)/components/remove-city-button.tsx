"use client";

import { useTransition } from "react";
import { removeCityAction } from "../mutate";

export function RemoveCityButton({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="btn ghost"
      disabled={pending}
      onClick={() => {
        if (window.confirm("删除这个城市？")) startTransition(() => void removeCityAction(id));
      }}
    >
      {pending ? "…" : "删除"}
    </button>
  );
}
