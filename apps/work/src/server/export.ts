import ExcelJS from "exceljs";
import { platformOf } from "@/lib/platform";
import type { ProjectView } from "./project";

/** 涉及人员的分组顺序。角色取自阶段人员上填的角色，同一人跨阶段只算一次。 */
const CREW_ROLES = [
  { role: "项目经理", label: "项目经理" },
  { role: "研发", label: "研发" },
  { role: "测试", label: "测试" },
] as const;

/** 阶段日期列，kind 对应 WorkPhaseKind。 */
const PHASE_COLUMNS = [
  { kind: "BUSINESS", start: "商务开始时间", end: "商务结束时间" },
  { kind: "DEV", start: "研发开始时间", end: "研发结束时间" },
  { kind: "SIT", start: "SIT开始时间", end: "SIT结束时间" },
  { kind: "UAT", start: "UAT开始时间", end: "UAT结束时间" },
  { kind: "PRELAUNCH", start: "上线准备开始时间", end: "上线准备结束时间" },
] as const;

/** 列顺序即导出表的列顺序。 */
const HEADERS = [
  "项目",
  "提出方",
  "紧急程度",
  "平台",
  "涉及人员",
  "当前阶段",
  ...PHASE_COLUMNS.flatMap((column) => [column.start, column.end]),
  "上线时间",
  "备注",
];

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2EF" } };
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD8D8D2" } },
  left: { style: "thin", color: { argb: "FFD8D8D2" } },
  bottom: { style: "thin", color: { argb: "FFD8D8D2" } },
  right: { style: "thin", color: { argb: "FFD8D8D2" } },
};

/** 每列的宽度，和表头对得上。 */
function columnWidths(): number[] {
  return HEADERS.map((header) => {
    if (header === "项目") return 26;
    if (header === "涉及人员") return 30;
    if (header === "备注") return 56;
    if (header === "当前阶段") return 14;
    if (header === "上线时间" || header === "提出方" || header === "平台") return 13;
    return 14;
  });
}

/** 涉及人员按角色分组，一人一行：项目经理：xxx、xxx / 研发：xxx / 测试：xxx */
function crewText(item: ProjectView): string {
  const byRole = new Map<string, string[]>();
  for (const phase of item.phases) {
    if (!phase.enabled) continue;
    for (const member of phase.members) {
      const name = member.name.trim();
      if (!name) continue;
      const role = CREW_ROLES.some((option) => option.role === member.role) ? member.role : "其他";
      const list = byRole.get(role) ?? [];
      if (!list.includes(name)) list.push(name);
      byRole.set(role, list);
    }
  }
  const lines = CREW_ROLES.flatMap(({ role, label }) => {
    const names = byRole.get(role);
    return names && names.length > 0 ? [`${label}：${names.join("、")}`] : [];
  });
  const others = byRole.get("其他");
  if (others && others.length > 0) lines.push(`其他：${others.join("、")}`);
  return lines.length > 0 ? lines.join("\n") : "—";
}

/** 未解决的问题堆进一个单元格，编号列出，带类型、状态、处理人和所属阶段。 */
function issueText(item: ProjectView): string {
  const open = item.issues.filter((issue) => issue.status !== "RESOLVED");
  if (open.length === 0) return "无";
  return open
    .map((issue, index) => {
      const meta = [issue.kindLabel, issue.statusLabel, issue.handler, issue.phaseLabel]
        .filter((part): part is string => Boolean(part))
        .join(" · ");
      const text = issue.description.replace(/\s+/g, " ").trim();
      return `${index + 1}. ${text}${meta ? `（${meta}）` : ""}`;
    })
    .join("\n");
}

/** 一行一个项目，顺序与 HEADERS 一致。 */
function exportMatrix(items: ProjectView[]): (string | number)[][] {
  return items.map((item) => {
    const dates = PHASE_COLUMNS.flatMap((column) => {
      const phase = item.phases.find((entry) => entry.kind === column.kind);
      return [phase?.startDate ?? "", phase?.endDate ?? ""];
    });
    return [
      item.name,
      item.code || "未分组",
      item.priorityLabel,
      platformOf(item.name),
      crewText(item),
      item.phaseLabel,
      ...dates,
      item.launchDate,
      issueText(item),
    ];
  });
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** 导出多行 CSV。带 BOM，Excel 靠它认 UTF-8，否则中文乱码。 */
export function exportProjectsCsv(items: ProjectView[]): string {
  const lines = [HEADERS, ...exportMatrix(items)].map((line) => line.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/**
 * 导出 xlsx 工作簿，一行一个项目。表头冻结、日期按日期格式显示，
 * 「涉及人员」「备注」两列多行排版，长内容在单元格里直接展开。
 */
export async function exportProjectsXlsx(items: ProjectView[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "项目管理";
  const sheet = book.addWorksheet("项目", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = HEADERS.map((header, index) => ({ header, key: `c${index}`, width: columnWidths()[index] }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", horizontal: "center" };
  header.height = 22;
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.border = THIN;
  });

  for (const row of exportMatrix(items)) {
    sheet.addRow(row);
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.border = THIN;
      // 日期列按 yyyy-mm-dd 显示，别让 Excel 转成 45917 这样的序列号
      if (colNumber >= 7 && colNumber <= 16) cell.numFmt = "yyyy-mm-dd";
    });
  });

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };

  const buffer = await book.xlsx.writeBuffer();
  return Buffer.from(buffer);
}