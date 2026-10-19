import { NextResponse } from "next/server";
import { serviceGuard } from "@nas/core";
import { travelSummary } from "@/server";

export const dynamic = "force-dynamic";

/** 门户首页汇总用。只有持 SERVICE_TOKEN 的服务器能调，不走登录态。 */
export async function GET(req: Request) {
  const denied = serviceGuard(req);
  if (denied) return denied;

  const userId = Number(new URL(req.url).searchParams.get("userId"));
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ message: "缺少 userId" }, { status: 400 });
  }

  const summary = await travelSummary(userId);
  return NextResponse.json({ app: "travel", ...summary, count: summary.tripCount });
}
