import { NextResponse } from "next/server";
import { MediaError } from "@nas/media";
import { readImage } from "@/server/images";

// 图片代理：本地兜底图与图床图都从这里出。
// 必须是 Node runtime —— @nas/media 用 node:http/https 才能对自签证书关校验。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u") || "";
  try {
    const { body, contentType } = await readImage(u);
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": contentType,
        // 文件名带随机串、内容不变，可以放心长缓存
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    const status = err instanceof MediaError ? err.status : 500;
    const message = err instanceof Error ? err.message : "读取失败";
    return NextResponse.json({ message }, { status });
  }
}
