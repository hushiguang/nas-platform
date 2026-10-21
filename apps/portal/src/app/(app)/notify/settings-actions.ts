"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { recordAudit } from "@nas/core";
import {
  DIGEST_SETTING_KEYS,
  digestTimes,
  invalidateSettingsCache,
  isQqMail,
  MAIL_SETTING_KEYS,
  parseDigestTimes,
  QQ_MAIL_HOST,
  QQ_MAIL_PORT,
  saveSettings,
  sendTestMail,
  testMailConnection,
  testWecomConnection,
  testWecomWebhook,
  WECOM_SETTING_KEYS,
} from "@nas/notify";
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 保存邮件（SMTP）配置。QQ 邮箱只需邮箱账号 + 授权码，服务器留空时
 * 保存后由 mailConfig 自动套 smtp.qq.com:465。全部留空 = 清空、回退环境变量。
 */
async function persistMailSettings(formData: FormData) {
  const admin = await requireAdmin();

  const user = str(formData, "mailUser");
  const pass = str(formData, "mailPass");
  const rawFrom = str(formData, "mailFrom");
  const rawHost = str(formData, "mailHost");
  const rawPort = str(formData, "mailPort");
  const rawSecure = str(formData, "mailSecure");

  if (!user && !pass && !rawFrom && !rawHost && !rawPort) {
    await saveSettings({
      [MAIL_SETTING_KEYS.user]: "",
      [MAIL_SETTING_KEYS.pass]: "",
      [MAIL_SETTING_KEYS.from]: "",
      [MAIL_SETTING_KEYS.host]: "",
      [MAIL_SETTING_KEYS.port]: "",
      [MAIL_SETTING_KEYS.secure]: "",
    });
    invalidateSettingsCache();
    await recordAudit({
      app: "portal",
      action: "update",
      summary: "清空邮件配置（改回环境变量）",
      target: "notify",
      actorId: admin.id,
      actorName: admin.nickname,
    });
    return { testTo: "", cleared: true };
  }

  if (!user || !EMAIL_RE.test(user)) {
    redirect(`${BACK}?error=${encodeURIComponent("请填写正确的发信邮箱，例如 yourname@qq.com")}`);
  }
  if (!pass) {
    redirect(`${BACK}?error=${encodeURIComponent("请填写邮箱授权码（QQ 邮箱在「设置 → 账号 → SMTP 服务」生成，不是 QQ 密码）")}`);
  }
  if (rawFrom && !EMAIL_RE.test(rawFrom.replace(/^.*<|>.*$/g, "").trim())) {
    redirect(`${BACK}?error=${encodeURIComponent("发件人格式不对，留空即可（默认与发信邮箱一致）")}`);
  }
  if (rawPort && !/^\d+$/.test(rawPort)) {
    redirect(`${BACK}?error=${encodeURIComponent("端口只能是数字")}`);
  }
  if (rawPort && (Number(rawPort) < 1 || Number(rawPort) > 65535)) {
    redirect(`${BACK}?error=${encodeURIComponent("端口超出范围（1-65535）")}`);
  }

  const qq = isQqMail(user);
  await saveSettings({
    [MAIL_SETTING_KEYS.user]: user,
    [MAIL_SETTING_KEYS.pass]: pass,
    // QQ 只能用自己的账号发信，不留自定义 from，避免 501
    [MAIL_SETTING_KEYS.from]: qq ? "" : rawFrom,
    [MAIL_SETTING_KEYS.host]: rawHost || (qq ? QQ_MAIL_HOST : ""),
    [MAIL_SETTING_KEYS.port]: rawPort || (qq ? String(QQ_MAIL_PORT) : ""),
    [MAIL_SETTING_KEYS.secure]: rawSecure === "false" ? "false" : "true",
  });
  invalidateSettingsCache();

  await recordAudit({
    app: "portal",
    action: "update",
    summary: `保存邮件配置（${user}）`,
    target: "notify",
    actorId: admin.id,
    actorName: admin.nickname,
  });
  return { testTo: str(formData, "mailTestTo"), cleared: false };
}

/** 保存邮件配置并做一次 SMTP 登录校验（不发信） */
export async function saveMailSettings(formData: FormData) {
  const saved = await persistMailSettings(formData);
  if (saved.cleared) redirect(`${BACK}?ok=${encodeURIComponent("已清空邮件配置，改用环境变量")}`);
  const result = await testMailConnection();
  redirect(`${BACK}?${result.ok ? "ok" : "error"}=${encodeURIComponent(result.message)}`);
}

/** 保存邮件配置并往指定地址发一封测试邮件 */
export async function saveAndTestMail(formData: FormData) {
  const saved = await persistMailSettings(formData);
  if (saved.cleared) redirect(`${BACK}?ok=${encodeURIComponent("已清空邮件配置，改用环境变量")}`);
  const result = await sendTestMail(saved.testTo);
  redirect(`${BACK}?${result.ok ? "ok" : "error"}=${encodeURIComponent(result.message)}`);
}

/** 只测试当前已保存的邮件配置（不发信），改环境变量后也能用 */
export async function testMailSettings() {
  await requireAdmin();
  invalidateSettingsCache();
  const result = await testMailConnection();
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

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * 保存每日汇总的发送时点（HH:mm 列表）。
 * 写成 setting 后 worker 的每分钟 tick 会在 15 秒内读到，不用重启容器。
 */
export async function saveDigestTimes(formData: FormData) {
  const admin = await requireAdmin();

  const items = formData
    .getAll("digestTime")
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  const bad = items.filter((item) => !HM_RE.test(item));
  if (bad.length > 0) {
    redirect(`${BACK}?error=${encodeURIComponent(`时间格式不对：${bad.join("、")}，请用 24 小时制 HH:mm`)}`);
  }
  // 重复的时点只留一份，按时间排好
  const times = parseDigestTimes(items.join(","));
  if (times.length === 0) {
    redirect(`${BACK}?error=${encodeURIComponent("至少保留一个发送时间，例如 08:10")}`);
  }

  await saveSettings({ [DIGEST_SETTING_KEYS.times]: times.join(",") });
  invalidateSettingsCache();
  await recordAudit({
    app: "portal",
    action: "update",
    summary: `保存每日汇总发送时间：${times.join(" / ")}`,
    target: "notify",
    actorId: admin.id,
    actorName: admin.nickname,
  });
  redirect(`${BACK}?ok=${encodeURIComponent(`每日汇总发送时间已改为 ${times.join("、")}，worker 15 秒内生效`)}`);
}

/** 把时点恢复成默认的 08:10 / 16:00（删掉页面配置，回退默认值） */
export async function resetDigestTimes() {
  const admin = await requireAdmin();
  await saveSettings({ [DIGEST_SETTING_KEYS.times]: "" });
  invalidateSettingsCache();
  await recordAudit({
    app: "portal",
    action: "update",
    summary: "重置每日汇总发送时间（恢复默认）",
    target: "notify",
    actorId: admin.id,
    actorName: admin.nickname,
  });
  const times = await digestTimes(true);
  redirect(`${BACK}?ok=${encodeURIComponent(`已恢复默认发送时间：${times.join("、")}`)}`);
}
