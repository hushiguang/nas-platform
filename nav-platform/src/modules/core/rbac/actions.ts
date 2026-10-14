"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/modules/core/auth/session";
import type { DataScope, NotifyChannelType } from "@prisma/client";

/** 所有管理端 Action 的统一管理员门槛 */
async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("仅管理员可执行该操作");
  return user;
}

/** 校验失败统一回到来源页并带错误提示 */
function fail(backTo: string, message: string): never {
  redirect(`${backTo}?error=${encodeURIComponent(message)}`);
}

const usernameSchema = z
  .string()
  .trim()
  .min(3, "用户名至少 3 位")
  .max(32, "用户名最多 32 位")
  .regex(/^[a-zA-Z0-9_.-]+$/, "用户名只能包含字母、数字、下划线、点、短横线");

const passwordSchema = z.string().min(8, "密码至少 8 位").max(72, "密码过长");

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

// ---------------------------------------------------------------- 用户

export async function createUser(formData: FormData) {
  await requireAdmin();
  const back = "/admin/users";
  const parsed = z
    .object({
      username: usernameSchema,
      password: passwordSchema,
      nickname: z.string().trim().min(1, "昵称不能为空").max(32),
      email: z.string().trim().email("邮箱格式不正确").optional().or(z.literal("")),
      wecomId: z.string().trim().max(64).optional().or(z.literal("")),
      role: z.enum(["ADMIN", "MEMBER"]),
    })
    .safeParse({
      username: str(formData, "username"),
      password: str(formData, "password"),
      nickname: str(formData, "nickname"),
      email: str(formData, "email"),
      wecomId: str(formData, "wecomId"),
      role: str(formData, "role") || "MEMBER",
    });
  if (!parsed.success) fail(back, parsed.error.issues[0]?.message ?? "参数错误");

  const { username, password, nickname, email, wecomId, role } = parsed.data;
  if (await prisma.user.findUnique({ where: { username } })) fail(back, `用户名 ${username} 已存在`);

  await prisma.user.create({
    data: {
      username,
      nickname,
      email: email || null,
      wecomId: wecomId || null,
      role,
      passwordHash: await bcrypt.hash(password, 10),
    },
  });
  revalidatePath(back);
  redirect(back);
}

export async function updateUser(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(str(formData, "id"));
  if (!Number.isInteger(id)) throw new Error("参数错误");
  const back = `/admin/users/${id}`;

  const parsed = z
    .object({
      nickname: z.string().trim().min(1, "昵称不能为空").max(32),
      email: z.string().trim().email("邮箱格式不正确").optional().or(z.literal("")),
      wecomId: z.string().trim().max(64).optional().or(z.literal("")),
      role: z.enum(["ADMIN", "MEMBER"]),
      status: z.enum(["ACTIVE", "DISABLED"]),
    })
    .safeParse({
      nickname: str(formData, "nickname"),
      email: str(formData, "email"),
      wecomId: str(formData, "wecomId"),
      role: str(formData, "role") || "MEMBER",
      status: str(formData, "status") || "ACTIVE",
    });
  if (!parsed.success) fail(back, parsed.error.issues[0]?.message ?? "参数错误");

  // 不允许把自己降级或停用，防止管理员把自己锁在门外
  if (id === admin.id) {
    if (parsed.data.role !== "ADMIN") fail(back, "不能修改自己的角色");
    if (parsed.data.status !== "ACTIVE") fail(back, "不能停用自己的账号");
  }

  await prisma.user.update({
    where: { id },
    data: {
      nickname: parsed.data.nickname,
      email: parsed.data.email || null,
      wecomId: parsed.data.wecomId || null,
      role: parsed.data.role,
      status: parsed.data.status,
    },
  });
  revalidatePath(back);
  revalidatePath("/admin/users");
  redirect(back);
}

export async function resetPassword(formData: FormData) {
  await requireAdmin();
  const id = Number(str(formData, "id"));
  if (!Number.isInteger(id)) throw new Error("参数错误");
  const back = `/admin/users/${id}`;
  const parsed = passwordSchema.safeParse(str(formData, "password"));
  if (!parsed.success) fail(back, parsed.error.issues[0]?.message ?? "参数错误");

  await prisma.user.update({
    where: { id },
    data: { passwordHash: await bcrypt.hash(parsed.data, 10) },
  });
  redirect(`${back}?ok=${encodeURIComponent("密码已重置")}`);
}

export async function deleteUser(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(str(formData, "id"));
  if (!Number.isInteger(id)) throw new Error("参数错误");
  if (id === admin.id) fail("/admin/users", "不能删除自己的账号");
  await prisma.user.delete({ where: { id } });
  revalidatePath("/admin/users");
  redirect("/admin/users");
}

// ---------------------------------------------------------------- 平台授权

/**
 * 保存用户平台授权：表单里每个平台给出「未授权 / 本人 / 全部」。
 * 先清空再重建，保证与提交结果严格一致（管理员不受此表限制，天然全平台）。
 */
