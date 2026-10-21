/**
 * 通知渠道的全局参数（企业微信应用三件套 + 邮件 SMTP）。
 *
 * 优先级：门户界面存到 setting 表的值 > 环境变量。环境变量是部署兜底，
 * 保留它是为了容器里不依赖数据库也能发（也兼容迁移前的配置）。
 *
 * 带 15 秒短缓存：worker 常驻进程，配置改完不必重启就能生效，
 * 同时避免每条消息都打一次库。控制台测试连接会显式跳过缓存。
 */
import { prisma } from "@nas/db";

export const WECOM_SETTING_KEYS = {
  corpId: "notify.wecom.corpId",
  corpSecret: "notify.wecom.corpSecret",
  agentId: "notify.wecom.agentId",
  /** 群机器人 Webhook。配了它就不需要应用三件套，也不校验出口 IP / 可信域名 */
  webhook: "notify.wecom.webhook",
} as const;

/**
 * 邮件（SMTP）配置。QQ 邮箱用「邮箱账号 + 授权码」即可，不需要开启独立密码。
 * host/port/secure 留空时按发信邮箱域名自动套 QQ 的预设（smtp.qq.com:465）。
 */
export const MAIL_SETTING_KEYS = {
  host: "notify.mail.host",
  port: "notify.mail.port",
  secure: "notify.mail.secure",
  user: "notify.mail.user",
  pass: "notify.mail.pass",
  from: "notify.mail.from",
} as const;

/**
 * 每日汇总的发送时点。页面配一份（逗号分隔的 HH:mm），worker 每分钟核对一次 ——
 * 改完不用重启 worker。lastRun 是 worker 自己写的「这个时点已经发过」的标记，
 * 防止进程重启后同一分钟再发一遍。
 */
export const DIGEST_SETTING_KEYS = {
  times: "notify.digest.times",
  lastRun: "notify.digest.lastRun",
} as const;

const SETTING_KEYS = [
  ...Object.values(WECOM_SETTING_KEYS),
  ...Object.values(MAIL_SETTING_KEYS),
  ...Object.values(DIGEST_SETTING_KEYS),
];

/** 应用消息与群机器人二选一，webhook 优先（它没有 IP 白名单的坑） */
export async function wecomWebhook(bypassCache = false): Promise<string> {
  const stored = await cachedSettings(bypassCache);
  return trim(stored[WECOM_SETTING_KEYS.webhook]) || trim(process.env.WECOM_WEBHOOK);
}

const CACHE_TTL_MS = 15_000;
let cache: { value: Record<string, string>; expiresAt: number } | null = null;

async function cachedSettings(bypassCache = false): Promise<Record<string, string>> {
  if (bypassCache || !cache || cache.expiresAt <= Date.now()) {
    cache = { value: await storedSettings(), expiresAt: Date.now() + CACHE_TTL_MS };
  }
  return cache.value;
}

/** 库里已保存的设置（没有就空对象）。不读环境变量，给界面展示用 */
export async function storedSettings(): Promise<Record<string, string>> {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: SETTING_KEYS } },
    });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch (err) {
    // 迁移还没跑时不该让整个通知链路挂掉，退回纯环境变量
    console.error("[notify] 读取 setting 表失败，改用环境变量", err);
    return {};
  }
}

/** 门户保存：空串会删掉 key，回到环境变量 */
export async function saveSettings(entries: Record<string, string>): Promise<void> {
  const ops = Object.entries(entries).map(([key, value]) =>
    prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    }),
  );
  await prisma.$transaction(ops);
  cache = null;
}

/** 测试连接、故障排查时用：忽略缓存，立刻反映最新配置 */
export function invalidateSettingsCache(): void {
  cache = null;
}

/** 没配过任何时点时的兜底：早上 8:10 和下午 4:00 各发一次汇总 */
export const DEFAULT_DIGEST_TIMES = ["08:10", "16:00"];

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 解析逗号分隔的时点串，丢非法值、去重、按时间升序 */
export function parseDigestTimes(raw: string | undefined | null): string[] {
  const list = trim(raw)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => HM_RE.test(item));
  return [...new Set(list)].sort();
}

/**
 * 每日汇总的发送时点：页面配置 > DIGEST_TIMES 环境变量 > 默认 08:10 / 16:00。
 * 走 15 秒短缓存，页面改完 worker 下一个 tick 就能拿到。
 */
export async function digestTimes(bypassCache = false): Promise<string[]> {
  const stored = await cachedSettings(bypassCache);
  const fromDb = parseDigestTimes(stored[DIGEST_SETTING_KEYS.times]);
  if (fromDb.length) return fromDb;
  const fromEnv = parseDigestTimes(process.env.DIGEST_TIMES);
  return fromEnv.length ? fromEnv : DEFAULT_DIGEST_TIMES;
}

