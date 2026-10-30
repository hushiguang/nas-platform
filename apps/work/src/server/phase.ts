import { dayDiff, type PlatformAccess, type SessionUser } from "@nas/core";
import {
  prisma,
  type ProjectStatus,
  type WorkPhaseItemStatus,
  type WorkPhaseKind,
} from "@nas/db";
import {
  DEFAULT_PHASE_ITEMS,
  MEMBER_ROLE_OPTIONS,
  PHASE_ITEM_STATUS_OPTIONS,
  PHASE_LABEL,
  PHASE_OPTIONS,
} from "@/lib/labels";
import { canManage, visibleWhere } from "./access";
import { dayLabel, isoDay, parseDay, rangeLabel, todayIso } from "./dates";
import { WorkError } from "./errors";
import { parseNames } from "./names";

export interface PhaseSpan {
  enabled: boolean;
  startDate: string;
  endDate: string;
}

/** 单个阶段的预期进度。没排期就空着，还没开始是 0，过了结束日是 100。 */
export function phaseExpected(startDate: string, endDate: string, today = todayIso()): number | null {
  if (!startDate || !endDate || endDate < startDate) return null;
  const span = dayDiff(endDate, startDate) + 1;
  if (span <= 0) return null;
  if (today < startDate) return 0;
  if (today >= endDate) return 100;
  return Math.max(0, Math.min(100, Math.round(((dayDiff(today, startDate) + 1) / span) * 100)));
}

/** 预期进度：按启用阶段的天数占比，算今天走到了计划的哪一段。没有排期就空着。 */
export function expectedProgress(phases: PhaseSpan[], today = todayIso()): number | null {
  const ranged = phases.filter(
    (phase) => phase.enabled && phase.startDate && phase.endDate && phase.endDate >= phase.startDate,
  );
  if (ranged.length === 0) return null;
  let total = 0;
  let elapsed = 0;
  for (const phase of ranged) {
    const span = dayDiff(phase.endDate, phase.startDate) + 1;
    total += span;
    if (today >= phase.endDate) elapsed += span;
    else if (today >= phase.startDate) elapsed += dayDiff(today, phase.startDate) + 1;
  }
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}

export async function ensurePhases(where: { id?: number } = {}): Promise<void> {
  const projects = await prisma.workProject.findMany({
    where: where.id ? { id: where.id } : {},
    select: { id: true },
  });
  if (projects.length === 0) return;
  await prisma.workPhase.createMany({
    data: projects.flatMap((project) =>
      PHASE_OPTIONS.map((option, sort) => ({
        projectId: project.id,
        kind: option.value,
        sort,
        enabled: true,
      })),
    ),
    skipDuplicates: true,
  });
  await ensurePhaseItems(where.id);
}

/**
 * 每个阶段第一次出现时补齐默认事项清单（需求调研、原型交付、研发实施……）。
 * 已经有事项的阶段原样不动，用户自己删掉的事项也不会反复长回来。
 */
export async function ensurePhaseItems(projectId?: number): Promise<void> {
  const phases = await prisma.workPhase.findMany({
    where: projectId ? { projectId } : {},
    select: { id: true, kind: true, items: { select: { id: true }, take: 1 } },
  });
  const empty = phases.filter((phase) => phase.items.length === 0);
  if (empty.length === 0) return;
  await prisma.workPhaseItem.createMany({
    data: empty.flatMap((phase) =>
      DEFAULT_PHASE_ITEMS[phase.kind].map((item, sort) => ({
        phaseId: phase.id,
        name: item.name,
        sort,
        trackProgress: Boolean(item.trackProgress),
      })),
    ),
    skipDuplicates: true,
  });
}

/** 单条事项的进度：已完成固定 100，未开始固定 0，其余看手填的百分比。 */
export function itemPercent(item: { status: WorkPhaseItemStatus; progress: number }): number {
  if (item.status === "DONE") return 100;
  if (item.status === "PENDING") return 0;
  return Math.max(0, Math.min(100, item.progress || 0));
}

function spanDays(startDate: string, endDate: string): number | null {
  if (!startDate || !endDate || endDate < startDate) return null;
  const span = dayDiff(endDate, startDate) + 1;
  return span > 0 ? span : null;
}

/**
 * 阶段进度按事项算：
 * - 有「研发实施 / SIT测试 / UAT测试」时，这些事项先合成一个百分比，权重是阶段天数。
 * - UAT 新增需求按自己的起止天数再算一份。填了百分比但还没排期时，权重和阶段一样，拖滑条就能看到阶段进度动。
 * - 刚加出来、没排期也还是 0 的新增需求先不算，避免一添加就把阶段进度打下去。
 * - 都没有单独进度时，按已完成事项数 / 总事项数。新增需求不进这个计数。
 * 阶段没有事项时退回老的手填进度，兼容历史数据。
 */
