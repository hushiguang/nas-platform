import type { IssueKind, WorkPhaseKind, WorkPriority } from "@nas/db";

export const PHASE_OPTIONS: { value: WorkPhaseKind; label: string }[] = [
  { value: "BUSINESS", label: "商务阶段" },
  { value: "DEV", label: "研发节点" },
  { value: "SIT", label: "SIT测试阶段" },
  { value: "UAT", label: "UAT阶段" },
  { value: "PRELAUNCH", label: "准备上线" },
  { value: "LIVE", label: "已上线" },
];

export const PRIORITY_OPTIONS: { value: WorkPriority; label: string }[] = [
  { value: "URGENT", label: "紧急" },
  { value: "HIGH", label: "高" },
  { value: "MEDIUM", label: "中" },
  { value: "LOW", label: "低" },
];

export const ISSUE_KIND_OPTIONS: { value: IssueKind; label: string }[] = [
  { value: "BUG", label: "bug" },
  { value: "IMPROVEMENT", label: "优化" },
];

/** 阶段里一个人能承担的角色。项目经理不参与研发/测试占用统计。 */
export const MEMBER_ROLE_OPTIONS = ["项目经理", "测试", "研发"] as const;

export const PHASE_LABEL: Record<WorkPhaseKind, string> = Object.fromEntries(
  PHASE_OPTIONS.map((item) => [item.value, item.label]),
) as Record<WorkPhaseKind, string>;

export const PRIORITY_LABEL: Record<WorkPriority, string> = Object.fromEntries(
  PRIORITY_OPTIONS.map((item) => [item.value, item.label]),
) as Record<WorkPriority, string>;

export const ISSUE_KIND_LABEL: Record<IssueKind, string> = Object.fromEntries(
  ISSUE_KIND_OPTIONS.map((item) => [item.value, item.label]),
) as Record<IssueKind, string>;

export const PHASE_RANK: Record<WorkPhaseKind, number> = {
  BUSINESS: 0,
  DEV: 1,
  SIT: 2,
  UAT: 3,
  PRELAUNCH: 4,
  LIVE: 5,
};

export const PRIORITY_RANK: Record<WorkPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export const PROJECT_OPTIONS: { value: "RUNNING" | "PREPARING" | "PAUSED" | "DONE"; label: string }[] = [
  { value: "RUNNING", label: "进行中" },
  { value: "PREPARING", label: "筹备" },
  { value: "PAUSED", label: "暂停" },
  { value: "DONE", label: "已完成" },
];

export const NODE_OPTIONS: { value: "PENDING" | "DELAYED" | "DONE"; label: string }[] = [
  { value: "PENDING", label: "待完成" },
  { value: "DELAYED", label: "已延期" },
  { value: "DONE", label: "已完成" },
];

export const ISSUE_OPTIONS: { value: "OPEN" | "RESOLVING" | "RESOLVED"; label: string }[] = [
  { value: "OPEN", label: "未处理" },
  { value: "RESOLVING", label: "处理中" },
  { value: "RESOLVED", label: "已解决" },
];

export const NODE_LABEL = {
  PENDING: "待完成",
  DELAYED: "已延期",
  DONE: "已完成",
} as const;

export const ISSUE_LABEL = {
  OPEN: "未处理",
  RESOLVING: "处理中",
  RESOLVED: "已解决",
} as const;

export const PROJECT_LABEL = {
  RUNNING: "进行中",
  PREPARING: "筹备",
  PAUSED: "暂停",
  DONE: "已完成",
} as const;

export const ISSUE_RANK = {
  OPEN: 0,
  RESOLVING: 1,
  RESOLVED: 2,
} as const;
