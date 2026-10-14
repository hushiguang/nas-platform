/**
 * 招商银行 PDF 乱码修正：账单里被错误解码的片段 → 正确文本。
 *
 * 招行 PDF 用了一套非标准的中文编码，解析出来会出现「倿仕广」这类错字。
 * 修正表按用户存库、可在页面维护 —— 代码里不写死任何姓名。
 * 移植自 cash-platform/server/src/cmb-fixes.js。
 */
import { prisma } from "@/lib/prisma";
import type { BillCmbTextFix } from "@prisma/client";
import { BillError } from "./errors";

export async function listCmbTextFixes(userId: number) {
  return prisma.billCmbTextFix.findMany({
    where: { ownerId: userId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, garbled: true, correct: true, enabled: true, position: true },
  });
}

/** 解析 CMB PDF 时按当前用户取「启用中」的映射，按 position 顺序执行 */
export async function getCmbGarbleFixes(userId: number) {
  return prisma.billCmbTextFix.findMany({
    where: { ownerId: userId, enabled: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { garbled: true, correct: true },
  });
}

export function presentCmbFix(row: BillCmbTextFix) {
  return {
    id: row.id,
    garbled: row.garbled,
    correct: row.correct,
    enabled: row.enabled,
    position: row.position,
  };
}

export async function createCmbTextFix(userId: number, body: Record<string, unknown>) {
  const garbled = String(body.garbled ?? "").trim();
  const correct = String(body.correct ?? "").trim();
  if (!garbled) throw new BillError("乱码片段不能为空");
  return prisma.billCmbTextFix.create({
    data: {
      ownerId: userId,
      garbled,
      correct,
      enabled: body.enabled === false ? false : true,
      position: Number(body.position) || 0,
    },
  });
}

export async function updateCmbTextFix(
  userId: number,
  id: number,
  body: Record<string, unknown>,
) {
  const existing = await prisma.billCmbTextFix.findFirst({
    where: { id: Number(id), ownerId: userId },
  });
  if (!existing) throw new BillError("规则不存在", 404);
  return prisma.billCmbTextFix.update({
    where: { id: existing.id },
    data: {
      garbled: body.garbled != null ? String(body.garbled).trim() : existing.garbled,
      correct: body.correct != null ? String(body.correct).trim() : existing.correct,
      enabled: body.enabled != null ? !!body.enabled : existing.enabled,
      position: body.position != null ? Number(body.position) || 0 : existing.position,
    },
  });
}

export async function deleteCmbTextFix(userId: number, id: number) {
  await prisma.billCmbTextFix.deleteMany({ where: { id: Number(id), ownerId: userId } });
  return { ok: true };
}