export function phaseProgressOf(
  items: {
    status: WorkPhaseItemStatus;
    progress: number;
    trackProgress: boolean;
    rework?: boolean;
    startDate?: string;
    endDate?: string;
  }[],
  fallback = 0,
  phaseStart = "",
  phaseEnd = "",
): number {
  const gate = items.filter((item) => !item.rework);
  const reworks = items.filter((item) => item.rework);
  if (gate.length === 0 && reworks.length === 0) return Math.max(0, Math.min(100, fallback));
  const reworkQuiet = (item: (typeof reworks)[number]) =>
    item.status === "PENDING" && item.progress === 0 && !spanDays(item.startDate ?? "", item.endDate ?? "");
  // 老项目刚补出清单时事项都还没动过，先保留原来的手填进度，避免一升级进度全变 0。
  const untouched = gate.every((item) => item.status === "PENDING" && item.progress === 0) && reworks.every(reworkQuiet);
  if (untouched && fallback > 0) return Math.max(0, Math.min(100, fallback));
  const tracked = gate.filter((item) => item.trackProgress);
  const phaseDays = spanDays(phaseStart, phaseEnd);
  const parts: { value: number; weight: number }[] = [];
  if (tracked.length > 0) {
    const value = tracked.reduce((total, item) => total + itemPercent(item), 0) / tracked.length;
    parts.push({ value, weight: phaseDays ?? 1 });
  }
  for (const item of reworks) {
    if (reworkQuiet(item)) continue;
    const days = spanDays(item.startDate ?? "", item.endDate ?? "");
    parts.push({ value: itemPercent(item), weight: days ?? phaseDays ?? 1 });
  }
  if (parts.length > 0) {
    const total = parts.reduce((sum, part) => sum + part.weight, 0);
    const done = parts.reduce((sum, part) => sum + part.value * part.weight, 0);
    return Math.max(0, Math.min(100, Math.round(done / total)));
  }
  if (gate.length === 0) return Math.max(0, Math.min(100, fallback));
  const done = gate.filter((item) => item.status === "DONE").length;
  return Math.max(0, Math.min(100, Math.round((done / gate.length) * 100)));
}

function progressRows(
  items: {
    status: WorkPhaseItemStatus;
    progress: number;
    trackProgress: boolean;
    rework: boolean;
    startDate: Date | null;
    endDate: Date | null;
  }[],
) {
  return items.map((item) => ({
    status: item.status,
    progress: item.progress,
    trackProgress: item.trackProgress,
    rework: item.rework,
    startDate: isoDay(item.startDate),
    endDate: isoDay(item.endDate),
  }));
}

async function syncPhaseProgress(phaseId: number, keepFallback = true): Promise<void> {
  const phase = await prisma.workPhase.findUnique({
    where: { id: phaseId },
    select: {
      progress: true,
      startDate: true,
      endDate: true,
      items: { select: { status: true, progress: true, trackProgress: true, rework: true, startDate: true, endDate: true } },
    },
  });
  if (!phase) return;
  const progress = phaseProgressOf(
    progressRows(phase.items),
    keepFallback ? phase.progress : 0,
    isoDay(phase.startDate),
    isoDay(phase.endDate),
  );
  await prisma.workPhase.update({ where: { id: phaseId }, data: { progress } });
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").replace(/\s+/g, " ").trim();
}

function optionalDay(raw: string, label: string): Date | null {
  if (!raw) return null;
  const date = parseDay(raw);
  if (!date) throw new WorkError(`${label}不对`);
  return date;
}

function assertReworkSpan(start: Date | null, end: Date | null, devEnter: Date | null) {
  if (start && end && end < start) throw new WorkError("结束日不能早于起始日");
  if (devEnter && start && devEnter < start) throw new WorkError("研发进入不能早于起始日");
  if (devEnter && end && devEnter > end) throw new WorkError("研发进入不能晚于结束日");
}

function laterDay(left: Date | null, right: Date | null): Date | null {
  if (left && right) return left > right ? left : right;
  return left ?? right;
}

function earlierDay(left: Date | null, right: Date | null): Date | null {
  if (left && right) return left < right ? left : right;
  return left ?? right;
}

function progressOf(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new WorkError("实际进度要填 0 到 100");
  return value;
}

async function requireManage(access: PlatformAccess, userId: number, projectId: number) {
  const project = await prisma.workProject.findFirst({
    where: { id: projectId, ...visibleWhere(access, userId) },
    select: { id: true, name: true, ownerId: true, phase: true },
  });
  if (!project) throw new WorkError("找不到这个项目", 404);
  if (!canManage(access, userId, project.ownerId)) throw new WorkError("只有负责人能改阶段配置", 403);
  return project;
}

export async function setActualProgress(
  access: PlatformAccess,
  userId: number,
  projectId: number,
  raw: number | string,
): Promise<string> {
  const project = await requireManage(access, userId, projectId);
  const progress = progressOf(String(raw));
  await prisma.workProject.update({ where: { id: projectId }, data: { progress } });
  return `把「${project.name}」的实际进度改成 ${progress}%`;
}

/**
 * 切换项目当前阶段。目标是启用阶段才允许切过去；切走时自动启用目标阶段，
 * 当前阶段本身若被关掉，先把它恢复启用，避免项目没有阶段可用。
 */
export async function setCurrentPhase(
  access: PlatformAccess,
  userId: number,
  projectId: number,
  raw: string,
): Promise<string> {
  const project = await requireManage(access, userId, projectId);
  const kind = raw as WorkPhaseKind;
  if (!PHASE_OPTIONS.some((option) => option.value === kind)) throw new WorkError("阶段不对");
  if (kind === project.phase) return `「${project.name}」已经在${PHASE_LABEL[kind]}`;
  const target = await prisma.workPhase.findFirst({
    where: { projectId, kind },
    select: { id: true, enabled: true },
  });
  if (!target) throw new WorkError("找不到这个阶段", 404);
  if (!target.enabled) throw new WorkError(`${PHASE_LABEL[kind]}没启用，先在下面启用它`);
  const status: ProjectStatus = kind === "LIVE" ? "DONE" : kind === "BUSINESS" ? "PREPARING" : "RUNNING";
  await prisma.workProject.update({ where: { id: projectId }, data: { phase: kind, status } });
  await syncProjectProgress(projectId);
  return `把「${project.name}」切到${PHASE_LABEL[kind]}`;
}

function itemStatus(raw: string): WorkPhaseItemStatus {
  const value = (raw || "PENDING") as WorkPhaseItemStatus;
  if (!PHASE_ITEM_STATUS_OPTIONS.some((option) => option.value === value)) throw new WorkError("事项状态不对");
  return value;
}

