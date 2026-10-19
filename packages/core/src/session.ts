/**
 * 会话用户的精简表示。放在 core 而不是 auth 包里，是为了让
 * 权限查询（rbac）不必反向依赖认证包 —— 否则两个包会互相 import。
 */
export interface SessionUser {
  id: number;
  username: string;
  nickname: string;
  role: "ADMIN" | "MEMBER";
}
