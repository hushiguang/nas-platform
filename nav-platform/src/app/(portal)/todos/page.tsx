import Link from "next/link";
import { revalidatePath } from "next/cache";
import type { Prisma, TodoPriority, TodoSource, TodoStatus } from "@prisma/client";
import { requireUser } from "@/modules/core/auth/session";
import { getPlatformAccess, scopeCondition } from "@/modules/core/rbac";
import { prisma } from "@/lib/prisma";
import { completeTodo } from "@/modules/core/todo";
import { zonedDate, zonedTime, dayDiff } from "@/lib/time";

const SOURCE_LABEL: Record<TodoSource, string> = {
  MANUAL: "手动",
  BILL: "账单",
  ANNIVERSARY: "纪念日",
  WORK: "工作",
  PREGNANCY: "孕期",
  TRAVEL: "旅行",
};

const PRIORITY_COLOR: Record<TodoPriority, string> = {
  HIGH: "var(--coral)",
  MEDIUM: "var(--yellow)",
  LOW: "var(--muted)",
};

const FILTERS = [
  { key: "open", label: "待处理" },
  { key: "overdue", label: "逾期" },
  { key: "done", label: "已完成" },
  { key: "all", label: "全部" },
] as const;

function statusWhere(key: string): Prisma.TodoWhereInput {
  switch (key) {
    case "overdue":
      return { status: "OVERDUE" };
    case "done":
      return { status: "DONE" };
    case "all":
      return {};
    default:
      return { status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] } };
  }
}

function dueLabel(due: Date | null, today: string): string {
  if (!due) return "无期限";
  const day = due.toISOString().slice(0, 10);
  const diff = dayDiff(day, today);
  const time = zonedTime(due);
  if (diff < 0) return `逾期 ${-diff} 天 · ${day} ${time}`;
  if (diff === 0) return `今天 ${time}`;
  if (diff === 1) return `明天 ${time}`;
  if (diff <= 30) return `${diff} 天后 · ${day} ${time}`;
  return `${day} ${time}`;
}

const rank = (s: TodoStatus) => (s === "OVERDUE" ? 0 : s === "DONE" ? 2 : 1);
const ts = (d: Date | null) => (d ? d.getTime() : Number.MAX_SAFE_INTEGER);

async function markDone(formData: FormData) {
  "use server";
  const user = await requireUser();
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await completeTodo(id, user.id);
  revalidatePath("/todos");
  revalidatePath("/");
}

export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; todo?: string }>;
}) {
  const user = await requireUser();
  const access = await getPlatformAccess(user, "todo");
  if (!access) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 48 }}>
        <div style={{ fontSize: 28, fontFamily: "Source Serif 4, serif" }}>403</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          你没有「待办」平台的访问权限
        </div>
      </div>
    );
  }

  const { status = "open", todo } = await searchParams;
  const focusId = Number(todo);
  const scope = scopeCondition(access, user.id);
  const rows = await prisma.todo.findMany({
    where: { ...scope, ...statusWhere(status) },
    include: { owner: { select: { nickname: true } } },
    take: 200,
  });
  const todos = [...rows].sort(
    (a, b) => rank(a.status) - rank(b.status) || ts(a.dueTime) - ts(b.dueTime),
  );
  const today = zonedDate(new Date());

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">聚合各平台待办</span>
          <h1>待办</h1>
        </div>
        <span className="badge soft">
          数据范围：{access.dataScope === "ALL" ? "全部数据" : "仅本人"}
        </span>
      </div>

      <div className="tabs">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/todos?status=${f.key}`}
            className={status === f.key ? "tab active" : "tab"}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {todos.length === 0 ? (
        <div className="card muted" style={{ fontSize: 13 }}>
          这个筛选下没有待办。
        </div>
      ) : (
        <ul className="todo-list">
          {todos.map((t) => {
            const overdue = t.status === "OVERDUE";
            const mine = t.ownerId === user.id;
            return (
              <li
                key={t.id}
                className={`todo-row${t.id === focusId ? " is-focus" : ""}${t.status === "DONE" ? " done" : ""}`}
              >
                <span
                  className="todo-dot"
                  style={{ background: PRIORITY_COLOR[t.priority] }}
                  title={t.priority}
                />
                <div className="todo-main">
                  <div className="todo-title">{t.title}</div>
                  <div className="todo-meta">
                    {SOURCE_LABEL[t.source]}
                    {t.dueTime ? ` · ${dueLabel(t.dueTime, today)}` : " · 无期限"}
                    {!mine && ` · ${t.owner.nickname}`}
                  </div>
                </div>
                {overdue && <span className="badge" style={{ background: "var(--wash-coral)", color: "var(--coral)" }}>逾期</span>}
                {t.status !== "DONE" && mine && (
                  <form action={markDone}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="btn ghost sm">
                      完成
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
