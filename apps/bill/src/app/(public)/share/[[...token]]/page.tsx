import { portalUrl } from "@nas/core";
import { BillApp } from "@/ui/BillApp";

/**
 * 账本分享页 —— 免登录。
 *
 * 放在 (app) 组之外，因此不经过 requireUser；URL 里的 token 就是授权凭证，
 * App.jsx 内部的 SharePage 会自己校验。放在这里而不是让 catch-all 顺带匹配，
 * 是因为路由组决定了要不要走登录门槛。
 */
export const dynamic = "force-dynamic";

export default function SharePage() {
  return <BillApp portalHome={portalUrl() || null} />;
}