export async function savePhase(access: PlatformAccess, userId: number, form: FormData): Promise<string> {
  const phaseId = Number(text(form, "phaseId"));
  if (!Number.isInteger(phaseId) || phaseId <= 0) throw new WorkError("阶段不对");
  const phase = await prisma.workPhase.findFirst({
    where: { id: phaseId },
    select: { id: true, projectId: true, kind: true, progress: true },
  });
  if (!phase) throw new WorkError("找不到这个阶段", 404);
  const project = await requireManage(access, userId, phase.projectId);
  const enabled = text(form, "enabled") !== "0";
  if (!enabled && project.phase === phase.kind) throw new WorkError("当前阶段不能关掉");
  const start = optionalDay(text(form, "startDate"), "开始日");
  const end = optionalDay(text(form, "endDate"), "结束日");
  if (start && end && end < start) throw new WorkError("结束日不能早于开始日");
  const devEnter = phase.kind === "SIT" || phase.kind === "UAT" ? optionalDay(text(form, "devEnterDate"), "研发进入日") : null;
  const items = await prisma.workPhaseItem.findMany({
    where: { phaseId },
    select: { status: true, progress: true, trackProgress: true, rework: true, startDate: true, endDate: true },
  });
  const progress = items.length > 0
    ? phaseProgressOf(progressRows(items), phase.progress, isoDay(start), isoDay(end))
    : progressOf(text(form, "progress") || "0");
  await prisma.workPhase.update({
    where: { id: phaseId },
    data: { enabled, startDate: start, endDate: end, devEnterDate: devEnter, progress },
  });
  await syncProjectProgress(project.id);
  await syncConflictTodos();
  return `修改「${project.name}」的${PHASE_LABEL[phase.kind]}，实际 ${progress}%`;
}

interface PhaseItemPayload {
  id: number;
  name: string;
  status: string;
  progress: number;
  trackProgress: boolean;
  startDate: string;
  endDate: string;
  devEnterDate: string;
  link: string;
  note: string;
}

function parseItemPayload(form: FormData): PhaseItemPayload[] {
  const raw = String(form.get("items") ?? "");
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WorkError("事项数据不对");
  }
  if (!Array.isArray(parsed)) throw new WorkError("事项数据不对");
  return parsed.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      id: Number(item.id),
      name: String(item.name ?? "").replace(/\s+/g, " ").trim(),
      status: String(item.status ?? "PENDING"),
      progress: Number(item.progress ?? 0),
      trackProgress: Boolean(item.trackProgress),
      startDate: String(item.startDate ?? "").trim(),
      endDate: String(item.endDate ?? "").trim(),
      devEnterDate: String(item.devEnterDate ?? "").trim(),
      link: String(item.link ?? "").trim(),
      note: String(item.note ?? "").trim(),
    };
  });
}

