"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@nas/core";
import { prisma } from "@nas/db";
import { requireAppAccess } from "@/auth";
import { AnniversaryError, removeAnniversary, saveAnniversary } from "@/server";

export interface ActionResult {
  message: string;
}

export async function saveAnniversaryAction(formData: FormData): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  let id: number;
  try {
    id = await saveAnniversary(user, access, formData);
  } catch (err) {
    if (err instanceof AnniversaryError) return { message: err.message };
    console.error(err);
    return { message: "保存失败" };
  }
  const name = String(formData.get("name") || "").trim();
  await recordAudit({
    app: "anniversary",
    action: "save",
    target: "anniversary",
    targetId: id,
    summary: `保存纪念日${name ? `「${name}」` : ""}`,
    actorId: user.id,
    actorName: user.nickname,
  });
  revalidatePath("/");
  revalidatePath(`/a/${id}`);
  redirect("/");
}

export async function removeAnniversaryAction(id: number): Promise<void> {
  const { user, access } = await requireAppAccess();
  const existing = await prisma.anniversary.findUnique({ where: { id }, select: { name: true } });
  try {
    await removeAnniversary(access, user.id, id);
  } catch (err) {
    if (err instanceof AnniversaryError) return;
    throw err;
  }
  await recordAudit({
    app: "anniversary",
    action: "delete",
    target: "anniversary",
    targetId: id,
    summary: `删除纪念日${existing?.name ? `「${existing.name}」` : ""}`,
    actorId: user.id,
    actorName: user.nickname,
  });
  revalidatePath("/");
  redirect("/");
}
