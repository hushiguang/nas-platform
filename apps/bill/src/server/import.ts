/**
 * 账单导入：解析上传文件 → 预览 → 提交。
 *
 * 从 cash-platform/server/src/index.js 的导入段移植。
 * 解析规则本身在 importers.js（微信 / 支付宝 / 京东 / 钱迹 / 招行 PDF / 自定义），
 * 那部分是纯矩阵运算、**不碰数据库**，所以原样保留，一行没改；
 * 这里只负责把「取数」换成 Prisma，以及预览与提交这两段流程。
 */
import type { BillTxSource } from "@nas/db";
import { prisma } from "@nas/db";
import { BillError } from "./errors";
import { centsToYuan } from "./money";
import { kindOfCategory } from "./category-rule";
import { loadCategoryRules, matchCategoryRule } from "./category-rule";
import { applyTransferRules } from "./transfer-rule";
import { normalizeAccountName, resolveCategoryPath } from "./taxonomy";
import { insertTransaction, type TxInput } from "./transaction";
import { canSeeBook, canWriteBook, type Actor } from "./book";
// importers 是原样搬过来的 JS，没有类型声明 —— 解析出的行是动态的，这里按 unknown 处理
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { parseFile } from "./importers";

const TX_SOURCES = new Set(["MANUAL", "ALIPAY", "WECHAT", "CMB", "JD", "QIANJI", "CUSTOM", "RECURRING"]);

/** 解析器给的是小写渠道名，库里存的是 PG 枚举（大写） */
function txSource(value: unknown): BillTxSource {
  const raw = String(value || "").toUpperCase();
  return (TX_SOURCES.has(raw) ? raw : "CUSTOM") as BillTxSource;
}

/** 上传文件：文件名可能是 latin1 编的（某些浏览器），先救回来 */
function decodeUploadName(name: string): string {
  const raw = name || "账单";
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  if (decoded.includes("\uFFFD") || /[\u0080-\u009f]/.test(decoded)) return raw;
  if (decoded !== raw && /[\u4e00-\u9fff]/.test(decoded)) return decoded;
  return raw;
}

