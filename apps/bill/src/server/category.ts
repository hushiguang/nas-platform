/**
 * 分类数据访问层。
 *
 * 替代 cash-platform/server/src/ledger.js 里所有分类相关逻辑：
 * 分类树维护、外部分类别名解析、导入时的三层兜底归类。
 *
 * 核心不变量：认不出来的分类一律落到「其他」，并且**把这个认不出来的名字记成别名**，
 * 下次直接命中。这样导入几千条账单不会把分类树撑爆。
 */
import { prisma } from "@nas/db";
import type { BillCategory, BillCategoryKind } from "@nas/db";
import { BillError } from "./errors";
import { CATEGORY_TREE, resolveCategoryPath } from "./taxonomy";

/** 取本人名下未归档的分类 */
export async function categoryOwned(userId: number, id: number | null | undefined) {
  if (!id) return null;
  return prisma.billCategory.findFirst({ where: { id, ownerId: userId, archived: false } });
}

/** 精确匹配一级/二级分类名 */
async function categoryByName(userId: number, kind: BillCategoryKind, name: string) {
  return prisma.billCategory.findFirst({ where: { ownerId: userId, kind, name } });
}

/** 分类别名优先：账单里的外部分类名直接落到统一分类上 */
export async function resolveCategoryAlias(
  userId: number,
  kind: BillCategoryKind,
  name: string | null | undefined,
) {
  const raw = String(name || "").trim();
  if (!raw) return null;
  // schema 里不声明 @relation，手工 join
  const row = await prisma.billCategoryAlias.findFirst({
    where: { ownerId: userId, kind, alias: raw },
  });
  if (!row) return null;
  return prisma.billCategory.findUnique({ where: { id: row.categoryId } });
}

/** 建「一级 + 二级」这对分类，一级不存在就顺手建出来 */
async function ensureTreeCategory(
  userId: number,
  kind: BillCategoryKind,
  parentName: string | null,
  childName: string,
) {
  let parentId: number | null = null;
  if (parentName) {
    let parentRow = await prisma.billCategory.findFirst({
      where: { ownerId: userId, kind, name: parentName, parentId: null },
    });
    if (!parentRow) {
      const max = await prisma.billCategory.aggregate({
        where: { ownerId: userId, parentId: null },
        _max: { sort: true },
      });
      parentRow = await prisma.billCategory.create({
        data: {
          ownerId: userId,
          name: parentName,
          parentId: null,
          kind,
          sort: (max._max.sort ?? 0) + 1,
        },
      });
    }
    parentId = parentRow.id;
  }
  const max = await prisma.billCategory.aggregate({
    where: { ownerId: userId },
    _max: { sort: true },
  });
  return prisma.billCategory.create({
    data: {
      ownerId: userId,
      name: childName,
      parentId,
      kind,
      sort: (max._max.sort ?? 0) + 1,
    },
  });
}

/**
 * 导入时的归类入口：给一个外部分类名，返回该落到的分类行。
 *
 * 顺序：外部映射表 → 用户已配的别名 → 同名分类 → 「其他」。
 * 前两者命中就直接用，第四种情况会把名字记成别名。
 */
export async function ensureCategory(
  userId: number,
  kind: BillCategoryKind,
  parentName: string | null | undefined,
  childName: string | null | undefined,
): Promise<BillCategory> {
  const parent = (parentName || "").trim();
  const child = (childName || "").trim();
  const leaf = child || parent;

  if (!leaf) {
    const other = await categoryByName(userId, kind, "其他");
    if (other) return other;
    return ensureTreeCategory(userId, kind, null, "其他");
  }

  // 1) 先按外部映射表把账单里的分类名换算成统一分类
  const path = resolveCategoryPath(leaf, kind);
  if (path) {
    const [topName, subName] = path;
    const top =
      (await categoryByName(userId, kind, topName)) ??
      (await ensureTreeCategory(userId, kind, null, topName));
    if (!subName) return top;
    return (
      (await categoryByName(userId, kind, subName)) ??
      (await ensureTreeCategory(userId, kind, topName, subName))
    );
  }

  // 2) 用户自己配过的别名
  const aliased = await resolveCategoryAlias(userId, kind, leaf);
  if (aliased) return aliased;

  // 3) 同名分类
  const found = await categoryByName(userId, kind, leaf);
  if (found) return found;

  // 4) 认不出来 → 「其他」，并记住这个名字，下次直接命中
  const fallback =
    (await categoryByName(userId, kind, "其他")) ??
    (await ensureTreeCategory(userId, kind, null, "其他"));
  await prisma.billCategoryAlias.upsert({
    where: { ownerId_kind_alias: { ownerId: userId, kind, alias: leaf } },
    create: { ownerId: userId, kind, alias: leaf, categoryId: fallback.id },
    update: { categoryId: fallback.id },
  });
  return fallback;
}

