import { NextResponse } from "next/server";
import { fetchImage, imageHostConfig, isAllowedImageUrl, MediaError } from "@nas/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 图床是自签证书，浏览器直连会失败，展示统一走这个代理。 */
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("u") || "";
  if (!url) return NextResponse.json({ message: "缺少地址" }, { status: 400 });
  if (!isAllowedImageUrl(url)) return NextResponse.json({ message: "这个地址不允许" }, { status: 400 });

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