/** 阶段事项清单整体保存：状态、单独进度、链接、备注。 */
export async function savePhaseItems(access: PlatformAccess, userId: number, form: FormData): Promise<string> {
  const phaseId = Number(text(form, "phaseId"));
  if (!Number.isInteger(phaseId) || phaseId <= 0) throw new WorkError("阶段不对");
  const phase = await prisma.workPhase.findFirst({
    where: { id: phaseId },
    select: { id: true, projectId: true, kind: true, result: true, items: true },
  });
  if (!phase) throw new WorkError("找不到这个阶段", 404);
  const project = await requireManage(access, userId, phase.projectId);
  const rows = parseItemPayload(form);
  if (rows.length === 0) throw new WorkError("没有要保存的事项");
  const known = new Map(phase.items.map((item) => [item.id, item]));
  for (const row of rows) {
    const item = known.get(row.id);
    if (!item) throw new WorkError("事项不对");
    const status = itemStatus(row.status);
    if (!Number.isInteger(row.progress) || row.progress < 0 || row.progress > 100) {
      throw new WorkError("事项进度要填 0 到 100");
    }
    if (row.link && !/^https?:\/\//i.test(row.link)) throw new WorkError("链接要以 http:// 或 https:// 开头");
    const progress = status === "DONE" ? 100 : status === "PENDING" ? 0 : row.progress;
    const data: {
      status: WorkPhaseItemStatus;
      progress: number;
      trackProgress: boolean;
      link: string | null;
      note: string | null;
      name?: string;
      startDate?: Date | null;
      endDate?: Date | null;
      devEnterDate?: Date | null;
    } = {
      status,
      progress,
      // 新增需求用自己的起止天数计入进度，不占用「UAT测试」那个开关。
      trackProgress: item.rework ? false : row.trackProgress,
      link: emptyToNull(clipText(row.link, 300, "链接")),
      note: emptyToNull(clipText(row.note, 160, "备注")),
    };
    if (item.rework) {
      const name = clipText(row.name, 80, "需求名称");
      if (!name) throw new WorkError("先写需求名称");
      if (phase.items.some((other) => other.id !== item.id && other.name === name)) {
        throw new WorkError("这个事项已经有了");
      }
      const startDate = optionalDay(row.startDate, "起始日");
      const endDate = optionalDay(row.endDate, "结束日");
      const devEnterDate = optionalDay(row.devEnterDate, "研发进入日");
      assertReworkSpan(startDate, endDate, devEnterDate);
      data.name = name;
      data.startDate = startDate;
      data.endDate = endDate;
      data.devEnterDate = devEnterDate;
    }
    await prisma.workPhaseItem.update({
      where: { id: item.id },
      data,
    });
  }
  // 用户在事项里点过之后，进度就完全按事项算；不再回退到以前手填的值。
  await syncPhaseProgress(phaseId, false);
  await syncProjectProgress(project.id);
  return `修改「${project.name}」的${PHASE_LABEL[phase.kind]}事项`;
}

/** UAT 里加一条新增需求。项目留在 UAT，不退回研发节点。 */
export async function addPhaseRework(access: PlatformAccess, userId: number, form: FormData): Promise<string> {
  const phaseId = Number(text(form, "phaseId"));
  if (!Number.isInteger(phaseId) || phaseId <= 0) throw new WorkError("阶段不对");
  const phase = await prisma.workPhase.findFirst({
    where: { id: phaseId },
    select: { id: true, projectId: true, kind: true, items: { select: { name: true, sort: true } } },
  });
  if (!phase) throw new WorkError("找不到这个阶段", 404);
  if (phase.kind !== "UAT") throw new WorkError("只有 UAT 阶段能记新增需求");
  const project = await requireManage(access, userId, phase.projectId);
  const name = clipText(text(form, "name"), 80, "需求名称");
  if (!name) throw new WorkError("先写需求名称");
  if (phase.items.some((item) => item.name === name)) throw new WorkError("这个事项已经有了");
  const startDate = optionalDay(text(form, "startDate"), "起始日");
  const endDate = optionalDay(text(form, "endDate"), "结束日");
  const devEnter = optionalDay(text(form, "devEnterDate"), "研发进入日");
  assertReworkSpan(startDate, endDate, devEnter);
  const sort = phase.items.reduce((max, item) => Math.max(max, item.sort), -1) + 1;
  await prisma.workPhaseItem.create({
    data: {
      phaseId,
      name,
      sort,
      rework: true,
      trackProgress: false,
      startDate,
      endDate,
      devEnterDate: devEnter,
    },
  });
  return `在「${project.name}」的 UAT 记下新增需求「${name}」`;
}

/** 删掉一条新增需求，并放开只为这条需求进来的研发。 */
export async function removePhaseRework(
  access: PlatformAccess,
  userId: number,
  itemId: number,
): Promise<{ summary: string; projectId: number }> {
  const item = await prisma.workPhaseItem.findFirst({
    where: { id: itemId },
    include: {
      members: { select: { name: true } },
      phase: { select: { id: true, projectId: true, kind: true } },
    },
  });
  if (!item) throw new WorkError("找不到这个事项", 404);
  if (!item.rework) throw new WorkError("只能删除新增需求");
  const project = await requireManage(access, userId, item.phase.projectId);
  const names = [...new Set(item.members.map((member) => member.name))];
  await prisma.workPhaseItem.delete({ where: { id: item.id } });
  for (const name of names) {
    const still = await prisma.workPhaseItemMember.count({
      where: { name, item: { phaseId: item.phase.id } },
    });
    if (still > 0) continue;
    // 名册是加人时补上的。这条需求删掉后如果没有别的事项，留着会按整段 UAT 继续占着。
    await prisma.workPhaseMember.deleteMany({
      where: { phaseId: item.phase.id, name, role: "研发" },
    });
  }
  try {
    await syncConflictTodos();
  } catch (err) {
    console.error("[work] syncConflictTodos after removePhaseRework failed", err);
  }
  return {
    projectId: project.id,
    summary: `删掉「${project.name}」UAT 的新增需求「${item.name}」`,
  };
}

function clipText(value: string, max: number, label: string): string {
  if (value.length > max) throw new WorkError(`${label}太长了`);
  return value;
}

function emptyToNull(value: string): string | null {
  return value ? value : null;
}

/**
 * 参与项目实际进度的阶段：只有研发和测试。
 * 商务、筹备上线、已上线这些没有百分比概念的阶段不计入。
 */
export const PROGRESS_KINDS: WorkPhaseKind[] = ["DEV", "SIT", "UAT"];

/**
 * 项目实际进度 = 研发 + 测试这几个阶段的实际进度加权平均，其他阶段不计。
 * 每个阶段的进度来自研发实施 / SIT测试 / UAT测试，UAT 新增需求再按自己的天数加进去
 * （事项还没动过时退回该阶段以前手填的进度）。
 * 这几个阶段都排了期就按天数加权，否则各阶段一视同仁。
 * 一个研发 / 测试阶段都没有（或都没启用）时返回 null，表示没有可算的进度。
 */
export function workProgress(
  phases: { enabled: boolean; kind: WorkPhaseKind; progress: number; startDate: string; endDate: string }[],
): number | null {
  const used = phases.filter((phase) => phase.enabled && PROGRESS_KINDS.includes(phase.kind));
  if (used.length === 0) return null;
  const dated = used.every(
    (phase) => phase.startDate && phase.endDate && phase.endDate >= phase.startDate,
  );
  let total = 0;
  let done = 0;
  for (const phase of used) {
    const weight = dated ? dayDiff(phase.endDate, phase.startDate) + 1 : 1;
    total += weight;
    done += weight * phase.progress;
  }
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(done / total)));
}

async function syncProjectProgress(projectId: number): Promise<void> {
  const phases = await prisma.workPhase.findMany({
    where: { projectId },
    select: {
      enabled: true,
      kind: true,
      progress: true,
      startDate: true,
      endDate: true,
      items: { select: { status: true, progress: true, trackProgress: true, rework: true, startDate: true, endDate: true } },
    },
  });
  const progress = workProgress(
    phases.map((phase) => ({
      enabled: phase.enabled,
      kind: phase.kind,
      // 与阶段行上显示的「实际 x%」同一口径
      progress: phaseProgressOf(progressRows(phase.items), phase.progress, isoDay(phase.startDate), isoDay(phase.endDate)),
      startDate: isoDay(phase.startDate),
      endDate: isoDay(phase.endDate),
    })),
  );
  await prisma.workProject.update({ where: { id: projectId }, data: { progress: progress ?? 0 } });
}

