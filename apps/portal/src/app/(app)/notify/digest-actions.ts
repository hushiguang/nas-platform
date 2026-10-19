"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { sendDigest } from "@nas/notify";

const CHANNEL_NAME: Record<string, string> = { MAIL: "邮件", WECOM: "企业微信" };

/** 试发送每日汇总（仅管理员），给指定用户发邮件/企微。结果带回页面展示 */
export async function testSendDigest(formData: FormData): Promise<void> {
  const me = await requireUser();
  if (me.role !== "ADMIN") throw new Error("仅管理员可试发送");
  const targetId = Number(formData.get("userId") ?? me.id);
  const channel = String(formData.get("channel") ?? "ALL");
  const channels = channel === "MAIL" ? ["MAIL"] : channel === "WECOM" ? ["WECOM"] : undefined;

  let summary: string;
  try {
    const result = await sendDigest(Number.isFinite(targetId) ? targetId : me.id, {
      channels: channels as never,
    });
    const lines = Object.entries(result);
    summary = lines.length
      ? lines.map(([k, v]) => `${CHANNEL_NAME[k] ?? k}：${v}`).join("；")
      : "该用户没有启用任何通知渠道，请先到「通知渠道 → 接收人」开启";
  } catch (err) {
    summary = `发送异常：${err instanceof Error ? err.message : String(err)}`;
  }

  revalidatePath("/notify");
  redirect(`/notify?notice=${encodeURIComponent(summary)}`);
}