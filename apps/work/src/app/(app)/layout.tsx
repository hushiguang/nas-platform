import { portalUrl } from "@nas/core";
import { AppShell, type NavItem } from "@nas/ui";
import { requireUser } from "@/auth";
import { logout } from "@/app/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 登录门槛。平台可见性与数据范围由各页面自己按需校验（requireAppAccess）
  const user = await requireUser();

  const navItems: NavItem[] = [
    { href: "/", label: "项目管理" },
    { href: "/digest", label: "风险预报" },
    { href: "/people", label: "人员汇总" },
    { href: "/board", label: "日历看板" },
    { href: "/new", label: "新建项目" },
  ];

  const bottomNav: NavItem[] = [
    { href: "/", label: "项目管理" },
    { href: "/digest", label: "风险预报" },
    { href: "/people", label: "人员汇总" },
    { href: "/board", label: "日历看板" },
    { href: "/new", label: "新建项目" },
  ];

  return (
    <AppShell
      appName="工作台"
      navItems={navItems}
      bottomNav={bottomNav}
      user={user}
      logout={logout}
      portalHome={portalUrl() || null}
    >
      {children}
    </AppShell>
  );
}
