import { dayDiff, type PlatformAccess, type SessionUser, zonedDate, zonedTime } from "@nas/core";
import { prisma, Prisma, type IssueKind, type IssueStatus, type NodeStatus, type ProjectStatus, type WorkPhaseItemStatus, type WorkPhaseKind, type WorkPriority } from "@nas/db";
import { isAllowedImageUrl } from "@nas/media";
import {
  ISSUE_KIND_LABEL,
  ISSUE_LABEL,
  NODE_LABEL,
  PHASE_GROUP,
  PHASE_ITEM_STATUS_LABEL,
  PHASE_LABEL,
  PHASE_RANK,
  PHASE_SHORT,
  PRIORITY_LABEL,
  PRIORITY_RANK,
  PROJECT_LABEL,
} from "@/lib/labels";
import { canManage, visibleWhere } from "./access";
import { dayLabel, isoDay, parseDay, rangeLabel, todayIso, utcDay, whenText } from "./dates";
import { WorkError } from "./errors";
import { parseNames } from "./names";
import { ensurePhases, expectedProgress, phaseExpected, phaseProgressOf, workProgress } from "./phase";

export { canManage, visibleWhere };

const detailInclude = {
  nodes: { orderBy: { planDate: "asc" as const } },
  issues: { orderBy: { updatedAt: "desc" as const } },
  members: true,
  phases: {
    orderBy: { sort: "asc" as const },
    include: {
      members: { orderBy: { id: "asc" as const } },
      items: {
        orderBy: { sort: "asc" as const },
        include: { members: { orderBy: { id: "asc" as const } } },
      },
    },
  },
} satisfies Prisma.WorkProjectInclude;

type ProjectRow = Prisma.WorkProjectGetPayload<{ include: typeof detailInclude }>;

export interface PersonOption {
  id: number;
  nickname: string;
}

export interface ProjectDraft {
  id?: number;
  name: string;
  code: string;
  status: ProjectStatus;
  priority: WorkPriority;
  phase: WorkPhaseKind;
  startDate: string;
  endDate: string;
  launchDate: string;
  description: string;
  progress: number;
}

export interface NodeView {
  id: number;
  name: string;
  planDate: string;
  planLabel: string;
  status: NodeStatus;
  statusLabel: string;
  ownerId: number | null;
  ownerName: string | null;
  days: number;
  when: string;
}

export interface IssueView {
  id: number;
  description: string;
  impact: string | null;
  solution: string | null;
  status: IssueStatus;
  statusLabel: string;
  kind: IssueKind;
  kindLabel: string;
  handler: string;
  phaseId: number | null;
  phaseLabel: string | null;
  /** 图床返回的地址，展示时统一走 /api/media/image 代理 */
  images: string[];
  /** 创建时间，ISO 字符串，供排序 */
  createdAt: string;
  /** 时间轴上显示的创建时间，如 2026-10-20 16:30 */
  createdLabel: string;
}

/** 一个人在某条事项上的投入。百分比只属于这一条事项。 */
export interface PhaseAllocationView {
  itemId: number;
  itemName: string;
  memberId: number;
  ratio: number;
}

export interface PhaseMemberView {
  id: number;
  userId: number | null;
  name: string;
  external: boolean;
  role: string;
  startDate: string;
  endDate: string;
  span: string;
  release: string;
  /** 没拆到事项上时，沿用阶段上的旧比例；拆开之后这里是各事项百分比之和 */
  ratio: number;
  /** 这个人在本阶段各事项上的投入。有内容时，百分比以这里为准 */
  allocations: PhaseAllocationView[];
}

export interface PhaseItemMemberView {
  id: number;
  name: string;
  external: boolean;
  ratio: number;
  /** 这条事项上的预计释放日，ISO 日期；没填是空字符串 */
  endDate: string;
  release: string;
}

export interface PhaseItemView {
  id: number;
  name: string;
  status: WorkPhaseItemStatus;
  statusLabel: string;
  /** 单独记百分比的事项（研发实施 / SIT测试 / UAT测试） */
  trackProgress: boolean;
  /** UAT 新增需求。自己有起止、研发进入日和进度，按天数计入阶段实际进度 */
  rework: boolean;
  /** 新增需求的起始、结束，ISO 日期；没有是空字符串 */
  startDate: string;
  endDate: string;
  span: string;
  /** 这一轮研发进入日，ISO 日期；没有是空字符串 */
  devEnterDate: string;
  devEnterLabel: string;
  progress: number;
  link: string;
  note: string;
  members: PhaseItemMemberView[];
}

export interface PhaseView {
  id: number;
  kind: WorkPhaseKind;
  label: string;
  enabled: boolean;
  startDate: string;
  endDate: string;
  range: string;
  /** 所需天数，含首尾；没排期或结束早于开始时为 null */
  days: number | null;
  devEnterDate: string;
  devEnterLabel: string;
  progress: number;
  expected: number | null;
  items: PhaseItemView[];
  itemDone: number;
  itemTotal: number;
  members: PhaseMemberView[];
}