/** 分类树：一级带 children，用于「分类」页展示 */
export async function listCategoryTree(userId: number) {
  const rows = await prisma.billCategory.findMany({
    where: { ownerId: userId },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
  });
  const tops = rows.filter((r) => r.parentId === null);
  return tops.map((top) => ({
    id: top.id,
    name: top.name,
    kind: top.kind.toLowerCase(),
    sort: top.sort,
    archived: !!top.archived,
    children: rows
      .filter((r) => r.parentId === top.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind.toLowerCase(),
        sort: c.sort,
        archived: !!c.archived,
      })),
  }));
}

/** 旧 API 的 kind 是小写 expense / income */
export function toCategoryKind(value: unknown): BillCategoryKind {
  return String(value ?? "").trim().toLowerCase() === "income" ? "INCOME" : "EXPENSE";
}

/** 新建分类（一级或二级） */
export async function createCategory(
  userId: number,
  kind: BillCategoryKind,
  name: string,
  parentId?: number | null,
) {
  const clean = String(name || "").trim();
  if (!clean) throw new BillError("请填写分类名");
  let parent: number | null = null;
  if (parentId) {
    const row = await prisma.billCategory.findFirst({
      where: { id: Number(parentId), ownerId: userId, kind },
    });
    // 旧实现要求上级必须是同类型的一级分类
    if (!row || row.parentId) throw new BillError("上级分类不正确");
    parent = row.id;
  }
  const dup = await prisma.billCategory.findFirst({
    where: { ownerId: userId, kind, name: clean },
  });
  if (dup) throw new BillError("同类型下已有这个分类", 409);
  const max = await prisma.billCategory.aggregate({
    where: { ownerId: userId, ...(parent === null ? { parentId: null } : {}) },
    _max: { sort: true },
  });
  return prisma.billCategory.create({
    data: { ownerId: userId, kind, name: clean, parentId: parent, sort: (max._max.sort ?? 0) + 1 },
  });
}

export async function renameCategory(userId: number, id: number, name: string) {
  const clean = String(name || "").trim();
  if (!clean) throw new BillError("请填写分类名");
  const row = await prisma.billCategory.findFirst({ where: { id: Number(id), ownerId: userId } });
  if (!row) throw new BillError("分类不存在", 404);
  const oldName = row.name;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.billCategory.update({ where: { id: row.id }, data: { name: clean } });
    // 旧名保留为别名，否则以后再导入同样的外部分类名会又新建一个分类
    if (oldName && oldName !== clean) {
      await tx.billCategoryAlias.upsert({
        where: { ownerId_kind_alias: { ownerId: userId, kind: row.kind, alias: oldName } },
        create: { ownerId: userId, kind: row.kind, alias: oldName, categoryId: row.id },
        update: { categoryId: row.id },
      });
    }
    return updated;
  });
}

/** 归档分类（不删数据，账单还挂着它） */
export async function archiveCategory(userId: number, id: number, archived: boolean) {
  const row = await prisma.billCategory.findFirst({ where: { id: Number(id), ownerId: userId } });
  if (!row) throw new BillError("分类不存在", 404);
  return prisma.billCategory.update({ where: { id: row.id }, data: { archived } });
}

/** 平铺列表（含已归档），字段名与旧 GET /api/categories 一致 */
export async function listFlatCategories(userId: number) {
  const rows = await prisma.billCategory.findMany({
    where: { ownerId: userId },
    orderBy: [{ kind: "asc" }, { parentId: "asc" }, { sort: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parentId,
    kind: r.kind.toLowerCase(),
    sort: r.sort,
    archived: !!r.archived,
  }));
}

/** 单条取（含已归档 —— 恢复归档分类时要用到） */
async function categoryRow(userId: number, id: number) {
  return prisma.billCategory.findFirst({ where: { id: Number(id), ownerId: userId } });
}

/** 分类 + 它的所有二级分类 */
async function categoryWithChildren(row: BillCategory) {
  const children = await prisma.billCategory.findMany({ where: { parentId: row.id } });
  return [row, ...children];
}

/** 这批分类里是否还有账单在用 */
async function categoryInUse(userId: number, ids: number[]) {
  const n = await prisma.billTransaction.count({
    where: { ownerId: userId, categoryId: { in: ids } },
  });
  return n > 0;
}

/**
 * 改分类（旧 PATCH /api/categories/:id）：改名 / 换上级 / 归档一起处理。
 * 恢复一级分类时把二级分类一起恢复，否则界面上会出现「父级可见、子级看不见」。
 */
export async function updateCategory(
  userId: number,
  id: number,
  body: { name?: unknown; parentId?: unknown; archived?: unknown },
) {
  const row = await categoryRow(userId, id);
  if (!row) throw new BillError("分类不存在", 404);

  let name = row.name;
  if (body.name != null) {
    name = String(body.name).trim();
    if (!name) throw new BillError("请填写分类名");
    if (name !== row.name) {
      const dup = await prisma.billCategory.findFirst({
        where: { ownerId: userId, kind: row.kind, name, id: { not: row.id } },
      });
      if (dup) throw new BillError("同类型下已有这个分类", 409);
    }
  }

  let parentId = row.parentId;
  if (body.parentId !== undefined) {
    const next = Number(body.parentId) || null;
    if (next === row.id) throw new BillError("上级分类不正确");
    if (next == null) {
      parentId = null;
    } else {
      const parent = await prisma.billCategory.findFirst({
        where: { id: next, ownerId: userId },
      });
      if (!parent || parent.kind !== row.kind || parent.parentId) throw new BillError("上级分类不正确");
      parentId = parent.id;
    }
  }

  const archived = body.archived != null ? !!body.archived : row.archived;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.billCategory.update({
      where: { id: row.id },
      data: { name, parentId, archived },
    });
    if (!archived && !parentId) {
      await tx.billCategory.updateMany({ where: { parentId: row.id }, data: { archived: false } });
    }
    return updated;
  });
}

