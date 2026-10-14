import { redirect } from "next/navigation";
import { auth } from "@/auth";

export interface SessionUser {
  id: number;
  username: string;
  nickname: string;
  role: "ADMIN" | "MEMBER";
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: Number(session.user.id),
    username: session.user.username,
    nickname: session.user.name ?? session.user.username,
    role: session.user.role,
  };
}

/** 服务端页面/Action 的登录门槛，未登录直接跳登录页 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
