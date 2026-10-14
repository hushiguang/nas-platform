import { requireUser } from "@/modules/core/auth/session";
import { logout } from "@/modules/core/auth/actions";
import { NavLinks, type NavItem } from "@/components/nav-links";
import { ThemeSwitch } from "@/components/theme-switch";

// 需登录区域的统一布局：应用入口集中在首页卡片网格，侧边栏只留全局入口。
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const navItems: NavItem[] = [{ href: "/", label: "应用门户" }];
  if (user.role === "ADMIN") {
    navItems.push({ href: "/admin/users", label: "用户管理" });
    navItems.push({ href: "/admin/platforms", label: "应用管理" });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            家庭 NAS<span className="brand-sub">应用门户</span>
          </div>
        </div>
        <nav className="sidenav">
          <div className="nav-group">
            <NavLinks items={navItems} />
          </div>
        </nav>
        <div className="sidebar-foot">
          <ThemeSwitch />
          <div className="me-row">
            <span className="me-avatar">{user.nickname.slice(0, 1)}</span>
            <div className="me-info">
              <div className="me-name">{user.nickname}</div>
              {user.role === "ADMIN" && <div className="me-role">管理员</div>}
            </div>
            <form action={logout} className="logout-form">
              <button type="submit" className="logout">
                退出
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header className="topbar">
          <span className="brand" style={{ fontSize: 18 }}>
            家庭 NAS
          </span>
          <nav style={{ display: "flex", gap: 4, flex: 1, overflowX: "auto" }}>
            <NavLinks items={navItems} />
          </nav>
          <form action={logout}>
            <button type="submit" className="ghost">
              退出
            </button>
          </form>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
