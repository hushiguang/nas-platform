"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { recordAudit } from "@nas/core";
import { invalidateSettingsCache, saveSettings, testWecomConnection, testWecomWebhook, WECOM_SETTING_KEYS } from "@nas/notify";
import { requireUser } from "@/auth";

const BACK = "/notify/channels";

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("仅管理员可执行该操作");
  return user;
}

/**
 * 保存企业微信应用三件套。
 * 三项全空等于「清空配置回到环境变量」；只填一部分不给保存，
 * 否则后台会以为什么都发不出去。
 */
export async function saveWecomAppSettings(formData: FormData) {
  const admin = await requireAdmin();

  const parsed = z
    .object({
      corpId: z.string().trim().max(64),
      corpSecret: z.string().trim().max(128),
      agentId: z.string().trim().regex(/^\d+$/, "AgentId 只能是数字").or(z.literal("")),
    })
    .safeParse({
      corpId: str(formData, "wecomCorpId"),
      corpSecret: str(formData, "wecomCorpSecret"),
      agentId: str(formData, "wecomAgentId"),
    });
  if (!parsed.success) redirect(`${BACK}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "参数错误")}`);

  const { corpId, corpSecret, agentId } = parsed.data;
  if ([corpId, corpSecret, agentId].filter(Boolean).length > 0 && !(corpId && corpSecret && agentId)) {
    redirect(`${BACK}?error=${encodeURIComponent("企业ID、应用Secret、AgentId 要么三项都填，要么都留空")}`);
  }

  // 空串会删掉对应 key，之后自动回退环境变量
  await saveSettings({
    [WECOM_SETTING_KEYS.corpId]: corpId,
    [WECOM_SETTING_KEYS.corpSecret]: corpSecret,
    [WECOM_SETTING_KEYS.agentId]: agentId,
  });
  invalidateSettingsCache();

  await recordAudit({
    app: "portal",
    action: "update",
    summary: corpId ? "保存企业微信应用配置" : "清空企业微信应用配置（改回环境变量）",
    target: "notify",
    actorId: admin.id,
    actorName: admin.nickname,
  });
  redirect(`${BACK}?ok=${encodeURIComponent(corpId ? "企业微信配置已保存" : "已清空，改用环境变量")}`);
}

/** 只换 access_token 验证三件套是否正确，不真发消息 */
export async function testWecomSettings() {
  const admin = await requireAdmin();
  invalidateSettingsCache();
  const result = await testWecomConnection();
  await recordAudit({
    app: "portal",
    action: "test",
    summary: `测试企业微信连接：${result.ok ? "成功" : "失败"}`,
    target: "notify",
    actorId: admin.id,
    actorName: admin.nickname,
  });
  redirect(`${BACK}?${result.ok ? "ok" : "error"}=${encodeURIComponent(result.message)}`);
}

/** 保存群机器人 webhook 地址并立即真发一条测试消息到群（你能在群里看到） */
export async function saveWecomWebhook(formData: FormData) {
  const admin = await requireAdmin();
  const url = str(formData, "wecomWebhook");
  await saveSettings({ [WECOM_SETTING_KEYS.webhook]: url });
  invalidateSettingsCache();

  const result = url ? await testWecomWebhook(url) : { ok: true, message: "已清空，企微通道改回应用消息" };
  await recordAudit({
    app: "portal",
    action: "update",
    summary: `保存群机器人 webhook：${result.ok ? "成功" : "失败"}`,
    target: "notify",
    actorId: admin.id,
    actorName: admin.nickname,
  });
  redirect(`${BACK}?${result.ok ? "ok" : "error"}=${encodeURIComponent(result.message)}`);
}
