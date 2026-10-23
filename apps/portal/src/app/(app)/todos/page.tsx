import Link from "next/link";
import { SiteLink } from "@nas/ui";
import { revalidatePath } from "next/cache";
import type { Prisma, TodoSource, TodoStatus } from "@nas/db";
import { requireUser } from "@/auth";
import { prisma } from "@nas/db";
import { setTodoStatus, deleteTodo, todoVisibilityWhere, toView } from "@nas/todo";
import { appBaseUrl, recordAudit, zonedDate, zonedTime, dayDiff } from "@nas/core";
import { anniversaryHints, ensureAnniversaryTodos, ensureBillFollowTodos, todoPortalSummary } from "@/server/summary";
import { PortalTodoRow } from "./todo-row";

const SOURCE_LABEL: Record<TodoSource, string> = {
  MANUAL: "手动",
  BILL: "账单",
  ANNIVERSARY: "纪念日",
  WORK: "工作",
  PREGNANCY: "孕期",
  TRAVEL: "旅行",
};

const FILTERS = [
  { key: "open", label: "待处理" },
  { key: "overdue", label: "逾期" },
  { key: "done", label: "已完成" },
  { key: "all", label: "全部" },
] as const;

/** 按应用（来源）分组展示的顺序 */
const SOURCE_ORDER: TodoSource[] = ["WORK", "BILL", "ANNIVERSARY", "TRAVEL", "PREGNANCY", "MANUAL"];

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

/** 排序位：逾期最前，其次未完成，然后已完成，已取消垫底 */
const rank = (s: TodoStatus) => (s === "OVERDUE" ? 0 : s === "DONE" ? 2 : s === "CANCELLED" ? 3 : 1);
const ts = (d: Date | null) => (d ? d.getTime() : Number.MAX_SAFE_INTEGER);

async function markDone(formData: FormData) {
  "use server";
  const user = await requireUser();
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  const row = await prisma.todo.findUnique({ where: { id }, select: { title: true } });
  // 共享清单里谁都能勾掉自己买的那一项 —— 所以走 setTodoStatus（按清单可见性判权），
  // 不用 completeTodo（那条要求 ownerId 完全一致，成员勾不动别人的待办）
  await setTodoStatus(id, user.id, "DONE", user.role === "ADMIN");
  await recordAudit({
    app: "portal",
    action: "complete",
    target: "todo",
    targetId: id,
    summary: `完成待办${row?.title ? `「${row.title}」` : ""}`,
    actorId: user.id,
    actorName: user.nickname,
  });
  revalidatePath("/todos");
  revalidatePath("/");
}

/** 取消：置为 CANCELLED，与完成走同一判权（setTodoStatus 清单可见性），可逆 */
async function cancelOne(formData: FormData) {
  "use server";
  const user = await requireUser();
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  const row = await prisma.todo.findUnique({ where: { id }, select: { title: true } });
  await setTodoStatus(id, user.id, "CANCELLED", user.role === "ADMIN");
  await recordAudit({
    app: "portal",
    action: "cancel",
    target: "todo",
    targetId: id,
    summary: `取消待办${row?.title ? `「${row.title}」` : ""}`,
    actorId: user.id,
    actorName: user.nickname,
  });
  revalidatePath("/todos");
  revalidatePath("/");
}

/** 删除：与待办应用同一判权（清单可见性），删完两边一起刷 */
async function removeOne(formData: FormData) {
  "use server";
  const user = await requireUser();
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  const row = await prisma.todo.findUnique({ where: { id }, select: { title: true } });
  await deleteTodo(id, user.id, user.role === "ADMIN");
  await recordAudit({
    app: "portal",
    action: "delete",
    target: "todo",
    targetId: id,
    summary: `删除待办${row?.title ? `「${row.title}」` : ""}`,
    actorId: user.id,
    actorName: user.nickname,
  });
  revalidatePath("/todos");
  revalidatePath("/");
}

