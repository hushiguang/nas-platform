"use client";

import { useState } from "react";

/** 行内删除：confirm 确认后走 Server Action */
export function DeleteButton({
  action,
  id,
  name,
}: {
  action: (form: FormData) => Promise<void>;
  id: number;
  name: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <form
      action={async (form: FormData) => {
        if (!confirm(`确定删除应用「${name}」？相关授权会一并清理。`)) return;
        setPending(true);
        try {
          await action(form);
        } finally {
          setPending(false);
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn ghost sm danger" disabled={pending}>
        {pending ? "删除中…" : "删除"}
      </button>
    </form>
  );
}
