"use client";
import { useState } from "react";
import { dayDiff, zonedDate, zonedTime } from "@nas/core";
import type { TodoView } from "@nas/todo";
import { deleteTodoAction, snoozeTodoAction, toggleTodoAction, updateTodoAction } from "@/app/actions";
import { TodoDialog, imageSrc, type ListOption } from "./todo-dialog";
import { LightboxImage } from "./lightbox";

const PRIORITY_COLOR: Record<string, string> = {
  HIGH: "var(--coral)",
  MEDIUM: "var(--yellow)",
  LOW: "var(--muted)",
};

const PRIORITY_LABEL: Record<string, string> = { HIGH: "重要", MEDIUM: "普通", LOW: "次要" };

/** 到期时间的口语化描述：逾期 2 天 / 今天 / 明天 09:00。
 *  没填几点时按当天算（服务端 parseDue 兜底 08:00），只显示日期不带时间。 */
function dueLabel(due: Date | null, today: string): string {
  if (!due) return "无期限";
  const day = zonedDate(due);
  const diff = dayDiff(day, today);
  const time = zonedTime(due);
  const suffix = time === "08:00" ? "" : ` ${time}`;
  if (diff < 0) return `逾期 ${-diff} 天 · ${day}${suffix}`;
  if (diff === 0) return `今天${suffix}`;
  if (diff === 1) return `明天${suffix}`;
  if (diff <= 30) return `${diff} 天后 · ${day}${suffix}`;
  return `${day}${suffix}`;
}

export function TodoRow({
  todo,
  today,
  listName,
  lists,
  showOwner,
  focus,
}: {
  todo: TodoView;
  today: string;
  listName?: string;
  lists: ListOption[];
  showOwner?: string;
  /** 从门户「编辑」跳过来时高亮（?focus=<id>） */
  focus?: boolean;
}) {
  const done = todo.status === "DONE";
  const overdue = todo.status === "OVERDUE";
  const due = dueLabel(todo.dueTime, today);
  const hasDue = Boolean(todo.dueTime);
  // 长备注默认收起，点"备注"展开全文 —— 行高保持一两行，不再被大段文字撑爆
  const [noteOpen, setNoteOpen] = useState(false);
  const notePreview =
    todo.description && todo.description.length > 42
      ? `${todo.description.slice(0, 42)}…`
      : todo.description;

  return (
    <li className={`todo-row is-compact${done ? " done" : ""}${focus ? " is-focus" : ""}`}>
      <span className="todo-dot" style={{ background: PRIORITY_COLOR[todo.priority] }} title={PRIORITY_LABEL[todo.priority]} />

      <form action={toggleTodoAction} className="todo-check">
        <input type="hidden" name="id" value={todo.id} />
        <input type="hidden" name="done" value={done ? "0" : "1"} />
        <button type="submit" className={`todo-box${done ? " on" : ""}`} title={done ? "取消完成" : "标记完成"}>
          {done ? "✓" : ""}
        </button>
      </form>

      <div className="todo-main">
        <div className="todo-line">
          <span className="todo-title" title={todo.title}>
            {todo.title}
          </span>
          <span
            className={`todo-due${overdue ? " is-overdue" : ""}${!hasDue ? " is-none" : ""}`}
            title={todo.dueTime ? new Date(todo.dueTime).toLocaleString() : "无截止日期"}
          >
            {due}
          </span>
          <span className="todo-ops">
            <TodoDialog
              lists={lists}
              action={updateTodoAction}
              trigger={<button type="button" className="todo-op">编辑</button>}
              initial={{
                id: todo.id,
                title: todo.title,
                description: todo.description,
                listId: todo.listId,
                priority: todo.priority,
                dueDate: todo.dueTime ? zonedDate(todo.dueTime) : "",
                dueTime: todo.dueTime && zonedTime(todo.dueTime) !== "08:00" ? zonedTime(todo.dueTime) : "",
                remindOffsets: Array.isArray(todo.remindRules)
                  ? (todo.remindRules as Array<{ offsetDays?: number }>).map((r) => Number(r?.offsetDays)).filter(Number.isFinite)
                  : [],
                remindTime: Array.isArray(todo.remindRules) && todo.remindRules.length > 0
                  ? String((todo.remindRules[0] as { time?: string })?.time ?? "09:00")
                  : "09:00",
                images: todo.imageList,
              }}
            />
            {!done && (
              <form action={snoozeTodoAction} className="todo-snooze">
                <input type="hidden" name="id" value={todo.id} />
                <input type="hidden" name="preset" value="tomorrow" />
                <button type="submit" className="todo-op" title="截止日期延到明天，并再提醒一次">
                  明天
                </button>
              </form>
            )}
            <form action={deleteTodoAction} onSubmit={(e) => { if (!confirm(`确定删除「${todo.title}」？`)) e.preventDefault(); }}>
              <input type="hidden" name="id" value={todo.id} />
              <button type="submit" className="todo-op is-danger" title="删除这条待办">
                删除
              </button>
            </form>
          </span>
        </div>
        <div className="todo-meta">
          {overdue && <span className="todo-flag">逾期</span>}
          {listName && <span>{listName}</span>}
          {todo.priority !== "MEDIUM" && <span>{PRIORITY_LABEL[todo.priority]}</span>}
          {todo.snoozeUntil && <span>已延到 {zonedDate(todo.snoozeUntil)}</span>}
          {showOwner && <span>{showOwner}</span>}
          {todo.imageList.length > 0 && <span>📷 {todo.imageList.length}</span>}
          {todo.description && (
            <button type="button" className="todo-op" onClick={() => setNoteOpen((v) => !v)}>
              {noteOpen ? "收起备注" : `备注：${notePreview}`}
            </button>
          )}
        </div>
        {todo.description && noteOpen && (
          <div className="todo-note is-full">{todo.description}</div>
        )}
        {noteOpen && todo.imageList.length > 0 && (
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
