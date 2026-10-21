/**
 * 待办模块的共享类型。
 *
 * 单独一个文件是为了避免循环依赖：index.ts 既导出引擎、又导出 lists/todo-ops，
 * 而那两边都要用到这里的输入结构，直接从 index 引会成环。
 */
import type { TodoPriority, TodoSource, TodoStatus } from "@nas/db";

export interface RemindRule {
  /** 提前 N 天提醒，0 表示当天 */
  offsetDays: number;
  /** 推送时点 "09:00" */
  time?: string;
  /**
   * 这条规则已经提醒过的触发日（YYYY-MM-DD）。引擎写回，界面不提交 ——
   * 没有它，逾期很久的待办每天都会被重新扫出来发一遍。
   */
  lastFired?: string;
}

export interface CreateTodoInput {
  title: string;
  description?: string | null;
  source?: TodoSource;
  /** 来源业务记录标识（如 "anniversary:12"），幂等去重靠它 */
  sourceBizId?: string;
  priority?: TodoPriority;
  dueTime?: Date | null;
  remindRules?: RemindRule[];
  ownerId: number;
  /** 归属清单；不传 = 收件箱（未归类） */
  listId?: number | null;
  /** 图片地址数组 */
  images?: string[];
  /** 幂等键：触发日期。同一来源同一天重复生成会被忽略 */
  triggerDate?: Date;
}

export interface UpdateTodoInput {
  title?: string;
  description?: string | null;
  priority?: TodoPriority;
  dueTime?: Date | null;
  remindRules?: RemindRule[] | null;
  status?: TodoStatus;
  /** 显式传 null 表示移出清单（退回收件箱） */
  listId?: number | null;
  images?: string[];
  sort?: number;
  /** 稍后提醒；传 null 清除 snooze */
  snoozeUntil?: Date | null;
}

/** 待办列表筛选条件 */
export interface TodoQuery {
  userId: number;
  /** 管理员可跨用户查看 */
  isAdmin?: boolean;
  /** undefined = 全部；null = 未归类（收件箱）；数字 = 指定清单 */
  listId?: number | null;
  /** 默认只看未完成 */
  scope?: "open" | "overdue" | "done" | "all";
  /** 标题/备注模糊搜索 */
  search?: string;
  take?: number;
  /**
   * 只看待办平台自身的数据（source = MANUAL），各平台收上来的归门户聚合页。
   * 传 includeSources 可显式覆盖；excludeSources 保留兼容旧调用。
   */
  includeSources?: TodoSource[];
  excludeSources?: TodoSource[];
}

export interface TodoStats {
  open: number;
  overdue: number;
  today: number;
  done: number;
}
