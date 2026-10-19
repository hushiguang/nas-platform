import { zonedDate } from "@nas/core";
import { listVisibleLists, todayTodos } from "@nas/todo";
import { requireUser } from "@/auth";
import { createTodoAction } from "@/app/actions";
import { TodoDialog } from "@/components/todo-dialog";
import { TodoList } from "@/components/todo-list";

/** 今天：逾期 + 今天到期。日常真正要盯的就是这一屏 */
export default async function TodayPage() {
  const user = await requireUser();
  const lists = await listVisibleLists(user.id);
  const listOptions = lists.map((l) => ({ id: l.id, name: l.name, icon: l.icon }));
  const todos = await todayTodos({ userId: user.id });

  return (
    <div className="todo-home">
      <div className="page-head">
        <div>
          <span className="page-eyebrow">{zonedDate(new Date())}</span>
          <h1>今天</h1>
        </div>
        <TodoDialog
          lists={listOptions}
          action={createTodoAction}
          trigger={<button type="button" className="btn">+ 记一件事</button>}
        />
      </div>

      <TodoList todos={todos} lists={listOptions} today={zonedDate(new Date())} grouped={false} />
    </div>
  );
}
