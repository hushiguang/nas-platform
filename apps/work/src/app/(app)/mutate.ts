"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit, type SessionUser } from "@nas/core";
import { requireAppAccess } from "@/auth";
import {
  removeIssue,
  removeMember,
  removeNode,
  removePhaseItemMember,
  removePhaseMember,
  removeProject,
  saveIssue,
  saveMember,
  saveNode,
  savePhase,
  addPhaseRework,
  removePhaseRework,
  savePhaseItemMember,
  savePhaseItems,
  savePhaseMembers,
  saveProject,
  setActualProgress,
  setCurrentPhase,
  setIssueStatus,
  setNodeStatus,
  updatePhaseMember,
  WorkError,
} from "@/server";

export interface ActionResult {
  message: string;
}

function refresh(projectId?: number) {
  revalidatePath("/");
  revalidatePath("/digest");
  revalidatePath("/people");
  if (projectId && projectId > 0) {
    revalidatePath(`/p/${projectId}`);
    revalidatePath(`/p/${projectId}/edit`);
  }
}

async function audit(user: SessionUser, action: string, target: string, targetId: number, summary: string) {
  await recordAudit({
    app: "work",
    action,
    target,
    targetId,
    summary,
    actorId: user.id,
    actorName: user.nickname,
  });
}

function fail(err: unknown, fallback: string): ActionResult {
  if (err instanceof WorkError) return { message: err.message };
  console.error(err);
  return { message: fallback };
}

export async function saveProjectAction(formData: FormData): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  let saved: { id: number; summary: string };
  try {
    saved = await saveProject(user, access, formData);
  } catch (err) {
    return fail(err, "保存失败");
  }
  await audit(user, "save", "work_project", saved.id, saved.summary);
  refresh(saved.id);
  redirect(`/p/${saved.id}`);
}

export async function removeProjectAction(id: number): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  let summary: string;
  try {
    summary = await removeProject(access, user.id, id);
  } catch (err) {
    return fail(err, "删除失败");
  }
  await audit(user, "delete", "work_project", id, summary);
  refresh(id);
  redirect("/");
}

export async function saveNodeAction(formData: FormData): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  const projectId = Number(formData.get("projectId"));
  try {
    const summary = await saveNode(access, user.id, formData);
    await audit(user, "save", "work_node", projectId, summary);
  } catch (err) {
    return fail(err, "保存失败");
  }
  refresh(projectId);
}

export async function setNodeStatusAction(
  projectId: number,
  nodeId: number,
  status: string,
): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  try {
    const summary = await setNodeStatus(access, user.id, projectId, nodeId, status);
    await audit(user, "update", "work_node", nodeId, summary);
  } catch (err) {
    return fail(err, "没改成");
  }
  refresh(projectId);
}

export async function removeNodeAction(projectId: number, nodeId: number): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  try {
    const summary = await removeNode(access, user.id, projectId, nodeId);
    await audit(user, "delete", "work_node", nodeId, summary);
  } catch (err) {
    return fail(err, "删除失败");
  }
  refresh(projectId);
}

export async function saveIssueAction(formData: FormData): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  const projectId = Number(formData.get("projectId"));
  try {
    const summary = await saveIssue(access, user.id, formData);
    await audit(user, "save", "work_issue", projectId, summary);
  } catch (err) {
    return fail(err, "保存失败");
  }
  refresh(projectId);
}

export async function setIssueStatusAction(
  projectId: number,
  issueId: number,
  status: string,
): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  try {
    const summary = await setIssueStatus(access, user.id, projectId, issueId, status);
    await audit(user, "update", "work_issue", issueId, summary);
  } catch (err) {
    return fail(err, "没改成");
  }
  refresh(projectId);
}

export async function removeIssueAction(projectId: number, issueId: number): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  try {
    const summary = await removeIssue(access, user.id, projectId, issueId);
    await audit(user, "delete", "work_issue", issueId, summary);
  } catch (err) {
    return fail(err, "删除失败");
  }
  refresh(projectId);
}