/**
 * 删分类：有账单在用就只归档，没人用才真删；一级分类连子分类一起处理。
 * 返回 { archived, deleted }，与旧接口一致（前端据此提示）。
 */
export async function deleteCategory(userId: number, id: number) {
  const row = await categoryRow(userId, id);
  if (!row) throw new BillError("分类不存在", 404);
  const group = await categoryWithChildren(row);
  const ids = group.map((item) => item.id);

  if (await categoryInUse(userId, ids)) {
    await prisma.billCategory.updateMany({ where: { id: { in: ids } }, data: { archived: true } });
    return { archived: true, deleted: false };
  }
  await prisma.$transaction(async (tx) => {
    await tx.billCategoryAlias.deleteMany({ where: { ownerId: userId, categoryId: { in: ids } } });
    await tx.billCategory.deleteMany({ where: { id: { in: ids } } });
  });
  return { archived: false, deleted: true };
}

/** 一键清理已归档：没人用的（含子分类）才真删 */
export async function pruneCategories(userId: number) {
  const rows = await prisma.billCategory.findMany({
    where: { ownerId: userId, archived: true },
    select: { id: true },
  });
  let deleted = 0;
  let kept = 0;
  const gone = new Set<number>();
  for (const row of rows) {
    if (gone.has(row.id)) continue; // 已随上级分类一起删掉了
    const children = await prisma.billCategory.findMany({
      where: { parentId: row.id },
      select: { id: true },
    });
    const ids = [row.id, ...children.map((c) => c.id)];
    if (await categoryInUse(userId, ids)) {
      kept += 1;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.billCategoryAlias.deleteMany({ where: { ownerId: userId, categoryId: { in: ids } } });
      await tx.billCategory.deleteMany({ where: { id: { in: ids } } });
    });
    ids.forEach((item) => gone.add(item));
    deleted += ids.length;
  }
  return { ok: true, deleted, kept };
}

/**
 * 合并同名重复分类：账单、子分类、自动分类规则一并归到保留的那条，重复的删掉。
 * 保留「未归档里 id 最小的」，全归档了就保留第一条。
 */
export async function mergeDuplicateCategories(userId: number) {
  const rows = await prisma.billCategory.findMany({
    where: { ownerId: userId },
    orderBy: { id: "asc" },
  });
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.kind}\u0000${row.name}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  let merged = 0;
  let moved = 0;
  await prisma.$transaction(async (tx) => {
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const keep = list.find((item) => !item.archived) ?? list[0];
      for (const dup of list) {
        if (dup.id === keep.id) continue;
        const info = await tx.billTransaction.updateMany({
          where: { ownerId: userId, categoryId: dup.id },
          data: { categoryId: keep.id },
        });
        moved += info.count;
        await tx.billCategory.updateMany({
          where: { parentId: dup.id },
          data: { parentId: keep.parentId },
        });
        await tx.billCategoryRule.updateMany({
          where: { ownerId: userId, categoryId: dup.id },
          data: { categoryId: keep.id },
        });
        await tx.billCategoryAlias.deleteMany({ where: { ownerId: userId, categoryId: dup.id } });
        await tx.billCategory.delete({ where: { id: dup.id } });
        merged += 1;
      }
    }
  });
  return { merged, moved };
}

/** 用户注册时预置整套分类树 */
export async function seedCategoryTree(userId: number) {
  for (const kind of ["EXPENSE", "INCOME"] as BillCategoryKind[]) {
    const tree = CATEGORY_TREE[kind];
    for (let i = 0; i < tree.length; i += 1) {
      const [name, children] = tree[i];
      const parent = await prisma.billCategory.create({
        data: { ownerId: userId, name, parentId: null, kind, sort: i },
      });
      for (let j = 0; j < children.length; j += 1) {
        await prisma.billCategory.create({
          data: { ownerId: userId, name: children[j], parentId: parent.id, kind, sort: j },
        });
      }
    }
  }
}
