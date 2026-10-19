"use client";

import { useState } from "react";
import { removeAnniversaryAction } from "./mutate";

export function DeleteAnniversary({ id }: { id: number }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("删除这个纪念日？")) return;
        setPending(true);
        void removeAnniversaryAction(id);
      }}
    >
      {pending ? "删除中" : "删除"}
    </button>
  );
}
