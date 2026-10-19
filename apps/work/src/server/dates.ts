import { zonedDate } from "@nas/core";
import type { NodeStatus } from "@nas/db";

/** @db.Date 按 UTC 零点存日历日，比较和回写都走这一天，不跟本地时区换算。 */
export function utcDay(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function isoDay(value: Date | null | undefined): string {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

export function parseDay(raw: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

export function todayIso(): string {
  return zonedDate(new Date());
}

export function dayLabel(iso: string): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  const thisYear = Number(todayIso().slice(0, 4));
  if (year === thisYear) return `${month}月${day}日`;
  return `${year}年${month}月${day}日`;
}

export function rangeLabel(start: string, end: string): string {
  if (start && end) return `${dayLabel(start)} 至 ${dayLabel(end)}`;
  if (start) return `${dayLabel(start)} 起`;
  if (end) return `${dayLabel(end)} 前`;
  return "日期未定";
}

export function whenText(days: number, status: NodeStatus): string {
  if (status === "DONE") return "已完成";
  if (days < 0) return `逾期 ${-days} 天`;
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  return `${days} 天后`;
}
