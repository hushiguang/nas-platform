import { NextResponse } from "next/server";
import { serviceGuard } from "@nas/core";
import { summaryAll, summaryForUser } from "@/server";

export const dynamic = "force-dynamic";

/** 供门户首页汇总。不走登录态，只有拿着 SERVICE_TOKEN 的服务器能调。 */
export async function GET(req: Request) {
  const denied = serviceGuard(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const scopeAll = url.searchParams.get("scope") === "all";
  const userId = Number(url.searchParams.get("userId"));
  if (!scopeAll && (!Number.isInteger(userId) || userId <= 0)) {
    return NextResponse.json({ message: "缺少 userId" }, { status: 400 });
  }

  const summary = scopeAll ? await summaryAll() : await summaryForUser(userId);
  return NextResponse.json({ app: "work", ...summary });
}