export interface QualityStats {
  total: number;
  fixed: number;
  remaining: number;
}

export interface MemberView {
  id: number;
  userId: number | null;
  nickname: string;
  role: string;
  ratio: number;
}

export interface ProjectView {
  id: number;
  name: string;
  code: string | null;
  status: ProjectStatus;
  statusLabel: string;
  priority: WorkPriority;
  priorityLabel: string;
  phase: WorkPhaseKind;
  phaseLabel: string;
  /** 大阶段：商务 / 研发 / 测试 / 上线 */
  phaseGroupLabel: string;
  /** 小阶段：具体走到哪一步，如 研发节点 / SIT测试 / UAT */
  phaseShortLabel: string;
  /** 当前阶段正在做/下一个要做的节点，如 UAT阶段下的「环境部署」 */
  stageNodeLabel: string;
  /** 研发实施进度（%），没有记进度的事项时为 null */
  devProgress: number | null;
  /** 测试进度（SIT / UAT 单独记进度的事项平均），没有时为 null */
  testProgress: number | null;
  startDate: string;
  endDate: string;
  dates: string;
  launchDate: string;
  launchLabel: string;
  description: string | null;
  /** 实际进度：只按研发 + 测试阶段算，都来自于手填的百分比。没有研发 / 测试阶段时为 null */
  progress: number | null;
  expected: number | null;
  ownerId: number;
  ownerName: string;
  /** 项目经理。导入的项目人是系统外人员，没有账号，名字单独存在这里 */
  managerName: string | null;
  canManage: boolean;
  nodes: NodeView[];
  issues: IssueView[];
  members: MemberView[];
  phases: PhaseView[];
  openIssues: number;
  bug: QualityStats;
  improvement: QualityStats;
  showQuality: boolean;
  /** 当前阶段在启用阶段里排第几，从1 开始。已上线算走到终点 */
  stageIndex: number;
  /** 参与计数的启用阶段总数，不含「已上线」 */
  stageTotal: number;
  /** 阶段进度文案，如 UAT阶段 · 3/5 */
  stageLabel: string;
  doneNodes: number;
  nodeTotal: number;
  nextLabel: string;
  nextDays: number | null;
  /** 当前阶段的到期文案，按该阶段结束日算：UAT阶段 · 逾期 2 天 / 今天到期 / 5 天后到期 / 未排期 / 已上线 */
  phaseDueLabel: string;
  /** 当前阶段逾期天数：未逾期（含当天到期）、未排期、已上线都是 null */
  phaseOverdue: number | null;
  delayed: number;
  draft: ProjectDraft;
}

/** 计划日已过、还没完成的节点改成延期。重复跑没有额外副作用。 */
export async function refreshDelayedNodes(): Promise<number> {
  const today = utcDay(todayIso());
  const result = await prisma.workNode.updateMany({
    where: { status: "PENDING", planDate: { lt: today } },
    data: { status: "DELAYED" },
  });
  return result.count;
}

export async function clearNodeTodos(nodeId: number): Promise<void> {
  await prisma.todo.deleteMany({
    where: {
      source: "WORK",
      sourceBizId: nodeBizId(nodeId),
      status: { not: "DONE" },
    },
  });
}

export function nodeBizId(nodeId: number): string {
  return `work-node:${nodeId}`;
}

/** 当前阶段的到期文案。结束日当天 23:59:59 前都算今天到期，不再算逾期；已上线或没排期不算逾期。 */
export function phaseDueOf(
  phaseLabel: string,
  phase: WorkPhaseKind,
  endDate: string,
  today: string,
): { label: string; overdue: number | null } {
  if (phase === "LIVE") return { label: phaseLabel, overdue: null };
  if (!endDate) return { label: `${phaseLabel} · 未排期`, overdue: null };
  const late = dayDiff(endDate, today);
  if (late < 0) return { label: `${phaseLabel} · 逾期 ${-late} 天`, overdue: late };
  if (late === 0) return { label: `${phaseLabel} · 今天到期`, overdue: null };
  if (late === 1) return { label: `${phaseLabel} · 明天到期`, overdue: null };
  return { label: `${phaseLabel} · ${late} 天后到期`, overdue: null };
}

function collectIds(rows: ProjectRow[]): number[] {
  const ids: number[] = [];
  for (const row of rows) {
    ids.push(row.ownerId);
    for (const member of row.members) if (member.userId) ids.push(member.userId);
    for (const node of row.nodes) if (node.ownerId) ids.push(node.ownerId);
    for (const issue of row.issues) if (issue.ownerId) ids.push(issue.ownerId);
    for (const phase of row.phases) {
      for (const member of phase.members) if (member.userId) ids.push(member.userId);
    }
  }
  return ids;
}

const ISSUE_IMAGE_LIMIT = 9;

/** 库里存的是 JSON 数组，读出时过滤掉脏数据；老记录没有这个字段就是空数组。 */
function issueImages(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function issueTimeLabel(date: Date): string {
  return `${zonedDate(date)} ${zonedTime(date)}`;
}

/** 纯图片记录没有文字，摘要用张数代替。 */
function issueBrief(issue: { description: string; images: Prisma.JsonValue | null }): string {
  const text = issue.description.replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 24);
  const count = issueImages(issue.images).length;
  return count > 0 ? `图片记录（${count} 张）` : "问题";
}

