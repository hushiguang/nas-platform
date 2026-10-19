/**
 * 账单模块的可调参数。
 *
 * 移植自 cash-platform/server/src/config.js 里与账单相关的那部分 ——
 * 部署期可以通过环境变量微调，其余给合理默认值。
 * 不要把这些常量散落到各个 service 里，改阈值要能在一处找到。
 */

import { imageHostConfig } from "@nas/media";

/** 环境变量取正整数，非法或非正数就退回默认值 */
function numEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const billConfig = {
  /** 分页与查询上限 */
  pagination: {
    transactionsDefault: numEnv(process.env.TX_LIMIT, 500),
    transactionsMax: numEnv(process.env.TX_LIMIT_MAX, 5000),
    searchDefault: 20,
    searchMax: 50,
    keywordMaxWords: 6,
  },

  /** 查重阈值（service/duplicate.ts 使用） */
  duplicates: {
    /** 同账户两笔要报重复的最低分（同额 + 同时刻 + 商户名一致才够硬） */
    sameAccountMinScore: numEnv(process.env.DUP_SAME_ACCOUNT_MIN_SCORE, 75),
    /** 一组最多合并多少条，避免一次误删一大片 */
    groupMaxSize: numEnv(process.env.DUP_GROUP_MAX_SIZE, 12),
    /** 查重默认时间窗口（天） */
    defaultWindowDays: numEnv(process.env.DUP_WINDOW_DAYS, 1),
    /** 评分权重 */
    scores: {
      baseline: 40, // 同额 + 分属不同账户
      sameTime: 30, // 同一时刻
      sameDay: 20, // 同一天
      gap: 8, // 跨天
      merchantExact: 22, // 商户名包含
      merchantNear: 10, // 商户名相近（最长公共片段 >= 2）
      channel: 20, // 渠道互证（微信/支付宝）
      order: 25, // 商户单号相同
      largeAmount: 5, // 金额 >= 50 元，偶然撞号概率低
    },
  },

  /**
   * 图床与图片代理。配置本体在 @nas/media，账单和纪念日共用。
   * 挂在 billConfig 上是为了旧代码不用改引用。
   */
  imageProxy: imageHostConfig,
};