function trim(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 企业微信应用配置：界面配的优先，缺项回退环境变量。
 * 三件套缺任何一项都是发不出去的，所以调用方要判断 ok。
 */
export interface WecomConfig {
  corpId: string;
  corpSecret: string;
  agentId: number;
  /** 哪一项来自界面（方便页面上标注「已配 / 用环境变量」） */
  fromDb: { corpId: boolean; corpSecret: boolean; agentId: boolean };
  /** 四项齐全 */
  ok: boolean;
}

export async function wecomConfig(bypassCache = false): Promise<WecomConfig> {
  const stored = await cachedSettings(bypassCache);

  const dbCorpId = trim(stored[WECOM_SETTING_KEYS.corpId]);
  const dbSecret = trim(stored[WECOM_SETTING_KEYS.corpSecret]);
  const dbAgentId = Number(trim(stored[WECOM_SETTING_KEYS.agentId]));
  const hasAgentId = Number.isFinite(dbAgentId) && dbAgentId > 0;

  const corpId = dbCorpId || trim(process.env.WECOM_CORP_ID);
  const corpSecret = dbSecret || trim(process.env.WECOM_CORP_SECRET);
  const agentId = hasAgentId
    ? dbAgentId
    : Number(trim(process.env.WECOM_AGENT_ID)) || Number.NaN;

  return {
    corpId,
    corpSecret,
    agentId,
    fromDb: { corpId: !!dbCorpId, corpSecret: !!dbSecret, agentId: hasAgentId },
    ok: !!corpId && !!corpSecret && Number.isFinite(agentId) && agentId > 0,
  };
}

/** QQ 邮箱（含 foxmail）的默认 SMTP 参数，授权码方式登录 */
export const QQ_MAIL_HOST = "smtp.qq.com";
export const QQ_MAIL_PORT = 465;
const QQ_DOMAINS = ["qq.com", "foxmail.com", "vip.qq.com"];

export function isQqMail(user: string): boolean {
  const domain = user.split("@")[1]?.toLowerCase() ?? "";
  return QQ_DOMAINS.includes(domain);
}

/**
 * 邮件（SMTP）配置：界面配的优先，缺项回退环境变量。
 *
 * QQ 邮箱只需要填「邮箱账号 + 授权码」，服务器按域名自动套预设；
 * 发件人也必须和登录账号一致（QQ 的硬性要求），所以 QQ 场景下只用账号
 * 自动拼 `from`，避免用户填错导致 501 发件人不一致。
 */
export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  /** 识别出 QQ 邮箱（自动套了 smtp.qq.com 预设） */
  qq: boolean;
  fromDb: { host: boolean; port: boolean; secure: boolean; user: boolean; pass: boolean; from: boolean };
  /** host / user / pass 齐全 */
  ok: boolean;
}

export async function mailConfig(bypassCache = false): Promise<MailConfig> {
  const stored = await cachedSettings(bypassCache);

  const dbHost = trim(stored[MAIL_SETTING_KEYS.host]);
  const dbPort = Number(trim(stored[MAIL_SETTING_KEYS.port]));
  const hasDbPort = Number.isInteger(dbPort) && dbPort > 0 && dbPort <= 65535;
  const dbSecure = trim(stored[MAIL_SETTING_KEYS.secure]);
  const dbUser = trim(stored[MAIL_SETTING_KEYS.user]);
  const dbPass = trim(stored[MAIL_SETTING_KEYS.pass]);
  const dbFrom = trim(stored[MAIL_SETTING_KEYS.from]);

  const user = dbUser || trim(process.env.SMTP_USER);
  const pass = dbPass || trim(process.env.SMTP_PASS);
  const qq = isQqMail(user);

  const host = dbHost || trim(process.env.SMTP_HOST) || (qq ? QQ_MAIL_HOST : "");
  const port = hasDbPort
    ? dbPort
    : Number(trim(process.env.SMTP_PORT)) || (qq ? QQ_MAIL_PORT : 465);
  const envSecure = trim(process.env.SMTP_SECURE).toLowerCase();
  const secure = dbSecure ? dbSecure === "true" : envSecure ? envSecure === "true" : port === 465;

  const rawFrom = dbFrom || trim(process.env.MAIL_FROM);
  // QQ 只允许用登录账号自己发信；from 里带了显示名但地址不对时也强制改成账号
  const from = qq ? (rawFrom.includes(user) ? rawFrom : user) : rawFrom || user;

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    qq,
    fromDb: {
      host: !!dbHost,
      port: hasDbPort,
      secure: !!dbSecure,
      user: !!dbUser,
      pass: !!dbPass,
      from: !!dbFrom,
    },
    ok: !!host && !!user && !!pass,
  };
}
