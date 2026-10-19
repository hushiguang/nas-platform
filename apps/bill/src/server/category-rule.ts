/**
 * 自动分类规则：账单的「对方 / 备注 / 外部分类名」里含某个关键词，就归到指定分类。
 *
 * 移植自 cash-platform/server/src/index.js 里的 loadCategoryRules / matchCategoryRule /
 * applyRulesToUncategorized。
 *
 * 匹配规则：命中的是**最长**的那条规则（越长越具体）——
 * 「星巴克」和「咖啡」同时命中时，应该按「星巴克」那条走。
 */
import { prisma } from "@nas/db";
import type { BillCategoryKind } from "@nas/db";
import { BillError } from "./errors";
import { categoryOwned } from "./category";

export interface CategoryRuleRow {
  id: number;
  keyword: string;
  categoryId: number;
  categoryName: string;
  kind: string;
}

/** 取本人名下、且分类未被归档的全部规则，按关键词长度倒序（长的优先） */
export async function loadCategoryRules(userId: number): Promise<CategoryRuleRow[]> {
  const rows = await prisma.billCategoryRule.findMany({
    where: { ownerId: userId },
    orderBy: { id: "asc" },
  });
  if (!rows.length) return [];
  const categories = await prisma.billCategory.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.categoryId))] }, archived: false },
    select: { id: true, name: true, kind: true },
  });
  const map = new Map(categories.map((c) => [c.id, c]));
  return rows
    .filter((r) => map.has(r.categoryId))
    .map((r) => ({
      id: r.id,
      keyword: r.keyword,
      categoryId: r.categoryId,
      categoryName: map.get(r.categoryId)!.name,
      kind: map.get(r.categoryId)!.kind.toLowerCase(),
    }))
    .sort((a, b) => b.keyword.length - a.keyword.length);
}

/** 在 payee / note / categoryName 拼成的文本里找命中的规则，长的优先 */
export function matchCategoryRule(
  rules: CategoryRuleRow[],
  row: { payee?: unknown; note?: unknown; categoryName?: unknown },
): CategoryRuleRow | null {
  const text = [row.payee, row.note, row.categoryName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!text.trim()) return null;
  for (const rule of rules) {
    if (text.includes(rule.keyword.toLowerCase())) return rule;
  }
  return null;
}

export async function listCategoryRules(userId: number) {
  return loadCategoryRules(userId);
}

/**
 * 新建/覆盖规则，并立刻把它套到「还没有分类」的账单上 ——
 * 用户加完规则不用再点一次「套用」，与旧实现一致。
 */
export async function saveCategoryRule(userId: number, keyword: string, categoryId: number) {
  const clean = String(keyword ?? "").trim();
  if (!clean) throw new BillError("请填写关键词");
  const category = await categoryOwned(userId, Number(categoryId));
  if (!category) throw new BillError("请选择分类");

  await prisma.billCategoryRule.upsert({
    where: { ownerId_keyword: { ownerId: userId, keyword: clean } },
    create: { ownerId: userId, keyword: clean, categoryId: category.id },
    update: { categoryId: category.id },
  });

  const updated = await applyRules(userId, true);
  return { ok: true, updated: updated.updated };
}

export async function deleteCategoryRule(userId: number, id: number) {
  await prisma.billCategoryRule.deleteMany({ where: { id: Number(id), ownerId: userId } });
  return { ok: true };
}

/**
 * 把规则套到已有账单上。
 * 默认只补未分类的（`onlyUncategorized`），避免覆盖用户已经分好的。
 */
export async function applyRules(
  userId: number,
  onlyUncategorized = true,
  dryRun = false,
): Promise<{ matched: number; updated: number }> {
  const rules = await loadCategoryRules(userId);
  if (!rules.length) return { matched: 0, updated: 0 };

  const rows = await prisma.billTransaction.findMany({
    where: { ownerId: userId, ...(onlyUncategorized ? { categoryId: null } : {}) },
    select: { id: true, payee: true, note: true, type: true },
  });

  const hits: Array<{ id: number; categoryId: number }> = [];
  for (const row of rows) {
    // 注意：这里**不校验收支方向**，与旧实现保持一致。
    // 规则是用户自己配的，跨方向命中（比如「美团」规则落到一笔收入上）属于用户的配置结果，
    // 迁移阶段不顺手改行为 —— 真要加校验得先在旧系统里验证影响面。
    const rule = matchCategoryRule(rules, row);
    if (!rule) continue;
    hits.push({ id: row.id, categoryId: rule.categoryId });
  }

  if (dryRun || !hits.length) return { matched: hits.length, updated: 0 };
  await prisma.$transaction(
    hits.map((hit) =>
      prisma.billTransaction.update({
        where: { id: hit.id },
        data: { categoryId: hit.categoryId },
      }),
    ),
  );
  return { matched: hits.length, updated: hits.length };
}

/** 该分类是不是这个收支方向（供导入预览用） */
export function kindOfCategory(kind: string): BillCategoryKind {
  return kind.toLowerCase() === "income" ? "INCOME" : "EXPENSE";
}
