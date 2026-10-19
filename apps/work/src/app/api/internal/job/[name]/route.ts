import { NextResponse } from "next/server";
import { serviceGuard } from "@nas/core";
import { runWorkDigest, syncPhaseTodos } from "@/server";

export const dynamic = "force-dynamic";

/** worker 到点叫醒：收风险预报/待修问题待办，或推早会/晚报。重复调用不会多出记录。 */
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const denied = serviceGuard(req);
  if (denied) return denied;

  const { name } = await params;
  // 每日报告前置：只收待办，不发消息（汇报由 worker 统一发）
  if (name === "sync-todos") {
    const count = await syncPhaseTodos();
    return NextResponse.json({ ok: true, count });
  }
  // 保留手动触发早晚报的入口（报告已并入 worker 的 digest 任务）
  if (name === "digest" || name === "work-digest") {
    const result = await runWorkDigest();
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ message: `未知任务：${name}` }, { status: 404 });
}

