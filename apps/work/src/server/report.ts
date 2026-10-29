import ExcelJS from "exceljs";
import { dayDiff, zonedDate, zonedDayRange, type PlatformAccess } from "@nas/core";
import { prisma, type ProjectStatus, type WorkPhaseItemStatus, type WorkPhaseKind, type WorkPhaseResult } from "@nas/db";
import { PHASE_LABEL, PHASE_SHORT } from "@/lib/labels";
import { visibleWhere } from "./access";
import { isoDay, todayIso } from "./dates";

export interface ReportLine {
  id: number;
  name: string;
  /** 括号里的跟进人，只要名字 */
  people: string;
  /** 冒号后面的进展。待排期可以是空的 */
  detail: string;
}

export interface ReportRisk {
  id: number;
  name: string;
  level: string;
  detail: string;
  note: string;
}

export interface ReportForecast {
  direction: string;
  detail: string;
  owner: string;
  date: string;
}

export interface WeeklyReport {
  title: string;
  from: string;
  to: string;
  rangeText: string;
  weekLabel: string;
  isCurrent: boolean;
  prevHref: string;
  nextHref: string | null;
  risks: ReportRisk[];
  done: ReportLine[];
  launching: ReportLine[];
  active: ReportLine[];
  waitTest: ReportLine[];
  unscheduled: ReportLine[];
  created: ReportLine[];
  forecast: ReportForecast[];
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2EF" } };
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD8D8D2" } },
  left: { style: "thin", color: { argb: "FFD8D8D2" } },
  bottom: { style: "thin", color: { argb: "FFD8D8D2" } },
  right: { style: "thin", color: { argb: "FFD8D8D2" } },
};

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const dow = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dow);
  return date.toISOString().slice(0, 10);
}

function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function weekHref(monday: string, thisMonday: string): string {
  return monday === thisMonday ? "/report" : `/report?week=${monday}`;
}

function resolveWeek(raw: string | undefined): { from: string; to: string; start: Date; end: Date; isCurrent: boolean } {
  const thisMonday = mondayOf(todayIso());
  let from = thisMonday;
  if (raw && isIsoDay(raw)) {
    const monday = mondayOf(raw);
    if (monday <= thisMonday && monday >= "2020-01-06") from = monday;
  }
  const to = addDaysIso(from, 6);
  const start = zonedDayRange(new Date(`${from}T12:00:00Z`)).start;
  const end = zonedDayRange(new Date(`${to}T12:00:00Z`)).end;
  return { from, to, start, end, isCurrent: from === thisMonday };
}

function weekTitle(from: string, isCurrent: boolean): string {
  if (isCurrent) return "本周";
  if (from === addDaysIso(mondayOf(todayIso()), -7)) return "上周";
  return "往期";
}

/** 10月第4周：按这个周的周一是当月第几个周一。 */
function monthWeekTitle(monday: string): string {
  const [year, month, day] = monday.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const dow = (first.getUTCDay() + 6) % 7;
  const firstMonday = dow === 0 ? 1 : 1 + (7 - dow);
  const index = day < firstMonday ? 1 : Math.floor((day - firstMonday) / 7) + 1;
  return `${year}年${month}月第${index}周工作总结`;
}

/** 10.26，和手写周报里的日期一样 */
function md(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(month)}.${Number(day)}`;
}

function dotted(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${year}.${Number(month)}.${Number(day)}`;
}

interface ItemRow {
  name: string;
  status: WorkPhaseItemStatus;
  progress: number;
  trackProgress: boolean;
  rework: boolean;
}

function averageProgress(items: ItemRow[]): number | null {
  if (items.length === 0) return null;
  const started = items.filter((item) => item.status !== "PENDING" || item.progress > 0);
  const pool = started.length > 0 ? started : items;
  return Math.round(pool.reduce((sum, item) => sum + item.progress, 0) / pool.length);
}

function devAndTest(phases: { kind: WorkPhaseKind; enabled: boolean; items: ItemRow[] }[]): {
  dev: number | null;
  test: number | null;
} {
  const dev = phases
    .filter((phase) => phase.enabled && phase.kind === "DEV")
    .flatMap((phase) => phase.items.filter((item) => item.trackProgress));
  const rework = phases
    .filter((phase) => phase.enabled)
    .flatMap((phase) => phase.items.filter((item) => item.rework && (item.status !== "PENDING" || item.progress > 0)));
  const test = phases
    .filter((phase) => phase.enabled && (phase.kind === "SIT" || phase.kind === "UAT"))
    .flatMap((phase) => phase.items.filter((item) => item.trackProgress));
  return { dev: averageProgress([...dev, ...rework]), test: averageProgress(test) };
}

