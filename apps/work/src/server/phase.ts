import { dayDiff, type PlatformAccess, type SessionUser } from "@nas/core";
import { prisma, type ProjectStatus, type WorkPhaseKind } from "@nas/db";
import { MEMBER_ROLE_OPTIONS, PHASE_LABEL, PHASE_OPTIONS } from "@/lib/labels";
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

export async function savePhase(access: PlatformAccess, userId: number, form: FormData): Promise<string> {
  const phaseId = Number(text(form, "phaseId"));
  if (!Number.isInteger(phaseId) || phaseId <= 0) throw new WorkError("阶段不对");
  const phase = await prisma.workPhase.findFirst({
    where: { id: phaseId },
    select: { id: true, projectId: true, kind: true },
  });
  if (!phase) throw new WorkError("找不到这个阶段", 404);
  const project = await requireManage(access, userId, phase.projectId);
  const enabled = text(form, "enabled") !== "0";
  if (!enabled && project.phase === phase.kind) throw new WorkError("当前阶段不能关掉");
  const start = optionalDay(text(form, "startDate"), "开始日");
  const end = optionalDay(text(form, "endDate"), "结束日");
  if (start && end && end < start) throw new WorkError("结束日不能早于开始日");
  const devEnter = phase.kind === "SIT" || phase.kind === "UAT" ? optionalDay(text(form, "devEnterDate"), "研发进入日") : null;
  const progress = progressOf(text(form, "progress"));
  await prisma.workPhase.update({
    where: { id: phaseId },
    data: { enabled, startDate: start, endDate: end, devEnterDate: devEnter, progress },
  });
  await syncProjectProgress(project.id);
  await syncConflictTodos();
  return `修改「${project.name}」的${PHASE_LABEL[phase.kind]}，实际 ${progress}%`;
}

/** 项目实际进度等于启用阶段的实际进度。都排了期就按天数加权，否则各阶段一视同仁。 */
export function rolledProgress(
  phases: { enabled: boolean; progress: number; startDate: string; endDate: string }[],
): number {
  const enabled = phases.filter((phase) => phase.enabled);
  if (enabled.length === 0) return 0;
  const dated = enabled.every((phase) => phase.startDate && phase.endDate && phase.endDate >= phase.startDate);
  let total = 0;
  let done = 0;
  for (const phase of enabled) {
    const weight = dated ? dayDiff(phase.endDate, phase.startDate) + 1 : 1;
    total += weight;
    done += weight * phase.progress;
  }
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(done / total)));
}

async function syncProjectProgress(projectId: number): Promise<void> {
  const phases = await prisma.workPhase.findMany({
    where: { projectId },
    select: { enabled: true, progress: true, startDate: true, endDate: true },
  });
  const progress = rolledProgress(
    phases.map((phase) => ({
      enabled: phase.enabled,
      progress: phase.progress,
      startDate: isoDay(phase.startDate),
      endDate: isoDay(phase.endDate),
    })),
  );
  await prisma.workProject.update({ where: { id: projectId }, data: { progress } });
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
  const end = optionalDay(text(form, "endDate"), "预计释放");
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
      endDate: end,
      ratio: 100,
    })),
  });
  try {
    await syncConflictTodos();
  } catch (err) {
    console.error("[work] syncConflictTodos after savePhaseMembers failed", err);
  }
  return `把${toAdd.join("、")}排进「${project.name}」的${PHASE_LABEL[phase.kind]}`;
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
}

export interface PersonProjectSpan {
  projectId: number;
  projectName: string;
  phases: string;
  span: string;
  from: string;
  to: string;
  release: string;
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
  projects: PersonProjectSpan[];
}

function rangesOverlap(from: string, to: string, otherFrom: string, otherTo: string): boolean {
  if (!from || !to || !otherFrom || !otherTo) return false;
  return from <= otherTo && otherFrom <= to;
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
      for (const member of phase.members) {
        // 人员汇总只看研发和测试，项目经理不参与占用统计
        if ((member.role ?? "").trim() === "项目经理") continue;
        const key = `name:${member.name}`;
        if (member.role?.trim()) {
          const set = roleSets.get(key) ?? new Set<string>();
          set.add(member.role.trim());
          roleSets.set(key, set);
        }
        const from = isoDay(member.startDate) || isoDay(phase.startDate);
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
        current.phases.push(PHASE_LABEL[phase.kind]);
        if (from && (!current.from || from < current.from)) current.from = from;
        if (to && (!current.to || to > current.to)) current.to = to;
        const release = isoDay(member.endDate);
        if (release && (!current.release || release > current.release)) current.release = release;
        if (from && to) {
          const existing = current.segments.get(phase.kind);
          if (existing) {
            if (from < existing.from) existing.from = from;
            if (to > existing.to) existing.to = to;
          } else {
            current.segments.set(phase.kind, {
              kind: phase.kind,
              label: PHASE_LABEL[phase.kind],
              from,
              to,
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
        projects: [],
      };
      const span = item.from || item.to ? rangeLabel(item.from, item.to) : "时间未定";
      person.projects.push({
        projectId: project.id,
        projectName: project.name,
        phases: item.phases.join("、"),
        span,
        from: item.from,
        to: item.to,
        release: item.release ? dayLabel(item.release) : "未定",
        conflictWith: [],
        segments: [...item.segments.values()].sort(
          (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
        ),
      });
      grouped.set(key, person);
    }
  }

  for (const person of grouped.values()) {
    for (let i = 0; i < person.projects.length; i += 1) {
      for (let j = i + 1; j < person.projects.length; j += 1) {
        const left = person.projects[i];
        const right = person.projects[j];
        if (!rangesOverlap(left.from, left.to, right.from, right.to)) continue;
        left.conflictWith.push(right.projectName);
        right.conflictWith.push(left.projectName);
      }
    }
    person.conflict = person.projects.some((project) => project.conflictWith.length > 0);
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
