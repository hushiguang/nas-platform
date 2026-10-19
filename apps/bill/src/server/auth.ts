/**
 * 账单的双通道认证。
 *
 *   Web（门户 / 本站）：Auth.js 会话。门户 nav.* 登录后 cookie 写在 .<root> 域，
 *                      到 cash.* 直接可解，所以不用再登录一次。
 *   安卓 App「轻记」  ：/legacy/api/auth/login 换 Bearer Token（HS256，30 天）。
 *
 * 两条通道认的是**同一张 user 表、同一个 bcrypt 哈希**，
 * 所以门户里改的密码手机端立刻生效，不存在两套账号。
 *
 * Token 用 jose 签发（next-auth v5 自带该依赖），
 * 密钥优先取 BILL_JWT_SECRET，退回 Auth.js 的 AUTH_SECRET。
 */
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "@nas/db";
import { auth } from "@/auth";
import { BillError } from "./errors";
import type { Actor } from "./book";

const ISSUER = "qingji";
const AUDIENCE = "qingji-app";
const TOKEN_TTL = "30d";

function secretKey(): Uint8Array {
  const raw = process.env.BILL_JWT_SECRET || process.env.AUTH_SECRET || "";
  if (!raw) {
    throw new BillError("服务端未配置 BILL_JWT_SECRET / AUTH_SECRET，无法签发登录凭证", 500);
  }
  return new TextEncoder().encode(raw);
}

export interface TokenPayload {
  id: number;
  username: string;
}

/** 给安卓端签发的长期 Token（30 天，与旧 JWT_EXPIRY 行为对齐） */
export async function signUser(user: { id: number; username: string }): Promise<string> {
  return new SignJWT({ id: user.id, username: user.username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(TOKEN_TTL)
    .sign(secretKey());
}

async function verifyToken(token: string): Promise<TokenPayload | null> {
  // 先取密钥：配置缺失属于服务端错误，必须抛出去（而不是被下面吞成「未登录」，
  // 否则线上忘配 AUTH_SECRET 时只会看到一片 401，查不出原因）。
  const key = secretKey();
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const id = Number(payload.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    return { id, username: String(payload.username ?? "") };
  } catch {
    return null;
  }
}

/** 对外的用户呈现（字段名与旧 API 一致，安卓端直接复用） */
export function publicUser(row: {
  id: number;
  username: string;
  nickname: string;
  role: string;
  status: string;
  createdAt?: Date | null;
}) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.nickname,
    isAdmin: row.role === "ADMIN",
    isActive: row.status === "ACTIVE",
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

/** 安卓端登录：用户名大小写不敏感（与迁移脚本的口径保持一致） */
export async function loginWithPassword(username: string, password: string) {
  const name = String(username || "").trim();
  if (!name || !password) throw new BillError("请输入用户名和密码");
  const user = await prisma.user.findFirst({
    where: { username: { equals: name, mode: "insensitive" } },
  });
  if (!user || user.status !== "ACTIVE") throw new BillError("用户名或密码不正确", 401);
  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) throw new BillError("用户名或密码不正确", 401);
  return { token: await signUser(user), user: publicUser(user) };
}

/** 从 Authorization: Bearer 解析出操作者 */
export async function actorFromBearer(req: Request): Promise<Actor | null> {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  return actorById(payload.id);
}

/** 从 Auth.js 会话解析出操作者 */
export async function actorFromSession(): Promise<Actor | null> {
  let sessionUserId: unknown;
  try {
    const session = await auth();
    sessionUserId = session?.user?.id;
  } catch {
    // 脱离请求上下文调用 auth()（脚本、worker、定时任务）时 Next 会抛错，
    // 这种情况按「未登录」处理，让上层继续走 Bearer 或直接返回 401。
    return null;
  }
  const id = Number(sessionUserId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return actorById(id);
}

/** 两种通道都试一遍：先 Bearer（安卓），再会话（Web） */
export async function resolveActor(req?: Request): Promise<Actor | null> {
  if (req) {
    const bearer = await actorFromBearer(req);
    if (bearer) return bearer;
  }
  return actorFromSession();
}

export async function requireActor(req?: Request): Promise<Actor> {
  const actor = await resolveActor(req);
  if (!actor) throw new BillError("请先登录", 401);
  return actor;
}

/** 需要管理员的操作（删除他人数据、管理用户等） */
export async function requireAdmin(req?: Request): Promise<Actor> {
  const actor = await requireActor(req);
  if (actor.role !== "ADMIN") throw new BillError("需要管理员权限", 403);
  return actor;
}

/** 每次都回表确认账号仍存在且启用 —— Token 有效期长，用户可能已被停用 */
async function actorById(id: number): Promise<Actor | null> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") return null;
  return { id: user.id, role: user.role };
}
