import { serviceGuard } from "@nas/core";
import { MediaError } from "@nas/media";
import { migrateLocalImages } from "@/server/images";

export const dynamic = "force-dynamic";

/**
 * 把历史遗留的 local: 图片迁移到图床（服务间调用，不走登录态）。
 *
 * 用法（在 NAS 上）：
 *   docker compose exec todo node -e "fetch('http://localhost:3000/api/internal/migrate-images',{method:'POST',headers:{'x-service-token':process.env.SERVICE_TOKEN}}).then(r=>r.text()).then(console.log)"
 */
export async function POST(req: Request) {
  const denied = serviceGuard(req);
  if (denied) return denied;

  try {
    return Response.json(await migrateLocalImages());
  } catch (err) {
    if (err instanceof MediaError) {
      return Response.json({ message: err.message }, { status: err.status });
    }
    console.error("[todo] local 图迁移失败：", err);
    return Response.json({ message: "迁移失败，看容器日志" }, { status: 500 });
  }
}
