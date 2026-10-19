export const PRI_DOT: Record<string, string> = {
  URGENT: "var(--coral)",
  HIGH: "#e8930c",
  MEDIUM: "var(--violet)",
  LOW: "#9aa0a6",
};

/** 卡片顶部优先级色带，一眼区分 */
export const PRI_TOP: Record<string, string> = {
  URGENT: "linear-gradient(90deg, #e5484d, #f76b6b)",
  HIGH: "linear-gradient(90deg, #e8930c, #f5b942)",
  MEDIUM: "linear-gradient(90deg, #7c6cf0, #a79dff)",
  LOW: "linear-gradient(90deg, #9aa0a6, #c4c9ce)",
};

export const PRI_ORDER = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;
