/**
 * 账单模块里的用户管理（旧 PATCH /api/users/:id）。
 *
 * 这里只管「账单侧用得上的那几个字段」：昵称、启用状态、管理员、密码。
 * 平台级的账号体系在 core 模块，别在这里加平台字段。
 *
 * ⚠ 两条防呆沿用旧实现，不是多余的：
 *   1. 不能停用自己 —— 否则管理员一停用自己就再也登不进来；
 *   2. 不能取消自己的管理员 —— 同理，会把系统锁死到没人能管。
 */
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { BillError } from "./errors";
import type { Actor } from "./book";

export interface UserPatch {
  displayName?: unknown;
  isActive?: unknown;
  isAdmin?: unknown;
  password?: unknown;
}

export async function updateUser(actor: Actor, id: number, body: UserPatch) {
  const target = await prisma.user.findUnique({ where: { id: Number(id) } });
  if (!target) throw new BillError("用户不存在", 404);

  const data: {
    nickname?: string;
    status?: "ACTIVE" | "DISABLED";
    role?: "ADMIN" | "MEMBER";
    passwordHash?: string;
  } = {};

  if (body.displayName != null) {
    data.nickname = String(body.displayName).trim() || target.nickname;
  }
  if (body.isActive != null) {
    if (target.id === actor.id && !body.isActive) throw new BillError("不能停用自己");
    data.status = body.isActive ? "ACTIVE" : "DISABLED";
  }
  if (body.isAdmin != null) {
    if (target.id === actor.id && !body.isAdmin) throw new BillError("不能取消自己的管理员");
    data.role = body.isAdmin ? "ADMIN" : "MEMBER";
  }
  if (body.password) {
    if (String(body.password).length < 6) throw new BillError("密码至少 6 位");
    data.passwordHash = await bcrypt.hash(String(body.password), 10);
  }

  return prisma.user.update({ where: { id: target.id }, data });
}
