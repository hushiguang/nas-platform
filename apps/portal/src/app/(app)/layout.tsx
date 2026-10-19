import { AppShell, type NavItem } from "@nas/ui";
import { requireUser } from "@/auth";
import { logout } from "@/app/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 登录门槛。平台可见性与数据范围由各页面自己按需校验（requireAppAccess）
  const user = await requireUser();

  const navItems: NavItem[] = [
    { href: "/", label: "应用门户" },
    { href: "/todos", label: "待办管理" },
  ];

  // 管理入口只对管理员显示。注意这只是体验层 —— 真正的权限校验在
  // /admin 下的页面和 Server Action 里，藏起来不等于拦住。
  if (user.role === "ADMIN") {
    navItems.push({ href: "/notify", label: "发送记录" });
    navItems.push({ href: "/notify/channels", label: "通知渠道" });
    navItems.push({ href: "/logs", label: "日志管理" });
    navItems.push({ href: "/admin/users", label: "用户管理" });
    navItems.push({ href: "/admin/platforms", label: "应用管理" });
  }

  const bottomNav: NavItem[] = [
    { href: "/", label: "门户" },
    { href: "/todos", label: "待办管理" },
  ];

  return (
    <AppShell
      appName="家庭 NAS"
      navItems={navItems}
      bottomNav={bottomNav}
      user={user}
      logout={logout}
    >
      {children}
    </AppShell>
  );
}
