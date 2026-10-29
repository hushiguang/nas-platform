"use client";
import { useState } from "react";
import { dayDiff, zonedDate, zonedTime } from "@nas/core";
import type { TodoView } from "@nas/todo";
import {
  deleteTodoAction,
  snoozeTodoAction,
  toggleTodoAction,
  updateTodoAction,
} from "@/app/actions";
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
  const due = dueLabel(todo.dueTime, today);
  const hasDue = Boolean(todo.dueTime);
  // 逾期按到期日现算，不信 status：到期日清空后状态可能还停在 OVERDUE，
  // 那样「无期限」的行会莫名其妙挂着红字「逾期」。
  const overdue = !done && (todo.dueTime ? dayDiff(zonedDate(todo.dueTime), today) < 0 : false);
  // 长备注默认收起，点"备注"展开全文 —— 行高保持一两行，不再被大段文字撑爆
  const [noteOpen, setNoteOpen] = useState(false);
  // 图片同样默认收起，点「📷 n」展开缩略图（再点缩略图看大图）。
  // 以前图片跟着备注一起展开，没写备注的条目就永远看不到图。
  const [imagesOpen, setImagesOpen] = useState(false);
  // 点标题 / 点「编辑」都拉起同一张编辑弹窗（受控开合，不重复挂两份表单）
  const [dialogOpen, setDialogOpen] = useState(false);
  const notePreview =
    todo.description && todo.description.length > 42
      ? `${todo.description.slice(0, 42)}…`
      : todo.description;

  /** 整块内容区（标题 + 元信息 + 备注 + 缩略图）都能点开弹窗，
   *  上下可点范围就是这一行的完整高度；勾选框、按钮、链接各走各的，
   *  划选备注文字时不弹窗（方便复制） */
  function openFromRow(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    // 大图灯箱等 portal 内容 DOM 上挂在 body，但 React 事件仍沿组件树冒泡到这里。
    // 不先拦住的话，「点大图关灯箱」会顺带把编辑弹窗弹出来。
    if (!event.currentTarget.contains(target)) return;
    if (target.closest("button, a, input, select, textarea, label")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    setDialogOpen(true);
  }

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

      <div className="todo-main is-clickable" onClick={openFromRow}>
        <div className="todo-line">
          <button
            type="button"
            className="todo-title"
            title="点击编辑这条待办"
            onClick={() => setDialogOpen(true)}
          >
            {todo.title}
          </button>
          <span
            className={`todo-due${overdue ? " is-overdue" : ""}${!hasDue ? " is-none" : ""}`}
            title={todo.dueTime ? new Date(todo.dueTime).toLocaleString() : "无截止日期"}
          >
            {due}
          </span>
          <span className="todo-ops">
            <button
              type="button"
              className="todo-op"
              onClick={() => setDialogOpen(true)}
            >
              编辑
            </button>
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
          {todo.imageList.length > 0 && (
            <button type="button" className="todo-op" onClick={() => setImagesOpen((v) => !v)}>
              {imagesOpen ? "收起图片" : `📷 ${todo.imageList.length}`}
            </button>
          )}
          {todo.description && (
            <button type="button" className="todo-op" onClick={() => setNoteOpen((v) => !v)}>
              {noteOpen ? "收起备注" : `备注：${notePreview}`}
            </button>
          )}
        </div>
        {todo.description && noteOpen && (
          <div className="todo-note is-full">{todo.description}</div>
        )}
        {imagesOpen && todo.imageList.length > 0 && (
          <div className="todo-thumbs">
            {todo.imageList.map((address, index) => (
              <LightboxImage key={address} src={imageSrc(address)} images={todo.imageList.map(imageSrc)} index={index} />
            ))}
          </div>
        )}
      </div>

      <TodoDialog
        lists={lists}
        action={updateTodoAction}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
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
    </li>
  );
}
