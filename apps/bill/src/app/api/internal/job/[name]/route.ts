import { NextResponse } from "next/server";
import { serviceGuard } from "@nas/core";
import { runDueRules } from "@/server";
import { syncAllBillFollowTodos } from "@/server/follow";

export const dynamic = "force-dynamic";

/**
 * 本应用自己的定时任务入口。
 *
 * worker 不直接引账单的代码（那样两个部署单元又焊在一起了），
 * 而是按 cron 到点拿服务令牌调这个接口。账单应用因此可以独立升级。
 *
 * 幂等由服务层保证：定期入账靠 (ownerId, source, externalId) 唯一键，
 * externalId = r{规则id}:{日期}，重复调用只会跳过。
 */
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const denied = serviceGuard(req);
  if (denied) return denied;

  const { name } = await params;

  if (name === "recurring") {
    const result = await runDueRules();
    return NextResponse.json({ ok: true, ...result });
  }

  if (name === "generate-todos") {
    const count = await syncAllBillFollowTodos();
    return NextResponse.json({ ok: true, count });
  }

  return NextResponse.json({ message: `未知任务：${name}` }, { status: 404 });
}
