import { NextResponse } from "next/server";
import { serviceGuard } from "@nas/core";
import { syncReminderTodos } from "@/server";

export const dynamic = "force-dynamic";

/** worker 到点叫醒：把临近纪念日收成待办。重复调用不会多出记录。 */
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const denied = serviceGuard(req);
  if (denied) return denied;

  const { name } = await params;
  if (name === "generate-todos") {
    const count = await syncReminderTodos();
    return NextResponse.json({ ok: true, count });
  }

  return NextResponse.json({ message: `未知任务：${name}` }, { status: 404 });
}
