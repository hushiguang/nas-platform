/**
 * 账单模块（bill）对外出口。
 *
 * 约定：**模块外只从这里取东西**。service/ 下的文件名与函数不对外承诺稳定，
 * 其他模块（门户聚合、待办引擎）也不要直接 prisma.billXxx 查表 ——
 * 账单的归属、归并、归档规则都收敛在这一层，绕过就会漏。
 */
export * from "./service/errors";
export * from "./service/config";
export * from "./service/money";
export * from "./service/dates";
export * from "./service/taxonomy";
export * from "./service/account";
export * from "./service/category";
export * from "./service/book";
export * from "./service/transaction";
export * from "./service/query";
export * from "./service/report";
export * from "./service/calendar";
export * from "./service/recurring";
export * from "./service/category-rule";
export * from "./service/transfer-rule";
export * from "./service/cmb-fix";
export * from "./service/duplicate";
export * from "./service/imagehost";
export * from "./service/user";
export * from "./auth";
