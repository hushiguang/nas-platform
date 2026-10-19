import { prisma } from "@nas/db";

export interface AuditInput {
  /** 应用标识：portal / bill / anniversary / work / pregnancy / travel */
  app: string;
  /** create / update / delete / complete 等 */
  action: string;
  /** 给人看的一句话，比如「修改账单「盒马」」 */
  summary: string;
  target?: string;
  targetId?: string | number | null;
  actorId?: number | null;
  actorName?: string | null;
}

/**
 * 记一条操作日志。写失败只打到控制台，不打断正在进行的保存。
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  const summary = input.summary.trim().slice(0, 240);
  if (!summary) return;
  try {
    await prisma.auditLog.create({
      data: {
        app: input.app,
        action: input.action,
        target: input.target ?? "",
        targetId: input.targetId == null || input.targetId === "" ? null : String(input.targetId),
        summary,
        actorId: input.actorId ?? null,
        actorName: input.actorName?.trim() || null,
      },
    });
  } catch (err) {
    console.error("[audit]", err);
  }
}