/**
 * 从项目预设的参加人员里挑人排进这个阶段。名字是手填的，多数没有系统账号，
 * 所以按名字存；名字碰上同名启用账号时顺带记下 userId。
 */
export async function savePhaseMembers(access: PlatformAccess, userId: number, form: FormData): Promise<string> {
  const phaseId = Number(text(form, "phaseId"));
  if (!Number.isInteger(phaseId) || phaseId <= 0) throw new WorkError("阶段不对");
  const phase = await prisma.workPhase.findFirst({
    where: { id: phaseId },
    select: { id: true, projectId: true, kind: true, members: { select: { name: true } } },
  });
  if (!phase) throw new WorkError("找不到这个阶段", 404);
  const project = await requireManage(access, userId, phase.projectId);
  const role = text(form, "role") || "研发";
  if (!(MEMBER_ROLE_OPTIONS as readonly string[]).includes(role)) throw new WorkError("角色不对");
  const start = optionalDay(text(form, "startDate"), "投入开始");
  const end = optionalDay(text(form, "endDate"), "预计释放");
  if (start && end && end < start) throw new WorkError("释放日不能早于投入开始");
  const ratioRaw = text(form, "ratio");
  const ratio = ratioRaw ? ratioOf(ratioRaw) : 0;
  const names = parseNames(form, "names");
  if (names.length === 0) throw new WorkError("先选人");
  const existing = new Set(phase.members.map((member) => member.name));
  const toAdd = names.filter((name) => !existing.has(name));
  if (toAdd.length === 0) throw new WorkError("这些人已经在这个阶段里了");
  const bound = await prisma.user.findMany({
    where: { nickname: { in: toAdd }, status: "ACTIVE" },
    select: { id: true, nickname: true },
  });
  const userByName = new Map(bound.map((user) => [user.nickname, user.id]));
  await prisma.workPhaseMember.createMany({
    data: toAdd.map((name) => ({
      phaseId,
      userId: userByName.get(name) ?? null,
      name,
      role,
      startDate: start,
      endDate: end,
      ratio,
    })),
  });
  try {
    await syncConflictTodos();
  } catch (err) {
    console.error("[work] syncConflictTodos after savePhaseMembers failed", err);
  }
  return `把${toAdd.join("、")}排进「${project.name}」的${PHASE_LABEL[phase.kind]}`;
}

/** 改阶段里某个人的角色、投入区间和投入比例。支持人员不是 all in 时把比例调到 30%、50%。 */
export async function updatePhaseMember(access: PlatformAccess, userId: number, form: FormData): Promise<string> {
  const memberId = Number(text(form, "memberId"));
  if (!Number.isInteger(memberId) || memberId <= 0) throw new WorkError("人员不对");
  const member = await prisma.workPhaseMember.findFirst({
    where: { id: memberId },
    include: { phase: { select: { projectId: true, kind: true } } },
  });
  if (!member) throw new WorkError("找不到这个人", 404);
  const project = await requireManage(access, userId, member.phase.projectId);
  const role = text(form, "role") || "研发";
  if (!(MEMBER_ROLE_OPTIONS as readonly string[]).includes(role)) throw new WorkError("角色不对");
  const start = optionalDay(text(form, "startDate"), "投入开始");
  const end = optionalDay(text(form, "endDate"), "预计释放");
  if (start && end && end < start) throw new WorkError("释放日不能早于投入开始");
  const ratioRaw = form.get("ratio");
  await prisma.workPhaseMember.update({
    where: { id: memberId },
    data: {
      role,
      startDate: start,
      endDate: end,
      ...(ratioRaw == null || String(ratioRaw).trim() === "" ? {} : { ratio: ratioOf(String(ratioRaw)) }),
    },
  });
  try {
    await syncConflictTodos();
  } catch (err) {
    console.error("[work] syncConflictTodos after updatePhaseMember failed", err);
  }
  return `修改${member.name}在「${project.name}」${PHASE_LABEL[member.phase.kind]}的投入安排`;
}

function ratioOf(raw: string): number {
  if (!raw) return 100;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new WorkError("投入比例要填 0 到 100");
  return value;
}

/**
 * 把一个人按某个百分比挂到一条事项上。
 * 同一个人可以出现在多条事项里，百分比各自记，加起来才是他在这个阶段的占用。
 * 阶段名册里还没有这个人时补一条，方便排期和权限，百分比仍以事项为准。
 */
export async function savePhaseItemMember(access: PlatformAccess, userId: number, form: FormData): Promise<string> {
  const itemId = Number(text(form, "itemId"));
  if (!Number.isInteger(itemId) || itemId <= 0) throw new WorkError("事项不对");
  const item = await prisma.workPhaseItem.findFirst({
    where: { id: itemId },
    include: { phase: { select: { id: true, projectId: true, kind: true } } },
  });
  if (!item) throw new WorkError("找不到这个事项", 404);
  const project = await requireManage(access, userId, item.phase.projectId);
  const name = text(form, "name");
  if (!name) throw new WorkError("先写投入人员");
  const ratioRaw = text(form, "ratio");
  if (!ratioRaw) throw new WorkError("先填投入百分比");
  const ratio = ratioOf(ratioRaw);
  const end = optionalDay(text(form, "endDate"), "预计释放");
  const bound = await prisma.user.findFirst({
    where: { nickname: name, status: "ACTIVE" },
    select: { id: true },
  });
  await prisma.workPhaseItemMember.upsert({
    where: { itemId_name: { itemId, name } },
    create: { itemId, name, userId: bound?.id ?? null, ratio, endDate: end },
    update: { ratio, userId: bound?.id ?? null, endDate: end },
  });
  const roster = await prisma.workPhaseMember.findFirst({
    where: { phaseId: item.phase.id, name },
    select: { id: true },
  });
  if (!roster) {
    const preset = await prisma.workMember.findFirst({
      where: { projectId: project.id, name },
      select: { role: true },
    });
    await prisma.workPhaseMember.create({
      data: {
        phaseId: item.phase.id,
        name,
        userId: bound?.id ?? null,
        role: preset?.role || "研发",
        ratio,
        endDate: end,
      },
    });
  }
  try {
    await syncConflictTodos();
  } catch (err) {
    console.error("[work] syncConflictTodos after savePhaseItemMember failed", err);
  }
  return `把${name}按 ${ratio}% 排进「${project.name}」${PHASE_LABEL[item.phase.kind]}的${item.name}`;
}

