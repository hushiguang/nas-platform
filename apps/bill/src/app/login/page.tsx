import { redirect } from "next/navigation";
import { safeNextUrl } from "@nas/core";
import { LoginForm } from "@nas/ui";
import { getSessionUser } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // 已经登录的不用再看登录页
  if (await getSessionUser()) redirect("/");

  // next 来自 URL，必须先过白名单，否则是开放重定向
  const { next } = await searchParams;
  return (
    <LoginForm
      appName="家庭记账"
      appSub="nas-platform"
      hint="登录后进入你的账本"
      next={safeNextUrl(next)}
    />
  );
}
