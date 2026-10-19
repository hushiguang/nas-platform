import type { PlatformAccess } from "@nas/core";
import type { Prisma } from "@nas/db";

/**
 * 看得到的项目：自己负责的，项目成员，以及被排进某个阶段的系统用户。
 * 数据范围是全部时不收窄。外部人员没有账号，不参与这条判断。
 */
export function visibleWhere(access: PlatformAccess, userId: number): Prisma.WorkProjectWhereInput {
  if (access.dataScope === "ALL") return {};
  return {
    OR: [
      { ownerId: userId },
      { members: { some: { userId } } },
      { phases: { some: { members: { some: { userId } } } } },
    ],
  };
}

export function canManage(access: PlatformAccess, userId: number, ownerId: number): boolean {
  return access.dataScope === "ALL" || ownerId === userId;
}
