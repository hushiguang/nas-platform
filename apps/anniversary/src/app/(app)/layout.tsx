import { portalUrl } from "@nas/core";
import { AppShell, type NavItem } from "@nas/ui";
import { requireUser } from "@/auth";
import { logout } from "@/app/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 登录门槛。平台可见性与数据范围由各页面自己按需校验（requireAppAccess）
  const user = await requireUser();

  const navItems: NavItem[] = [
    { href: "/", label: "纪念日" },
    { href: "/new", label: "添加" },
  ];

  const bottomNav: NavItem[] = [
    { href: "/", label: "纪念日" },
    { href: "/new", label: "添加" },
  ];

  return (
    <AppShell
      appName="纪念日"
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
