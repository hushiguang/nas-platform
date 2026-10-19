// 数据访问的唯一入口。所有应用与共享包都从这里取 prisma 与模型类型，
// 不直接 import "@prisma/client" —— 生成产物在包内 generated/，直接引会解析不到。
export * from "../generated/client";
export { prisma } from "./client";
