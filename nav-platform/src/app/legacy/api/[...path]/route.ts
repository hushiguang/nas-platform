/**
 * 旧账单 API 兼容层的 Next.js 接线。
 *
 * 真正的分发、鉴权与响应外壳都在 `@/modules/bill/legacy` ——
 * 那里只用 Web 标准 Request/Response，不依赖 Next，
 * 所以可以被脚本直接调用做端到端验证（见 scripts/smoke-legacy.ts）。
 * 本文件只负责把 Next 的 `params` 传下去。
 *
 * 挂载前缀是 `/legacy/api/*`（不是 `/api/*`）：Auth.js 占用了
 * `/api/auth/[...nextauth]`，那是 catch-all，会把老的 `/api/auth/login` 吞掉。
 * 安卓端「轻记」只需把设置页里的服务器地址改成 `http://<nas>:3000/legacy`。
 */
import { handleLegacyRequest } from "@/modules/bill/legacy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ path: string[] }>;
}

async function handle(req: Request, method: string, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return handleLegacyRequest(req, method, path ?? []);
}

export const GET = (req: Request, ctx: RouteCtx) => handle(req, "GET", ctx);
export const POST = (req: Request, ctx: RouteCtx) => handle(req, "POST", ctx);
export const PATCH = (req: Request, ctx: RouteCtx) => handle(req, "PATCH", ctx);
export const PUT = (req: Request, ctx: RouteCtx) => handle(req, "PUT", ctx);
export const DELETE = (req: Request, ctx: RouteCtx) => handle(req, "DELETE", ctx);
