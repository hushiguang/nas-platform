import { NextResponse } from "next/server";
import { fetchImage, imageHostConfig, isAllowedImageUrl, MediaError } from "@nas/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 粘贴上传的照片存在图床，展示同样走代理，避免自签证书让浏览器加载失败。 */
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("u") || "";
  if (!url) return NextResponse.json({ message: "缺少地址" }, { status: 400 });
  const [allowed, reason] = isAllowedImageUrl(url);
  if (!allowed) return NextResponse.json({ message: reason ?? "这个地址不允许" }, { status: 400 });

  try {
    const image = await fetchImage(url);
    return new NextResponse(new Uint8Array(image.body), {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": `public, max-age=${imageHostConfig.cacheTtlSeconds}`,
      },
    });
  } catch (err) {
    if (err instanceof MediaError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: "取不到这张图" }, { status: 502 });
  }
}
