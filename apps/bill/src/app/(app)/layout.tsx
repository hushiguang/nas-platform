import { requireUser } from "@/auth";

/**
 * 登录门槛。
 *
 * 这里刻意不加外壳：顶栏、底栏、侧边菜单都是账单 UI 自己的（原 cash-platform），
 * 再套一层门户的 AppShell 就会两套导航打架。
 * 所以只做会话校验，通过后原样渲染。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 子域名方案下 cookie 写在 .<root> 域，门户登录后这里直接可解
  await requireUser();
  return <>{children}</>;
}
