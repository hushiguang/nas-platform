import { handleLegacyRequest } from "@/server/legacy";

/**
 * 旧账单 API 兼容层 —— 路径前缀 `/legacy/api/*`
 *
 * 为什么不是 `/api/*`：Auth.js 占用了 `/api/auth/[...nextauth]`，
 * 那是个 catch-all，会把老的 `/api/auth/login`、`/api/auth/register` 一并吞掉。
 * 所以整层挪到 `/legacy` 前缀下。
 *
 * 前端不需要为此改一行代码：所有请求都经过 src/ui/api.ts 的 apiUrl()，
 * 那里统一把 `/api/*` 改写到 `/legacy/api/*`。
 * 安卓端「轻记」只需把设置页里的服务器地址填成 `https://cash.<root>` 即可
 * （apiBase 本来就可配），不需要重新打包 APK。
 *
 * 认证双通道（在 server/legacy.ts 里分发）：
 *   Web  —— Auth.js 会话 cookie，门户登录后免二次登录
 *   App  —— Authorization: Bearer，由 /legacy/api/auth/login 签发
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  // Next 15：动态段参数是 Promise
  params: Promise<{ path?: string[] }>;
}

async function handle(req: Request, { params }: RouteContext) {
  const { path } = await params;
  return handleLegacyRequest(req, req.method, path ?? []);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
export const HEAD = handle;
