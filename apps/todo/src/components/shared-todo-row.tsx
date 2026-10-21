"use client";

import { useState } from "react";
import { zonedDate, zonedTime } from "@nas/core";
import type { TodoView } from "@nas/todo";
import { guestToggleTodoAction } from "@/app/share/actions";
import { LightboxImage } from "./lightbox";

const PRIORITY_COLOR: Record<string, string> = {
  HIGH: "var(--coral)",
  MEDIUM: "var(--yellow)",
  LOW: "var(--muted)",
};

const PRIORITY_LABEL: Record<string, string> = { HIGH: "重要", MEDIUM: "普通", LOW: "次要" };

function dueText(due: Date | null): string {
  if (!due) return "无期限";
  const day = zonedDate(due);
  const time = zonedTime(due);
  return time === "08:00" ? day : `${day} ${time}`;
}

/**
 * 分享页的待办行：跟待办应用里的行保持同一套展示 ——
 * 图片直接铺成缩略图、点了看大图；长备注收起成一行，点一下展开全文。
 * 区别只在不带编辑/删除这些要登录的操作，勾选走免登录 Server Action。
 */
export function SharedTodoRow({
  todo,
  token,
  writable,
}: {
  todo: TodoView;
  token: string;
  writable: boolean;
}) {
  const done = todo.status === "DONE";
  const overdue = todo.status === "OVERDUE";
  // 长备注默认收起，点「备注」展开全文，行高不被大段文字撑爆
  const [noteOpen, setNoteOpen] = useState(false);
  const notePreview =
    todo.description && todo.description.length > 42
      ? `${todo.description.slice(0, 42)}…`
      : todo.description;

  // 图片不能走 /api/image（要登录），走这个清单自己的免登录代理
  function imageSrc(address: string): string {
    return `/share/${encodeURIComponent(token)}/image?u=${encodeURIComponent(address)}`;
  }

  return (
    <li
      className={`todo-row is-compact${done ? " done" : ""}${
        todo.imageList.length > 0 ? " has-media" : ""
      }`}
    >
      <span
        className="todo-dot"
        style={{ background: PRIORITY_COLOR[todo.priority] }}
        title={PRIORITY_LABEL[todo.priority]}
      />

      {writable ? (
        <form action={guestToggleTodoAction} className="todo-check">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="id" value={todo.id} />
          <input type="hidden" name="done" value={done ? "0" : "1"} />
          <button
            type="submit"
            className={`todo-box${done ? " on" : ""}`}
            title={done ? "取消完成" : "标记完成"}
          >
            {done ? "✓" : ""}
          </button>
        </form>
      ) : (
        <span
          className={`todo-box${done ? " on" : ""}`}
          role="img"
          aria-label={done ? "已完成" : "未完成"}
        >
          {done ? "✓" : ""}
        </span>
      )}

      <div className="todo-main">
        <div className="todo-line">
          <span className="todo-title" title={todo.title}>
            {todo.title}
          </span>
          <span
            className={`todo-due${overdue ? " is-overdue" : ""}${!todo.dueTime ? " is-none" : ""}`}
          >
            {dueText(todo.dueTime)}
          </span>
        </div>
        <div className="todo-meta">
          {overdue && <span className="todo-flag">逾期</span>}
          {done && todo.completedAt && <span>完成于 {zonedDate(todo.completedAt)}</span>}
          {todo.priority !== "MEDIUM" && <span>{PRIORITY_LABEL[todo.priority]}</span>}
          {todo.description && (
            <button
              type="button"
              className="todo-op"
              onClick={() => setNoteOpen((value) => !value)}
            >
              {noteOpen ? "收起备注" : `备注：${notePreview}`}
            </button>
          )}
        </div>
        {todo.description && noteOpen && (
          <div className="todo-note is-full">{todo.description}</div>
        )}
        {todo.imageList.length > 0 && (
          <div className="todo-thumbs">
            {todo.imageList.map((address) => (
              <LightboxImage key={address} src={imageSrc(address)} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
