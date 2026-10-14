// 独立定时任务进程（方案 A：与 web 同仓库、共用任务代码，node-cron 常驻）。
// Next.js 是请求驱动模型，跑不了常驻 cron，必须独立进程。
import cron from "node-cron";
import { JOBS } from "../src/jobs";

const TZ = process.env.TZ ?? "Asia/Shanghai";

// 任务名 → cron 表达式（与 docs/技术方案.md 第五章任务清单一致）
const SCHEDULE: Record<string, string> = {
  "refresh-countdown": "5 0 * * *",    // 每日 00:05
  "generate-todos": "10 0 * * *",      // 每日 00:10
  "scan-overdue": "0 * * * *",         // 每小时
  "dispatch-reminders": "*/10 * * * *", // 每 10 分钟
  "notify-retry": "*/10 * * * *",      // 每 10 分钟
  "work-digest": "30 8,18 * * *",      // 早 08:30 / 晚 18:30（可配）
  "pregnancy-daily": "0 8 * * *",      // 每日 08:00
  "travel-onthisday": "0 8 * * *",     // 每日 08:00
  "push-summary": "0 9 * * *",         // 每日 09:00
  "bill-recurring": "*/30 * * * *",    // 每 30 分钟（幂等，按规则到期日入账）
};

for (const [name, expression] of Object.entries(SCHEDULE)) {
  const job = JOBS[name];
  if (!job) continue;
  cron.schedule(
    expression,
    async () => {
      try {
        await job();
      } catch (err) {
        console.error(`[worker] ${name} failed:`, err);
      }
    },
    { timezone: TZ },
  );
  console.log(`[worker] scheduled ${name}: ${expression} (${TZ})`);
}

console.log("[worker] started");
