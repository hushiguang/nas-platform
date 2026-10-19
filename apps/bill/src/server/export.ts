/**
 * 导出与导入模板 —— 从 cash-platform/server/src/export.js 移植。
 *
 * 字段口径改了一处：新库的行是 Prisma 模型（camelCase），旧库是 SQLite 裸列
 * （snake_case），所以 exportMatrix 里的取值全部换成驼峰，
 * occurredAt 也从字符串变成了 Date，导出前要格式化。
 * 表头与列顺序一个字没动 —— 导出的文件要能原样导回来。
 */
import XLSX from "xlsx";
import { formatDateTime } from "./dates";
import { centsToYuan } from "./money";
import { parseShareWith, type TransactionRow } from "./transaction";

const TYPE_LABEL: Record<string, string> = { expense: "支出", income: "收入", transfer: "转账" };

// 新库的 source 是 PG 枚举，存的是大写
const SOURCE_LABEL: Record<string, string> = {
  MANUAL: "手动记账",
  WECHAT: "微信账单",
  ALIPAY: "支付宝账单",
  CMB: "招商银行",
  JD: "京东账单",
  QIANJI: "钱迹",
  RECURRING: "定期入账",
  CUSTOM: "自定义导入",
};

// 付款人/分摊人跟着一起导出，AA 账本才能导出后再原样导回来
export const EXPORT_HEADERS = [
  "时间",
  "类型",
  "金额",
  "分类",
  "二级分类",
  "账户1",
  "账户2",
  "商家",
  "备注",
  "付款人",
  "分摊人",
  "来源",
  "单号",
];

export function exportMatrix(rows: TransactionRow[]) {
  return rows.map((row) => {
    const parent = row.parentName || row.categoryName || "";
    const child = row.parentName ? row.categoryName || "" : "";
    const shareWith = parseShareWith(row.shareWith);
    return [
      row.occurredAt instanceof Date ? formatDateTime(row.occurredAt) : String(row.occurredAt || ""),
      TYPE_LABEL[row.type] || row.type || "",
      centsToYuan(row.amountCents),
      parent,
      child,
      row.accountName || "",
      row.toAccountName || "",
      row.payee || "",
      row.note || "",
      row.memberName || "",
      // 没设过（全员平摊）留空，自己承担的写成「自己」，其余是名单
      shareWith === null ? "" : shareWith.length ? shareWith.join("、") : "自己",
      SOURCE_LABEL[row.source] || row.source || "",
      row.externalId || "",
    ];
  });
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows: TransactionRow[]) {
  const lines = [EXPORT_HEADERS, ...exportMatrix(rows)].map((line) => line.map(csvCell).join(","));
  // BOM：Excel 靠它认 UTF-8，否则中文全是乱码
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function toXlsx(rows: TransactionRow[]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...exportMatrix(rows)]);
  sheet["!cols"] = EXPORT_HEADERS.map((header) => ({ wch: Math.max(header.length * 2, 12) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "账单");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// 导入模板：下载后按列填好，再走「自定义」导入就能直接解析
const IMPORT_TEMPLATES: Record<string, { sheet: string; filename: string; headers: string[]; sample: unknown[][] }> = {
  // 出游/家庭账本：共享账本里记「谁付的」，导入后落在 member_name。
  // 分摊人决定这笔钱摊给谁：留空 = 按账本参与人平分，写「自己」= 请客不算 AA
  travel: {
    sheet: "出游账本",
    filename: "出游账本导入模板.xlsx",
    headers: ["付款人", "费用", "费用类型", "费用详情", "日期", "分摊人"],
    sample: [
      ["胡胡", 271, "吃饭", "葫芦岛-邴家小颖海鲜", "2026-10-02", "胡胡、楠楠、郭志华、李燕飞"],
      ["楠楠", 362, "住宿", "葫芦岛-住宿", "2026-10-02", "胡胡、楠楠、郭志华"],
      ["胡胡", 560, "加油", "葫芦岛-加油", "2026-10-03", ""],
      ["胡胡", 88, "请客", "请大家喝水", "2026-10-03", "自己"],
    ],
  },
  custom: {
    sheet: "账单",
    filename: "账单导入模板.xlsx",
    headers: ["日期", "金额", "收/支", "分类", "账户", "对方", "备注"],
    sample: [
      ["2026-10-02", 271, "支出", "餐饮", "微信", "某某餐厅", "和朋友吃饭"],
      ["2026-10-03", 5000, "收入", "工资", "银行卡", "公司", ""],
    ],
  },
};

export function importTemplate(kind: string): { buffer: Buffer; filename: string } {
  const template = IMPORT_TEMPLATES[kind] || IMPORT_TEMPLATES.custom;
  const sheet = XLSX.utils.aoa_to_sheet([template.headers, ...template.sample]);
  sheet["!cols"] = template.headers.map((header) => ({ wch: Math.max(header.length * 2 + 4, 12) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, template.sheet);
  return {
    buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer,
    filename: template.filename,
  };
}