function parseIssueImages(form: FormData): string[] {
  const raw = String(form.get("images") ?? "");
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WorkError("图片数据不对");
  }
  if (!Array.isArray(parsed)) throw new WorkError("图片数据不对");
  const urls: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string" || !item.trim()) continue;
    const [allowed, reason] = isAllowedImageUrl(item);
    if (!allowed) throw new WorkError(reason ?? "图片地址不对");
    if (!urls.includes(item)) urls.push(item);
  }
  if (urls.length > ISSUE_IMAGE_LIMIT) throw new WorkError(`一次最多 ${ISSUE_IMAGE_LIMIT} 张图`);
  return urls;
}

async function nicknames(ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((id) => id > 0))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, nickname: true },
  });
  return new Map(users.map((user) => [user.id, user.nickname]));
}

function present(row: ProjectRow, names: Map<number, string>, access: PlatformAccess, userId: number): ProjectView {
  const today = todayIso();
  const nodes: NodeView[] = row.nodes.map((node) => {
    const planDate = isoDay(node.planDate);
    const days = dayDiff(planDate, today);
    return {
      id: node.id,
      name: node.name,
      planDate,
      planLabel: dayLabel(planDate),
      status: node.status,
      statusLabel: NODE_LABEL[node.status],
      ownerId: node.ownerId,
      ownerName: node.ownerId ? (names.get(node.ownerId) ?? null) : null,
      days,
      when: whenText(days, node.status),
    };
  });
  const nodeName = new Map(row.nodes.map((node) => [node.id, node.name]));
  const phaseName = new Map(row.phases.map((phase) => [phase.id, PHASE_LABEL[phase.kind]]));
  // 时间轴按创建时间倒序：最近记的问题在最上面，状态只作为标签展示
  const issues: IssueView[] = [...row.issues]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
    .map((issue) => ({
      id: issue.id,
      description: issue.description,
      impact: issue.impact,
      solution: issue.solution,
      status: issue.status,
      statusLabel: ISSUE_LABEL[issue.status],
      kind: issue.kind,
      kindLabel: ISSUE_KIND_LABEL[issue.kind],
      handler: issue.handler || (issue.ownerId ? (names.get(issue.ownerId) ?? "") : ""),
      phaseId: issue.phaseId,
      phaseLabel: issue.phaseId
        ? (phaseName.get(issue.phaseId) ?? null)
        : issue.nodeId
          ? (nodeName.get(issue.nodeId) ?? null)
          : null,
      images: issueImages(issue.images),
      createdAt: issue.createdAt.toISOString(),
      createdLabel: issueTimeLabel(issue.createdAt),
    }));
  const doneNodes = nodes.filter((node) => node.status === "DONE").length;
  const todoNodes = nodes
    .filter((node) => node.status !== "DONE")
    .sort((a, b) => a.days - b.days || a.id - b.id);
  const next = todoNodes[0];
  // 当前阶段到期状态：按该阶段的结束日算，不再被历史节点带偏
  const rowPhaseMap = new Map(row.phases.map((phase) => [phase.kind, phase]));
  const currentRowPhase = rowPhaseMap.get(row.phase);
  const phaseDue = phaseDueOf(
    PHASE_LABEL[row.phase],
    row.phase,
    currentRowPhase ? isoDay(currentRowPhase.endDate) : "",
    today,
  );
  const startDate = isoDay(row.startDate);
  const endDate = isoDay(row.endDate);
  const launchDate = isoDay(row.launchDate);
  const phases: PhaseView[] = [...row.phases]
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
    .map((phase) => {
      const start = isoDay(phase.startDate);
      const end = isoDay(phase.endDate);
      const devEnterDate = isoDay(phase.devEnterDate);
      const items: PhaseItemView[] = phase.items.map((item) => {
        const startDate = isoDay(item.startDate);
        const endDate = isoDay(item.endDate);
        const devEnterDate = isoDay(item.devEnterDate);
        return {
        id: item.id,
        name: item.name,
        status: item.status,
        statusLabel: PHASE_ITEM_STATUS_LABEL[item.status],
        trackProgress: item.trackProgress,
        rework: item.rework,
        startDate,
        endDate,
        span: startDate || endDate ? rangeLabel(startDate, endDate) : "",
        devEnterDate,
        devEnterLabel: devEnterDate ? dayLabel(devEnterDate) : "",
        progress: item.status === "DONE" ? 100 : item.status === "PENDING" ? 0 : item.progress,
        link: item.link ?? "",
        note: item.note ?? "",
        members: item.members.map((member) => {
          const endDate = isoDay(member.endDate);
          return {
            id: member.id,
            name: member.name,
            external: member.userId == null,
            ratio: member.ratio,
            endDate,
            release: endDate ? dayLabel(endDate) : "",
          };
        }),
      };
      });
      const allocations = new Map<string, PhaseAllocationView[]>();
      for (const item of items) {
        for (const member of item.members) {
          const list = allocations.get(member.name) ?? [];
          list.push({ itemId: item.id, itemName: item.name, memberId: member.id, ratio: member.ratio });
          allocations.set(member.name, list);
        }
      }
      const members: PhaseMemberView[] = phase.members.map((member) => {
        const memberStart = isoDay(member.startDate);
        const memberEnd = isoDay(member.endDate);
        const assigned = allocations.get(member.name) ?? [];
        const ratio = assigned.length > 0 ? assigned.reduce((sum, row) => sum + row.ratio, 0) : member.ratio;
        return {
          id: member.id,
          userId: member.userId,
          name: member.name,
          external: member.userId == null,
          role: member.role ?? "",
          startDate: memberStart,
          endDate: memberEnd,
          span: memberStart || memberEnd ? rangeLabel(memberStart, memberEnd) : "",
          release: memberEnd ? dayLabel(memberEnd) : "",
          ratio,
          allocations: assigned,
        };
      });
      const listed = new Set(members.map((member) => member.name));
      for (const item of phase.items) {
        for (const member of item.members) {
          if (listed.has(member.name)) continue;
          listed.add(member.name);
          const assigned = allocations.get(member.name) ?? [];
          members.push({
            id: 0,
            userId: member.userId,
            name: member.name,
            external: member.userId == null,
            role: "",
            startDate: "",
            endDate: "",
            span: "",
            release: "",
            ratio: assigned.reduce((sum, row) => sum + row.ratio, 0),
            allocations: assigned,
          });
        }
      }
      return {
        id: phase.id,
        kind: phase.kind,
        label: PHASE_LABEL[phase.kind],
        enabled: phase.enabled,
        startDate: start,
        endDate: end,
        range: start || end ? rangeLabel(start, end) : "",
        days: start && end && end >= start ? dayDiff(end, start) + 1 : null,
        devEnterDate,
        devEnterLabel: devEnterDate ? dayLabel(devEnterDate) : "",
        progress: phaseProgressOf(items, phase.progress, start, end),
        expected: phaseExpected(start, end),
        items,
        itemDone: items.filter((item) => item.status === "DONE").length,
        itemTotal: items.length,
        members,
      };
    });
  // 当前阶段里先找卡住/进行中的节点，没有就取第一个还没完成的；全完成就落到最后一个。
  const currentPhaseView = phases.find((phase) => phase.kind === row.phase);
  const currentItem = currentPhaseView
    ? (currentPhaseView.items.find((item) => item.status === "BLOCKED") ??
      currentPhaseView.items.find((item) => item.status === "DOING") ??
      currentPhaseView.items.find((item) => item.status === "PENDING") ??
      currentPhaseView.items[currentPhaseView.items.length - 1] ??
      null)
    : null;
  const trackedProgress = (kinds: WorkPhaseKind[]): number | null => {
    const tracked = phases
      .filter((phase) => phase.enabled && kinds.includes(phase.kind))
      .flatMap((phase) => phase.items.filter((item) => item.trackProgress));
    if (tracked.length === 0) return null;
    // 只把已经启动的事项算进平均：SIT 填了 90、UAT 还没开始时，测试进度就是 90，不被 0 拉成 45。
    const started = tracked.filter((item) => item.status !== "PENDING" || item.progress > 0);
    const pool = started.length > 0 ? started : tracked;
    return Math.round(pool.reduce((sum, item) => sum + item.progress, 0) / pool.length);
  };
  const devProgressOf = (rows: PhaseView[]): number | null => {
    const dev = rows
      .filter((phase) => phase.enabled && phase.kind === "DEV")
      .flatMap((phase) => phase.items.filter((item) => item.trackProgress));
    const extra = rows
      .filter((phase) => phase.enabled)
      .flatMap((phase) =>
        phase.items.filter((item) => item.rework && (item.status !== "PENDING" || item.progress > 0)),
      );
    const all = [...dev, ...extra];
    if (all.length === 0) return null;
    const started = all.filter((item) => item.status !== "PENDING" || item.progress > 0);
    const pool = started.length > 0 ? started : all;
    return Math.round(pool.reduce((sum, item) => sum + item.progress, 0) / pool.length);
  };
  const quality = (kind: IssueKind): QualityStats => {
    const rows = issues.filter((issue) => issue.kind === kind);
    const fixed = rows.filter((issue) => issue.status === "RESOLVED").length;
    return { total: rows.length, fixed, remaining: rows.length - fixed };
  };
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status,
    statusLabel: PROJECT_LABEL[row.status],
    priority: row.priority,
    priorityLabel: PRIORITY_LABEL[row.priority],
    phase: row.phase,
    phaseLabel: PHASE_LABEL[row.phase],
    phaseGroupLabel: PHASE_GROUP[row.phase],
    phaseShortLabel: PHASE_SHORT[row.phase],
    stageNodeLabel: currentItem?.name ?? "",
    devProgress: devProgressOf(phases),
    testProgress: trackedProgress(["SIT", "UAT"]),
    startDate,
    endDate,
    dates: rangeLabel(startDate, endDate),
    launchDate,
    launchLabel: launchDate ? dayLabel(launchDate) : "未定",
    description: row.description,
    progress: workProgress(phases),
    expected: expectedProgress(phases),
    ownerId: row.ownerId,
    ownerName: row.managerName || names.get(row.ownerId) || "—",
    managerName: row.managerName,
    canManage: canManage(access, userId, row.ownerId),
    nodes,
    issues,
    members: row.members
      .map((member) => ({
        id: member.id,
        userId: member.userId,
        nickname: member.name || (member.userId ? (names.get(member.userId) ?? "—") : "—"),
        role: member.role ?? "",
        ratio: member.ratio,
      }))
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "zh")),
    phases,
    openIssues: issues.filter((issue) => issue.status !== "RESOLVED").length,
    bug: quality("BUG"),
    improvement: quality("IMPROVEMENT"),
    showQuality: row.phase === "SIT" || row.phase === "UAT",
    ...stageStep(row.phase, phases),
    doneNodes,
    nodeTotal: nodes.length,
    nextLabel: next ? `${next.name} · ${next.when}` : nodes.length ? "节点都完成了" : "还没有节点",
    nextDays: next ? next.days : null,
    phaseDueLabel: phaseDue.label,
    phaseOverdue: phaseDue.overdue,
    delayed: nodes.filter((node) => node.status === "DELAYED").length,
    draft: {
      id: row.id,
      name: row.name,
      code: row.code ?? "",
      status: row.status,
      priority: row.priority,
      phase: row.phase,
      startDate,
      endDate,
      launchDate,
      description: row.description ?? "",
      progress: row.progress,
    },
  };
}

