"use client";

import { useState } from "react";

/**
 * 底部快速添加：输入标题回车即记。
 * 默认当天到期 + 全部提醒（当天 / 提前1天 / 提前3天 / 提前7天 09:00），
 * 与弹窗里的默认档位一致，省得每条都点开弹窗。
 */
export function QuickAdd({
  action,
  listId,
  today,
}: {
  action: (form: FormData) => Promise<void>;
  listId: number | null;
  today: string;
}) {
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = title.trim();
    if (!value || pending) return;
    setPending(true);
    try {
      const form = new FormData();
      form.set("title", value);
      form.set("priority", "MEDIUM");
      // 只定日期不定几点：服务端兜底 08:00，行内显示"今天"不带时间
      form.set("dueDate", today);
      form.set("remindTime", "09:00");
      for (const offset of ["0", "1", "3", "7"]) form.append("remindOffsets", offset);
      if (listId !== null) form.set("listId", String(listId));
      await action(form);
      setTitle("");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="quick-add card">
      <input
        className="input quick-add-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="记一件事，回车即记（默认今天到期）…"
        maxLength={200}
      />
      <span className="quick-add-hint">今天 · 全部提醒</span>
      <button type="submit" className="btn" disabled={!title.trim() || pending}>
        {pending ? "记入中…" : "添加"}
      </button>
    </form>
  );
}
