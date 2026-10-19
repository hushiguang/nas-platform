import { dayDiff, zonedDate } from "@nas/core";
import type { TodoView } from "@nas/todo";
import { TodoRow } from "./todo-row";
import type { ListOption } from "./todo-dialog";

/**
 * 待办列表。按到期时间分组（逾期 / 今天 / 明天 / 以后 / 无期限）——
 * 这是待办类产品最有用的一刀，比按清单平铺更接近「今天该干什么」。
 *
 * 已完成的不分组，直接平铺（/done 用）。
 */
export function TodoList({
  todos,
  lists,
  today,
  ownerNames,
  grouped = true,
  focusId,
}: {
  todos: TodoView[];
  lists: ListOption[];
  today: string;
  /** 管理员视图里显示归属人 */
  ownerNames?: Map<number, string>;
  grouped?: boolean;
  /** 从门户「编辑」跳过来时高亮那一条（?focus=<id>） */
  focusId?: number;
}) {
  const listNameById = new Map(lists.map((l) => [l.id, l.icon ? `${l.icon} ${l.name}` : l.name]));

  function renderRow(todo: TodoView) {
    return (
      <TodoRow
        key={todo.id}
        todo={todo}
        today={today}
        lists={lists}
        listName={todo.listId ? listNameById.get(todo.listId) : undefined}
        showOwner={ownerNames?.get(todo.ownerId)}
        focus={todo.id === focusId}
      />
    );
  }

  if (todos.length === 0) {
    return (
      <div className="card muted" style={{ fontSize: 13 }}>
        这里还没有待办。
      </div>
    );
  }

  if (!grouped) {
    return <ul className="todo-list">{todos.map(renderRow)}</ul>;
  }

  const buckets: Record<string, TodoView[]> = { overdue: [], today: [], tomorrow: [], later: [], none: [] };
  for (const todo of todos) {
    if (todo.status === "DONE") continue; // 分组视图只看未完成
    if (!todo.dueTime) {
      buckets.none.push(todo);
      continue;
    }
    const diff = dayDiff(zonedDate(todo.dueTime), today);
    if (diff < 0) buckets.overdue.push(todo);
    else if (diff === 0) buckets.today.push(todo);
    else if (diff === 1) buckets.tomorrow.push(todo);
    else buckets.later.push(todo);
  }

  const labels: Array<[keyof typeof buckets, string]> = [
    ["overdue", "逾期"],
    ["today", "今天"],
    ["tomorrow", "明天"],
    ["later", "以后"],
    ["none", "无期限"],
  ];
  const visible = labels.filter(([key]) => buckets[key].length > 0);

  if (visible.length === 0) {
    return (
      <div className="card muted" style={{ fontSize: 13 }}>
        这里还没有待办。
      </div>
    );
  }

  return (
    <>
      {visible.map(([key, label]) => (
        <section key={key} className="todo-group">
          <div className="todo-group-title">
            {label}
            <span className="muted">{buckets[key].length}</span>
          </div>
          <ul className="todo-list">{buckets[key].map(renderRow)}</ul>
        </section>
      ))}
    </>
  );
}
