import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { browse, TravelError } from "@/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 浏览飞牛相册目录。目录即相册，`path` 为相对照片根目录的路径。 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const rel = new URL(req.url).searchParams.get("path") || "";
  try {
    return NextResponse.json(await browse(rel));
  } catch (err) {
    if (err instanceof TravelError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: "读取失败" }, { status: 500 });
  }
}
