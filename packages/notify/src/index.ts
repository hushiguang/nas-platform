import { prisma } from "@nas/db";
import type { NotifyChannelType } from "@nas/db";
import { Prisma } from "@nas/db";
import { sendWecomAppMessage } from "./providers/wecom";
import { sendMail } from "./providers/mail";
import { sendWecomWebhook } from "./providers/webhook";
import { wecomWebhook } from "./settings";

export const NOTIFY_CHANNEL_LABEL: Record<NotifyChannelType, string> = {
  WECOM: "企业微信应用消息",
  WX: "微信（预留）",
  MAIL: "邮件",
};

/** 失败重试：最多 3 次，退避 1min → 5min → 25min */
const MAX_RETRY = 3;
const BACKOFF_MS = [60_000, 5 * 60_000, 25 * 60_000];

export interface SendNotifyInput {
  userId: number;
  todoId?: number | null;
  title: string;
  content: string;
  /** 幂等键（不含渠道，内部会拼渠道）。同一提醒重复触发只会入队一次 */
  dedupeKey?: string;
  /** 限定渠道；不传则按用户已启用渠道发送 */
  channels?: NotifyChannelType[];
}

/** 从 NotifyChannel.config 里取字符串字段 */
function cfgString(config: Prisma.JsonValue | null, key: string): string | undefined {
  if (!config || typeof config !== "object" || Array.isArray(config)) return undefined;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
}

/**
 * 入队：为该用户每个可用渠道建一条 NotifyLog，返回新建记录的 id。
 * dedupeKey 唯一约束保证幂等——重复调用（如定时任务重复扫描）不会重复发。
 */
export async function enqueueNotify(input: SendNotifyInput): Promise<number[]> {
  const channels = await prisma.notifyChannel.findMany({
    where: {
      userId: input.userId,
      enabled: true,
      ...(input.channels?.length ? { type: { in: input.channels } } : {}),
    },
  });
  const queued: number[] = [];
  for (const channel of channels) {
    const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${channel.type}` : null;
    try {
      const log = await prisma.notifyLog.create({
        data: {
          userId: input.userId,
          todoId: input.todoId ?? null,
          channel: channel.type,
          title: input.title,
          content: input.content,
          dedupeKey,
        },
      });
      queued.push(log.id);
    } catch (err) {
      // 唯一键冲突＝已经入队/发过，忽略；其余错误交给上层
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
    }
  }
  return queued;
}

async function dispatch(logId: number): Promise<boolean> {
  const log = await prisma.notifyLog.findUnique({ where: { id: logId } });
  if (!log || log.status === "SENT") return true;
  // FAILED 是终态：重试超过上限或渠道已删的记录不再自动重发。
  // 否则「已判死」的记录会被每 10 分钟的 notify-retry 一直捞起重试，
  // 旧日报会在任意整十分突然补发出去。
  if (log.status === "FAILED") return false;

  try {
    const [user, channel] = await Promise.all([
      prisma.user.findUnique({ where: { id: log.userId } }),
      prisma.notifyChannel.findFirst({ where: { userId: log.userId, type: log.channel } }),
    ]);
    if (!user || !channel) throw new Error("渠道已删除或用户不存在");

    if (log.channel === "WECOM") {
      // 有群机器人 webhook 就用它：不走应用消息，也就没有 IP 白名单、可信域名的事
      const hook = await wecomWebhook();
      if (hook) {
        // 汇总类消息自己带 `## 标题`，重发时不要再叠一层加粗标题
        const body = log.content.trimStart().startsWith("#")
          ? log.content
          : `**${log.title}**\n${log.content}`;
        await sendWecomWebhook(hook, body);
        await prisma.notifyLog.update({
          where: { id: log.id },
          data: { status: "SENT", sentAt: new Date(), lastError: null },
        });
        return true;
      }
      const toUser = cfgString(channel.config, "toUser") ?? user.wecomId;
      if (!toUser) throw new Error("未配置企微 userid（用户 wecomId 为空）");
      await sendWecomAppMessage({ toUser, title: log.title, content: log.content });
    } else if (log.channel === "MAIL") {
      const to = cfgString(channel.config, "to") ?? user.email;
      if (!to) throw new Error("未配置收件邮箱（用户 email 为空）");
      await sendMail({ to, subject: log.title, text: log.content });
    } else {
      throw new Error("微信渠道暂未实现");
    }

    await prisma.notifyLog.update({
      where: { id: log.id },
      data: { status: "SENT", sentAt: new Date(), lastError: null },
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryCount = log.retryCount + 1;
    // 超过上限置 FAILED 终态（nextRetryAt 留空）：flush 只扫 PENDING，不会再被捞起重试
    const dead = retryCount > MAX_RETRY;
    await prisma.notifyLog.update({
      where: { id: log.id },
      data: {
        status: dead ? "FAILED" : "PENDING",
        retryCount,
        lastError: message,
        nextRetryAt: dead
          ? null
          : new Date(Date.now() + BACKOFF_MS[Math.min(retryCount - 1, BACKOFF_MS.length - 1)]),
      },
    });
    console.error(`[notify] #${log.id} 发送失败（第 ${retryCount} 次）: ${message}`);
    return false;
  }
}

/**
 * 发送所有到期待发记录：只发 PENDING 且已到重试时间的。
 * FAILED 是终态（重试超过 3 次 / 渠道已删），留在「发送记录」里供排查，不再自动重发 ——
 * 否则失败记录会被每 10 分钟的 notify-retry 无限捞起，旧消息可能在任意时间点补发。
 * 定时任务（每 10 分钟）与入队后的立即发送共用。
 */
export async function flushNotifyLogs(
  limit = 100,
  userId?: number,
): Promise<{ sent: number; failed: number }> {
  const due = await prisma.notifyLog.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
      ...(userId ? { userId } : {}),
    },
    orderBy: { id: "asc" },
    take: limit,
  });
  let sent = 0;
  let failed = 0;
  for (const log of due) {
    if (await dispatch(log.id)) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

/** 按 id 立即发送（入队后同步发用，避免连带刷出别的积压记录） */
export async function dispatchLogs(ids: number[]): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    if (await dispatch(id)) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

/** 入队并立即尝试发送（同步调用方等待结果） */
export async function sendNotify(input: SendNotifyInput) {
  const ids = await enqueueNotify(input);
  return { queued: ids.length, ...(await dispatchLogs(ids)) };
}

/** 待办完成/取消后撤销未发出的提醒 */
export async function cancelTodoNotify(todoId: number) {
  return prisma.notifyLog.deleteMany({ where: { todoId, status: "PENDING" } });
}

export { wecomConfigured, testWecomConnection } from "./providers/wecom";
export { mailConfigured, testMailConnection, sendTestMail } from "./providers/mail";
export { sendWecomWebhook, testWecomWebhook, webhookKey } from "./providers/webhook";
export {
  WECOM_SETTING_KEYS,
  MAIL_SETTING_KEYS,
  DIGEST_SETTING_KEYS,
  QQ_MAIL_HOST,
  QQ_MAIL_PORT,
  DEFAULT_DIGEST_TIMES,
  isQqMail,
  parseDigestTimes,
  digestTimes,
  storedSettings,
  saveSettings,
  invalidateSettingsCache,
  wecomConfig,
  wecomWebhook,
  mailConfig,
} from "./settings";
export { collectDigest, buildDigestExcel, sendDigest } from "./digest";
