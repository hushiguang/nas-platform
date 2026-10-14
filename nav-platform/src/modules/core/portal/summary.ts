import { prisma } from "@/lib/prisma";
import type { Prisma, TodoSource } from "@prisma/client";
import type { PlatformAccess } from "@/modules/core/rbac";
import { scopeCondition } from "@/modules/core/rbac";
import { PLATFORM_HREF } from "@/modules/core/rbac/platform-links";
import { zonedDate } from "@/lib/time";

export interface SummaryStat {
  value: string;
  label: string;
  tone?: "warn" | "ok";
  /** 点击跳转到对应页面（带筛选参数） */
  href?: string;
}

export interface SummaryLine {
  text: string;
  tone?: "warn";
  /** 点击跳转到该条记录（带定位参数） */
  href?: string;
}

export interface PortalSummary {
  stats: SummaryStat[];
  lines: SummaryLine[];
  /** 无数据/未接入时的兜底文案 */
  note?: string;
}

/** 内部模块路由；外部应用没有内部路由，返回 null */
function hrefOf(code: string): string | null {
  return PLATFORM_HREF[code] ?? `/${code}`;
}

/** @db.Date 字段以 UTC 午夜存储，统一按 ISO 日期串比较，避免时区偏移 */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000);
}

/** 相对今天的天数文案 */
function dayText(day: string, today: string): { text: string; tone?: "warn" } {
  const diff = daysBetween(today, day);
  if (diff < 0) return { text: `逾期 ${-diff} 天`, tone: "warn" };
  if (diff === 0) return { text: "今天" };
  if (diff === 1) return { text: "明天" };
  if (diff <= 30) return { text: `${diff} 天后` };
  return { text: day.slice(5).replace("-", "/") };
}

type Loader = (access: PlatformAccess, userId: number) => Promise<PortalSummary | null>;

/** 待办摘要：可指定来源，外部应用用同一份数据打通 */
async function loadTodoSummary(
  access: PlatformAccess,
  userId: number,
  options: {
    sources?: TodoSource[];
    base: string;
    statLabel: string;
    emptyNote: string;
  },
): Promise<PortalSummary> {
  const scope = scopeCondition(access, userId);
  const sourceFilter: Prisma.TodoWhereInput = options.sources?.length
    ? { source: { in: options.sources } }
    : {};
  const openWhere: Prisma.TodoWhereInput = {
    ...scope,
    ...sourceFilter,
    status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
  };
  const [open, overdue, recent] = await Promise.all([
    prisma.todo.count({ where: openWhere }),
    prisma.todo.count({ where: { ...scope, ...sourceFilter, status: "OVERDUE" } }),
    prisma.todo.findMany({
      where: openWhere,
      orderBy: [{ dueTime: "asc" }],
      take: 3,
      select: { id: true, title: true, dueTime: true, status: true },
    }),
  ]);

  const base = options.base;
  const today = zonedDate(new Date());
  const stats: SummaryStat[] = [
    { value: String(open), label: options.statLabel, href: `${base}?status=open` },
  ];
  if (overdue > 0) {
    stats.push({ value: String(overdue), label: "逾期", tone: "warn", href: `${base}?status=overdue` });
  }
  return {
    stats,
    lines: recent.map((t) => {
      const due = t.dueTime ? isoDay(t.dueTime) : null;
      const rel = due ? dayText(due, today) : null;
      return {
        text: rel ? `${t.title} · ${rel.text}` : t.title,
        tone: rel?.tone ?? (t.status === "OVERDUE" ? "warn" : undefined),
        href: `${base}?todo=${t.id}`,
      };
    }),
    note: open === 0 ? options.emptyNote : undefined,
  };
}

/** 聚合待办：所有来源 */
const todoLoader: Loader = (access, userId) =>
  loadTodoSummary(access, userId, {
    base: hrefOf("todo") ?? "/todos",
    statLabel: "待处理",
    emptyNote: "暂无待办",
  });

/** 账单/记账相关待办：外部应用（ledger）和内部账单模块共用 */
const billTodoLoader: Loader = (access, userId) =>
  loadTodoSummary(access, userId, {
    sources: ["BILL"],
    base: "/todos",
    statLabel: "账单待办",
    emptyNote: "暂无账单相关待办",
  });

/** 纪念日：总数 + 最近 3 个（农历暂按公历日期估算，P3 接 lunar-javascript 后精确） */
const anniversaryLoader: Loader = async (access, userId) => {
  const scope = scopeCondition(access, userId);
  const items = await prisma.anniversary.findMany({
    where: scope,
    select: { id: true, name: true, date: true, calendar: true },
  });
  if (items.length === 0) return { stats: [], lines: [], note: "还没有纪念日" };

  const today = zonedDate(new Date());
  const year = Number(today.slice(0, 4));
  const nextOf = (day: string): string => {
    const md = day.slice(4); // "-MM-DD"
    const thisYear = `${year}${md}`;
    return thisYear >= today ? thisYear : `${year + 1}${md}`;
  };

  const base = hrefOf("anniversary") ?? "/anniversaries";
  const upcoming = items
    .map((it) => {
      const day = isoDay(it.date);
      const next = nextOf(day);
      return {
        id: it.id,
        name: it.name,
        next,
        days: daysBetween(today, next),
        lunar: it.calendar === "LUNAR",
      };
    })
    .sort((a, b) => a.days - b.days);

  const near = upcoming[0];
  const stats: SummaryStat[] = [{ value: String(items.length), label: "个纪念日", href: base }];
  if (near.days <= 30) {
    stats.push({
      value: near.days === 0 ? "今天" : `${near.days}天`,
      label: near.name,
      tone: near.days <= 3 ? "warn" : undefined,
      href: `${base}?id=${near.id}`,
    });
  }
  return {
    stats,
    lines: upcoming.slice(0, 3).map((it) => ({
      text: `${it.name} · ${it.days === 0 ? "就是今天" : `还有 ${it.days} 天`}${it.lunar ? "（农历）" : ""}`,
      tone: it.days <= 3 ? "warn" : undefined,
      href: `${base}?id=${it.id}`,
    })),
  };
};