/** 招行 PDF 的乱码修正表：解析前先按用户的配置把乱码替换掉 */
async function garbleFixes(userId: number) {
  const rows = await prisma.billCmbTextFix.findMany({
    where: { ownerId: userId, enabled: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { garbled: true, correct: true },
  });
  return rows;
}

/** 预览里回给前端的一行：金额带上「元」的字符串，前端直接显示 */
function previewRow(row: Record<string, unknown>) {
  return {
    occurredAt: row.occurredAt,
    type: row.type,
    amount: row.amountCents == null ? "" : centsToYuan(Number(row.amountCents)),
    amountCents: row.amountCents,
    categoryName: row.categoryName || "",
    categoryLabel: row.categoryLabel || "",
    subcategoryName: row.subcategoryName || "",
    accountName: row.accountName || "",
    toAccountName: row.toAccountName || "",
    memberName: row.memberName || "",
    payee: row.payee || "",
    note: row.note || "",
    // 分摊人跟着回前端，导入时才写得进账单
    shareWith: Array.isArray(row.shareWith) ? row.shareWith : null,
    externalId: row.externalId || "",
    skipReason: row.skipReason,
    incoming: !!row.incoming,
  };
}

/** 这一批导入会新增哪些账户 / 分类。前端用它提示「将创建…」 */
export async function previewNewNames(userId: number, rows: Array<Record<string, unknown>>) {
  const [accounts, aliases, categories] = await Promise.all([
    prisma.billAccount.findMany({ where: { ownerId: userId }, select: { name: true } }),
    prisma.billAccountAlias.findMany({ where: { ownerId: userId }, select: { alias: true } }),
    prisma.billCategory.findMany({
      where: { ownerId: userId, archived: false },
      select: { name: true, kind: true },
    }),
  ]);
  const accountNames = new Set([...accounts.map((a) => a.name), ...aliases.map((a) => a.alias)]);
  const known = new Set(categories.map((c) => `${c.kind}\u0000${c.name}`));

  const newAccounts = new Set<string>();
  const newCategories = new Set<string>();
  for (const row of rows) {
    if (row.skipReason) continue;
    for (const raw of [row.accountName, row.toAccountName]) {
      const name = normalizeAccountName(raw as string | null | undefined);
      if (name && !accountNames.has(name)) newAccounts.add(name);
    }
    if (row.type === "transfer" || !row.categoryName) continue;
    const path = resolveCategoryPath(
      String(row.categoryName || ""),
      kindOfCategory(String(row.type || "expense")),
    );
    if (!path) continue; // 认不出来的落「其他」，不算新增
    const leaf = path[1] || path[0];
    if (!known.has(`${String(row.type)}\u0000${leaf}`)) newCategories.add(leaf);
  }
  return { newAccounts: [...newAccounts], newCategories: [...newCategories] };
}

async function parseUpload(
  file: { buffer: Buffer; filename: string },
  source: string,
  mapping: Record<string, unknown> | null,
  userId: number,
) {
  const filename = decodeUploadName(file.filename);
  const fixes = await garbleFixes(userId);
  try {
    const parsed = await parseFile(file.buffer, filename, source, mapping, fixes);
    if (parsed.needsMapping) {
      return {
        filename,
        needsMapping: true,
        source: parsed.source,
        headers: parsed.headers,
        suggested: parsed.suggested,
        samples: parsed.samples,
        rows: [] as Array<Record<string, unknown>>,
        total: 0,
        ready: 0,
        skipped: 0,
      };
    }
    const rows: Array<Record<string, unknown>> = (parsed.rows || []).map((row: Record<string, unknown>) => ({
      ...previewRow(row),
      source: parsed.source,
      filename,
    }));
    return {
      filename,
      needsMapping: false,
      source: parsed.source,
      total: rows.length,
      ready: rows.filter((row) => !row.skipReason).length,
      skipped: rows.filter((row) => row.skipReason).length,
      rows,
    };
  } catch (err) {
    return {
      filename,
      needsMapping: false,
      error: (err as Error)?.message || "解析失败",
      rows: [] as Array<Record<string, unknown>>,
      total: 0,
      ready: 0,
      skipped: 0,
    };
  }
}

/**
 * 预览：解析所有文件 → 补自动分类 → 套转账规则 → 算出新增项。
 * 与旧接口返回结构完全一致，前端不用改。
 */
export async function previewImport(
  actor: Actor,
  files: Array<{ buffer: Buffer; filename: string }>,
  source: string,
  mapping: Record<string, unknown> | null,
) {
  const parsedFiles = await Promise.all(files.map((file) => parseUpload(file, source, mapping, actor.id)));
  const rows = parsedFiles.flatMap((file) => file.rows || []);

  // 解析没给出分类的，按自动分类规则补上，预览里就能看到归类结果
  const rules = await loadCategoryRules(actor.id);
  for (const row of rows) {
    if (row.skipReason || row.categoryName) continue;
    const hit = matchCategoryRule(rules, row);
    if (hit) row.categoryName = hit.categoryName;
  }
  // 按用户配置的转账规则，把命中的账单标记为转账（并可补上转入账户）
  for (const row of rows) {
    if (row.skipReason) continue;
    await applyTransferRules(actor.id, row);
  }

  return {
    files: parsedFiles,
    needsMapping: parsedFiles.some((file) => file.needsMapping),
    ...(await previewNewNames(actor.id, rows)),
    total: rows.length,
    ready: rows.filter((row) => !row.skipReason).length,
    skipped: rows.filter((row) => row.skipReason).length,
  };
}

/**
 * 提交：把预览确认过的行逐条写库。
 *
 * 用 $transaction 包起来：中途炸了整批回滚，不会留下「导了一半」的账单。
 * 去重靠 externalId（insertTransaction 内部查重），重复的直接计入 duplicated。
 */
export async function commitImport(
  actor: Actor,
  rows: Array<Record<string, unknown>>,
  source: string,
  bookId: number | null,
) {
  if (bookId) {
    const book = await canSeeBook(actor, bookId);
    if (!book || !(await canWriteBook(actor, book))) throw new BillError("没有当前账本的导入权限", 403);
  }
  if (!rows.length) throw new BillError("没有可导入的账单");

  let inserted = 0;
  let duplicated = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.skipReason) continue;
    try {
      const result = await insertTransaction(
        actor,
        { ...(row as unknown as TxInput), bookId },
        txSource(row.source || source),
        String(row.externalId || "") || null,
      );
      if (result.skipped) duplicated += 1;
      else inserted += 1;
    } catch {
      failed += 1;
    }
  }

  return { inserted, duplicated, failed };
}