export async function removePhaseItemMember(
  access: PlatformAccess,
  userId: number,
  memberId: number,
): Promise<{ summary: string; projectId: number }> {
  const member = await prisma.workPhaseItemMember.findFirst({
    where: { id: memberId },
    include: { item: { include: { phase: { select: { projectId: true, kind: true } } } } },
  });
  if (!member) throw new WorkError("找不到这个投入", 404);
  const project = await requireManage(access, userId, member.item.phase.projectId);
  await prisma.workPhaseItemMember.delete({ where: { id: memberId } });
  const still = await prisma.workPhaseItemMember.count({
    where: { name: member.name, item: { phaseId: member.item.phaseId } },
  });
  // 事项上的人删光后，阶段名册还留着的话，阶段行上仍显示这个人，而且删不掉。
  if (still === 0) {
    await prisma.workPhaseMember.deleteMany({
      where: { phaseId: member.item.phaseId, name: member.name },
    });
  }
  try {
    await syncConflictTodos();
  } catch (err) {
    console.error("[work] syncConflictTodos after removePhaseItemMember failed", err);
  }
  return {
    projectId: project.id,
    summary: `把${member.name}从「${project.name}」${PHASE_LABEL[member.item.phase.kind]}的${member.item.name}移出`,
  };
}

export async function removePhaseMember(
  access: PlatformAccess,
  userId: number,
  memberId: number,
): Promise<{ summary: string; projectId: number }> {
  const member = await prisma.workPhaseMember.findFirst({
    where: { id: memberId },
    include: { phase: { select: { projectId: true, kind: true } } },
  });
  if (!member) throw new WorkError("找不到这个人", 404);
  const project = await requireManage(access, userId, member.phase.projectId);
  await prisma.workPhaseItemMember.deleteMany({
    where: { name: member.name, item: { phaseId: member.phaseId } },
  });
  await prisma.workPhaseMember.delete({ where: { id: memberId } });
  await syncConflictTodos();
  return {
    projectId: project.id,
    summary: `把${member.name}移出「${project.name}」的${PHASE_LABEL[member.phase.kind]}`,
  };
}

/** 某人在某个项目里的单个阶段占用（真正排到的时间段，不再跨阶段合并） */
export interface PersonPhaseSegment {
  kind: string;
  label: string;
  from: string;
  to: string;
  /** 投入比例 %，不是 all in 的项目按 30 / 50 记 */
  ratio: number;
  /** 这个阶段里单独记进度的事项（研发实施 / SIT测试 / UAT测试），周安排页直接展示 */
  items: { name: string; progress: number }[];
}

export interface PersonProjectSpan {
  projectId: number;
  projectName: string;
  phases: string;
  span: string;
  from: string;
  to: string;
  release: string;
  /** 该项目里最高的一次投入比例，方便一眼看出是不是 all in */
  ratio: number;
  conflictWith: string[];
  /** 按阶段拆开的真实占用区间，日历看板按它画条块 */
  segments: PersonPhaseSegment[];
}

export interface PersonSummary {
  key: string;
  name: string;
  external: boolean;
  conflict: boolean;
  /** 这个人挂过的角色（如 前端研发 / 后端研发 / 测试人员），项目经理已过滤 */
  roles: string[];
  /** 所有阶段加起来，同一天最多同时投入多少（%）。超过 100 就是排满了还超 */
  peakRatio: number;
  projects: PersonProjectSpan[];
}

