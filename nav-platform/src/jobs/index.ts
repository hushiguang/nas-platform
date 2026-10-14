// 定时任务注册表：worker（常驻 cron）与 /api/cron/[job]（手动触发/补跑）共用。
// 每个任务必须幂等——可重复执行而不产生副作用（待办生成靠唯一键，通知靠 dedupeKey）。
import { prisma } from "@/lib/prisma";
import { zonedDate, zonedDayRange } from "@/lib/time";
import { scanOverdueTodos, dispatchTodoReminders } from "@/modules/core/todo";
import { flushNotifyLogs, sendNotify } from "@/modules/core/notify";
import { runDueRules } from "@/modules/bill";

/** 占位任务：对应平台逻辑落地后替换（P2 起） */
async function stub(name: string) {
  console.log(`[job] ${name} ran at ${new Date().toISOString()}（占位，逻辑待实现）`);
}

/** 每日待办汇总：给每个启用用户推今日待办与逾期数 */
async function pushSummary() {
  const now = new Date();
  const day = zonedDate(now);
  const { start, end } = zonedDayRange(now);
  const users = await prisma.user.findMany({ where: { status: "ACTIVE" } });

  let queued = 0;
  for (const user of users) {
    const [overdue, todayDue, pending] = await Promise.all([
      prisma.todo.count({ where: { ownerId: user.id, status: "OVERDUE" } }),
      prisma.todo.count({
        where: {
          ownerId: user.id,
          status: { in: ["PENDING", "IN_PROGRESS"] },
          dueTime: { gte: start, lte: end },
        },
      }),
      prisma.todo.count({ where: { ownerId: user.id, status: "PENDING" } }),
    ]);
    if (overdue + todayDue + pending === 0) continue;

    const result = await sendNotify({
      userId: user.id,
      title: `【每日待办】${day}`,
      content: `逾期 ${overdue} 条 / 今日到期 ${todayDue} 条 / 待处理 ${pending} 条`,
      dedupeKey: `summary:${day}:${user.id}`,
    });
    queued += result.queued;
  }
  console.log(`[job] push-summary queued ${queued} for ${day}`);
}

export const JOBS: Record<string, () => Promise<void>> = {
  "refresh-countdown": () => stub("refresh-countdown"), // 每日 00:05 倒计时/孕周/节点重算
  "generate-todos": () => stub("generate-todos"), // 每日 00:10 各平台事件 → 待办
  // 逾期扫描：到期未完成的置 OVERDUE
  "scan-overdue": async () => {
    const res = await scanOverdueTodos();
    console.log(`[job] scan-overdue marked ${res.count}`);
  },
  // 提醒派发：按 remindRules 投递（高频跑，保证提醒时点准确）
  "dispatch-reminders": async () => {
    const sent = await dispatchTodoReminders();
    if (sent) console.log(`[job] dispatch-reminders queued ${sent}`);
  },
  // 通知重试：补发失败退避到点的消息
  "notify-retry": async () => {
    const res = await flushNotifyLogs(200);
    if (res.sent || res.failed) console.log(`[job] notify-retry sent=${res.sent} failed=${res.failed}`);
  },
  "work-digest": () => stub("work-digest"), // 工作早会/晚报（时点可配）
  "pregnancy-daily": () => stub("pregnancy-daily"), // 孕期今日任务
  "travel-onthisday": () => stub("travel-onthisday"), // 每日 08:00 往年今日
  "push-summary": pushSummary,
  // 定期账单入账：把到期的定期规则补成真实流水。
  // 幂等靠 (ownerId, source, externalId) 唯一键（externalId = r{规则id}:{日期}），
  // 跑多少次都只会入一遍，所以可以放心高频跑。
  "bill-recurring": async () => {
    const res = await runDueRules();
    if (res.created) console.log(`[job] bill-recurring 到期 ${res.rules} 条，入账 ${res.created} 笔`);
  },
};

export type JobName = keyof typeof JOBS;

export async function runJob(name: string): Promise<boolean> {
  const job = JOBS[name];
  if (!job) return false;
  await job();
  return true;
}
