import ExcelJS from "exceljs";
import { prisma, type IssueKind, type IssueStatus, type WorkPhaseKind, type WorkPriority } from "@nas/db";
import { ISSUE_KIND_OPTIONS, ISSUE_OPTIONS, PHASE_OPTIONS, PRIORITY_OPTIONS } from "@/lib/labels";
import { ensurePhases, syncConflictTodos } from "./phase";
import { canManage } from "./access";
import { parseDay, utcDay } from "./dates";
import { WorkError } from "./errors";
import type { PlatformAccess, SessionUser } from "@nas/core";

/**
 * Excel 导入：用的就是导出那张表的格式，按「项目」列全名匹配，
 * 同名直接全量重写，新名就新建。
 *
 * 口径（和用户对过）：
 * - 阶段人员按角色落库：项目经理→商务阶段，研发→项目准备/研发/上线准备/已上线，
 *   测试→SIT/UAT，「其他」算研发；只动这几个阶段的人员，别的不碰。
 * - 项目预设的参加人员 = 涉及人员里的全部名字。
 * - 表里的人都是系统外人员，不核对系统账号，userId 一律留空；
 *   项目经理不参与账号绑定，「谁是项目经理」由阶段人员里的角色体现，
 *   ownerId 记在导入人名下。
 * - 备注里的未解决问题导入成问题记录，已存在项目里描述能对上的跳过。
 */

const HEADER = [
  "项目",
  "提出方",
  "紧急程度",
  "平台",
  "涉及人员",
  "当前阶段",
  "商务开始时间",
  "商务结束时间",
  "研发开始时间",
  "研发结束时间",
  "SIT开始时间",
  "SIT结束时间",
  "UAT开始时间",
  "UAT结束时间",
  "上线准备开始时间",
  "上线准备结束时间",
  "上线时间",
  "备注",
] as const;

/** 每列的阶段日期落在哪个阶段上，key 与 HEADER 的列一一对应。 */
const DATE_PHASES: (WorkPhaseKind | null)[] = [
  null, null, null, null, null, null,
  "BUSINESS", "BUSINESS",
  "DEV", "DEV",
  "SIT", "SIT",
  "UAT", "UAT",
  "PRELAUNCH", "PRELAUNCH",
  null, null,
];

const MAX_ROWS = 500;
const MAX_BYTES = 5 * 1024 * 1024;

const priorityOf = new Map(PRIORITY_OPTIONS.map((option) => [option.label, option.value]));
const phaseOf = new Map(PHASE_OPTIONS.map((option) => [option.label, option.value]));
const issueKindOf = new Map(ISSUE_KIND_OPTIONS.map((option) => [option.label, option.value]));
const issueStatusOf = new Map(ISSUE_OPTIONS.map((option) => [option.label, option.value]));

export interface ImportIssue {
  description: string;
  kind: IssueKind;
  status: IssueStatus;
  handler: string;
  phase: WorkPhaseKind | null;
}

export interface ParsedRow {
  rowNumber: number;
  name: string;
  code: string;
  priority: WorkPriority | null;
  phase: WorkPhaseKind | null;
  managers: string[];
  dev: string[];
  qa: string[];
  others: string[];
  dates: Partial<Record<WorkPhaseKind, { start: string; end: string }>>;
  launchDate: string;
  issues: ImportIssue[];
}

export interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; project: string; message: string }[];
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ""
      : `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number") {
    // 没设日期格式的单元格会读成序列号，按 Excel 1900 日期系换算
    if (Number.isInteger(value) && value > 20000 && value < 80000) {
      const date = new Date(Math.round((value - 25569) * 86400000));
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("error" in value) return "";
  }
  return "";
}

function splitNames(raw: string): string[] {
  const names: string[] = [];
  for (const piece of raw.split(/[、,，;；\s]+/)) {
    const name = piece.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** 涉及人员按行解析：项目经理：a、b / 研发：c / 测试：d，中英文冒号都认。 */
function parseCrew(raw: string): { managers: string[]; dev: string[]; qa: string[]; others: string[] } {
  const managers: string[] = [];
  const dev: string[] = [];
  const qa: string[] = [];
  const others: string[] = [];
  const push = (list: string[], names: string[]) => {
    for (const name of names) if (!list.includes(name)) list.push(name);
  };
  for (const line of raw.split(/[\r\n]+/)) {
    const text = line.trim();
    if (!text || text === "—" || text === "-") continue;
    const cut = text.search(/[:：]/);
    if (cut < 0) {
      push(others, splitNames(text));
      continue;
    }
    const role = text.slice(0, cut).trim();
    const names = splitNames(text.slice(cut + 1));
    if (role === "项目经理") push(managers, names);
    else if (role === "研发") push(dev, names);
    else if (role === "测试") push(qa, names);
    else push(others, names);
  }
  return { managers, dev, qa, others };
}

/**
 * 备注按行解析：1. 描述（bug · 未处理 · 张三 · 研发节点）。
 * 状态写了已解决的行直接丢掉；整格「无」等于没有问题。
 */
function parseIssues(raw: string): ImportIssue[] {
  const text = raw.trim();
  if (!text || text === "无" || text === "没有" || text === "-") return [];
  const issues: ImportIssue[] = [];
  for (const line of text.split(/[\r\n]+/)) {
    const stripped = line.replace(/^\s*\d+\s*[.、．。:：]\s*/, "").trim();
    if (!stripped) continue;
    let description = stripped;
    let kind: IssueKind = "IMPROVEMENT";
    let status: IssueStatus = "OPEN";
    let phase: WorkPhaseKind | null = null;
    const handlers: string[] = [];
    const meta = stripped.match(/（([^（）]*)）\s*$/);
    if (meta) {
      description = stripped.slice(0, meta.index).trim();
      for (const part of meta[1].split(/[·•|／/]/)) {
        const token = part.trim();
        if (!token) continue;
        if (issueKindOf.has(token)) kind = issueKindOf.get(token)!;
        else if (issueStatusOf.has(token)) status = issueStatusOf.get(token)!;
        else if (phaseOf.has(token)) phase = phaseOf.get(token)!;
        else handlers.push(...splitNames(token));
      }
    }
    if (!description || status === "RESOLVED") continue;
    const handler = handlers.join("、").slice(0, 40);
    issues.push({ description: description.slice(0, 200), kind, status, handler, phase });
  }
  return issues;
}

/** 格子里的日期：Date 对象、序列号、2026-10-18 / 2026/10/18 都认，认不出就报错。 */
function parseDateCell(raw: string, label: string, rowNumber: number): string {
  const text = raw.trim();
  if (!text) return "";
  const normalized = text.replace(/[./年]/g, "-").replace(/月/g, "-").replace(/[日号]/g, "").replace(/-+$/, "");
  const padded = normalized.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_, y: string, m: string, d: string) => {
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  });
  if (!parseDay(padded)) throw new WorkError(`第 ${rowNumber} 行「${label}」日期不对：${text}`);
  return padded;
}

function parseRow(values: string[], rowNumber: number): ParsedRow | null {
  const name = values[0].trim().replace(/\s+/g, " ");
  if (!name) return null;
  if (name.length > 40) throw new WorkError(`第 ${rowNumber} 行项目名太长了，最多 40 字`);
  const code = values[1].trim().replace(/\s+/g, " ");
  if (code.length > 16) throw new WorkError(`第 ${rowNumber} 行提出方太长了，最多 16 字`);
  const priorityRaw = values[2].trim();
  const priority = priorityRaw ? (priorityOf.get(priorityRaw) ?? null) : null;
  if (priorityRaw && !priority) throw new WorkError(`第 ${rowNumber} 行紧急程度不对：${priorityRaw}`);
  const phaseRaw = values[5].trim();
  const phase = phaseRaw ? (phaseOf.get(phaseRaw) ?? null) : null;
  if (phaseRaw && !phase) throw new WorkError(`第 ${rowNumber} 行当前阶段不对：${phaseRaw}`);

  const crew = parseCrew(values[4]);
  for (const list of [crew.managers, crew.dev, crew.qa, crew.others]) {
    for (const person of list) {
      if (person.length > 20) throw new WorkError(`第 ${rowNumber} 行名字太长了：${person}`);
    }
  }

  const dates: ParsedRow["dates"] = {};
  // 日期列成对出现：开始、结束。步长必须是 2，不然会把相邻两组串起来
  for (let col = 6; col <= 14; col += 2) {
    const kind = DATE_PHASES[col];
    if (!kind) continue;
    const start = parseDateCell(values[col], HEADER[col], rowNumber);
    const end = parseDateCell(values[col + 1], HEADER[col + 1], rowNumber);
    if (start && end && end < start) {
      throw new WorkError(`第 ${rowNumber} 行${HEADER[col].replace("开始时间", "")}结束日早于开始日`);
    }
    if (start || end) dates[kind] = { start, end };
  }
  const launchDate = parseDateCell(values[16], "上线时间", rowNumber);

  return {
    rowNumber,
    name,
    code,
    priority,
    phase,
    ...crew,
    dates,
    launchDate,
    issues: parseIssues(values[17]),
  };
}

/** 读表：表头必须跟导出模板一字不差，空行跳过，表内同名算错。 */
export async function parseImportWorkbook(buffer: Buffer): Promise<ParsedRow[]> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = book.worksheets[0];
  if (!sheet) throw new WorkError("这个文件里没有工作表");
  const header = sheet.getRow(1).values as ExcelJS.CellValue[];
  const titles = (Array.isArray(header) ? header.slice(1) : []).map((cell) => cellText(cell).trim());
  const bad = HEADER.some((title, index) => titles[index] !== title) || titles.length !== HEADER.length;
  if (bad) throw new WorkError("表头跟导出模板对不上，请用「导出 Excel」拿到的表填");

  const rows: ParsedRow[] = [];
  const seen = new Map<string, number>();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    if (rowNumber - 1 > MAX_ROWS) throw new WorkError(`一次最多导 ${MAX_ROWS} 行`);
    const values = HEADER.map((_, index) => cellText(row.getCell(index + 1).value));
    if (values.every((value) => !value.trim())) return;
    const parsed = parseRow(values, rowNumber);
    if (!parsed) return;
    const clash = seen.get(parsed.name);
    if (clash) throw new WorkError(`表里第 ${clash} 行和第 ${rowNumber} 行项目同名：${parsed.name}`);
    seen.set(parsed.name, rowNumber);
    rows.push(parsed);
  });
  if (rows.length === 0) throw new WorkError("表里没有能导的行");
  return rows;
}

/**
 * 项目预设的参加人员 = 涉及人员里的全部名字。
 * 导入的人一律当系统外人员，只留名字不绑账号。
 */
async function syncPresetMembers(projectId: number, names: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.workMember.deleteMany({ where: { projectId, name: { notIn: names } } }),
    ...names.map((name) =>
      prisma.workMember.upsert({
        where: { projectId_name: { projectId, name } },
        create: { projectId, name, userId: null, ratio: 100 },
        update: { userId: null },
      }),
    ),
  ]);
}

/**
 * 角色落到哪些阶段：项目经理→商务，研发→项目准备/研发/上线准备/已上线，
 * 测试→SIT/UAT，「其他」按研发算。
 */
export function crewPlan(parsed: ParsedRow): Map<WorkPhaseKind, { names: string[]; role: string }> {
  return new Map<WorkPhaseKind, { names: string[]; role: string }>([
    ["BUSINESS", { names: [...new Set(parsed.managers)], role: "项目经理" }],
    ["PREPARE", { names: [...new Set([...parsed.dev, ...parsed.others])], role: "研发" }],
    ["DEV", { names: [...new Set([...parsed.dev, ...parsed.others])], role: "研发" }],
    ["SIT", { names: [...new Set(parsed.qa)], role: "测试" }],
    ["UAT", { names: [...new Set(parsed.qa)], role: "测试" }],
    ["PRELAUNCH", { names: [...new Set(parsed.dev)], role: "研发" }],
    ["LIVE", { names: [...new Set(parsed.dev)], role: "研发" }],
  ]);
}

/**
 * 按 crewPlan 重写这几个阶段的人员，同一个人同阶段只留一条，
 * 其他阶段的人员原样不动。
 */
async function syncCrewPhases(projectId: number, phases: { id: number; kind: WorkPhaseKind }[], parsed: ParsedRow): Promise<void> {
  const plan = crewPlan(parsed);
  const byId = new Map(phases.map((phase) => [phase.kind, phase.id]));
  for (const [kind, entry] of plan) {
    const phaseId = byId.get(kind);
    if (!phaseId) continue;
    await prisma.$transaction([
      prisma.workPhaseMember.deleteMany({ where: { phaseId } }),
      ...(entry.names.length
        ? [
            prisma.workPhaseMember.createMany({
              data: entry.names.map((name) => ({
                phaseId,
                userId: null,
                name,
                role: entry.role,
                ratio: 100,
              })),
            }),
          ]
        : []),
    ]);
  }
}

function statusOf(phase: WorkPhaseKind): "PREPARING" | "RUNNING" | "DONE" {
  if (phase === "LIVE") return "DONE";
  if (phase === "BUSINESS") return "PREPARING";
  return "RUNNING";
}

/**
 * 哪些阶段要启用：填了日期的、有人的，再加当前阶段。
 * 表格里没日期也没人的阶段视为不用，直接关掉。
 */
function keepKinds(parsed: ParsedRow, phase: WorkPhaseKind): Set<WorkPhaseKind> {
  const keep = new Set<WorkPhaseKind>([...(Object.keys(parsed.dates) as WorkPhaseKind[]), phase]);
  if (parsed.managers.length > 0) keep.add("BUSINESS");
  if (parsed.dev.length > 0 || parsed.others.length > 0) {
    keep.add("PREPARE");
    keep.add("DEV");
    keep.add("PRELAUNCH");
    keep.add("LIVE");
  }
  if (parsed.qa.length > 0) {
    keep.add("SIT");
    keep.add("UAT");
  }
  return keep;
}

/** 备注的问题往库里放：描述能对上已有的就跳过，只追加新增的。 */
async function appendIssues(
  projectId: number,
  phases: { id: number; kind: WorkPhaseKind }[],
  parsed: ParsedRow,
): Promise<void> {
  if (parsed.issues.length === 0) return;
  const byKind = new Map(phases.map((phase) => [phase.kind, phase.id]));
  const existing = await prisma.workIssue.findMany({
    where: { projectId, status: { not: "RESOLVED" } },
    select: { description: true },
  });
  const known = new Set(existing.map((issue) => issue.description.replace(/\s+/g, " ").trim()));
  const fresh = parsed.issues.filter((issue) => !known.has(issue.description));
  if (fresh.length === 0) return;
  await prisma.workIssue.createMany({
    data: fresh.map((issue) => ({
      projectId,
      description: issue.description,
      impact: null,
      solution: null,
      status: issue.status,
      kind: issue.kind,
      handler: issue.handler || null,
      phaseId: issue.phase ? (byKind.get(issue.phase) ?? null) : null,
      ownerId: null,
      nodeId: null,
    })),
  });
}

async function applyRow(
  access: PlatformAccess,
  user: SessionUser,
  parsed: ParsedRow,
  result: ImportResult,
): Promise<void> {
  const existing = await prisma.workProject.findFirst({
    where: { name: parsed.name },
    select: { id: true, ownerId: true, phase: true, progress: true },
  });
  if (existing) {
    if (!canManage(access, user.id, existing.ownerId)) {
      throw new WorkError(`第 ${parsed.rowNumber} 行「${parsed.name}」不是你负责的，改不了`);
    }
  }

  // 表里的人全是系统外人员，一律不核对账号；
  // ownerId 必填且指向系统用户，所以内部归属记在导入人名下，
  // 对外显示的负责人用 managerName（项目经理的名字）
  const ownerId = user.id;
  const managerName = parsed.managers[0]?.trim() || null;

  const phase = parsed.phase ?? existing?.phase ?? "BUSINESS";
  const priority = parsed.priority ?? "MEDIUM";

  if (existing) {
    const phases = await prisma.workPhase.findMany({ where: { projectId: existing.id } });
    const keep = keepKinds(parsed, phase);
    await prisma.$transaction([
      prisma.workProject.update({
        where: { id: existing.id },
        data: {
          code: parsed.code || null,
          priority,
          phase,
          status: statusOf(phase),
          launchDate: parsed.launchDate ? utcDay(parsed.launchDate) : null,
          ownerId,
          managerName,
        },
      }),
      ...phases.map((item) => {
        const span = parsed.dates[item.kind];
        return prisma.workPhase.update({
          where: { id: item.id },
          data: {
            enabled: keep.has(item.kind),
            startDate: span?.start ? utcDay(span.start) : null,
            endDate: span?.end ? utcDay(span.end) : null,
          },
        });
      }),
    ]);
    const crewNames = [...new Set([...parsed.managers, ...parsed.dev, ...parsed.qa, ...parsed.others])];
    await syncPresetMembers(existing.id, crewNames);
    await syncCrewPhases(existing.id, phases, parsed);
    await appendIssues(existing.id, phases, parsed);
    result.updated += 1;
    return;
  }

  const created = await prisma.workProject.create({
    data: {
      name: parsed.name,
      code: parsed.code || null,
      status: statusOf(phase),
      startDate: null,
      endDate: null,
      ownerId,
      managerName,
      description: null,
      progress: 0,
      priority,
      phase,
      launchDate: parsed.launchDate ? utcDay(parsed.launchDate) : null,
    },
  });
  await ensurePhases({ id: created.id });
  const phases = await prisma.workPhase.findMany({ where: { projectId: created.id } });
  const keep = keepKinds(parsed, phase);
  await prisma.$transaction(
    phases.map((item) => {
      const span = parsed.dates[item.kind];
      return prisma.workPhase.update({
        where: { id: item.id },
        data: {
          enabled: keep.has(item.kind),
          startDate: span?.start ? utcDay(span.start) : null,
          endDate: span?.end ? utcDay(span.end) : null,
        },
      });
    }),
  );
  const crewNames = [...new Set([...parsed.managers, ...parsed.dev, ...parsed.qa, ...parsed.others])];
  await syncPresetMembers(created.id, crewNames);
  await syncCrewPhases(created.id, phases, parsed);
  await appendIssues(created.id, phases, parsed);
  result.created += 1;
}

/**
 * 整表导入：一行一个项目，同名按导入更新，没有就新增。
 * 一行报错只跳过这一行，继续往下导，最后把成功和失败一起返回。
 */
export async function importProjects(
  access: PlatformAccess,
  user: SessionUser,
  buffer: Buffer,
): Promise<ImportResult> {
  if (buffer.length === 0) throw new WorkError("文件是空的");
  if (buffer.length > MAX_BYTES) throw new WorkError("文件太大了，最多 5MB");
  const rows = await parseImportWorkbook(buffer);
  await ensurePhases();
  const result: ImportResult = { created: 0, updated: 0, errors: [] };
  for (const parsed of rows) {
    try {
      await applyRow(access, user, parsed, result);
    } catch (err) {
      result.errors.push({
        row: parsed.rowNumber,
        project: parsed.name,
        message: err instanceof WorkError ? err.message : "这一行没导进去",
      });
      if (!(err instanceof WorkError)) console.error("[work] import row failed", parsed.name, err);
    }
  }
  try {
    await syncConflictTodos();
  } catch (err) {
    console.error("[work] syncConflictTodos after import failed", err);
  }
  return result;
}