interface PhaseRow {
  kind: WorkPhaseKind;
  enabled: boolean;
  result: WorkPhaseResult;
  startDate: Date | null;
  endDate: Date | null;
  members: { name: string; role: string | null }[];
  items: ItemRow[];
}

interface ProjectRow {
  id: number;
  name: string;
  status: ProjectStatus;
  phase: WorkPhaseKind;
  managerName: string | null;
  launchDate: Date | null;
  createdAt: Date;
  phases: PhaseRow[];
}

function namesOf(members: { name: string; role: string | null }[], role?: string): string[] {
  const names: string[] = [];
  for (const member of members) {
    if (role ? member.role !== role : member.role === "项目经理") continue;
    const clean = member.name.trim();
    if (clean && !names.includes(clean)) names.push(clean);
  }
  return names;
}

function crew(project: ProjectRow): string {
  const current = project.phases.find((phase) => phase.kind === project.phase);
  const names = namesOf(current?.members ?? []);
  if (names.length === 0) {
    for (const phase of project.phases) {
      for (const name of namesOf(phase.members)) {
        if (!names.includes(name)) names.push(name);
      }
    }
  }
  if (names.length === 0 && project.managerName?.trim()) names.push(project.managerName.trim());
  return names.join("、");
}

function phaseByKind(project: ProjectRow, kind: WorkPhaseKind): PhaseRow | undefined {
  return project.phases.find((phase) => phase.kind === kind);
}

function scheduled(phase: PhaseRow | undefined): boolean {
  return Boolean(isoDay(phase?.startDate) || isoDay(phase?.endDate));
}

/** 研发跟进里的人：研发取研发节点，测试取当前 SIT 或 UAT。 */
function devAndQa(project: ProjectRow, testKind: "SIT" | "UAT"): string {
  const devPhase = phaseByKind(project, "DEV");
  const testPhase = phaseByKind(project, testKind);
  const dev = namesOf(devPhase?.members ?? [], "研发");
  for (const name of namesOf(testPhase?.members ?? [], "研发")) {
    if (!dev.includes(name)) dev.push(name);
  }
  const test = namesOf(testPhase?.members ?? [], "测试");
  const bits: string[] = [];
  if (dev.length > 0) bits.push(`研发 ${dev.join("、")}`);
  if (test.length > 0) bits.push(`测试 ${test.join("、")}`);
  return bits.join("，") || crew(project);
}

type Bucket = "done" | "launching" | "active" | "waitTest" | "unscheduled";

/** 实际上线日写在上线阶段上。项目上的上线日只是早先暂定的，不拿来判断本周是否完成。 */
function liveDay(project: ProjectRow): string {
  const live = phaseByKind(project, "LIVE");
  return isoDay(live?.startDate) || isoDay(live?.endDate);
}

function classify(project: ProjectRow, weekFrom: string, weekTo: string): Bucket | null {
  if (project.phase === "LIVE") {
    const day = liveDay(project);
    return day >= weekFrom && day <= weekTo ? "done" : null;
  }
  if (project.status === "DONE") return null;
  if (project.phase === "PRELAUNCH") return "launching";
  if (project.phase === "SIT") return scheduled(phaseByKind(project, "SIT")) ? "active" : "waitTest";
  if (project.phase === "UAT") return "active";
  if (project.phase === "DEV") return scheduled(phaseByKind(project, "DEV")) ? "active" : "unscheduled";
  if (project.phase === "BUSINESS" || project.phase === "PREPARE") return "unscheduled";
  return "active";
}

/** 准备上线还没走完的事项，写成周报里的那句动作。 */
function openLaunchWork(items: ItemRow[]): string[] {
  const open = items.filter((item) => item.status !== "DONE");
  const phrases: string[] = [];
  const take = (match: (name: string) => boolean, phrase: string) => {
    if (open.some((item) => match(item.name))) phrases.push(phrase);
  };
  take((name) => name.includes("OA"), "推进OA流程");
  take((name) => name.includes("文档"), "撰写文档");
  take((name) => name.includes("运维"), "等待运维评审");
  for (const item of open) {
    if (item.name.includes("OA") || item.name.includes("文档") || item.name.includes("运维")) continue;
    phrases.push(item.name);
  }
  return phrases;
}

function story(project: ProjectRow, bucket: Bucket): string {
  const launch = isoDay(project.launchDate);
  if (bucket === "done") {
    const day = liveDay(project);
    return day ? `${md(day)}上线` : "";
  }
  if (bucket === "launching") {
    const pending = openLaunchWork(phaseByKind(project, "PRELAUNCH")?.items ?? []);
    if (pending.length > 0) return pending.join("、");
    return launch ? `上线时间 ${md(launch)}` : "上线时间未定";
  }
  if (bucket === "waitTest") return "研发已完成，等测试资源释放";
  if (bucket === "unscheduled") return "";
  if (project.phase === "UAT") return "UAT进行中";
  if (project.phase === "SIT") {
    const sit = phaseByKind(project, "SIT");
    const test = averageProgress((sit?.items ?? []).filter((item) => item.trackProgress));
    return `SIT进行中，测试进度 ${test ?? 0}%`;
  }
  if (project.phase === "DEV") {
    const { dev } = devAndTest(project.phases);
    return `研发进度 ${dev ?? 0}%`;
  }
  return `${PHASE_SHORT[project.phase]}中`;
}