export async function saveUserPlatforms(formData: FormData) {
  await requireAdmin();
  const userId = Number(str(formData, "userId"));
  if (!Number.isInteger(userId)) throw new Error("参数错误");
  const back = `/admin/users/${userId}`;

  const platforms = await prisma.platform.findMany();
  const grants: { platformId: number; dataScope: DataScope }[] = [];
  for (const platform of platforms) {
    const value = str(formData, `scope_${platform.id}`);
    if (value === "SELF" || value === "ALL") {
      grants.push({ platformId: platform.id, dataScope: value });
    }
  }

  await prisma.$transaction([
    prisma.userPlatform.deleteMany({ where: { userId } }),
    prisma.userPlatform.createMany({ data: grants.map((g) => ({ userId, ...g })) }),
  ]);
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent("平台授权已保存")}`);
}

// ---------------------------------------------------------------- 通知渠道

const CHANNEL_TYPES: NotifyChannelType[] = ["WECOM", "MAIL"];

/** 保存用户通知渠道：企微 userid / 收件邮箱 + 启用开关 */
export async function saveNotifyChannels(formData: FormData) {
  await requireAdmin();
  const userId = Number(str(formData, "userId"));
  if (!Number.isInteger(userId)) throw new Error("参数错误");
  const back = `/admin/users/${userId}`;

  for (const type of CHANNEL_TYPES) {
    const enabled = str(formData, `ch_${type}_enabled`) === "on";
    const target = str(formData, `ch_${type}_target`);
    await prisma.notifyChannel.upsert({
      where: { userId_type: { userId, type } },
      update: { enabled, config: target ? (type === "WECOM" ? { toUser: target } : { to: target }) : {} },
      create: {
        userId,
        type,
        enabled,
        config: target ? (type === "WECOM" ? { toUser: target } : { to: target }) : {},
      },
    });
  }
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent("通知渠道已保存")}`);
}

// ---------------------------------------------------------------- 平台注册表

export async function createPlatform(formData: FormData) {
  await requireAdmin();
  const back = "/admin/platforms";
  const parsed = z
    .object({
      code: z
        .string()
        .trim()
        .min(2, "标识至少 2 位")
        .max(32)
        .regex(/^[a-z][a-z0-9-]*$/, "标识只能用小写字母开头，含小写字母/数字/短横线"),
      name: z.string().trim().min(1, "名称不能为空").max(32),
      description: z.string().trim().max(200).optional().or(z.literal("")),
      icon: z.string().trim().max(16).optional().or(z.literal("")),
      group: z.string().trim().max(32).optional().or(z.literal("")),
      url: z.string().trim().url("URL 格式不正确").optional().or(z.literal("")),
      isExternal: z.coerce.boolean(),
      sort: z.coerce.number().int().min(0).max(9999).default(0),
    })
    .safeParse({
      code: str(formData, "code"),
      name: str(formData, "name"),
      description: str(formData, "description"),
      icon: str(formData, "icon"),
      group: str(formData, "group"),
      url: str(formData, "url"),
      isExternal: str(formData, "isExternal"),
      sort: str(formData, "sort") || "0",
    });
  if (!parsed.success) fail(back, parsed.error.issues[0]?.message ?? "参数错误");

  if (await prisma.platform.findUnique({ where: { code: parsed.data.code } })) {
    fail(back, `平台标识 ${parsed.data.code} 已存在`);
  }
  await prisma.platform.create({
    data: { ...parsed.data, description: parsed.data.description || null, icon: parsed.data.icon || "🧩", group: parsed.data.group || null, url: parsed.data.url || null },
  });
  revalidatePath(back);
  redirect(back);
}

export async function updatePlatform(formData: FormData) {
  await requireAdmin();
  const back = "/admin/platforms";
  const id = Number(str(formData, "id"));
  if (!Number.isInteger(id)) throw new Error("参数错误");
  const parsed = z
    .object({
      name: z.string().trim().min(1, "名称不能为空").max(32),
      description: z.string().trim().max(200).optional().or(z.literal("")),
      icon: z.string().trim().max(16).optional().or(z.literal("")),
      group: z.string().trim().max(32).optional().or(z.literal("")),
      url: z.string().trim().url("URL 格式不正确").optional().or(z.literal("")),
      isExternal: z.coerce.boolean(),
      sort: z.coerce.number().int().min(0).max(9999),
    })
    .safeParse({
      name: str(formData, "name"),
      description: str(formData, "description"),
      icon: str(formData, "icon"),
      group: str(formData, "group"),
      url: str(formData, "url"),
      isExternal: str(formData, "isExternal"),
      sort: str(formData, "sort") || "0",
    });
  if (!parsed.success) fail(back, parsed.error.issues[0]?.message ?? "参数错误");

  await prisma.platform.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      icon: parsed.data.icon || "🧩",
      group: parsed.data.group || null,
      url: parsed.data.url || null,
      isExternal: parsed.data.isExternal,
      sort: parsed.data.sort,
    },
  });
  revalidatePath(back);
  redirect(back);
}

export async function deletePlatform(formData: FormData) {
  await requireAdmin();
  const id = Number(str(formData, "id"));
  if (!Number.isInteger(id)) throw new Error("参数错误");
  // 级联删除 user_platform，授权关系随之清理
  await prisma.platform.delete({ where: { id } });
  revalidatePath("/admin/platforms");
  redirect("/admin/platforms");
}
