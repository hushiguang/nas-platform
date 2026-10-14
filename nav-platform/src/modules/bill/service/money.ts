/**
 * 金额工具。
 *
 * 全模块金额一律用「整数分」（Int），禁止浮点 —— 与 prisma/schema.prisma 里
 * bill_transaction.amountCents 的约定一致。
 *
 * 移植自 cash-platform/server/src/money.js，逻辑保持原样，只补类型。
 */

/** 取 "12.34(红包)" 这类文本里括号中的标记；不是金额尾巴就返回空串 */
export function amountMark(input: unknown): string {
  const s = String(input ?? "").trim();
  const matched = s.match(/[(（]([^)）]+)[)）]\s*$/);
  if (!matched || !/\d/.test(s.slice(0, matched.index))) return "";
  return matched[1].trim();
}

/**
 * 各种来源的金额文本 → 整数分。
 *
 * 支持 ¥ / ￥ / 千分位 / 「元」后缀、括号负数、正负号；第三位小数四舍五入。
 * 解析不出来返回 null，由调用方决定是跳过还是落 0。
 */
export function yuanToCents(input: unknown): number | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s || s === "-" || s === "—") return null;
  const mark = amountMark(s);
  if (mark) s = s.slice(0, s.lastIndexOf(mark)).replace(/[(（]\s*$/, "").trim();
  s = s.replace(/[¥￥,\s]/g, "").replace(/元$/, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const digits = (frac + "000").slice(0, 3);
  let cents = Number(whole) * 100 + Number(digits.slice(0, 2));
  if (digits[2] >= "5") cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return neg ? -cents : cents;
}

/** 整数分 → "12.34"（始终两位小数，负号在前） */
export function centsToYuan(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const v = Math.abs(Number(cents) || 0);
  return `${sign}${Math.floor(v / 100)}.${String(v % 100).padStart(2, "0")}`;
}
