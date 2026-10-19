import type { SessionUser } from "@nas/core";
import type { Actor } from "@/server";

/**
 * 会话用户 → 账单服务层的操作者身份。
 *
 * 两边 user.id 是同一个值（门户 user.id ≡ 源库 users.id，迁移时刻意保持的契约），
 * 所以这里不需要任何映射表。role 直接透传：管理员天然能看到全部账本，
 * 普通成员只能看到自己的与参与的。
 */
export function asActor(user: SessionUser): Actor {
  return { id: user.id, role: user.role };
}
