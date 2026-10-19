import type { AnniversaryType } from "@nas/db";

export const TYPE_OPTIONS: { value: AnniversaryType; label: string; icon: string }[] = [
  { value: "BIRTHDAY", label: "生日", icon: "🎂" },
  { value: "MARRIAGE", label: "结婚", icon: "💍" },
  { value: "PROPOSAL", label: "求婚", icon: "💐" },
  { value: "OTHER", label: "纪念日", icon: "🎉" },
];

export const LUNAR_MONTHS = [
  "正月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "冬月",
  "腊月",
];

const DAY_NUM = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/** 1 → 初一，11 → 十一，21 → 廿一，30 → 三十 */
export function lunarDayName(day: number): string {
  if (day <= 10) return `初${DAY_NUM[day]}`;
  if (day < 20) return `十${DAY_NUM[day - 10]}`;
  if (day === 20) return "二十";
  if (day < 30) return `廿${DAY_NUM[day - 20]}`;
  return "三十";
}

export const LUNAR_DAYS = Array.from({ length: 30 }, (_, i) => i + 1);

export const REMIND_CHOICES: { days: number; label: string }[] = [
  { days: 30, label: "提前 30 天" },
  { days: 7, label: "提前 7 天" },
  { days: 3, label: "提前 3 天" },
  { days: 1, label: "提前 1 天" },
  { days: 0, label: "当天" },
];

export function typeMeta(type: AnniversaryType) {
  if (type === "COUNTDOWN") return TYPE_OPTIONS[3];
  return TYPE_OPTIONS.find((item) => item.value === type) ?? TYPE_OPTIONS[3];
}

export function yearsText(type: AnniversaryType, years: number | null): string | null {
  if (years == null || years <= 0) return null;
  return type === "BIRTHDAY" ? `${years} 岁` : `${years} 周年`;
}
