// 独立定时任务进程（node-cron 常驻）。
//
// Next.js 是请求驱动模型，跑不了常驻 cron —— 这是本方案里最容易踩的坑，
// 所以 worker 是一个单独的容器，和各应用共用同一份任务代码与 Prisma 客户端。
import cron from "node-cron";
import { JOBS } from "./jobs";

const TZ = process.env.TZ ?? "Asia/Shanghai";

// 任务名 → cron 表达式。
//
// 只留三类：每日报告（时点由「通知渠道」页配置，每分钟核对）、通知重试、
// 用户自己记的待办提醒。其余（倒计时刷新、纪念日/账单收数、逾期扫描、早晚报、
// 孕期、旅行、账单入账）要么并进了报告前置，要么已无实际作用，见 README「定时任务」一节。
const SCHEDULE: Record<string, string> = {
  "digest-tick": "* * * * *", // 每分钟核对是否到了配置的汇总发送时点
  "notify-retry": "*/10 * * * *", // 每 10 分钟补发失败通知
  "dispatch-reminders": "*/10 * * * *", // 每 10 分钟派发「自己记的待办」提醒
  "bill-recurring": "*/30 * * * *", // 每 30 分钟跑定期账单入账
};

let scheduled = 0;
for (const [name, expression] of Object.entries(SCHEDULE)) {
  const job = JOBS[name];
  if (!job) continue;
  cron.schedule(
    expression,
    async () => {
      try {
        await job();
      } catch (err) {
        // 单个任务失败不能把调度器带崩，记录后继续等下一次
        console.error(`[worker] ${name} failed:`, err);
      }
    },
    { timezone: TZ },
  );
  scheduled += 1;
  console.log(`[worker] scheduled ${name}: ${expression} (${TZ})`);
}

console.log(`[worker] started，已注册 ${scheduled} 个任务`);