/** 工作：进行中项目 + 最近 3 个未完成节点 */
const workLoader: Loader = async (access, userId) => {
  const scope = scopeCondition(access, userId);
  const nodeScope = scope.ownerId ? { project: { ownerId: scope.ownerId } } : {};
  const [running, nodes] = await Promise.all([
    prisma.workProject.count({ where: { ...scope, status: "RUNNING" } }),
    prisma.workNode.findMany({
      where: { ...nodeScope, status: { in: ["PENDING", "DELAYED"] } },
      orderBy: [{ planDate: "asc" }],
      take: 3,
      select: {
        id: true,
        name: true,
        planDate: true,
        status: true,
        project: { select: { id: true, name: true } },
      },
    }),
  ]);

  const base = hrefOf("work") ?? "/work";
  const today = zonedDate(new Date());
  return {
    stats: [{ value: String(running), label: "进行中项目", href: base }],
    lines: nodes.map((n) => {
      const rel = dayText(isoDay(n.planDate), today);
      return {
        text: `${n.project.name} · ${n.name} · ${rel.text}`,
        tone: rel.tone ?? (n.status === "DELAYED" ? "warn" : undefined),
        href: `${base}?project=${n.project.id}&node=${n.id}`,
      };
    }),
    note: nodes.length === 0 ? (running === 0 ? "暂无进行中项目" : "节点都已排期完成") : undefined,
  };
};

/** 孕期：当前孕周 + 距预产期 + 最近 3 项未完成 */
const pregnancyLoader: Loader = async (access, userId) => {
  const scope = scopeCondition(access, userId);
  const pregnancy = await prisma.pregnancy.findFirst({ where: scope, orderBy: { id: "desc" } });
  if (!pregnancy) return { stats: [], lines: [], note: "还没有孕期记录" };

  const today = zonedDate(new Date());
  const days = daysBetween(today, isoDay(pregnancy.dueDate));
  const nodes = await prisma.pregNode.findMany({
    where: { pregnancyId: pregnancy.id, done: false },
    orderBy: [{ planDate: "asc" }],
    take: 3,
    select: { id: true, name: true, planDate: true },
  });

  const base = hrefOf("pregnancy") ?? "/pregnancy";
  return {
    stats: [
      { value: `${pregnancy.currentWeek}周`, label: "当前", href: base },
      {
        value: days >= 0 ? `${days}天` : "已过",
        label: "距预产期",
        tone: days <= 14 ? "warn" : undefined,
        href: `${base}?pregnancy=${pregnancy.id}`,
      },
    ],
    lines: nodes.map((n) => ({
      text: n.planDate ? `${n.name} · ${dayText(isoDay(n.planDate), today).text}` : n.name,
      href: `${base}?pregnancy=${pregnancy.id}&node=${n.id}`,
    })),
    note: nodes.length === 0 ? "近期没有待办事项" : undefined,
  };
};

/** 旅行：去过城市 + 最近 3 次行程 */
const travelLoader: Loader = async (access, userId) => {
  const scope = scopeCondition(access, userId);
  const [cities, trips] = await Promise.all([
    prisma.travelCity.count({ where: { ...scope, status: "VISITED" } }),
    prisma.travelTrip.findMany({
      where: scope,
      orderBy: { startDate: "desc" },
      take: 3,
      select: { id: true, title: true, startDate: true },
    }),
  ]);

  const base = hrefOf("travel") ?? "/travel";
  return {
    stats: [{ value: String(cities), label: "座城市", href: `${base}?tab=cities` }],
    lines: trips.map((t) => ({
      text: `${t.title} · ${isoDay(t.startDate).slice(0, 7).replace("-", "/")}`,
      href: `${base}?trip=${t.id}`,
    })),
    note: trips.length === 0 ? "还没有行程记录" : undefined,
  };
};



const LOADERS: Record<string, Loader> = {
  todo: todoLoader,
  anniversary: anniversaryLoader,
  work: workLoader,
  pregnancy: pregnancyLoader,
  travel: travelLoader,
  // 账单模块与外部记账应用共享「账单相关待办」摘要
  bill: billTodoLoader,
  ledger: billTodoLoader,
};

/**
 * 门户摘要：每个应用在卡片上展示"最近的一些数据"。
 * 返回 null 表示该应用没有可聚合的数据（如外部独立服务），卡片不渲染摘要区。
 */
export async function getPortalSummary(
  access: PlatformAccess,
  userId: number,
): Promise<PortalSummary | null> {
  const loader = LOADERS[access.code];
  if (!loader) return null;
  try {
    return await loader(access, userId);
  } catch (e) {
    // 单个应用摘要失败不能拖垮整个门户
    console.error(`[portal] ${access.code} 摘要失败`, e);
    return { stats: [], lines: [], note: "数据加载失败" };
  }
}

export async function getPortalSummaries(
  userId: number,
  platforms: PlatformAccess[],
): Promise<Record<string, PortalSummary | null>> {
  const entries = await Promise.all(
    platforms.map(async (p) => [p.code, await getPortalSummary(p, userId)] as const),
  );
  return Object.fromEntries(entries);
}
