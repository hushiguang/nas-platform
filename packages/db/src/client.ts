import { PrismaClient } from "../generated/client";

// 开发期热重载会反复执行模块顶层代码，不缓存实例的话每改一次文件就多一个连接池，
// 很快打满 PG 的 max_connections。生产环境进程只起一次，不需要走全局缓存。
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
