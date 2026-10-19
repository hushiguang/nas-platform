import { dayDiff, zonedDate } from "@nas/core";
import type { AnniversaryType } from "@nas/db";
import { Lunar, Solar } from "lunar-javascript";

/** 门户汇总和纪念日首页用同一个窗口，避免两处各算各的 */
export const UPCOMING_DAYS = 30;

export interface AnniversaryDate {
  date: Date;
  calendar: "SOLAR" | "LUNAR";
  lunarLeap: boolean;
  lunarMonth: number | null;
  lunarDay: number | null;
  /** 结婚、求婚、纪念日用来算已过天数；生日只看下一次 */
  type?: AnniversaryType;
}

export interface Occurrence {
  /** 下一次对应的公历日。农历在某些年份排不开时为 null */
  date: string | null;
  days: number | null;
  /** 到下一次为止的周年。生日就是岁数。还没到第一年时为 0 */
  years: number | null;
  countdown: string;
  /** 结婚、求婚、纪念日：从起始日到今天。生日不填 */
  elapsedDays: number | null;
  elapsedText: string | null;
  /** 「下个周期还有 N 天」。生日不填 */
  cycleText: string | null;
  /** 「下次 10月27日」 */
  when: string;
  /** 原始日期的可读形式 */
  origin: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function dateParts(date: Date): { y: number; m: number; d: number } {
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 2 月 29 日遇到平年，落到 2 月 28 日 */
function solarYmd(year: number, month: number, day: number): string {
  if (month === 2 && day === 29 && !isLeapYear(year)) return ymd(year, 2, 28);
  return ymd(year, month, day);
}

export function lunarToSolar(
  lunarYear: number,
  month: number,
  day: number,
  leap: boolean,
): string | null {
  try {
    const lunar = Lunar.fromYmd(lunarYear, leap ? -Math.abs(month) : Math.abs(month), day);
    const solar = lunar.getSolar();
    return ymd(solar.getYear(), solar.getMonth(), solar.getDay());
  } catch {
    return null;
  }
}

function lunarOrigin(year: number, month: number, day: number, leap: boolean): string {
  try {
    const text = Lunar.fromYmd(year, leap ? -Math.abs(month) : Math.abs(month), day).toString();
    return `农历${text}`;
  } catch {
    return `农历 ${year}年${month}月${day}日`;
  }
}

function monthDayLabel(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

/**
 * 下一次纪念日落在哪一天。
 *
 * 公历按月日每年重复；农历先换算成当年的公历，已经过去就看下一年。
 * 闰月不是每年都有，找不到就继续往后找。
 */
function tracksCycle(type: AnniversaryType | undefined): boolean {
  return type === "MARRIAGE" || type === "PROPOSAL" || type === "OTHER" || type === "COUNTDOWN";
}

function originIso(row: AnniversaryDate, origin: { y: number; m: number; d: number }): string | null {
  if (row.calendar === "SOLAR") return ymd(origin.y, origin.m, origin.d);
  const month = row.lunarMonth ?? origin.m;
  const day = row.lunarDay ?? origin.d;
  return lunarToSolar(origin.y, month, day, row.lunarLeap);
}

export function nextOccurrence(row: AnniversaryDate, today = zonedDate(new Date())): Occurrence {
  const origin = dateParts(row.date);
  let next: string | null = null;
  let years: number | null = null;
  let originText: string;

  if (row.calendar === "SOLAR") {
    const year = Number(today.slice(0, 4));
    const thisYear = solarYmd(year, origin.m, origin.d);
    next = thisYear >= today ? thisYear : solarYmd(year + 1, origin.m, origin.d);
    years = Number(next.slice(0, 4)) - origin.y;
    originText = `${origin.y}年${origin.m}月${origin.d}日`;
  } else {
    const month = row.lunarMonth ?? origin.m;
    const day = row.lunarDay ?? origin.d;
    const [ty, tm, td] = today.split("-").map(Number);
    const lunarYear = Solar.fromYmd(ty, tm, td).getLunar().getYear();
    // 闰月不是每年都有，同一个闰月可能十几年才再出现一次，所以多看几年
    const span = row.lunarLeap ? 24 : 4;
    for (let i = 0; i < span; i += 1) {
      const candidate = lunarToSolar(lunarYear + i, month, day, row.lunarLeap);
      if (candidate && candidate >= today) {
        next = candidate;
        years = lunarYear + i - origin.y;
        break;
      }
    }
    originText = lunarOrigin(origin.y, month, day, row.lunarLeap);
  }

  if (years != null && years < 0) years = 0;
  const days = next ? dayDiff(next, today) : null;
  const countdown =
    days == null ? "这一天换算不出来" : days === 0 ? "就是今天" : days === 1 ? "明天" : `还有 ${days} 天`;

  const anchor = originIso(row, origin);
  const since = anchor ? -dayDiff(anchor, today) : null;
  const elapsedDays = tracksCycle(row.type) && since != null && since >= 0 ? since : null;
  const elapsedText = elapsedDays == null ? null : elapsedDays === 0 ? "今天刚到" : `已过 ${elapsedDays} 天`;
  const cycleText = !tracksCycle(row.type) || days == null
    ? null
    : days === 0
      ? "下个周期就是今天"
      : `下个周期还有 ${days} 天`;

  return {
    date: next,
    days,
    years,
    countdown,
    elapsedDays,
    elapsedText,
    cycleText,
    when: next ? `下次 ${monthDayLabel(next)}` : "暂无法换算",
    origin: originText,
  };
}
