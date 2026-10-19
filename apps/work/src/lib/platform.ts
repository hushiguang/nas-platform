/**
 * 项目名开头【xxx】里的平台标识。历史数据写法不一，
 * 这里把常见的几种归一成 5iDHL / OSSP / Wecom，其余原样返回。
 */
export function platformOf(name: string | null | undefined): string {
  const match = String(name ?? "").match(/^\s*[【\[]\s*([^】\]]+?)\s*[】\]]/);
  const raw = (match?.[1] ?? "").trim();
  if (!raw) return "未分组";
  const lower = raw.toLowerCase();
  if (lower.includes("5idhl")) return "5iDHL";
  if (lower.includes("ossp")) return "OSSP";
  if (lower.includes("wecom") || lower.includes("wechat") || lower.includes("企业微信")) return "Wecom";
  return raw;
}
