/**
 * 账单应用的业务出口。
 *
 * 约定：**应用内其他层只从这里取东西**（页面 / Server Action / Route Handler）。
 * 也只在账单应用内使用 —— 门户要看账单数据，走 /api/internal/summary，
 * 不跨应用直接 import 这个包，更不直接查 bill_* 表。
 *
 * 账单的归属、归并、归档规则都收敛在这一层，绕过去就会漏。
 */
export * from "./errors";
export * from "./config";
export * from "./money";
export * from "./dates";
export * from "./taxonomy";
export * from "./account";
export * from "./category";
export * from "./book";
export * from "./transaction";
export * from "./query";
export * from "./report";
export * from "./calendar";
export * from "./recurring";
export * from "./category-rule";
export * from "./transfer-rule";
export * from "./cmb-fix";
export * from "./duplicate";
export * from "./imagehost";
export * from "./user";
export * from "./auth";
export * from "./export";
export * from "./import";