function lineOf(project: ProjectRow, detail: string): ReportLine {
  return { id: project.id, name: project.name, people: crew(project), detail };
}

function byName(a: ReportLine, b: ReportLine): number {
  return a.name.localeCompare(b.name, "zh");
}

/**
 * 周报按手写总结的栏目来：完成、待上线、跟进中、等测试、待排期。
 * 每一行是「项目（跟进人）：现在进展到哪」。
 */
export async function weeklyReport(access: PlatformAccess, userId: number, weekRaw?: string): Promise<WeeklyReport> {
  const week = resolveWeek(weekRaw);
  const asOf = week.isCurrent ? todayIso() : week.to;
  const projects = await prisma.workProject.findMany({
    where: visibleWhere(access, userId),
    select: {
      id: true,
      name: true,
      status: true,
      phase: true,
      managerName: true,
      launchDate: true,
      createdAt: true,
      phases: {
        orderBy: { sort: "asc" },
        select: {
          kind: true,
          enabled: true,
          result: true,
          startDate: true,
          endDate: true,
          members: { select: { name: true, role: true } },
          items: {
            select: { name: true, status: true, progress: true, trackProgress: true, rework: true },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const done: ReportLine[] = [];
  const launching: ReportLine[] = [];
  const active: ReportLine[] = [];
  const waitTest: ReportLine[] = [];
  const unscheduled: ReportLine[] = [];
  const created: ReportLine[] = [];
  const risks: ReportRisk[] = [];

  for (const project of projects) {
    const bucket = classify(project, week.from, week.to);
    const createdOn = zonedDate(project.createdAt);
    if (createdOn >= week.from && createdOn <= week.to) {
      created.push(lineOf(project, `${md(createdOn)}新增`));
    }
    if (!bucket) continue;
    const detail = story(project, bucket);
    const line = lineOf(project, detail);
    if (bucket === "waitTest") line.people = namesOf(phaseByKind(project, "SIT")?.members ?? [], "测试").join("、");
    else if (bucket === "active" && (project.phase === "SIT" || project.phase === "UAT")) line.people = devAndQa(project, project.phase);
    if (bucket === "done") done.push(line);
    else if (bucket === "launching") launching.push(line);
    else if (bucket === "waitTest") waitTest.push(line);
    else if (bucket === "unscheduled") unscheduled.push(line);
    else active.push(line);

    const current = project.phases.find((phase) => phase.kind === project.phase);
    const end = isoDay(current?.endDate);
    if (bucket !== "done" && project.status !== "PAUSED" && current?.enabled && end && end < asOf) {
      risks.push({
        id: project.id,
        name: project.name,
        level: "高",
        detail: `${PHASE_LABEL[project.phase]} ${md(end)}结束，逾期 ${-dayDiff(end, asOf)} 天`,
        note: crew(project),
      });
    }
  }

  done.sort(byName);
  launching.sort(byName);
  active.sort(byName);
  waitTest.sort(byName);
  unscheduled.sort(byName);
  created.sort(byName);
  risks.sort((a, b) => a.name.localeCompare(b.name, "zh"));

  const nextFrom = addDaysIso(week.from, 7);
  const nextTo = addDaysIso(week.to, 7);
  const forecast: ReportForecast[] = [];
  const ownerOf = (rows: ProjectRow[]) => {
    const names = [...new Set(rows.map((row) => row.managerName?.trim()).filter((name): name is string => Boolean(name)))];
    return names.slice(0, 3).join("、") || "—";
  };
  const open = projects.filter((project) => project.phase !== "LIVE" && project.status !== "DONE");
  const launchingNext = open.filter((project) => {
    const launch = isoDay(project.launchDate);
    return launch >= nextFrom && launch <= nextTo;
  });
  if (launchingNext.length > 0) {
    forecast.push({
      direction: "项目上线",
      detail: launchingNext.map((project) => `${project.name} ${md(isoDay(project.launchDate))}上线`).join("；"),
      owner: ownerOf(launchingNext),
      date: dotted(asOf),
    });
  }
  const endingNext = open.filter((project) => {
    const end = isoDay(project.phases.find((phase) => phase.kind === project.phase)?.endDate);
    return end >= nextFrom && end <= nextTo && !launchingNext.some((item) => item.id === project.id);
  });
  if (endingNext.length > 0) {
    forecast.push({
      direction: "阶段结束",
      detail: endingNext
        .map((project) => {
          const end = isoDay(project.phases.find((phase) => phase.kind === project.phase)?.endDate);
          return `${project.name} ${PHASE_SHORT[project.phase]} ${md(end)}结束`;
        })
        .join("；"),
      owner: ownerOf(endingNext),
      date: dotted(asOf),
    });
  }
  if (risks.length > 0) {
    forecast.push({
      direction: "阶段逾期",
      detail: `${risks.length} 个项目当前阶段已逾期，下周继续盯`,
      owner: ownerOf(open.filter((project) => risks.some((risk) => risk.id === project.id))),
      date: dotted(asOf),
    });
  }

  const thisMonday = mondayOf(todayIso());
  return {
    title: monthWeekTitle(week.from),
    from: week.from,
    to: week.to,
    rangeText: `${md(week.from)} ～ ${md(week.to)}`,
    weekLabel: weekTitle(week.from, week.isCurrent),
    isCurrent: week.isCurrent,
    prevHref: weekHref(addDaysIso(week.from, -7), thisMonday),
    nextHref: week.isCurrent ? null : weekHref(addDaysIso(week.from, 7), thisMonday),
    risks,
    done,
    launching,
    active,
    waitTest,
    unscheduled,
    created,
    forecast,
  };
}

function bullet(line: ReportLine): string {
  const people = line.people ? `（${line.people}）` : "";
  return line.detail ? `- ${line.name}${people}：${line.detail}` : `- ${line.name}${people}`;
}

function section(title: string, lines: ReportLine[], empty: string): string[] {
  return [`### ${title}`, "", ...(lines.length > 0 ? lines.map(bullet) : [empty]), ""];
}

export function renderWeeklyReportMarkdown(report: WeeklyReport): string {
  const lines = [
    `# ${report.title}`,
    "",
    "## 关键情况概括",
    "",
    "### 高风险进展",
    "",
  ];
  if (report.risks.length === 0) lines.push("无", "");
  else {
    lines.push("| 项目 | 风险级别 | 情况说明 | 备注 |", "| --- | --- | --- | --- |");
    for (const risk of report.risks) lines.push(`| ${risk.name} | ${risk.level} | ${risk.detail} | ${risk.note || "—"} |`);
    lines.push("");
  }
  lines.push(
    "## 项目进展",
    "",
    ...section("本周完成项目", report.done, "本周暂无完成项目"),
    ...section("待上线项目", report.launching, "无"),
    ...section("研发跟进中项目", report.active, "无"),
    ...section("等待测试资源", report.waitTest, "无"),
    ...section("研发待排期项目", report.unscheduled, "无"),
    ...section("新增项目", report.created, "本周暂无新增项目"),
    "## 下周风险预报",
    "",
  );
  if (report.forecast.length === 0) lines.push("无");
  else {
    lines.push("| 方向 | 情况描述 | 提报人 | 提报日期 |", "| --- | --- | --- | --- |");
    for (const row of report.forecast) lines.push(`| ${row.direction} | ${row.detail} | ${row.owner} | ${row.date} |`);
  }
  return `${lines.join("\n").trim()}\n`;
}

function styleSheet(sheet: ExcelJS.Worksheet, headers: string[], widths: number[]) {
  sheet.columns = headers.map((header, index) => ({ header, key: `c${index}`, width: widths[index] }));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", horizontal: "center" };
  header.height = 22;
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.border = THIN;
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function paintRows(sheet: ExcelJS.Worksheet) {
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = THIN;
    });
  });
}

export async function exportWeeklyReportXlsx(report: WeeklyReport): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "工作台";
  const sheet = book.addWorksheet("项目进展");
  styleSheet(sheet, ["分组", "项目", "跟进人", "进展"], [16, 36, 28, 42]);
  const groups: Array<[string, ReportLine[]]> = [
    ["本周完成项目", report.done],
    ["待上线项目", report.launching],
    ["研发跟进中项目", report.active],
    ["等待测试资源", report.waitTest],
    ["研发待排期项目", report.unscheduled],
    ["新增项目", report.created],
  ];
  for (const [group, lines] of groups) {
    for (const line of lines) sheet.addRow([group, line.name, line.people || "—", line.detail || "—"]);
  }
  paintRows(sheet);

  const risk = book.addWorksheet("风险");
  styleSheet(risk, ["栏目", "项目或方向", "级别或提报人", "说明", "备注或日期"], [14, 28, 16, 42, 20]);
  for (const row of report.risks) risk.addRow(["高风险进展", row.name, row.level, row.detail, row.note || "—"]);
  for (const row of report.forecast) risk.addRow(["下周风险预报", row.direction, row.owner, row.detail, row.date]);
  paintRows(risk);

  const buffer = await book.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
