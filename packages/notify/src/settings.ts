/**
 * 通知渠道的全局参数（企业微信应用三件套）。
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

/** 应用消息与群机器人二选一，webhook 优先（它没有 IP 白名单的坑） */
export async function wecomWebhook(bypassCache = false): Promise<string> {
  let stored: Record<string, string> = {};
  if (bypassCache || !cache || cache.expiresAt <= Date.now()) {
    stored = await storedSettings();
    cache = { value: stored, expiresAt: Date.now() + CACHE_TTL_MS };
  } else {
    stored = cache.value;
  }
  return trim(stored[WECOM_SETTING_KEYS.webhook]) || trim(process.env.WECOM_WEBHOOK);
}

const CACHE_TTL_MS = 15_000;
let cache: { value: Record<string, string>; expiresAt: number } | null = null;

/** 库里已保存的设置（没有就空对象）。不读环境变量，给界面展示用 */
export async function storedSettings(): Promise<Record<string, string>> {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: Object.values(WECOM_SETTING_KEYS) } },
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
  let stored: Record<string, string> = {};
  if (bypassCache || !cache || cache.expiresAt <= Date.now()) {
    stored = await storedSettings();
    cache = { value: stored, expiresAt: Date.now() + CACHE_TTL_MS };
  } else {
    stored = cache.value;
  }

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
