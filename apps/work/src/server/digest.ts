import { appBaseUrl, dayDiff, zonedDate, zonedMinutes, type PlatformAccess } from "@nas/core";
import { prisma, type Prisma } from "@nas/db";
import { sendNotify } from "@nas/notify";
import { ISSUE_KIND_LABEL, ISSUE_LABEL, PHASE_LABEL } from "@/lib/labels";
import { dayLabel, isoDay, todayIso, utcDay } from "./dates";
import { visibleWhere } from "./project";

export interface DigestItem {
  projectId: number;
  projectName: string;
  text: string;
  tone?: "warn";
  /** 相对今天的天数：负数=逾期，正数=还有几天 */
  days?: number;
}

export interface DigestView {
  slot: "morning" | "evening";
  title: string;
  day: string;
  dayText: string;
  running: number;
  /** 当前阶段已过结束日 */
  delayed: DigestItem[];
  /** 当前阶段今天结束 */
  dueToday: DigestItem[];
  /** 当前阶段未来 1～7 天结束，按最近倒序 */
  dueSoon: DigestItem[];
  /** 已上线、退出预警 */
  doneToday: DigestItem[];
  /** 未关闭的问题（兼容老展示，= 缺陷 + 优化） */
  issues: DigestItem[];
  /** 未关闭的缺陷 */
  bugs: DigestItem[];
  /** 未关闭的优化 */
  improvements: DigestItem[];
}

export interface WorkSummary {
  total: number;
  running: number;
  delayed: number;
  openIssues: number;
  items: Array<{ projectId: number; text: string; warn: boolean }>;
}

type DigestRow = Prisma.WorkProjectGetPayload<{
  include: {
    phases: { include: { members: true } };
    issues: { where: { status: { in: ["OPEN", "RESOLVING"] } } };
  };
}>;

function currentSlot(now = new Date()): "morning" | "evening" {
  return zonedMinutes(now) < 14 * 60 ? "morning" : "evening";
}

function active(status: DigestRow["status"]): boolean {
  return status === "PREPARING" || status === "RUNNING";
}

function short(text: string, max = 42): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** 上海时区的那天 09:00。和纪念日提醒用的是同一种墙钟换算。 */
function shanghaiDue(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 9 - 8, 0, 0));
}

async function loadDigestRows(where: Prisma.WorkProjectWhereInput): Promise<DigestRow[]> {
  return prisma.workProject.findMany({
    where,
    include: {
      phases: { orderBy: { sort: "asc" }, include: { members: true } },
      issues: {
        where: { status: { in: ["OPEN", "RESOLVING"] } },
        orderBy: { updatedAt: "desc" },
      },
    },
    orderBy: { id: "asc" },
  });
}

/**
 * 风险预报只看当前阶段：项目的风险由「这一步什么时候结束」决定，
 * 不是由历史上遗留的节点决定。阶段没排结束日就先不预警，等排期补上。
 */
function buildDigest(rows: DigestRow[], now = new Date()): DigestView {
  const day = zonedDate(now);
  const slot = currentSlot(now);
  const dueToday: DigestItem[] = [];
  const delayed: DigestItem[] = [];
  const dueSoon: DigestItem[] = [];
  const doneToday: DigestItem[] = [];
  const bugs: DigestItem[] = [];
  const improvements: DigestItem[] = [];
  let running = 0;

  for (const project of rows) {
    if (project.status === "RUNNING") running += 1;
    // 已上线的项目退出预警。暂停的保留，但今天结束不再催。
    if (project.status === "DONE") continue;
    const phase = project.phases.find((item) => item.kind === project.phase);
    const end = isoDay(phase?.endDate);
    if (project.phase !== "LIVE" && end && phase?.enabled) {
      const days = dayDiff(end, day);
      const item = {
        projectId: project.id,
        projectName: project.name,
        text: `${PHASE_LABEL[project.phase]} · ${dayLabel(end)}结束`,
        days,
      };
      if (days < 0) delayed.push({ ...item, tone: "warn" });
      else if (days === 0 && active(project.status)) dueToday.push(item);
      else if (active(project.status) && days >= 1 && days <= 7) dueSoon.push(item);
    }
    for (const issue of project.issues) {
      const item: DigestItem = {
        projectId: project.id,
        projectName: project.name,
        text: short(issue.description),
        tone: issue.status === "OPEN" ? "warn" : undefined,
      };
      if (issue.kind === "IMPROVEMENT") improvements.push(item);
      else bugs.push(item);
    }
  }

  delayed.sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  dueSoon.sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  return {
    slot,
    title: slot === "morning" ? "工作早会" : "工作晚报",
    day,
    dayText: dayLabel(day),
    running,
    dueToday,
    delayed,
    dueSoon,
    doneToday,
    issues: [...bugs, ...improvements],
    bugs,
    improvements,
  };
}

export function digestIsQuiet(view: DigestView): boolean {
  if (view.dueToday.length || view.delayed.length || view.dueSoon.length || view.issues.length) return false;
  if (view.slot === "evening" && view.doneToday.length) return false;
  return true;
}

