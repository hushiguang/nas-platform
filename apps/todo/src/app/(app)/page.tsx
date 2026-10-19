import Link from "next/link";
import { zonedDate } from "@nas/core";
import { listTodos, listVisibleLists, todoStats } from "@nas/todo";
import { requireUser } from "@/auth";
import { createTodoAction } from "@/app/actions";
import { TodoDialog } from "@/components/todo-dialog";
import { TodoList } from "@/components/todo-list";
import { QuickAdd } from "@/components/quick-add";

/**
 * 待办主页：顶部统计 + 分类横栏 + 紧凑清单。
 * 底部快速输入框固定在视口底部，回车即记，默认当天到期 + 全部提醒。
 */
export default async function TodoHomePage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string; q?: string; focus?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const listId = sp.list === undefined ? undefined : sp.list === "" ? null : Number(sp.list);
  const search = sp.q ?? "";
  const focusId = Number(sp.focus) || undefined;

  const lists = await listVisibleLists(user.id);
  const listOptions = lists.map((l) => ({ id: l.id, name: l.name, icon: l.icon }));
  const [todos, stats] = await Promise.all([
    // 待办应用只看自己手动记的（source = MANUAL，见 sourceWhere 默认口径）；
    // 账单/纪念日/工作收上来的归门户「待办管理」页聚合展示
    listTodos({ userId: user.id, listId, scope: "open", search }),
    todoStats({ userId: user.id }),
  ]);
  const today = zonedDate(new Date());
  const activeList = typeof listId === "number" ? lists.find((l) => l.id === listId) : undefined;
  const title = activeList ? `${activeList.icon ?? ""} ${activeList.name}`.trim() : listId === null ? "未归类" : "全部待办";
  const listHref = (v: string | undefined) => (v === undefined ? "/" : `/?list=${v}`);

  return (
    <div className="todo-home">
      <div className="page-head">
        <div>
          <span className="page-eyebrow">想起来了就记一笔</span>
          <h1>待办</h1>
        </div>
        <TodoDialog
          lists={listOptions}
          action={createTodoAction}
          defaultListId={typeof listId === "number" ? listId : null}
          defaultDueDate={today}
          trigger={<button type="button" className="btn">+ 记一件事</button>}
        />
      </div>

      <div className="app-stats" style={{ marginBottom: 12 }}>
        <Link href="/" className="stat">
          <b>{stats.open}</b>
          待处理
        </Link>
        <Link href="/today" className={`stat${stats.overdue > 0 ? " warn" : ""}`}>
          <b>{stats.overdue}</b>
          逾期
        </Link>
        <Link href="/today" className="stat">
          <b>{stats.today}</b>
          今天到期
        </Link>
        <Link href="/done" className="stat">
          <b>{stats.done}</b>
          已完成
        </Link>
      </div>

      <div className="todo-bar">
        <nav className="todo-cats is-row">
          <Link href="/" className={listId === undefined ? "todo-cat active" : "todo-cat"}>
            全部{stats.open > 0 && <span className="todo-count">{stats.open}</span>}
          </Link>
          <Link href="/?list=" className={listId === null ? "todo-cat active" : "todo-cat"}>
            未归类
          </Link>
          {lists.map((list) => (
            <Link
              key={list.id}
              href={`/?list=${list.id}`}
              className={listId === list.id ? "todo-cat active" : "todo-cat"}
            >
              {list.icon ? `${list.icon} ` : ""}
              {list.name}
              {list.openCount > 0 && <span className="todo-count">{list.openCount}</span>}
            </Link>
          ))}
        </nav>
        <Link href="/lists" className="todo-manage">
          管理清单 →
        </Link>
      </div>

      <div className="todo-list-head">
        <b>{title}</b>
        <span className="muted" style={{ fontSize: 12 }}>{todos.length} 条待处理</span>
      </div>

      <form className="form-row todo-search" action="/">
        {sp.list !== undefined && <input type="hidden" name="list" value={sp.list} />}
        <input className="input" name="q" defaultValue={search} placeholder="搜标题或备注…" />
        <button type="submit" className="ghost">
          搜索
        </button>
        {search && (
          <Link href={listHref(sp.list)} className="ghost sm">
            清空
          </Link>
        )}
      </form>

      <TodoList todos={todos} lists={listOptions} today={today} focusId={focusId} />

      <QuickAdd
        action={createTodoAction}
        listId={typeof listId === "number" ? listId : null}
        today={today}
      />
    </div>
  );
}
