import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { isQqMail, mailConfig, QQ_MAIL_HOST, QQ_MAIL_PORT } from "../settings";

/**
 * 邮件渠道（SMTP）。
 *
 * QQ 邮箱用「邮箱账号 + 授权码」：
 *   邮箱设置 → 账号 → 开启 SMTP 服务 → 生成授权码，授权码当密码填。
 *   服务器 smtp.qq.com:465（SSL），发信地址必须与登录账号一致。
 * 配置来源：门户「通知渠道」页保存到 setting 表 > 环境变量
 *   SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / MAIL_FROM
 * 只填 SMTP_USER / SMTP_PASS 且账号是 @qq.com 时，host/port 自动用 QQ 预设。
 */

export interface MailPayload {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

async function createTransport(): Promise<Transporter> {
  const cfg = await mailConfig();
  if (!cfg.ok) {
    const missing = [
      !cfg.host ? "SMTP 服务器" : "",
      !cfg.user ? "发信邮箱" : "",
      !cfg.pass ? "授权码/密码" : "",
    ].filter(Boolean);
    throw new Error(
      `邮件未配置：缺少${missing.join("、")}，请在门户「通知渠道」页填写，或配置 SMTP_HOST / SMTP_USER / SMTP_PASS`,
    );
  }
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    // QQ 邮箱偶发连接慢，给一个上限，避免整轮通知卡住
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
    // 飞牛/内网场景常见自签证书，仅对 SMTP 连接放宽校验
    tls: { rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== "false" },
  });
}

export async function sendMail({ to, subject, text, html, attachments }: MailPayload): Promise<void> {
  const cfg = await mailConfig();
  const transporter = await createTransport();
  try {
    await transporter.sendMail({
      from: cfg.from,
      to,
      subject,
      text: text ?? html?.replace(/<[^>]+>/g, " ").slice(0, 4000),
      html,
      attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
  } catch (err) {
    throw new Error(formatMailError(err, cfg.user));
  } finally {
    transporter.close();
  }
}

/** 把 QQ 邮箱最常见的报错翻译成能照着做的提示 */
function formatMailError(err: unknown, user: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/535|Login Fail|authentication failed|Invalid login/i.test(raw)) {
    return isQqMail(user)
      ? `QQ 邮箱认证失败：请确认「授权码」而不是 QQ 密码，并已在邮箱设置里开启 SMTP 服务（${raw}）`
      : `SMTP 认证失败，请检查账号与密码/授权码（${raw}）`;
  }
  if (/501|mail from address must be same|sender/i.test(raw)) {
    return `发件地址与登录账号不一致，QQ 邮箱要求两者相同（${raw}）`;
  }
  return raw;
}

export async function mailConfigured(): Promise<boolean> {
  return (await mailConfig(true)).ok;
}

/**
 * 连通性测试：只做 SMTP 握手 + 登录，不发邮件。
 * QQ 报 535 通常是授权码填错或没开 SMTP 服务。
 */
export async function testMailConnection(): Promise<{ ok: boolean; message: string }> {
  const cfg = await mailConfig(true);
  if (!cfg.ok) {
    return {
      ok: false,
      message: `邮件未配置：请填写发信邮箱和授权码${
        cfg.qq ? `（QQ 邮箱预设 ${QQ_MAIL_HOST}:${QQ_MAIL_PORT}）` : ""
      }`,
    };
  }
  const transporter = await createTransport();
  try {
    await transporter.verify();
    return { ok: true, message: `连接正常：${cfg.host}:${cfg.port}（${cfg.user}）` };
  } catch (err) {
    return { ok: false, message: formatMailError(err, cfg.user) };
  } finally {
    transporter.close();
  }
}

/** 发一封测试邮件，确认「能连上」之外整条投递链路也通 */
export async function sendTestMail(to?: string): Promise<{ ok: boolean; message: string }> {
  const cfg = await mailConfig(true);
  if (!cfg.ok) return { ok: false, message: "邮件未配置：请填写发信邮箱和授权码" };
  const target = (to ?? "").trim() || cfg.user;
  try {
    const transporter = await createTransport();
    await transporter.sendMail({
      from: cfg.from,
      to: target,
      subject: "【NAS 平台】邮件测试",
      text: `这是一封测试邮件。\n\n发信账号：${cfg.user}\n服务器：${cfg.host}:${cfg.port}\n时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}\n\n能收到这封信，说明 QQ 邮箱授权码配置正确。`,
    });
    transporter.close();
    return { ok: true, message: `测试邮件已发往 ${target}，请查收（也看一下垃圾箱）` };
  } catch (err) {
    return { ok: false, message: formatMailError(err, cfg.user) };
  }
}
