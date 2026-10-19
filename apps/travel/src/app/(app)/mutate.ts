"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@nas/core";
import { prisma } from "@nas/db";
import { requireAppAccess } from "@/auth";
import { removeCity, removeTrip, saveCity, saveTrip, TravelError } from "@/server";

export interface ActionResult {
  message: string;
}

export async function saveTripAction(formData: FormData): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  let id: number;
  try {
    id = await saveTrip(user, access, formData);
  } catch (err) {
    if (err instanceof TravelError) return { message: err.message };
    console.error(err);
    return { message: "保存失败" };
  }
  const title = String(formData.get("title") || "").trim();
  await recordAudit({
    app: "travel",
    action: "save",
    target: "trip",
    targetId: id,
    summary: `保存行程${title ? `「${title}」` : ""}`,
    actorId: user.id,
    actorName: user.nickname,
  });
  revalidatePath("/");
  revalidatePath("/trips");
  revalidatePath("/map");
  revalidatePath(`/trips/${id}`);
  redirect(`/trips/${id}`);
}

export async function removeTripAction(id: number): Promise<void> {
  const { user, access } = await requireAppAccess();
  const existing = await prisma.travelTrip.findUnique({ where: { id }, select: { title: true } });
  try {
    await removeTrip(access, user.id, id);
  } catch (err) {
    if (err instanceof TravelError) return;
    throw err;
  }
  await recordAudit({
    app: "travel",
    action: "delete",
    target: "trip",
    targetId: id,
    summary: `删除行程${existing?.title ? `「${existing.title}」` : ""}`,
    actorId: user.id,
    actorName: user.nickname,
  });
  revalidatePath("/");
  revalidatePath("/trips");
  revalidatePath("/map");
  redirect("/trips");
}

export async function saveCityAction(formData: FormData): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  try {
    await saveCity(user, access, formData);
  } catch (err) {
    if (err instanceof TravelError) return { message: err.message };
    console.error(err);
    return { message: "保存失败" };
  }
  const name = String(formData.get("name") || "").trim();
  await recordAudit({
    app: "travel",
    action: "save",
    target: "city",
    targetId: name,
    summary: `保存城市${name ? `「${name}」` : ""}`,
    actorId: user.id,
    actorName: user.nickname,
  });
  revalidatePath("/");
  revalidatePath("/cities");
  revalidatePath("/map");
}

export async function removeCityAction(id: number): Promise<void> {
  const { user, access } = await requireAppAccess();
  try {
    await removeCity(access, user.id, id);
  } catch (err) {
    if (err instanceof TravelError) return;
    throw err;
  }
  await recordAudit({
    app: "travel",
    action: "delete",
    target: "city",
    targetId: id,
    summary: "删除城市",
    actorId: user.id,
    actorName: user.nickname,
  });
  revalidatePath("/");
  revalidatePath("/cities");
  revalidatePath("/map");
}
