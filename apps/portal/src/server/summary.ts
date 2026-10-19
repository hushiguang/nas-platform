import { appBaseUrl, callInternal, zonedDate, zonedDayRange, zonedTime, dayDiff } from "@nas/core";
import { prisma, type TodoStatus } from "@nas/db";
import { todoVisibilityWhere } from "@nas/todo";
import type { PlatformAccess, SessionUser } from "@nas/core";

export interface SummaryStat {
  value: string;
  label: string;
  tone?: "warn" | "ok";
  /** 点击跳转。站内是相对路径，跨应用是绝对地址 */
  href?: string;
}

export interface SummaryBill {
  /** 账单名字，带年份时是「2026 蛋糕」 */
  label: string;
  href: string;
  /** 记下这笔的时间，已经按站点时区排好 */
  createdAt: string;
}

export interface SummaryLine {
  text: string;
  tone?: "warn";
  href?: string;
  /** 悬停时展开，每一笔都能点进账单 */
  bills?: SummaryBill[];
}

export interface PortalSummary {
  stats: SummaryStat[];
  lines: SummaryLine[];
  /** 无数据/未接入时的兜底文案 */
  note?: string;
}

function formatBillTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${zonedDate(date)} ${zonedTime(date)}`;
}

/**
 * 待办概览（门户首页待办应用卡片）。
 *
 * 待办的读写入口有独立站点（apps/todo），但表就在共享库里，所以门户直接
 * 查 —— 这是本文件里唯一一处直连数据表的地方。其余应用的数据一律走各自的
 * 内部接口。注意这张卡片只看待办应用自己的数据（source = MANUAL），各平台
 * 收上来的待办（账单/纪念日/工作等）归「待办管理」页聚合展示，不进这张卡片。
 */
async function todoSummary(
  user: SessionUser,
  access: PlatformAccess,
  allSources = false,
): Promise<PortalSummary> {
  // 可见范围与待办应用共用同一个条件：未归类看本人，挂在清单上的按清单可见性。
  // 管理员（dataScope = ALL）看全部。口径只此一处，别在这儿自己拼 ownerId。
  const scope = await todoVisibilityWhere(user.id, access.dataScope === "ALL");
  // 首页待办应用卡片只看待办平台自身的数据（source = MANUAL）；
  // 「待办管理」页是聚合视图（allSources = true），各平台收上来的照常出现。
  const sourceFilter: { source?: "MANUAL" } = allSources ? {} : { source: "MANUAL" };
  const now = new Date();
  const { end } = zonedDayRange(now);
  const today = zonedDate(now);
  // 不加 as const：Prisma 的 in 过滤器要的是可写数组，readonly 元组过不了类型
  const openStatus = { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] as TodoStatus[] };

  const [open, overdue, dueSoon, upcoming] = await Promise.all([
    prisma.todo.count({ where: { ...scope, ...sourceFilter, status: "PENDING" } }),
    prisma.todo.count({ where: { ...scope, ...sourceFilter, status: "OVERDUE" } }),
    prisma.todo.count({
      where: { ...scope, ...sourceFilter, status: { in: ["PENDING", "IN_PROGRESS"] }, dueTime: { lte: end } },
    }),
    prisma.todo.findMany({
      where: { ...scope, ...sourceFilter, status: openStatus },
      orderBy: [{ dueTime: "asc" }, { id: "asc" }],
      take: 3,
      select: { id: true, title: true, dueTime: true },
    }),
  ]);

  const lines: SummaryLine[] = upcoming.map((row) => {
    const due = row.dueTime;
    let when = "无期限";
    if (due) {
      const day = due.toISOString().slice(0, 10);
      const diff = dayDiff(day, today);
      when =
        diff < 0
          ? `逾期 ${-diff} 天`
          : diff === 0
            ? `今天 ${zonedTime(due)}`
            : diff === 1
              ? `明天 ${zonedTime(due)}`
              : `${diff} 天后`;
    }
    return {
      text: `${row.title}（${when}）`,
      tone: due && due.getTime() < now.getTime() ? "warn" : undefined,
      href: `/todos?todo=${row.id}`,
    };
  });

  return {
    stats: [
      { value: String(open), label: "待处理", href: "/todos?status=open" },
      { value: String(overdue), label: "逾期", tone: overdue > 0 ? "warn" : undefined, href: "/todos?status=overdue" },
      { value: String(dueSoon), label: "今日到期", href: "/todos?status=open" },
    ],
    lines,
    note: lines.length === 0 ? "近期没有待办" : undefined,
  };
}

interface BillSummaryPayload {
  year: number;
  month: number;
  count: number;
  expense: string;
  income: string;
}

interface WorkSummaryPayload {
  total: number;
  running: number;
  delayed: number;
  openIssues: number;
  items: Array<{ projectId: number; text: string; warn: boolean }>;
}

interface AnniversarySummaryPayload {
  withinDays: number;
  count: number;
  items: Array<{
    id: number;
    name: string;
    days: number;
    when: string;
    bills?: Array<{ label: string; href: string; createdAt: string }>;
  }>;
}

/**
 * 纪念日概览：30 天内临近的日子。每条都能点进纪念日自己的详情页。
 * 具体哪一天算“临近”由纪念日应用决定（见 UPCOMING_DAYS），门户只负责展示。
 */
async function anniversarySummary(userId: number): Promise<PortalSummary | null> {
  const base = appBaseUrl("anniversary");
  if (!base) return null;

  const data = await callInternal<AnniversarySummaryPayload>(
    `${base}/api/internal/summary?userId=${userId}`,
  );
  if (!data) return null;

  const lines: SummaryLine[] = data.items.map((item) => {
    const bills = (item.bills ?? [])
      .map((bill) => ({
        label: bill.label,
        href: bill.href,
        createdAt: formatBillTime(bill.createdAt),
      }))
      .filter((bill) => bill.label && bill.href);
    return {
      text: `${item.name} · ${item.when}`,
      href: `${base}/a/${item.id}`,
      tone: item.days <= 1 ? "warn" : undefined,
      bills: bills.length > 0 ? bills : undefined,
    };
  });

  return {
    stats:
      data.count > 0
        ? [
            {
              value: String(data.count),
              label: "临近提醒",
              href: data.items[0] ? `${base}/a/${data.items[0].id}` : base,
            },
          ]
        : [],
    lines,
    note: data.count === 0 ? "近30天没有纪念日提醒" : undefined,
  };
}

/**
 * 工作台概览：这个人负责或参与的项目里，近期要盯的节点。
 * 数字由工作台自己算，门户只展示。
 */
async function workSummary(userId: number): Promise<PortalSummary | null> {
  const base = appBaseUrl("work");
  if (!base) return null;

  const data = await callInternal<WorkSummaryPayload>(`${base}/api/internal/summary?userId=${userId}`);
  if (!data) return null;

  const lines: SummaryLine[] = data.items.map((item) => ({
    text: item.text,
    href: `${base}/p/${item.projectId}`,
    tone: item.warn ? "warn" : undefined,
  }));

  return {
    stats:
      data.total > 0
        ? [
            { value: String(data.running), label: "进行中", href: base },
            {
              value: String(data.delayed),
              label: "已延期",
              tone: data.delayed > 0 ? "warn" : undefined,
              href: `${base}/digest`,
            },
            { value: String(data.openIssues), label: "未关闭", href: base },
          ]
        : [],
    lines,
    note: data.total === 0 ? "还没有项目" : lines.length === 0 ? "近期没有要盯的节点" : undefined,
  };
}

/**
 * 账单概览：调账单应用的内部接口，而不是直读 bill_* 表。
 *
 * 这样账单应用可以自己改表结构、自己升级，门户不需要跟着动。代价是多一次
 * 跨容器的 HTTP 调用 —— 所以 callInternal 有 3 秒超时且失败返回 null，
 * 账单容器没起来时门户首页照样能打开，只是这张卡片没有数字。
 */
async function billSummary(userId: number): Promise<PortalSummary | null> {
  const base = appBaseUrl("bill");
  if (!base) return null;

  const data = await callInternal<BillSummaryPayload>(
    `${base}/api/internal/summary?userId=${userId}`,
  );
  if (!data) return null;

  return {
    stats: [
      { value: `¥${data.expense}`, label: `${data.month} 月支出`, href: base },
      { value: `¥${data.income}`, label: `${data.month} 月收入`, href: base },
    ],
    lines: data.count > 0 ? [{ text: `本月已记 ${data.count} 笔`, href: base }] : [],
    note: data.count === 0 ? "本月还没有记账" : undefined,
  };
}

interface TravelSummaryPayload {
  tripCount: number;
  cityCount: number;
  visitedCount: number;
  photoCount: number;
  recent: Array<{
    id: number;
    title: string;
    startDate: string;
    endDate: string;
    cityName: string | null;
  }>;
}

/**
 * 旅行足迹概览：多少趟行程、去过多少城市，最近几趟可点进去看日记。
 */
async function travelSummary(userId: number): Promise<PortalSummary | null> {
  const base = appBaseUrl("travel");
  if (!base) return null;

  const data = await callInternal<TravelSummaryPayload>(`${base}/api/internal/summary?userId=${userId}`);
  if (!data) return null;

  const lines: SummaryLine[] = data.recent.slice(0, 3).map((trip) => ({
    text: `${trip.title} · ${trip.startDate}`,
    href: `${base}/trips/${trip.id}`,
  }));

  return {
    stats:
      data.tripCount > 0
        ? [
            { value: String(data.tripCount), label: "趟行程", href: `${base}/trips` },
            { value: String(data.visitedCount), label: "去过城市", href: `${base}/cities` },
          ]
        : [],
    lines,
    note: data.tripCount === 0 ? "还没有旅行记录" : undefined,
  };
}

/**
 * 「待办管理」页顶部的统计：聚合视图，各平台收上来的待办都在内。
 * 门户首页的待办应用卡片走 `getPortalSummary`（仅 MANUAL），别混用。
 */
export function todoPortalSummary(user: SessionUser): Promise<PortalSummary> {
  return todoSummary(
    user,
    {
      code: "todo",
      name: "待办管理",
      description: null,
      icon: "",
      cover: null,
      group: null,
      url: null,
      isExternal: false,
      sort: 0,
      dataScope: user.role === "ADMIN" ? "ALL" : "SELF",
    },
    true,
  );
}

export interface AnniversaryHint {
  text: string;
  href: string;
  tone?: "warn";
  bills: SummaryBill[];
}

/** 近30天临近的纪念日提醒，带上可以点开的账单。管理员看全部 */
export async function anniversaryHints(user: SessionUser): Promise<Map<number, AnniversaryHint>> {
  const base = appBaseUrl("anniversary");
  const hints = new Map<number, AnniversaryHint>();
  if (!base) return hints;

  const url =
    user.role === "ADMIN"
      ? `${base}/api/internal/summary?scope=all`
      : `${base}/api/internal/summary?userId=${user.id}`;
  const data = await callInternal<AnniversarySummaryPayload>(url);
  if (!data) return hints;

  for (const item of data.items) {
    const bills = (item.bills ?? [])
      .map((bill) => ({
        label: bill.label,
        href: bill.href,
        createdAt: formatBillTime(bill.createdAt),
      }))
      .filter((bill) => bill.label && bill.href);
    hints.set(item.id, {
      text: `${item.name} · ${item.when}`,
      href: `${base}/a/${item.id}`,
      tone: item.days <= 1 ? "warn" : undefined,
      bills,
    });
  }
  return hints;
}

/** 先把临近纪念日收成待办，再查汇总，数字才对得上 */
export async function ensureAnniversaryTodos(): Promise<void> {
  const base = appBaseUrl("anniversary");
  if (!base) return;
  await callInternal(`${base}/api/internal/job/generate-todos`, { method: "POST", timeoutMs: 8000 });
}

/** 把勾了后续跟进、或不计入费用的账单收成待办 */
export async function ensureBillFollowTodos(): Promise<void> {
  const base = appBaseUrl("bill");
  if (!base) return;
  await callInternal(`${base}/api/internal/job/generate-todos`, { method: "POST", timeoutMs: 8000 });
}

/** 单个应用的概览。未接入的应用返回 null，卡片上显示「暂无概览数据」 */
export async function getPortalSummary(
  user: SessionUser,
  access: PlatformAccess,
): Promise<PortalSummary | null> {
  if (access.isExternal) return null;
  switch (access.code) {
    case "todo":
      return todoSummary(user, access);
    case "bill":
      return billSummary(user.id);
    case "anniversary":
      return anniversarySummary(user.id);
    case "work":
      return workSummary(user.id);
    case "travel":
      return travelSummary(user.id);
    default:
      return null;
  }
}

/** 各应用的概览一起取。任何一个应用挂了都不影响其余的（各自失败各自降级） */
export async function getPortalSummaries(
  user: SessionUser,
  platforms: PlatformAccess[],
): Promise<Record<string, PortalSummary | null>> {
  const entries = await Promise.all(
    platforms.map(async (access) => [access.code, await getPortalSummary(user, access)] as const),
  );
  return Object.fromEntries(entries);
}
