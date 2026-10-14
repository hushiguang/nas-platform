import { NextRequest, NextResponse } from "next/server";
import { runJob } from "@/jobs";

// 手动触发 / 补跑入口：worker 是主通道，这里用于排查与补跑。
// 用 CRON_SECRET 做密钥校验（middleware 已放行 /api/cron）。
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ job: string }> },
) {
  const secret =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { job } = await params;
  const ok = await runJob(job);
  if (!ok) {
    return NextResponse.json({ error: `unknown job: ${job}` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, job, ranAt: new Date().toISOString() });
}