/**
 * 阶段走到第几。只数启用的阶段，「已上线」是终点不占名额：
 * 走到上线时记成最后一个启用阶段走完，序号等于总数。
 */
export function stageStep(
  phase: WorkPhaseKind,
  phases: { kind: WorkPhaseKind; enabled: boolean }[],
): { stageIndex: number; stageTotal: number; stageLabel: string } {
  const ordered = phases
    .filter((item) => item.enabled && item.kind !== "LIVE")
    .sort((a, b) => PHASE_RANK[a.kind] - PHASE_RANK[b.kind]);
  const total = ordered.length;
  const raw = ordered.findIndex((item) => item.kind === phase);
  const index = raw >= 0 ? raw + 1 : total > 0 ? total : 0;
  const label = total > 0 ? `${PHASE_LABEL[phase]} · ${index}/${total}` : PHASE_LABEL[phase];
  return { stageIndex: index, stageTotal: total, stageLabel: label };
}

async function loadViews(where: Prisma.WorkProjectWhereInput, access: PlatformAccess, userId: number) {
  const rows = await prisma.workProject.findMany({ where, include: detailInclude });
  const names = await nicknames(collectIds(rows));
  return rows.map((row) => present(row, names, access, userId));
}

/**
 * 到期分组：逾期的最前，其次是有结束日的（越近越前），再次是未排期，最后是已上线。
 * 卡片上的到期文案也是按当前阶段结束日算的，排序跟文案保持一致。
 */