/**
 * 企微群机器人只认 [文字](链接) 行内链接。工作台不一定配了对外地址，
 * 没地址就退化成纯文字，至少消息能发出去。
 */
function projectLink(item: DigestItem): string {
  const base = appBaseUrl("work");
  const text = `${item.projectName} / ${item.text}`;
  return base ? `[${text}](${base}/p/${item.projectId})` : text;
}

function section(title: string, items: DigestItem[], limit = 8): string[] {
  if (items.length === 0) return [];
  const lines = [title];
  for (const item of items.slice(0, limit)) lines.push(`- ${projectLink(item)}`);
  if (items.length > limit) lines.push(`还有 ${items.length - limit} 条`);
  return lines;
}

/** 群机器人是 markdown 卡片：加粗标题 + 可点进项目的行内链接 */
function renderDigest(view: DigestView, day: string): string {
  const lines = [
    `## 【${view.title}】${day}`,
    `进行中 ${view.running} 个`,
    ...section("**阶段已逾期**", view.delayed),
    ...section("**阶段今天结束**", view.dueToday),
    ...section("**阶段 7 天内结束**", view.dueSoon),
  ];
  if (view.issues.length > 0) lines.push(...section(`**未关闭问题 ${view.issues.length}**`, view.issues));
  return lines.join("\n");
}

export async function digestFor(access: PlatformAccess, userId: number): Promise<DigestView> {
  const rows = await loadDigestRows(visibleWhere(access, userId));
  return buildDigest(rows);
}

/** 推送和门户卡片只看这个人负责或参与的。打开工作台时，管理员仍按数据范围看全部。 */
function personalWhere(userId: number): Prisma.WorkProjectWhereInput {
  return {
    OR: [
      { ownerId: userId },
      { members: { some: { userId } } },
      { phases: { some: { members: { some: { userId } } } } },
    ],
  };
}

/**
 * 早 08:30 / 晚 18:30 由 worker 叫醒。
 * 先把风险预报（阶段逾期 / 7 天内结束）和待修问题收成负责人待办，再按人推一条汇总。
 * 待办靠 source + sourceBizId + 当天去重，通知靠 dedupeKey，重复跑不会多出记录。
 */
export async function runWorkDigest(): Promise<{ todos: number; notified: number }> {
  const todos = await syncPhaseTodos();
  const day = todayIso();
  const slot = currentSlot();
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });
  let notified = 0;
  for (const user of users) {
    const rows = await loadDigestRows(personalWhere(user.id));
    const view = buildDigest(rows);
    if (digestIsQuiet(view)) continue;
    const result = await sendNotify({
      userId: user.id,
      title: `【${view.title}】${day}`,
      content: renderDigest(view, day),
      dedupeKey: `work-digest:${day}:${slot}:${user.id}`,
    });
    notified += result.queued;
  }
  console.log(`[job] work-digest ${day} ${slot} todos=${todos} notified=${notified}`);
  return { todos, notified };
}

/**
 * 风险预报收成负责人待办，和风险预报页同一口径：
 *
 * - 阶段风险：只看当前阶段的结束日 —— 已逾期、今天结束、7 天内结束都收；
 *   没排结束日的不催，也不看历史节点。
 * - 待修问题：项目里还有未关闭的问题（未处理 / 处理中），收一条汇总待办。
 *
 * 待办靠 source + sourceBizId + 当天去重，问题关掉、下期排开后会自动清掉旧的。
 */
