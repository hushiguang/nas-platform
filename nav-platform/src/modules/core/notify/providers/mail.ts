import nodemailer from "nodemailer";

/**
 * 邮件渠道（SMTP）。
 * 依赖环境变量：SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM（可选，默认 SMTP_USER）
 */

interface SmtpEnv {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

function smtpEnv(): SmtpEnv {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error("邮件未配置：缺少 SMTP_HOST / SMTP_USER / SMTP_PASS");
  }
  const port = Number(process.env.SMTP_PORT ?? 465);
  return {
    host,
    port,
    // 465 走隐式 TLS；587 等走 STARTTLS
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    user,
    pass,
    from: process.env.MAIL_FROM ?? user,
  };
}

export interface MailPayload {
  to: string;
  subject: string;
  text: string;
}

export async function sendMail({ to, subject, text }: MailPayload): Promise<void> {
  const env = smtpEnv();
  const transporter = nodemailer.createTransport({
    host: env.host,
    port: env.port,
    secure: env.secure,
    auth: { user: env.user, pass: env.pass },
    // 飞牛/内网场景常见自签证书，仅对 SMTP 连接放宽校验
    tls: { rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== "false" },
  });
  await transporter.sendMail({
    from: env.from,
    to,
    subject,
    text,
  });
}

export function mailConfigured(): boolean {
  try {
    smtpEnv();
    return true;
  } catch {
    return false;
  }
}