export async function saveMemberAction(formData: FormData): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  const projectId = Number(formData.get("projectId"));
  try {
    const summary = await saveMember(access, user.id, formData);
    await audit(user, "save", "work_member", projectId, summary);
  } catch (err) {
    return fail(err, "保存失败");
  }
  refresh(projectId);
}

export async function removeMemberAction(projectId: number, memberId: number): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  try {
    const summary = await removeMember(access, user.id, projectId, memberId);
    await audit(user, "delete", "work_member", memberId, summary);
  } catch (err) {
    return fail(err, "移出失败");
  }
  refresh(projectId);
}

export async function setProgressAction(projectId: number, progress: number): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  try {
    const summary = await setActualProgress(access, user.id, projectId, progress);
    await audit(user, "update", "work_project", projectId, summary);
  } catch (err) {
    return fail(err, "没改成");
  }
  refresh(projectId);
}

export async function setCurrentPhaseAction(projectId: number, phase: string): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  try {
    const summary = await setCurrentPhase(access, user.id, projectId, phase);
    await audit(user, "update", "work_project", projectId, summary);
  } catch (err) {
    return fail(err, "没切成");
  }
  refresh(projectId);
}

export async function savePhaseAction(formData: FormData): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  const projectId = Number(formData.get("projectId"));
  try {
    const summary = await savePhase(access, user.id, formData);
    await audit(user, "update", "work_phase", projectId, summary);
  } catch (err) {
    return fail(err, "保存失败");
  }
  refresh(projectId);
}

export async function savePhaseMembersAction(formData: FormData): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  const projectId = Number(formData.get("projectId"));
  try {
    const summary = await savePhaseMembers(access, user.id, formData);
    await audit(user, "save", "work_phase_member", projectId, summary);
  } catch (err) {
    return fail(err, "保存失败");
  }
  refresh(projectId);
}

export async function addPhaseReworkAction(formData: FormData): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  const projectId = Number(formData.get("projectId"));
  try {
    const summary = await addPhaseRework(access, user.id, formData);
    await audit(user, "create", "work_phase_item", projectId, summary);
  } catch (err) {
    return fail(err, "添加失败");
  }
  refresh(projectId);
}

export async function removePhaseReworkAction(projectId: number, itemId: number): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  try {
    const removed = await removePhaseRework(access, user.id, itemId);
    await audit(user, "delete", "work_phase_item", itemId, removed.summary);
  } catch (err) {
    return fail(err, "删除失败");
  }
  refresh(projectId);
}

export async function savePhaseItemsAction(formData: FormData): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  const projectId = Number(formData.get("projectId"));
  try {
    const summary = await savePhaseItems(access, user.id, formData);
    await audit(user, "update", "work_phase_item", projectId, summary);
  } catch (err) {
    return fail(err, "保存失败");
  }
  refresh(projectId);
}

export async function updatePhaseMemberAction(formData: FormData): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  const projectId = Number(formData.get("projectId"));
  try {
    const summary = await updatePhaseMember(access, user.id, formData);
    await audit(user, "update", "work_phase_member", projectId, summary);
  } catch (err) {
    return fail(err, "保存失败");
  }
  refresh(projectId);
}

export async function savePhaseItemMemberAction(formData: FormData): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  const projectId = Number(formData.get("projectId"));
  try {
    const summary = await savePhaseItemMember(access, user.id, formData);
    await audit(user, "save", "work_phase_item_member", projectId, summary);
  } catch (err) {
    return fail(err, "保存失败");
  }
  refresh(projectId);
}

export async function removePhaseItemMemberAction(projectId: number, memberId: number): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  try {
    const removed = await removePhaseItemMember(access, user.id, memberId);
    await audit(user, "delete", "work_phase_item_member", memberId, removed.summary);
  } catch (err) {
    return fail(err, "移出失败");
  }
  refresh(projectId);
}

export async function removePhaseMemberAction(projectId: number, memberId: number): Promise<ActionResult | void> {
  const { user, access } = await requireAppAccess();
  try {
    const removed = await removePhaseMember(access, user.id, memberId);
    await audit(user, "delete", "work_phase_member", memberId, removed.summary);
  } catch (err) {
    return fail(err, "移出失败");
  }
  refresh(projectId);
}
