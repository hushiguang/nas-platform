"use server";

import { signOut } from "@/auth";

/** 退出登录。cookie 的作用域是整站的，这里退出，其他应用也就一起退出了 */
export async function logout() {
  await signOut({ redirectTo: "/login" });
}