export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; todo?: string; source?: string }>;
}) {
  const user = await requireUser();
  // 可见范围与待办应用**共用同一个条件**（packages/todo 的 todoVisibilityWhere）：
  // 未归类看本人，挂在清单上的按清单可见性 —— 共享清单里别人记的也在这看得见。
  // 以前这里自己拼 `{ ownerId: user.id }`，结果待办应用里有的、门户汇总里没有。
  const visibility = await todoVisibilityWhere(user.id, user.role === "ADMIN");
  const isAdmin = user.role === "ADMIN";

  // 图片走待办应用的代理读（本地兜底图只有它认），跨子域靠共享 cookie
  const todoBase = appBaseUrl("todo");
  const imageSrc = (address: string) => `${todoBase}/api/image?u=${encodeURIComponent(address)}`;

  const { status = "open", todo, source } = await searchParams;
  const focusId = Number(todo);
  await Promise.all([ensureAnniversaryTodos(), ensureBillFollowTodos()]);
  const [summary, hints, rows] = await Promise.all([
    todoPortalSummary(user),
    anniversaryHints(user),
    prisma.todo.findMany({
      where: { ...visibility, ...statusWhere(status) },
      include: {
        owner: { select: { nickname: true } },
        list: { select: { id: true, name: true, icon: true } },
      },
      take: 200,
    }),
  ]);
  const todos = [...rows].sort(
    (a, b) => rank(a.status) - rank(b.status) || ts(a.dueTime) - ts(b.dueTime),
  );
  // 工作台节点待办只存 nodeId，这里批量换成项目 id，好跳到对应项目页
  const workNodeIds = todos
    .filter((t) => t.source === "WORK" && (t.sourceBizId ?? "").startsWith("work-node:"))
    .map((t) => Number((t.sourceBizId ?? "").slice("work-node:".length)))
    .filter((id) => Number.isInteger(id));
  const workNodes =
    workNodeIds.length > 0
      ? await prisma.workNode.findMany({
          where: { id: { in: workNodeIds } },
          select: { id: true, projectId: true },
        })
      : [];
  const workProjectOf = new Map(workNodes.map((n) => [n.id, n.projectId]));
  const workBase = appBaseUrl("work");
  const today = zonedDate(new Date());
  // 按应用（来源）分组，组内保持原排序
  const groups = SOURCE_ORDER.map((source) => ({
    source,
    items: todos.filter((t) => t.source === source),
  })).filter((g) => g.items.length > 0);
  // 分类切换：只列出当前筛选下有内容的分类，避免点进去是空列表
  const sourceTabs = [
    { key: "all", label: "全部来源", count: todos.length },
    ...groups.map((g) => ({ key: g.source, label: SOURCE_LABEL[g.source], count: g.items.length })),
  ];
  const activeSource = sourceTabs.some((t) => t.key === source) ? (source as string) : "all";
  const visibleGroups = groups.filter((g) => activeSource === "all" || g.source === activeSource);
  const sourceHref = (key: string) => `/todos?status=${status}&source=${key}`;

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">聚合各平台待办</span>
          <h1>待办管理</h1>
        </div>
        <div className="row-actions">
          <span className="badge soft">数据范围：{isAdmin ? "全部数据" : "本人 + 共享清单"}</span>
          {todoBase && (
            <SiteLink href={todoBase} className="btn">
              去记一笔
            </SiteLink>
          )}
        </div>
      </div>

      {summary.stats.length > 0 && (
        <div className="app-stats" style={{ marginBottom: 14 }}>
          {summary.stats.map((item) => (
            <SiteLink key={item.label} href={item.href ?? "/todos"} className={`stat${item.tone === "warn" ? " warn" : ""}`}>
              <b>{item.value}</b>
              {item.label}
            </SiteLink>
          ))}
        </div>
      )}

      <div className="tabs">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/todos?status=${f.key}${activeSource === "all" ? "" : `&source=${activeSource}`}`}
            className={status === f.key ? "tab active" : "tab"}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {todos.length > 0 && (
        <div
          className="tabs"
          style={{ marginTop: -6, marginBottom: 4, paddingBottom: 8, borderBottom: "1px solid var(--line)" }}
        >
          {sourceTabs.map((tab) => {
            const active = tab.key === activeSource;
            return (
              <Link
                key={tab.key}
                href={sourceHref(tab.key)}
                className={active ? "tab active" : "tab"}
                aria-current={active ? "page" : undefined}
              >
                {tab.label}
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 11,
                    opacity: active ? 0.85 : 0.65,
                    fontWeight: 400,
                  }}
                >
                  {tab.count}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {todos.length === 0 ? (
        <div className="card muted" style={{ fontSize: 13 }}>
          这个筛选下没有待办。
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className="card muted" style={{ fontSize: 13 }}>
          这个分类下没有待办。
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
          {visibleGroups.map((group) => (
            <section key={group.source} id={`source-${group.source}`}>
              {activeSource === "all" && (
                <div className="row-actions" style={{ marginBottom: 8 }}>
                  <h2 style={{ fontSize: 15, margin: 0 }}>{SOURCE_LABEL[group.source]}</h2>
                  <span className="badge soft">{group.items.length} 条</span>
                </div>
              )}
              <ul className="todo-list" style={{ marginTop: 0 }}>
                {group.items.map((t) => {
                  const view = toView(t);
                  // 逾期按到期日现算，不信 status：到期日清空后状态可能还停在 OVERDUE
                  const overdue =
                    t.status !== "DONE" &&
                    t.status !== "CANCELLED" &&
                    Boolean(t.dueTime) &&
                    dayDiff(zonedDate(t.dueTime as Date), today) < 0;
                  const cancelled = t.status === "CANCELLED";
                  const mine = t.ownerId === user.id;
                  const anniversaryId =
                    t.source === "ANNIVERSARY" ? Number(t.sourceBizId?.replace("anniversary:", "")) : NaN;
                  const hint = Number.isInteger(anniversaryId) ? hints.get(anniversaryId) : undefined;
                  const billId = t.source === "BILL" ? Number(t.sourceBizId?.replace("bill:", "")) : NaN;
                  const billBase = appBaseUrl("bill");
                  const billHref =
                    Number.isInteger(billId) && billBase ? `${billBase}/bills?tx=${billId}` : "";
                  const href = hint?.href || billHref || undefined;
                  // 手动记的待办才给「编辑」入口（跳待办应用并高亮那一条）；
                  // 工作台收上来的给「去处理」：节点待办跳对应项目页，风险预报 / 待修问题直接跳该项目
                  const editHref =
                    todoBase && t.source === "MANUAL" ? `${todoBase}/?focus=${t.id}` : "";
                  const workBizId = t.sourceBizId ?? "";
                  const isWorkIssue = t.source === "WORK" && workBizId.startsWith("work-issues:");
                  let workHref = "";
                  if (t.source === "WORK" && workBase) {
                    if (workBizId.startsWith("work-node:")) {
                      const pid = workProjectOf.get(Number(workBizId.slice("work-node:".length)));
                      workHref = pid ? `${workBase}/p/${pid}` : workBase;
                    } else if (workBizId.startsWith("work-phase:")) {
                      const pid = Number(workBizId.split(":")[1]);
                      workHref = Number.isInteger(pid) ? `${workBase}/p/${pid}` : workBase;
                    } else if (isWorkIssue) {
                      const pid = Number(workBizId.slice("work-issues:".length));
                      workHref = Number.isInteger(pid) ? `${workBase}/p/${pid}` : workBase;
                    } else workHref = workBase;
                  }
                  // 来源补充：纪念日提醒文案（去掉重复的标题）或账单跟进的第一行
                  const extra = hint
                    ? hint.text.replace(`${t.title} · `, "")
                    : t.source === "BILL"
                      ? t.description?.split("\n")[0] || "后续跟进"
                      : undefined;
                  // 备注：纪念日 / 账单的说明已经在小字里露过，不再重复占一块
                  const note =
                    t.description &&
                    !hint &&
                    t.source !== "BILL" &&
                    (t.source !== "WORK" || isWorkIssue)
                      ? t.description
                      : undefined;
                  return (
                    <PortalTodoRow
                      key={t.id}
                      id={t.id}
                      title={t.title}
                      href={href}
                      priority={t.priority}
                      due={dueLabel(t.dueTime, today)}
                      hasDue={Boolean(t.dueTime)}
                      overdue={overdue}
                      done={t.status === "DONE"}
                      cancelled={cancelled}
                      focus={t.id === focusId}
                      sourceLabel={SOURCE_LABEL[t.source]}
                      extra={extra}
                      listName={t.list ? { icon: t.list.icon, name: t.list.name } : undefined}
                      workBadge={
                        t.source === "WORK" && workBizId
                          ? isWorkIssue
                            ? "待修问题"
                            : workBizId.startsWith("work-phase:")
                              ? "风险预报"
                              : "工作"
                          : undefined
                      }
                      snoozeText={
                        t.snoozeUntil
                          ? `已推迟到 ${zonedDate(t.snoozeUntil)} ${zonedTime(t.snoozeUntil)}`
                          : undefined
                      }
                      ownerName={!mine ? t.owner.nickname : undefined}
                      note={note}
                      images={view.imageList.map(imageSrc)}
                      bills={hint?.bills}
                      editHref={editHref || undefined}
                      workHref={workHref || undefined}
                      markDoneAction={markDone}
                      cancelAction={cancelOne}
                      deleteAction={removeOne}
                    />
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
