import { AppShell, type NavItem } from "@nas/ui";
import { portalUrl } from "@nas/core";
import { ensureDefaultLists } from "@nas/todo";
import { requireUser } from "@/auth";
import { logout } from "@/app/actions";

/**
 * 登录门槛 + 外壳。
 *
 * 权限：这里只要求登录。待办是「随时记一笔」的东西，再挡一层平台授权
 * 只会让手机上没有入口，平台可见性在门户卡片那层控制就够了。
 * 数据可见范围由 @nas/todo 的查询层收口（自己的 + 参与的共享清单）。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // 第一次进来没有清单会很空，这里补两个默认的（幂等，已有就不动）
  await ensureDefaultLists(user.id);

  const navItems: NavItem[] = [
    { href: "/", label: "待办" },
    { href: "/today", label: "今天" },
    { href: "/lists", label: "清单" },
    { href: "/done", label: "已完成" },
    { href: "/settings", label: "设置" },
  ];

  const bottomNav: NavItem[] = [
    { href: "/", label: "待办" },
    { href: "/today", label: "今天" },
    { href: "/lists", label: "清单" },
    { href: "/settings", label: "设置" },
  ];

  return (
    <AppShell
      appName="待办"
      appSub="todo"
      navItems={navItems}
      bottomNav={bottomNav}
      user={{ nickname: user.nickname, role: user.role }}
      logout={logout}
      portalHome={portalUrl() || null}
    >
      {children}
    </AppShell>
  );
}
