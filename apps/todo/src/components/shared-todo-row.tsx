"use client";

import { useState } from "react";
import { zonedDate, zonedTime } from "@nas/core";
import type { TodoView } from "@nas/todo";
import { guestToggleTodoAction, guestUpdateTodoAction } from "@/app/share/actions";
import { LightboxImage } from "./lightbox";
import { TodoDialog, type ListOption } from "./todo-dialog";

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
 * 「可勾选」分享里点条目就能打开编辑弹窗，保存走免登录 Server Action；
 * 只读分享保持纯展示。
 */
export function SharedTodoRow({
  todo,
  token,
  writable,
  list,
}: {
  todo: TodoView;
  token: string;
  writable: boolean;
  /** 当前清单信息：编辑弹窗里的「归到清单」只有这一个选项 */
  list: ListOption;
}) {
  const done = todo.status === "DONE";
  const overdue = todo.status === "OVERDUE";
  // 长备注默认收起，点「备注」展开全文，行高不被大段文字撑爆
  const [noteOpen, setNoteOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const notePreview =
    todo.description && todo.description.length > 42
      ? `${todo.description.slice(0, 42)}…`
      : todo.description;

  // 图片不能走 /api/image（要登录），走这个清单自己的免登录代理
  function imageSrc(address: string): string {
    return `/share/${encodeURIComponent(token)}/image?u=${encodeURIComponent(address)}`;
  }

  /** 点条目的内容区也能打开编辑弹窗；勾选框、按钮、链接各走各的，划选备注文字时不弹窗 */
  function openFromRow(event: React.MouseEvent<HTMLDivElement>) {
    if (!writable) return;
    const target = event.target as HTMLElement;
    // 大图灯箱是 portal 到 body 的，React 事件仍会冒泡到这里；不在本行里的点击忽略
    if (!event.currentTarget.contains(target)) return;
    if (target.closest("button, a, input, select, textarea, label")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    setDialogOpen(true);
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

      <div
        className={`todo-main${writable ? " is-clickable" : ""}`}
        onClick={openFromRow}
      >
        <div className="todo-line">
          {writable ? (
            <button
              type="button"
              className="todo-title"
              title="点击编辑这条待办"
              onClick={() => setDialogOpen(true)}
            >
              {todo.title}
            </button>
          ) : (
            <span className="todo-title" title={todo.title}>
              {todo.title}
            </span>
          )}
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

      {writable && (
        <TodoDialog
          lists={[list]}
          action={guestUpdateTodoAction}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          imageUrl={imageSrc}
          hiddenFields={{ token }}
          basic
          initial={{
            id: todo.id,
            title: todo.title,
            description: todo.description,
            images: todo.imageList,
          }}
        />
      )}
    </li>
  );
}