function dueBucket(item: ProjectView): number {
  if (item.phase === "LIVE") return 3;
  if (item.phaseOverdue != null) return 0;
  const end = item.phases.find((phase) => phase.kind === item.phase)?.endDate;
  return end ? 1 : 2;
}

function phaseEndOf(item: ProjectView): string {
  return item.phases.find((phase) => phase.kind === item.phase)?.endDate ?? "";
}

export async function listProjects(access: PlatformAccess, userId: number): Promise<ProjectView[]> {
  await refreshDelayedNodes();
  await ensurePhases();
  const items = await loadViews(visibleWhere(access, userId), access, userId);
  return items.sort((a, b) => {
    const bucket = dueBucket(a) - dueBucket(b);
    if (bucket !== 0) return bucket;
    // 都逾期：逾期越久越靠前（phaseOverdue 是负数）
    if (a.phaseOverdue != null && b.phaseOverdue != null && a.phaseOverdue !== b.phaseOverdue) {
      return a.phaseOverdue - b.phaseOverdue;
    }
    // 都未逾期：到期日近的靠前
    const ae = phaseEndOf(a);
    const be = phaseEndOf(b);
    if (ae !== be) {
      if (!ae) return 1;
      if (!be) return -1;
      return ae < be ? -1 : 1;
    }
    const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priority !== 0) return priority;
    if (a.delayed !== b.delayed) return b.delayed - a.delayed;
    return a.id - b.id;
  });
}

export async function getProject(access: PlatformAccess, userId: number, id: number): Promise<ProjectView | null> {
  await refreshDelayedNodes();
  await ensurePhases({ id });
  const [item] = await loadViews({ id, ...visibleWhere(access, userId) }, access, userId);
  return item ?? null;
}

