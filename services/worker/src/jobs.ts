// 定时任务注册表：worker（常驻 cron）与各应用的 /api/internal/job/[name]（手动补跑）共用。
//
// 每个任务必须幂等 —— 可重复执行而不产生副作用（待办靠唯一键，通知靠 dedupeKey，
// 定期账单靠 externalId）。worker 重启、补跑、重复触发都不该产生重复数据。
//
// 边界：worker 只做**与业务应用无关**的事（待办扫描、提醒派发、通知重试）。
// 业务应用自己的定时任务（比如账单的定期入账）由各应用自己实现，
// worker 通过内部接口触发 —— 这样账单应用可以独立升级，worker 不用跟着改。
import { callInternal, internalAppBaseUrl, zonedDate } from "@nas/core";
import { prisma } from "@nas/db";
import { flushNotifyLogs, wecomWebhook } from "@nas/notify";
import { dispatchTodoReminders, scanOverdueTodos } from "@nas/todo";

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
 * 每日汇报：早 09:00 / 下午 16:00 各推一次。
 *
 * 邮件按人发（各自的待办和项目）；企业微信群机器人发到群里，一条就够 ——
 * 所以配了 webhook 时只有第一个人真正发企微，其余人只发邮件，避免同一份报告
 * 在群里刷屏 N 次。没配 webhook 时才退回应用消息，按人各发一条。
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
      if (Object.keys(result).length === 0) skipped += 1;
      ok += 1;
    } catch (err) {
      console.error(`[job] digest ${user.username} 失败:`, err);
    }
  }
  console.log(`[job] digest ${day} sent=${ok}/${users.length} skipped=${skipped}`);
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
  // 每日汇报：09:00 / 16:00。先把待办收全、逾期重算，再按人推。
  // 报告本身走 notifyLog（失败会进 notify-retry 退避重发）。
  digest: pushSummary,

  // 用户自己设的待办提醒：按 remindRules 的时点投递（高频跑，保证时点准确）。
  // 不跑它，待办应用里勾的「提前 3 天 09:00 提醒」就不会发。
  "dispatch-reminders": async () => {
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
