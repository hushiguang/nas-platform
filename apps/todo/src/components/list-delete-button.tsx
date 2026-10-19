"use client";

import { useState } from "react";

/** 行内删除按钮：confirm 确认后走 Server Action */
export function ListDeleteButton({
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
        if (!confirm(`确定删除清单「${name}」？里面的待办会退回「未归类」。`)) return;
        setPending(true);
        try {
          await action(form);
        } finally {
          setPending(false);
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="todo-op is-danger" disabled={pending}>
        {pending ? "删除中…" : "删除"}
      </button>
    </form>
  );
}
