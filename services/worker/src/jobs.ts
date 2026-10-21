// 定时任务注册表：worker（常驻 cron）与各应用的 /api/internal/job/[name]（手动补跑）共用。
//
// 每个任务必须幂等 —— 可重复执行而不产生副作用（待办靠唯一键，通知靠 dedupeKey，
// 定期账单靠 externalId）。worker 重启、补跑、重复触发都不该产生重复数据。
//
// 边界：worker 只做**与业务应用无关**的事（待办扫描、提醒派发、通知重试）。
// 业务应用自己的定时任务（比如账单的定期入账）由各应用自己实现，
// worker 通过内部接口触发 —— 这样账单应用可以独立升级，worker 不用跟着改。
import { callInternal, internalAppBaseUrl, zonedDate, zonedTime } from "@nas/core";
import { prisma } from "@nas/db";
import {
  digestTimes,
  DIGEST_SETTING_KEYS,
  flushNotifyLogs,
  saveSettings,
  storedSettings,
  wecomWebhook,
} from "@nas/notify";
import { dispatchTodoReminders, purgeAutoTodoReminders, scanOverdueTodos } from "@nas/todo";

/**
 * 报告前置：把要进报告的待办收全（纪念日临近、账单跟进、工作台风险预报 /
 * 待修问题），再把到期未完成的待办标成逾期。数字算准了再发。
 * 任何一个应用没起来都不影响报告，只是少那部分数据。
 */
async function prepareDigestData(): Promise<void> {
  const steps: Array<[string, string]> = [
    ["anniversary", "generate-todos"],
    ["bill", "generate-todos"],
    ["work", "sync-todos"],
  ];
  await Promise.all(
    steps.map(async ([code, job]) => {
      const ok = await triggerAppJob(code, job);
      if (!ok) console.log(`[job] digest 前置 ${code}:${job} 未响应，本轮跳过`);
    }),
  );
  await scanOverdueTodos();
}

/**
 * 每日汇报：邮件按人发（各自的待办和项目）；企业微信群机器人发到群里，一条就够 ——
 * 所以配了 webhook 时只有第一个人真正发企微，其余人只发邮件，避免同一份报告
 * 在群里刷屏 N 次。没配 webhook 时才退回应用消息，按人各发一条。
 *
 * 什么时候发由「通知渠道」页的时点配置决定，见 digestTick。
 */
async function pushSummary() {
  const day = zonedDate(new Date());
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    orderBy: { id: "asc" },
    select: { id: true, username: true },
  });
  if (users.length === 0) {
    console.log("[job] digest 没有启用中的用户");
    return;
  }

  await prepareDigestData();

  const group = Boolean(await wecomWebhook());
  const { sendDigest } = await import("@nas/notify");
  let ok = 0;
  let skipped = 0;
  // 群机器人只发一次：第一个真正发出去的人把坑占掉
  let wecomDone = false;

  for (const user of users) {
    try {
      const result = await sendDigest(user.id, { skipWecom: group && wecomDone });
      if (result.WECOM) wecomDone = true;
      if (Object.keys(result).length === 0) {
        skipped += 1;
        // 空结果 = 这个人一个可用渠道都没有（企微/邮件都没启用），
        // 不单独记一笔的话，日志里只看到 sent 数字，根本不知道谁被跳过了
        console.log(`[job] digest ${user.username} 跳过：没有启用的通知渠道`);
      } else {
        ok += 1;
      }
    } catch (err) {
      console.error(`[job] digest ${user.username} 失败:`, err);
    }
  }
  console.log(`[job] digest ${day} sent=${ok}/${users.length} skipped=${skipped}`);
}

/**
 * 每日汇总的定时入口：每分钟核对一次「现在是不是配置里的发送时点」。
 *
 * 时点在门户「通知渠道」页配置（setting: notify.digest.times，逗号分隔的 HH:mm），
 * 改完 15 秒内生效，不用重启 worker —— 这是把原来写死的 cron 改成每分钟核对的原因。
 * 发过的时点写到 setting（notify.digest.lastRun），worker 重启不会把同一分钟再发一遍。
 */
async function digestTick(): Promise<void> {
  const times = await digestTimes();
  const now = new Date();
  const hm = zonedTime(now).slice(0, 5);
  if (!times.includes(hm)) return;

  const stamp = `${zonedDate(now)} ${hm}`;
  const stored = await storedSettings();
  if (stored[DIGEST_SETTING_KEYS.lastRun] === stamp) return;

  // 先占坑再发：一轮报告要发几十秒，避免下一分钟的另一条时点撞进来重复发
  await saveSettings({ [DIGEST_SETTING_KEYS.lastRun]: stamp });
  try {
    await pushSummary();
  } catch (err) {
    // 发挂了把标记放掉，下一分钟还能重试一次，别把当天这个时点整个丢掉
    await saveSettings({ [DIGEST_SETTING_KEYS.lastRun]: "" });
    throw err;
  }
}

/**
 * 触发某个业务应用自己的定时任务。
 * 应用没配置地址、或该应用容器没起来时返回 false —— 一个应用掉线不能拖垮整轮调度。
 */
async function triggerAppJob(code: string, job: string): Promise<boolean> {
  const base = internalAppBaseUrl(code as never);
  if (!base) return false;
  const result = await callInternal<{ ok?: boolean }>(`${base}/api/internal/job/${job}`, {
    method: "POST",
    // 定期入账要遍历所有规则并写流水，给足时间
    timeoutMs: 120_000,
  });
  return result !== null;
}

export const JOBS: Record<string, () => Promise<void>> = {
  // 每日汇报的实际推送（digest-tick 到点调用；也可以手动补跑一次）。
  // 报告本身走 notifyLog（失败会进 notify-retry 退避重发）。
  digest: pushSummary,

  // 每日汇报的调度：每分钟看一眼是不是配置里的发送时点（时点在「通知渠道」页配）。
  "digest-tick": digestTick,

  // 用户自己记的待办提醒：按 remindRules 的时点提醒（高频跑，保证时点准确）。
  // 不跑它，待办应用里勾的「提前 3 天 09:00 提醒」就不会发。
  // 同一个人这一轮到点的提醒会合成一条消息，不会一条待办一个推送。
  // 工作台 / 纪念日 / 账单自动收的待办不在这里单推，它们只在每日汇总里出现。
  "dispatch-reminders": async () => {
    const purged = await purgeAutoTodoReminders();
    if (purged) console.log(`[job] dispatch-reminders purged ${purged} 条自动待办提醒`);
    const sent = await dispatchTodoReminders();
    if (sent) console.log(`[job] dispatch-reminders queued ${sent}`);
  },
  // 通知重试：补发失败退避到点的消息
  "notify-retry": async () => {
    const res = await flushNotifyLogs(200);
    if (res.sent || res.failed) console.log(`[job] notify-retry sent=${res.sent} failed=${res.failed}`);
  },

  // 定期账单入账。真正的逻辑在账单应用里（runDueRules），这里只负责按点叫醒它。
  // 幂等靠 (ownerId, source, externalId) 唯一键（externalId = r{规则id}:{日期}），
  // 所以可以放心高频跑。这是真业务数据，不能跟报告一起砍掉。
  "bill-recurring": async () => {
    const ok = await triggerAppJob("bill", "recurring");
    if (!ok) console.log("[job] bill-recurring 账单应用未响应，本轮跳过");
  },
};

export type JobName = keyof typeof JOBS;

export async function runJob(name: string): Promise<boolean> {
  const job = JOBS[name];
  if (!job) return false;
  await job();
  return true;
}
