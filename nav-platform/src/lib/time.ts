// 全站统一时区（web / worker / postgres 三处保持一致，见 docs）
export const APP_TZ = process.env.TZ || "Asia/Shanghai";

// en-CA 的日期格式就是 YYYY-MM-DD
const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 时间在该时区下的日期，格式 YYYY-MM-DD */
export function zonedDate(date: Date): string {
  return dateFmt.format(date);
}

/** 时间在该时区下的时刻，格式 HH:MM（24 小时制） */
export function zonedTime(date: Date): string {
  return timeFmt.format(date);
}

/** 日期加减天数（按 UTC 毫秒算，@db.Date 存的是 UTC 零点，等价按天位移） */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** "09:00" → 分钟数，非法返回 null */
export function parseHm(hm?: string): number | null {
  if (!hm) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 1440 ? minutes : null;
}

/** 当前时刻在该时区下的分钟数，用于与提醒时点比较 */
export function zonedMinutes(date: Date): number {
  const [h, m] = zonedTime(date).split(":");
  return Number(h) * 60 + Number(m);
}

/** 两个 ISO 日期（YYYY-MM-DD）之间相差的天数：负表示已过去 */
export function dayDiff(day: string, today: string = zonedDate(new Date())): number {
  return Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

/** 该时区下某个 UTC 时刻的偏移量（毫秒），用于构造当天起止时刻 */
function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (
    Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) -
    date.getTime()
  );
}

/** 该时区下「当天」的起止 UTC 时刻：[start, end] */
export function zonedDayRange(date: Date): { start: Date; end: Date } {
  const day = zonedDate(date);
  const offset = tzOffsetMs(new Date(`${day}T12:00:00Z`), APP_TZ);
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - offset);
  return { start, end: new Date(start.getTime() + 86_400_000 - 1) };
}