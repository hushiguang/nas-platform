import type { ReactNode } from "react";
import { BusyBar } from "./busy-bar";
import { NavLinks, type NavItem } from "./nav-links";
import { ThemeSwitch } from "./theme-switch";

export interface ShellUser {
  nickname: string;
  role: "ADMIN" | "MEMBER";
}

export interface AppShellProps {
  /** 品牌名，如「家庭记账」 */
  appName: string;
  /** 品牌下方的小字，各应用统一写 nas-platform */
  appSub?: string;
  navItems: NavItem[];
  user: ShellUser;
  /** 退出登录的 Server Action，由各应用自己提供 */
  logout: () => Promise<void>;
  /** 门户地址。配了就在导航最前面加一个「应用门户」入口 */
  portalHome?: string | null;
  /** 移动端底部标签栏。不传则不渲染 */
  bottomNav?: NavItem[];
  children: ReactNode;
}

/**
 * 所有应用共用的外壳：桌面端左侧栏 + 移动端底部标签栏。
 *
 * 账单这类页面主要在手机上用，所以外壳是移动优先的：窄屏隐藏侧栏、
 * 露出底部标签栏，宽屏反过来。各应用的页面只管内容区。
 */
export function AppShell({
  appName,
  appSub = "nas-platform",
  navItems,
  user,
  logout,
  portalHome,
  bottomNav,
  children,
}: AppShellProps) {
  const items: NavItem[] = portalHome
    ? [{ href: portalHome, label: "应用门户", external: true }, ...navItems]
    : navItems;

  return (
    <div className="app-shell">
      <BusyBar />
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            {appName}
            <span className="brand-sub">{appSub}</span>
          </div>
        </div>
        <nav className="sidenav">
          <div className="nav-group">
            <NavLinks items={items} />
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

      <div className="shell-body">
        <header className="topbar">
          <span className="brand" style={{ fontSize: 18 }}>
            {appName}
          </span>
          <nav className="topbar-nav">
            <NavLinks items={items} />
          </nav>
          <form action={logout}>
            <button type="submit" className="ghost">
              退出
            </button>
          </form>
        </header>
        <main className="main">{children}</main>
      </div>

      {bottomNav && bottomNav.length > 0 && (
        <nav className="bottombar">
          <NavLinks items={bottomNav} />
        </nav>
      )}
    </div>
  );
}
