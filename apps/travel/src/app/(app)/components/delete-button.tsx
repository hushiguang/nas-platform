"use client";

import { useTransition } from "react";

/** 删除按钮：二次确认后调用传入的 server action（用 .bind 绑定 id） */
export function DeleteButton({
  action,
  label = "删除",
  confirmText = "确定删除？删掉就找不回来了。",
}: {
  action: () => Promise<void>;
  label?: string;
  confirmText?: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="btn ghost"
      disabled={pending}
      onClick={() => {
        if (window.confirm(confirmText)) startTransition(() => void action());
      }}
    >
      {pending ? "删除中…" : label}
    </button>
  );
}