function rangesOverlap(from: string, to: string, otherFrom: string, otherTo: string): boolean {
  if (!from || !to || !otherFrom || !otherTo) return false;
  return from <= otherTo && otherFrom <= to;
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * 找出同一天最多同时投入多少。用扫描线算，结束日的第二天才释放，
 * 这样「A 项目 3 号结束、B 项目 3 号开始」不会误判成叠加。
 */
function peakRatioOf(segments: PersonPhaseSegment[]): number {
  const events: { day: string; delta: number }[] = [];
  for (const segment of segments) {
    if (!segment.from || !segment.to) continue;
    events.push({ day: segment.from, delta: segment.ratio });
    events.push({ day: addDaysIso(segment.to, 1), delta: -segment.ratio });
  }
  if (events.length === 0) return 0;
  events.sort((a, b) => a.day.localeCompare(b.day) || b.delta - a.delta);
  let running = 0;
  let peak = 0;
  for (const event of events) {
    running += event.delta;
    if (running > peak) peak = running;
  }
  return peak;
}

function trackedProgress(item: { status: WorkPhaseItemStatus; progress: number }): number {
  return item.status === "DONE" ? 100 : item.status === "PENDING" ? 0 : item.progress;
}

/**
 * 一个阶段里要计入占用的人。
 * 已经拆到事项上的，百分比是各事项之和；还没拆的，沿用阶段上原来的比例。
 * 项目经理不参与占用。
 */
function phaseSeats(phase: {
  members: {
    name: string;
    userId: number | null;
    role: string | null;
    ratio: number;
    startDate: Date | null;
    endDate: Date | null;
  }[];
  items: {
    id: number;
    name: string;
    trackProgress: boolean;
    rework: boolean;
    startDate: Date | null;
    endDate: Date | null;
    devEnterDate: Date | null;
    status: WorkPhaseItemStatus;
    progress: number;
    members: { name: string; userId: number | null; ratio: number; endDate: Date | null }[];
  }[];
}): {
  name: string;
  userId: number | null;
  role: string;
  ratio: number;
  startDate: Date | null;
  endDate: Date | null;
  /** 新增需求从自己的研发进入日算起，没有进入日就不占 */
  fixedStart: boolean;
  /** 同一阶段里不同事项分开记，避免释放日被并成一段 */
  segmentKey: string;
  tracked: { name: string; progress: number }[];
}[] {
  const roleByName = new Map<string, string>();
  for (const member of phase.members) {
    const role = (member.role ?? "").trim();
    if (role && !roleByName.has(member.name)) roleByName.set(member.name, role);
  }
  const seats: {
    name: string;
    userId: number | null;
    role: string;
    ratio: number;
    startDate: Date | null;
    endDate: Date | null;
    fixedStart: boolean;
    segmentKey: string;
    tracked: { name: string; progress: number }[];
  }[] = [];
  const assigned = new Set<string>();
  for (const item of phase.items) {
    const progress = trackedProgress(item);
    for (const member of item.members) {
      const role = roleByName.get(member.name) ?? "";
      if (role === "项目经理") continue;
      assigned.add(member.name);
      seats.push({
        name: member.name,
        userId: member.userId,
        role,
        ratio: member.ratio,
        startDate: item.rework ? laterDay(item.startDate, item.devEnterDate) : null,
        endDate: item.rework ? earlierDay(member.endDate, item.endDate) : member.endDate,
        fixedStart: item.rework,
        segmentKey: `item:${item.id}`,
        tracked: item.trackProgress || item.rework ? [{ name: item.name, progress }] : [],
      });
    }
  }
  const fallback = phase.items
    .filter((item) => item.trackProgress)
    .map((item) => ({ name: item.name, progress: trackedProgress(item) }));
  for (const member of phase.members) {
    if (assigned.has(member.name)) continue;
    const role = (member.role ?? "").trim();
    if (role === "项目经理") continue;
    seats.push({
      name: member.name,
      userId: member.userId,
      role,
      ratio: member.ratio,
      startDate: member.startDate,
      endDate: member.endDate,
      fixedStart: false,
      segmentKey: "phase",
      tracked: fallback,
    });
  }
  return seats;
}

export async function listPersonSummary(access: PlatformAccess, user: SessionUser): Promise<PersonSummary[]> {
  await ensurePhases();
  const projects = await prisma.workProject.findMany({
    where: visibleWhere(access, user.id),
    select: {
      id: true,
      name: true,
      phases: {
        orderBy: { sort: "asc" },
        select: {
          kind: true,
          enabled: true,
          startDate: true,
          endDate: true,
          members: true,
          items: {
            orderBy: { sort: "asc" },
            select: {
              id: true,
              name: true,
              trackProgress: true,
              rework: true,
              startDate: true,
              endDate: true,
              devEnterDate: true,
              status: true,
              progress: true,
              members: { select: { name: true, userId: true, ratio: true, endDate: true } },
            },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const grouped = new Map<string, PersonSummary>();
  const roleSets = new Map<string, Set<string>>();
  for (const project of projects) {
    const byPerson = new Map<
      string,
      {
        name: string;
        external: boolean;
        phases: string[];
        from: string;
        to: string;
        release: string;
        segments: Map<string, PersonPhaseSegment>;
      }
    >();
    for (const phase of project.phases) {
      if (!phase.enabled) continue;
      for (const member of phaseSeats(phase)) {
        const key = `name:${member.name}`;
        if (member.role) {
          const set = roleSets.get(key) ?? new Set<string>();
          set.add(member.role);
          roleSets.set(key, set);
        }
        const from = member.fixedStart ? isoDay(member.startDate) : isoDay(member.startDate) || isoDay(phase.startDate);
        const to = isoDay(member.endDate) || isoDay(phase.endDate);
        const current = byPerson.get(key) ?? {
          name: member.name,
          external: member.userId == null,
          phases: [],
          from: "",
          to: "",
          release: "",
          segments: new Map<string, PersonPhaseSegment>(),
        };
        const phaseLabel = PHASE_LABEL[phase.kind];
        if (!current.phases.includes(phaseLabel)) current.phases.push(phaseLabel);
        if (from && (!current.from || from < current.from)) current.from = from;
        if (to && (!current.to || to > current.to)) current.to = to;
        const release = isoDay(member.endDate);
        if (release && (!current.release || release > current.release)) current.release = release;
        if (from && to && to >= from) {
          const segmentKey = `${phase.kind}:${member.segmentKey}`;
          const existing = current.segments.get(segmentKey);
          if (existing) {
            if (from < existing.from) existing.from = from;
            if (to > existing.to) existing.to = to;
            existing.ratio = member.ratio;
            existing.items = member.tracked;
          } else {
            current.segments.set(segmentKey, {
              kind: phase.kind,
              label: PHASE_LABEL[phase.kind],
              from,
              to,
              ratio: member.ratio,
              items: member.tracked,
            });
          }
        }
        byPerson.set(key, current);
      }
    }
    for (const [key, item] of byPerson) {
      const person = grouped.get(key) ?? {
        key,
        name: item.name,
        external: item.external,
        conflict: false,
        roles: [...(roleSets.get(key) ?? [])],
        peakRatio: 0,
        projects: [],
      };
      const span = item.from || item.to ? rangeLabel(item.from, item.to) : "时间未定";
      const segments = [...item.segments.values()].sort(
        (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
      );
      person.projects.push({
        projectId: project.id,
        projectName: project.name,
        phases: item.phases.join("、"),
        span,
        from: item.from,
        to: item.to,
        release: item.release ? dayLabel(item.release) : "未定",
        ratio: segments.reduce((max, segment) => Math.max(max, segment.ratio), 0),
        conflictWith: [],
        segments,
      });
      grouped.set(key, person);
    }
  }

  for (const person of grouped.values()) {
    const rangesOf = (project: PersonProjectSpan) => {
      if (project.segments.length > 0) return project.segments;
      return project.from && project.to ? [{ from: project.from, to: project.to }] : [];
    };
    for (let i = 0; i < person.projects.length; i += 1) {
      for (let j = i + 1; j < person.projects.length; j += 1) {
        const left = person.projects[i];
        const right = person.projects[j];
        const clash = rangesOf(left).some((a) =>
          rangesOf(right).some((b) => rangesOverlap(a.from, a.to, b.from, b.to)),
        );
        if (!clash) continue;
        left.conflictWith.push(right.projectName);
        right.conflictWith.push(left.projectName);
      }
    }
    person.conflict = person.projects.some((project) => project.conflictWith.length > 0);
    person.peakRatio = peakRatioOf(person.projects.flatMap((project) => project.segments));
  }

  await syncConflictTodos();
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "zh") || a.key.localeCompare(b.key));
}

/**
 * 人员时间冲突只在「人员汇总」页展示，不再收成待办 —— 冲突靠人工排期判断，
 * 一条条待办太吵。这里只负责把历史上生成过的冲突待办清掉，保留页面的冲突标记。
 */
export async function syncConflictTodos(): Promise<void> {
  await prisma.todo.deleteMany({
    where: { source: "WORK", sourceBizId: { startsWith: "work-conflict:" }, status: { not: "DONE" } },
  });
}

/** 某一天同时参与的阶段投入之和（%）。用来判断排没排满。 */
export function loadOnDay(segments: PersonPhaseSegment[], day: string): number {
  let load = 0;
  for (const segment of segments) {
    if (segment.kind === "LIVE" || !segment.from || !segment.to) continue;
    if (segment.from <= day && day <= segment.to) load += segment.ratio;
  }
  return load;
}

export interface WeeklyEntry {
  projectId: number;
  projectName: string;
  phaseLabel: string;
  kind: string;
  ratio: number;
  items: { name: string; progress: number }[];
  /** 与这一周重叠的区间 */
  from: string;
  to: string;
}

export interface WeeklyPerson {
  key: string;
  name: string;
  roles: string[];
  /** 这一周平均每天占用（%），按七天取平均 */
  load: number;
  /** 这一周单日最高占用（%），超过 100 就是排满了 */
  peak: number;
  entries: WeeklyEntry[];
}

export interface WeeklyColumn {
  label: string;
  from: string;
  to: string;
  people: WeeklyPerson[];
}

export interface WeeklyPlan {
  columns: WeeklyColumn[];
}

function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const dow = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dow);
  return date.toISOString().slice(0, 10);
}

function weekRoleKind(role: string): "dev" | "qa" | null {
  if (role.includes("测试")) return "qa";
  if (/研发|开发|前端|后端/.test(role)) return "dev";
  return null;
}

/**
 * 周安排：只看研发和测试，按上周 / 本周 / 下周三个窗口，
 * 把每个人在这周参与的阶段、项目和单独记进度的事项列出来。
 */
export async function weeklyPlan(access: PlatformAccess, user: SessionUser): Promise<WeeklyPlan> {
  const people = await listPersonSummary(access, user);
  const thisMonday = mondayOf(todayIso());
  const build = (offset: number, label: string): WeeklyColumn => {
    const from = addDaysIso(thisMonday, offset * 7);
    const to = addDaysIso(from, 6);
    const rows: WeeklyPerson[] = [];
    for (const person of people) {
      const kinds = new Set(person.roles.map(weekRoleKind).filter(Boolean));
      if (kinds.size === 0 && person.roles.length > 0) continue;
      const segments = person.projects.flatMap((project) => project.segments);
      let total = 0;
      let peak = 0;
      for (let day = 0; day < 7; day += 1) {
        const load = loadOnDay(segments, addDaysIso(from, day));
        total += load;
        if (load > peak) peak = load;
      }
      const entries: WeeklyEntry[] = [];
      for (const project of person.projects) {
        for (const segment of project.segments) {
          if (segment.kind === "LIVE" || !segment.from || !segment.to) continue;
          if (segment.from > to || segment.to < from) continue;
          entries.push({
            projectId: project.projectId,
            projectName: project.projectName,
            phaseLabel: segment.label,
            kind: segment.kind,
            ratio: segment.ratio,
            items: segment.items,
            from: segment.from < from ? from : segment.from,
            to: segment.to > to ? to : segment.to,
          });
        }
      }
      if (entries.length === 0) continue;
      entries.sort((a, b) => a.from.localeCompare(b.from) || a.projectName.localeCompare(b.projectName, "zh"));
      rows.push({
        key: person.key,
        name: person.name,
        roles: person.roles,
        load: Math.round(total / 7),
        peak,
        entries,
      });
    }
    rows.sort((a, b) => b.peak - a.peak || b.load - a.load || a.name.localeCompare(b.name, "zh"));
    return { label, from, to, people: rows };
  };
  return { columns: [build(-1, "上周"), build(0, "本周"), build(1, "下周")] };
}
