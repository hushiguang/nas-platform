import { portalUrl } from "@nas/core";
import { AppShell, type NavItem } from "@nas/ui";
import { requireUser } from "@/auth";
import { logout } from "@/app/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 登录门槛。平台可见性与数据范围由各页面自己按需校验（requireAppAccess）
  const user = await requireUser();

  const navItems: NavItem[] = [
    { href: "/", label: "足迹" },
    { href: "/trips", label: "行程" },
    { href: "/map", label: "地图" },
    { href: "/cities", label: "城市" },
  ];

  const bottomNav: NavItem[] = [
    { href: "/", label: "足迹" },
    { href: "/trips", label: "行程" },
    { href: "/map", label: "地图" },
    { href: "/cities", label: "城市" },
  ];

  return (
    <AppShell
      appName="旅行足迹"
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
