import type { IssueKind, WorkPhaseItemStatus, WorkPhaseKind, WorkPhaseResult, WorkPriority } from "@nas/db";

export const PHASE_OPTIONS: { value: WorkPhaseKind; label: string }[] = [
  { value: "BUSINESS", label: "商务阶段" },
  { value: "PREPARE", label: "项目准备阶段" },
  { value: "DEV", label: "研发节点" },
  { value: "SIT", label: "SIT测试阶段" },
  { value: "UAT", label: "UAT阶段" },
  { value: "PRELAUNCH", label: "准备上线" },
  { value: "LIVE", label: "上线阶段" },
];

/** 阶段结论。走完一个阶段后，用它标记这个阶段到底 OK 不 OK。 */
export const PHASE_RESULT_OPTIONS: { value: WorkPhaseResult; label: string; tone: string }[] = [
  { value: "PENDING", label: "未开始", tone: "muted" },
  { value: "DOING", label: "进行中", tone: "sky" },
  { value: "OK", label: "OK", tone: "mint" },
  { value: "RISK", label: "有问题", tone: "coral" },
];

export const PHASE_RESULT_LABEL: Record<WorkPhaseResult, string> = Object.fromEntries(
  PHASE_RESULT_OPTIONS.map((item) => [item.value, item.label]),
) as Record<WorkPhaseResult, string>;

export const PHASE_ITEM_STATUS_OPTIONS: { value: WorkPhaseItemStatus; label: string }[] = [
  { value: "PENDING", label: "未开始" },
  { value: "DOING", label: "进行中" },
  { value: "DONE", label: "已完成" },
  { value: "BLOCKED", label: "卡住" },
];

export const PHASE_ITEM_STATUS_LABEL: Record<WorkPhaseItemStatus, string> = Object.fromEntries(
  PHASE_ITEM_STATUS_OPTIONS.map((item) => [item.value, item.label]),
) as Record<WorkPhaseItemStatus, string>;

export interface PhaseItemTemplate {
  name: string;
  /** 单独记百分比进度：研发实施、SIT测试 */
  trackProgress?: boolean;
  /** 这类事项通常是链接，例如 ChangeList / Jira */
  link?: boolean;
}

/** 每个阶段的默认事项清单。新项目、老项目第一次打开时按它补齐。 */
export const DEFAULT_PHASE_ITEMS: Record<WorkPhaseKind, PhaseItemTemplate[]> = {
  BUSINESS: [
    { name: "需求调研" },
    { name: "报价评估（内部）" },
    { name: "报价评审（IT）" },
    { name: "POA（BCA）" },
  ],
  PREPARE: [
    { name: "项目计划" },
    { name: "原型交付" },
    { name: "UI交付" },
    { name: "ChangeList", link: true },
    { name: "Jira链接", link: true },
  ],
  DEV: [{ name: "研发实施", trackProgress: true }],
  SIT: [
    { name: "环境部署" },
    { name: "SIT测试", trackProgress: true },
  ],
  UAT: [
    { name: "环境部署" },
    { name: "UAT回归" },
    { name: "UAT邮件" },
    { name: "UAT测试", trackProgress: true },
  ],
  PRELAUNCH: [
    { name: "OA流程" },
    { name: "研发文档（RTP/TSD）" },
    { name: "测试文档" },
    { name: "运维评审" },
  ],
  LIVE: [{ name: "上线" }],
};

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

/** 大阶段：列表卡片上只露出这一层，小阶段就是具体走到哪一步。 */
export const PHASE_GROUP: Record<WorkPhaseKind, string> = {
  BUSINESS: "商务",
  PREPARE: "准备",
  DEV: "研发",
  SIT: "测试",
  UAT: "测试",
  PRELAUNCH: "上线",
  LIVE: "上线",
};

/** 小阶段：去掉「阶段」后缀，卡片上跟大阶段并排显示。 */
export const PHASE_SHORT: Record<WorkPhaseKind, string> = Object.fromEntries(
  PHASE_OPTIONS.map((item) => [item.value, item.label.replace(/阶段$/, "")]),
) as Record<WorkPhaseKind, string>;

export const PRIORITY_LABEL: Record<WorkPriority, string> = Object.fromEntries(
  PRIORITY_OPTIONS.map((item) => [item.value, item.label]),
) as Record<WorkPriority, string>;

export const ISSUE_KIND_LABEL: Record<IssueKind, string> = Object.fromEntries(
  ISSUE_KIND_OPTIONS.map((item) => [item.value, item.label]),
) as Record<IssueKind, string>;

export const PHASE_RANK: Record<WorkPhaseKind, number> = {
  BUSINESS: 0,
  PREPARE: 1,
  DEV: 2,
  SIT: 3,
  UAT: 4,
  PRELAUNCH: 5,
  LIVE: 6,
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
