import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { readPhoto, TravelError } from "@/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 飞牛相册图片代理。
 *
 * 磁盘路径不外泄：前端只知道相对路径，由这里读字节。
 * 读的是挂进容器的照片目录，路径穿越在 readPhoto 内部已拦。
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const rel = new URL(req.url).searchParams.get("path") || "";
  try {
    const { body, contentType } = await readPhoto(rel);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    if (err instanceof TravelError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: "取不到这张图" }, { status: 500 });
  }
}
