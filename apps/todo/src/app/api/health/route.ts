import { NextResponse } from "next/server";
import { prisma } from "@nas/db";

// 健康检查：容器编排与人工排查都用它。顺带确认数据库可达，
// 不然「进程活着但库连不上」这种状态看不出来。
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, app: "todo" });
  } catch {
    return NextResponse.json({ ok: false, app: "todo" }, { status: 503 });
  }
}