export async function syncPhaseTodos(): Promise<number> {
  const today = todayIso();
  const triggerDate = utcDay(today);
  const rows = await loadDigestRows({});
  const due: Array<{
    projectId: number;
    projectName: string;
    ownerId: number;
    sourceBizId: string;
    title: string;
    description: string;
    priority: "HIGH" | "MEDIUM";
  }> = [];

  for (const project of rows) {
    if (project.status === "DONE") continue;
    // 未上线项目的未关闭问题收成待办：标题带数量，描述逐条列出来，点「去处理」跳项目页
    if (project.issues.length > 0) {
      const bugCount = project.issues.filter((issue) => issue.kind !== "IMPROVEMENT").length;
      const lines = project.issues
        .slice(0, 8)
        .map(
          (issue) =>
            `·【${ISSUE_KIND_LABEL[issue.kind]}·${ISSUE_LABEL[issue.status]}】${short(issue.description, 60)}`,
        );
      if (project.issues.length > 8) lines.push(`还有 ${project.issues.length - 8} 条`);
      due.push({
        projectId: project.id,
        projectName: project.name,
        ownerId: project.ownerId,
        sourceBizId: `work-issues:${project.id}`,
        title: `${project.name} · 待修问题 ${project.issues.length} 个${bugCount > 0 ? `（${bugCount} 个缺陷）` : ""}`,
        description: lines.join("\n"),
        priority: bugCount > 0 || project.issues.some((issue) => issue.status === "OPEN") ? "HIGH" : "MEDIUM",
      });
    }
    if (project.phase === "LIVE") continue;
    const phase = project.phases.find((item) => item.kind === project.phase);
    const end = isoDay(phase?.endDate);
    const days = end ? dayDiff(end, today) : Number.POSITIVE_INFINITY;
    if (!phase?.enabled || days > 7) continue;
    const when =
      days < 0 ? `逾期 ${-days} 天` : days === 0 ? "今天结束" : `${days} 天后结束`;
    due.push({
      projectId: project.id,
      projectName: project.name,
      ownerId: project.ownerId,
      sourceBizId: `work-phase:${project.id}:${project.phase}`,
      title: `${project.name} · ${PHASE_LABEL[project.phase]}${when}`,
      description: `风险预报：当前阶段计划 ${end} 结束`,
      priority: days <= 0 ? "HIGH" : "MEDIUM",
    });
  }

  const activeKeys = due.map((item) => item.sourceBizId);
  // 节点待办和人员冲突待办都已淘汰，直接清掉。
  await prisma.todo.deleteMany({
    where: {
      source: "WORK",
      status: { not: "DONE" },
      OR: [
        { sourceBizId: { startsWith: "work-node:" } },
        { sourceBizId: { startsWith: "work-conflict:" } },
      ],
    },
  });
  await prisma.todo.deleteMany({
    where: {
      source: "WORK",
      status: { not: "DONE" },
      sourceBizId: { startsWith: "work-phase:" },
      ...(activeKeys.length > 0
        ? { OR: [{ sourceBizId: { notIn: activeKeys } }, { triggerDate: { not: triggerDate } }] }
        : {}),
    },
  });
  await prisma.todo.deleteMany({
    where: {
      source: "WORK",
      status: { not: "DONE" },
      sourceBizId: { startsWith: "work-issues:" },
      ...(activeKeys.length > 0
        ? { OR: [{ sourceBizId: { notIn: activeKeys } }, { triggerDate: { not: triggerDate } }] }
        : {}),
    },
  });

  // 负责人可能指向已不存在的用户（历史数据沿用旧库 id）。待办要连 User 外键，
  // 连不上会整条 upsert 报错，所以先挑出真实存在的负责人。
  const liveOwners = new Set(
    (
      await prisma.user.findMany({
        where: { id: { in: [...new Set(due.map((item) => item.ownerId))] } },
        select: { id: true },
      })
    ).map((user) => user.id),
  );

  let created = 0;
  for (const item of due) {
    if (!liveOwners.has(item.ownerId)) continue;
    await prisma.todo.upsert({
      where: {
        source_sourceBizId_triggerDate: { source: "WORK", sourceBizId: item.sourceBizId, triggerDate },
      },
      create: {
        title: item.title,
        description: item.description,
        source: "WORK",
        sourceBizId: item.sourceBizId,
        priority: item.priority,
        dueTime: shanghaiDue(today),
        remindRules: [{ offsetDays: 0, time: "09:00" }],
        triggerDate,
        owner: { connect: { id: item.ownerId } },
      },
      update: {
        title: item.title,
        description: item.description,
        priority: item.priority,
        dueTime: shanghaiDue(today),
        remindRules: [{ offsetDays: 0, time: "09:00" }],
        owner: { connect: { id: item.ownerId } },
      },
    });
    created += 1;
  }
  return created;
}

export async function workSummary(where: Prisma.WorkProjectWhereInput): Promise<WorkSummary> {
  const rows = await loadDigestRows(where);
  const today = todayIso();
  let running = 0;
  let delayed = 0;
  let openIssues = 0;
  const upcoming: Array<{ projectId: number; text: string; warn: boolean; days: number }> = [];

  for (const project of rows) {
    if (project.status === "RUNNING") running += 1;
    if (project.status === "DONE") continue;
    openIssues += project.issues.length;
    if (project.phase === "LIVE") continue;
    const phase = project.phases.find((item) => item.kind === project.phase);
    const end = isoDay(phase?.endDate);
    if (!phase?.enabled || !end) continue;
    const days = dayDiff(end, today);
    if (days < 0) delayed += 1;
    if (days > 7) continue;
    upcoming.push({
      projectId: project.id,
      text: `${project.name} · ${PHASE_LABEL[project.phase]}（${days < 0 ? `逾期 ${-days} 天` : days === 0 ? "今天结束" : `${days} 天后结束`}）`,
      warn: days <= 0,
      days,
    });
  }

  upcoming.sort((a, b) => a.days - b.days);
  return {
    total: rows.length,
    running,
    delayed,
    openIssues,
    items: upcoming.slice(0, 3).map(({ projectId, text, warn }) => ({ projectId, text, warn })),
  };
}

export async function summaryForUser(userId: number): Promise<WorkSummary> {
  return workSummary(personalWhere(userId));
}

export async function summaryAll(): Promise<WorkSummary> {
  return workSummary({});
}
