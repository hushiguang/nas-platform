import type { CityStatus } from "@nas/db";

export const CITY_STATUS: { value: CityStatus; label: string; icon: string }[] = [
  { value: "VISITED", label: "已去过", icon: "✔" },
  { value: "WISHLIST", label: "想去", icon: "☆" },
];

export function cityStatusLabel(status: CityStatus): string {
  return CITY_STATUS.find((s) => s.value === status)?.label ?? "想去";
}

const GRADIENTS = [
  "linear-gradient(135deg, #ff9a9e, #fad0c4)",
  "linear-gradient(135deg, #a1c4fd, #c2e9fb)",
  "linear-gradient(135deg, #f6d365, #fda085)",
  "linear-gradient(135deg, #84fab0, #8fd3f4)",
  "linear-gradient(135deg, #d4fc79, #96e6a1)",
  "linear-gradient(135deg, #cd9cf2, #f6f3ff)",
];

/** 没有封面照片时的占位渐变，靠 id 稳定取一张 */
export function fallbackGradient(seed: number): string {
  return GRADIENTS[Math.abs(seed) % GRADIENTS.length];
}

export function dateRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${Number(m)}月${Number(d)}日`;
  };
  if (start === end) return fmt(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return sameYear ? `${fmt(start)} - ${fmt(end)}` : `${start} - ${end}`;
}