export async function listPeople(): Promise<PersonOption[]> {
  return prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, nickname: true },
    orderBy: [{ nickname: "asc" }, { id: "asc" }],
  });
}

export function emptyDraft(): ProjectDraft {
  return {
    name: "",
    code: "",
    status: "RUNNING",
    priority: "MEDIUM",
    phase: "BUSINESS",
    startDate: todayIso(),
    endDate: "",
    launchDate: "",
    description: "",
    progress: 0,
  };
}

async function requireProject(access: PlatformAccess, userId: number, projectId: number) {
  const row = await prisma.workProject.findFirst({
    where: { id: projectId, ...visibleWhere(access, userId) },
    select: { id: true, name: true, ownerId: true },
  });
  if (!row) throw new WorkError("找不到这个项目", 404);
  return row;
}

function assertManage(access: PlatformAccess, userId: number, ownerId: number) {
  if (!canManage(access, userId, ownerId)) throw new WorkError("只有负责人能改项目资料", 403);
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").replace(/\s+/g, " ").trim();
}

function block(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function clip(value: string, max: number, label: string): string {
  if (value.length > max) throw new WorkError(`${label}太长了`);
  return value;
}

function emptyToNull(value: string): string | null {
  return value ? value : null;
}

function parseId(raw: string): number | null {
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function nodeStatus(raw: string): NodeStatus {
  if (raw === "PENDING" || raw === "DONE" || raw === "DELAYED") return raw;
  throw new WorkError("节点状态不对");
}

function issueStatus(raw: string): IssueStatus {
  if (raw === "OPEN" || raw === "RESOLVING" || raw === "RESOLVED") return raw;
  throw new WorkError("问题状态不对");
}

function ratioOf(raw: string): number {
  if (!raw) return 100;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new WorkError("投入比例要填 0 到 100");
  return value;
}

async function optionalPerson(raw: string): Promise<number | null> {
  if (!raw) return null;
  const id = parseId(raw);
  if (!id) throw new WorkError("这个人不对");
  const user = await prisma.user.findFirst({
    where: { id, status: "ACTIVE" },
    select: { id: true },
  });
  if (!user) throw new WorkError("找不到这个人");
  return id;
}

async function optionalPhase(projectId: number, raw: string): Promise<number | null> {
  if (!raw) return null;
  const id = parseId(raw);
  if (!id) throw new WorkError("阶段不对");
  const phase = await prisma.workPhase.findFirst({
    where: { id, projectId },
    select: { id: true },
  });
  if (!phase) throw new WorkError("找不到这个阶段", 404);
  return id;
}

function projectPhase(raw: string): WorkPhaseKind {
  if (raw === "BUSINESS" || raw === "DEV" || raw === "SIT" || raw === "UAT" || raw === "PRELAUNCH" || raw === "LIVE") {
    return raw;
  }
  throw new WorkError("当前阶段不对");
}

function projectPriority(raw: string): WorkPriority {
  if (raw === "URGENT" || raw === "HIGH" || raw === "MEDIUM" || raw === "LOW") return raw;
  throw new WorkError("优先级不对");
}

function issueKind(raw: string): IssueKind {
  if (raw === "BUG" || raw === "IMPROVEMENT") return raw;
  throw new WorkError("问题类型不对");
}

export async function saveProject(
  user: SessionUser,
  access: PlatformAccess,
  form: FormData,
): Promise<{ id: number; summary: string }> {
  const name = clip(text(form, "name"), 40, "名字");
  if (!name) throw new WorkError("先写个名字");
  const code = text(form, "code");
  if (code.length > 16) throw new WorkError("代号太长了");
  const phase = projectPhase(text(form, "phase") || "BUSINESS");
  const priority = projectPriority(text(form, "priority") || "MEDIUM");
  const status: ProjectStatus = phase === "LIVE" ? "DONE" : phase === "BUSINESS" ? "PREPARING" : "RUNNING";
  const startRaw = text(form, "startDate");
  const endRaw = text(form, "endDate");
  const launchRaw = text(form, "launchDate");
  const startDate = startRaw ? parseDay(startRaw) : null;
  const endDate = endRaw ? parseDay(endRaw) : null;
  const launchDate = launchRaw ? parseDay(launchRaw) : null;
  if (startRaw && !startDate) throw new WorkError("开始日不对");
  if (endRaw && !endDate) throw new WorkError("结束日不对");
  if (launchRaw && !launchDate) throw new WorkError("上线时间不对");
  if (startDate && endDate && endDate < startDate) throw new WorkError("结束日不能早于开始日");
  const description = emptyToNull(clip(block(form, "description"), 500, "说明"));
  const id = parseId(text(form, "id"));
  const memberNames = parseNames(form, "memberNames");

  const data = {
    name,
    code: code || null,
    status,
    phase,
    priority,
    startDate,
    endDate,
    launchDate,
    description,
  };

  if (id) {
    const existing = await prisma.workProject.findFirst({
      where: { id, ...visibleWhere(access, user.id) },
      select: { id: true, ownerId: true },
    });
    if (!existing) throw new WorkError("找不到这个项目", 404);
    assertManage(access, user.id, existing.ownerId);
    await prisma.workProject.update({ where: { id }, data });
    await ensurePhases({ id });
    await prisma.workPhase.updateMany({ where: { projectId: id, kind: phase }, data: { enabled: true } });
    await syncProjectMembers(id, memberNames);
    return { id, summary: `修改项目「${name}」` };
  }

  const created = await prisma.workProject.create({
    data: { ...data, ownerId: user.id },
  });
  await ensurePhases({ id: created.id });
  await syncProjectMembers(created.id, memberNames);
  return { id: created.id, summary: `记下项目「${name}」` };
}

/**
 * 项目预设的参加人员。手填名字，名字对上某个启用账号时顺手记下 userId，
 * 这样这些人在权限判断里仍算项目成员；系统外的人只留名字。
 */
async function syncProjectMembers(projectId: number, names: string[]): Promise<void> {
  const users = names.length
    ? await prisma.user.findMany({
        where: { nickname: { in: names }, status: "ACTIVE" },
        select: { id: true, nickname: true },
      })
    : [];
  const userByName = new Map(users.map((user) => [user.nickname, user.id]));
  await prisma.$transaction([
    prisma.workMember.deleteMany({ where: { projectId, name: { notIn: names } } }),
    ...names.map((name) =>
      prisma.workMember.upsert({
        where: { projectId_name: { projectId, name } },
        create: { projectId, name, userId: userByName.get(name) ?? null, ratio: 100 },
        update: { userId: userByName.get(name) ?? null },
      }),
    ),
  ]);
}

export async function removeProject(access: PlatformAccess, userId: number, id: number): Promise<string> {
  const existing = await requireProject(access, userId, id);
  assertManage(access, userId, existing.ownerId);
  const nodes = await prisma.workNode.findMany({
    where: { projectId: id },
    select: { id: true },
  });
  const bizIds = nodes.map((node) => nodeBizId(node.id));
  await prisma.$transaction([
    ...(bizIds.length
      ? [
          prisma.todo.deleteMany({
            where: { source: "WORK", sourceBizId: { in: bizIds }, status: { not: "DONE" } },
          }),
        ]
      : []),
    prisma.workProject.delete({ where: { id } }),
  ]);
  return `删除项目「${existing.name}」`;
}

export async function saveNode(access: PlatformAccess, userId: number, form: FormData): Promise<string> {
  const projectId = parseId(text(form, "projectId"));
  if (!projectId) throw new WorkError("项目不对");
  const project = await requireProject(access, userId, projectId);
  const name = clip(text(form, "name"), 40, "节点名字");
  if (!name) throw new WorkError("先写节点名字");
  const plan = parseDay(text(form, "planDate"));
  if (!plan) throw new WorkError("计划日不对");
  const status = nodeStatus(text(form, "status") || "PENDING");
  const ownerId = await optionalPerson(text(form, "ownerId"));
  const id = parseId(text(form, "id"));
  const today = utcDay(todayIso());
  const planIso = isoDay(plan);

  if (id) {
    const node = await prisma.workNode.findFirst({
      where: { id, projectId },
      select: { id: true, actualDate: true },
    });
    if (!node) throw new WorkError("找不到这个节点", 404);
    await prisma.workNode.update({
      where: { id },
      data: {
        name,
        planDate: plan,
        status,
        ownerId,
        actualDate: status === "DONE" ? (node.actualDate ?? today) : null,
      },
    });
    const stillDue = status === "DELAYED" || (status === "PENDING" && planIso <= todayIso());
    if (!stillDue) await clearNodeTodos(id);
  } else {
    await prisma.workNode.create({
      data: {
        projectId,
        name,
        planDate: plan,
        status,
        ownerId,
        actualDate: status === "DONE" ? today : null,
      },
    });
  }
  return `${id ? "修改" : "记下"}节点「${project.name} / ${name}」`;
}

export async function setNodeStatus(
  access: PlatformAccess,
  userId: number,
  projectId: number,
  nodeId: number,
  rawStatus: string,
): Promise<string> {
  const project = await requireProject(access, userId, projectId);
  const status = nodeStatus(rawStatus);
  const node = await prisma.workNode.findFirst({ where: { id: nodeId, projectId } });
  if (!node) throw new WorkError("找不到这个节点", 404);
  const today = utcDay(todayIso());
  if (status === "PENDING" && node.planDate < today) throw new WorkError("计划日已经过了，先改日期");
  await prisma.workNode.update({
    where: { id: nodeId },
    data: {
      status,
      actualDate: status === "DONE" ? (node.actualDate ?? today) : null,
    },
  });
  if (status === "DONE") await clearNodeTodos(nodeId);
  const verb = status === "DONE" ? "完成" : status === "DELAYED" ? "延期" : "改回";
  return `${verb}节点「${project.name} / ${node.name}」`;
}

export async function removeNode(
  access: PlatformAccess,
  userId: number,
  projectId: number,
  nodeId: number,
): Promise<string> {
  const project = await requireProject(access, userId, projectId);
  const node = await prisma.workNode.findFirst({ where: { id: nodeId, projectId } });
  if (!node) throw new WorkError("找不到这个节点", 404);
  await prisma.$transaction([
    prisma.workIssue.updateMany({ where: { projectId, nodeId }, data: { nodeId: null } }),
    prisma.todo.deleteMany({
      where: { source: "WORK", sourceBizId: nodeBizId(nodeId), status: { not: "DONE" } },
    }),
    prisma.workNode.delete({ where: { id: nodeId } }),
  ]);
  return `删除节点「${project.name} / ${node.name}」`;
}

export async function saveIssue(access: PlatformAccess, userId: number, form: FormData): Promise<string> {
  const projectId = parseId(text(form, "projectId"));
  if (!projectId) throw new WorkError("项目不对");
  const project = await requireProject(access, userId, projectId);
  const description = clip(block(form, "description"), 200, "问题");
  const hasImagesField = form.has("images");
  const images = hasImagesField ? parseIssueImages(form) : null;
  if (!description && !images?.length) throw new WorkError("写一句问题，或者至少传一张图");
  const impact = emptyToNull(clip(block(form, "impact"), 200, "影响"));
  const solution = emptyToNull(clip(block(form, "solution"), 500, "办法"));
  const status = issueStatus(text(form, "status") || "OPEN");
  const kind = issueKind(text(form, "kind") || "BUG");
  const handler = emptyToNull(clip(text(form, "handler"), 40, "谁来处理"));
  const phaseId = await optionalPhase(projectId, text(form, "phaseId"));
  const id = parseId(text(form, "id"));
  const data = {
    description,
    impact,
    solution,
    status,
    kind,
    handler,
    phaseId,
    ownerId: null,
    nodeId: null,
    ...(images ? { images: images.length ? images : Prisma.DbNull } : {}),
  };

  if (id) {
    const issue = await prisma.workIssue.findFirst({ where: { id, projectId }, select: { id: true } });
    if (!issue) throw new WorkError("找不到这个问题", 404);
    await prisma.workIssue.update({ where: { id }, data });
  } else {
    await prisma.workIssue.create({ data: { ...data, projectId } });
  }
  const brief = description ? description.replace(/\s+/g, " ").slice(0, 24) : `图片 ${images?.length ?? 0} 张`;
  return `${id ? "修改" : "记下"}问题「${project.name} / ${brief}」`;
}

export async function setIssueStatus(
  access: PlatformAccess,
  userId: number,
  projectId: number,
  issueId: number,
  rawStatus: string,
): Promise<string> {
  const project = await requireProject(access, userId, projectId);
  const status = issueStatus(rawStatus);
  const issue = await prisma.workIssue.findFirst({ where: { id: issueId, projectId } });
  if (!issue) throw new WorkError("找不到这个问题", 404);
  await prisma.workIssue.update({ where: { id: issueId }, data: { status } });
  const verb = status === "RESOLVED" ? "解决" : status === "RESOLVING" ? "开始处理" : "重新打开";
  const brief = issueBrief(issue);
  return `${verb}问题「${project.name} / ${brief}」`;
}

export async function removeIssue(
  access: PlatformAccess,
  userId: number,
  projectId: number,
  issueId: number,
): Promise<string> {
  const project = await requireProject(access, userId, projectId);
  const issue = await prisma.workIssue.findFirst({ where: { id: issueId, projectId } });
  if (!issue) throw new WorkError("找不到这个问题", 404);
  await prisma.workIssue.delete({ where: { id: issueId } });
  const brief = issueBrief(issue);
  return `删除问题「${project.name} / ${brief}」`;
}

export async function saveMember(access: PlatformAccess, userId: number, form: FormData): Promise<string> {
  const projectId = parseId(text(form, "projectId"));
  if (!projectId) throw new WorkError("项目不对");
  const project = await requireProject(access, userId, projectId);
  assertManage(access, userId, project.ownerId);
  const name = clip(text(form, "name"), 20, "名字");
  if (!name) throw new WorkError("先写个名字");
  const role = emptyToNull(clip(text(form, "role"), 20, "角色"));
  const ratio = ratioOf(text(form, "ratio"));
  const bound = await prisma.user.findFirst({ where: { nickname: name, status: "ACTIVE" }, select: { id: true } });
  await prisma.workMember.upsert({
    where: { projectId_name: { projectId, name } },
    create: { projectId, name, userId: bound?.id ?? null, role, ratio },
    update: { userId: bound?.id ?? null, role, ratio },
  });
  return `把${name}加入「${project.name}」`;
}

export async function removeMember(
  access: PlatformAccess,
  userId: number,
  projectId: number,
  memberId: number,
): Promise<string> {
  const project = await requireProject(access, userId, projectId);
  assertManage(access, userId, project.ownerId);
  const member = await prisma.workMember.findFirst({ where: { id: memberId, projectId } });
  if (!member) throw new WorkError("这个人不在项目里", 404);
  await prisma.workMember.delete({ where: { id: member.id } });
  return `把${member.name}移出「${project.name}」`;
}
