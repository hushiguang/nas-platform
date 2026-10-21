import { NextResponse } from "next/server";
import { MediaError, uploadImage } from "@nas/media";
import { getSessionUser } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 应用卡片封面上传。改封面是管理员操作，接口沿用同一门槛。 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json({ message: "仅管理员可上传封面" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "没有选到图片" }, { status: 400 });
  }
  if (file.type && !file.type.startsWith("image/")) {
    return NextResponse.json({ message: "只能上传图片" }, { status: 400 });
  }

  try {
    const saved = await uploadImage({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimetype: file.type || "application/octet-stream",
      filename: file.name,
    });
    return NextResponse.json({ url: saved.url, thumb: saved.thumb });
  } catch (err) {
    if (err instanceof MediaError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ message: "上传失败" }, { status: 500 });
  }
}
