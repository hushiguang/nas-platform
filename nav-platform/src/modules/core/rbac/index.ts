import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/modules/core/auth/session";

export interface PlatformAccess {
  code: string;
  name: string;
  description: string | null;
  icon: string;
  group: string | null;
  url: string | null;
  isExternal: boolean;
  sort: number;
  dataScope: "SELF" | "ALL";
}

/**
 * 用户可见的应用列表（平台可见性）。
 * 管理员全平台可见、数据范围 ALL；普通成员按 user_platform 授权。
 * 门户首页把它渲染成卡片网格，无权限的应用不出现。
 */
export async function getUserPlatforms(user: SessionUser): Promise<PlatformAccess[]> {
  const toAccess = (p: { code: string; name: string; description: string | null; icon: string; group: string | null; url: string | null; isExternal: boolean; sort: number }, dataScope: "SELF" | "ALL"): PlatformAccess => ({
    code: p.code,
    name: p.name,
    description: p.description,
    icon: p.icon,
    group: p.group,
    url: p.url,
    isExternal: p.isExternal,
    sort: p.sort,
    dataScope,
  });

  if (user.role === "ADMIN") {
    const platforms = await prisma.platform.findMany({ orderBy: { sort: "asc" } });
    return platforms.map((p) => toAccess(p, "ALL"));
  }
  const rows = await prisma.userPlatform.findMany({
    where: { userId: user.id },
    include: { platform: true },
    orderBy: { platform: { sort: "asc" } },
  });
  return rows.map((r) => toAccess(r.platform, r.dataScope));
}

/**
 * 平台级权限校验（内部模块 layout / Server Action 的最终校验点之一）。
 * 返回该用户在该平台的访问授权，无权限返回 null。
 */
export async function getPlatformAccess(
  user: SessionUser,
  code: string,
): Promise<PlatformAccess | null> {
  const platforms = await getUserPlatforms(user);
  return platforms.find((p) => p.code === code) ?? null;
}

/**
 * 数据范围查询条件：ALL 看全部，SELF 只看自己。
 * 查询层兜底用——上层做了过滤这里也必须拼，不能信任上层。
 */
export function scopeCondition(access: PlatformAccess, userId: number): { ownerId?: number } {
  return access.dataScope === "ALL" ? {} : { ownerId: userId };
}
