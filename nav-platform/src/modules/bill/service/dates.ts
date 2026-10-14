/**
 * 日期工具与定期规则推进。
 *
 * ⚠ 这里的 Date 一律按「运行进程的本地时区」解释（容器统一 TZ=Asia/Shanghai），
 *   与 cash-platform 原实现一致。它与 @/lib/time 里那套基于 Intl 的显式时区工具
 *   语义不同，两者不要混用：账单侧要的是「用户在本地看到的那一天」。
 *
 * 移植自 cash-platform/server/src/dates.js，逻辑保持原样，只补类型。
 */

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function parseISODate(value: string): Date {
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: Date, days: number): Date {
  const n = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  n.setDate(n.getDate() + days);
  return n;
}

/** 构造日期，日号越界时夹到当月最后一天（如 2 月 31 日 → 2 月 28/29 日） */
export function clampDate(year: number, monthIndex: number, day: number): Date {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(Math.max(1, day), last));
}

export function todayString(): string {
  return formatDate(new Date());
}

/**
 * 五花八门的日期写法 → 'YYYY-MM-DD HH:MM:SS'。
 * 支持 Excel 序列号（如 45123.5）、'2026/1/2'、'1-2-2026'，解析不出来返回 null。
 */
export function parseDateTime(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateTime(value);
  }
  const s = String(value ?? "").trim().replace(/\//g, "-");
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const ms = Date.UTC(1899, 11, 30) + Number(s) * 86400000;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
      d.getUTCHours(),
    )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))} ${pad(Number(m[4] || 0))}:${pad(
      Number(m[5] || 0),
    )}:${pad(Number(m[6] || 0))}`;
  }
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (m) {
    return `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))} ${pad(Number(m[4] || 0))}:${pad(
      Number(m[5] || 0),
    )}:${pad(Number(m[6] || 0))}`;
  }
  return null;
}

/** 前端传来的日期串（可能带 T）归一成 'YYYY-MM-DD HH:MM:SS' */
export function normalizeClientDate(value: unknown): string | null {
  if (!value) return null;
  return parseDateTime(String(value).trim().replace("T", " "));
}

/** 周几，1=周一 … 7=周日（ISO 口径） */
function weekday(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

/** 定期规则的形状（与 bill_recurring_rule 表对应） */
export interface RecurringRuleLike {
  frequency: string;
  startDate: string;
  /** 存库时是 '1,3,5' 这样的字符串，也接受已解析好的数组 */
  weekdays?: number[] | string | null;
  intervalDays?: number | null;
  monthDay?: number | null;
  yearMonth?: number | null;
  yearDay?: number | null;
}

/** weekdays 兼容字符串与数组两种形态 */
function weekdaySet(value: RecurringRuleLike["weekdays"]): Set<number> {
  if (Array.isArray(value)) return new Set(value.length ? value : [1]);
  if (typeof value === "string" && value.trim()) {
    const list = value
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 7);
    if (list.length) return new Set(list);
  }
  return new Set([1]);
}

/** 规则在 startDate 之后的第一次发生日（'YYYY-MM-DD'） */
export function firstOccurrence(rule: RecurringRuleLike): string {
  const start = rule.startDate;
  if (rule.frequency === "weekly") {
    const d = parseISODate(start);
    const set = weekdaySet(rule.weekdays);
    for (let i = 0; i < 7; i += 1) {
      const n = addDays(d, i);
      if (set.has(weekday(n))) return formatDate(n);
    }
  }
  if (rule.frequency === "monthly") {
    const d = parseISODate(start);
    let occ = formatDate(clampDate(d.getFullYear(), d.getMonth(), rule.monthDay || 1));
    if (occ < start) {
      occ = formatDate(clampDate(d.getFullYear(), d.getMonth() + 1, rule.monthDay || 1));
    }
    return occ;
  }
  if (rule.frequency === "yearly") {
    const d = parseISODate(start);
    const month = (rule.yearMonth || 1) - 1;
    const day = rule.yearDay || 1;
    let occ = formatDate(clampDate(d.getFullYear(), month, day));
    if (occ < start) occ = formatDate(clampDate(d.getFullYear() + 1, month, day));
    return occ;
  }
  return start;
}

/** 从 date 推进到下一次发生日 */
export function advance(rule: RecurringRuleLike, date: string): string | null {
  const d = parseISODate(date);
  if (rule.frequency === "daily") return formatDate(addDays(d, 1));
  if (rule.frequency === "interval") {
    return formatDate(addDays(d, Math.max(1, Number(rule.intervalDays) || 1)));
  }
  if (rule.frequency === "weekly") {
    const set = weekdaySet(rule.weekdays);
    for (let i = 1; i <= 7; i += 1) {
      const n = addDays(d, i);
      if (set.has(weekday(n))) return formatDate(n);
    }
  }
  if (rule.frequency === "monthly") {
    return formatDate(clampDate(d.getFullYear(), d.getMonth() + 1, rule.monthDay || d.getDate()));
  }
  if (rule.frequency === "yearly") {
    return formatDate(
      clampDate(
        d.getFullYear() + 1,
        (rule.yearMonth || d.getMonth() + 1) - 1,
        rule.yearDay || d.getDate(),
      ),
    );
  }
  return null;
}

/** 某年某月的首末日（month 为 1-12） */
export function monthBounds(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${pad(month)}-01`;
  const last = new Date(year, month, 0).getDate();
  const end = `${year}-${pad(month)}-${pad(last)}`;
  return { start, end };
}

// ---------------------------------------------------------------- 落库日期转换
//
// ⚠ 两类列的语义不一样，混用就会整体差一天：
//   · `@db.Date` 列（bill_recurring_rule.startDate / endDate）
//       Prisma 只取 UTC 的年月日 —— 存 '2026-05-09' 必须传 UTC 午夜。
//       传 +08:00 的午夜会落到前一天 16:00Z，被截成 2026-05-08。
//   · timestamp 列（nextRun）
//       按项目约定存「UTC 墙钟」，即本地日期 00:00 对应的 UTC 时刻（前一天 16:00Z）。

/** `@db.Date` 列 → 'YYYY-MM-DD' */
export function dateColumnToISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 写进 `@db.Date` 列的值 */
export function isoToDateColumn(s: string): Date {
  return new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`);
}

/** timestamp 列里的「UTC 墙钟日期」→ 'YYYY-MM-DD'（加回 8 小时才是本地那一天） */
export function wallClockToISO(d: Date): string {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 写进 timestamp 列的 UTC 墙钟值 */
export function isoToWallClock(s: string): Date {
  return new Date(`${String(s).slice(0, 10)}T00:00:00+08:00`);
}
