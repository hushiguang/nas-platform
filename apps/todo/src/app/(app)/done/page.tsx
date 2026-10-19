import { zonedDate } from "@nas/core";
import { listTodos, listVisibleLists } from "@nas/todo";
import { requireUser } from "@/auth";
import { TodoList } from "@/components/todo-list";

/** 已完成：只读回顾。需要重新打开就在行上点勾，会回到未完成 */
export default async function DonePage() {
  const user = await requireUser();
  const lists = await listVisibleLists(user.id, { includeArchived: true });
  const listOptions = lists.map((l) => ({ id: l.id, name: l.name, icon: l.icon }));
  const todos = await listTodos({ userId: user.id, scope: "done", take: 200 });

  return (
    <div className="todo-home">
      <div className="page-head">
        <div>
          <span className="page-eyebrow">最近的 {todos.length} 条</span>
          <h1>已完成</h1>
        </div>
      </div>

      <TodoList todos={todos} lists={listOptions} today={zonedDate(new Date())} grouped={false} />
    </div>
  );
}
