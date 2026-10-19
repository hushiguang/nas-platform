import { NextResponse } from "next/server";
import { getPlatformAccess } from "@nas/core";
import { MediaError, uploadImage } from "@nas/media";
import { getSessionUser } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 背景图上传。和账单走同一套图床，token 只留在服务端。 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const access = await getPlatformAccess(user, "anniversary");
  if (!access) return NextResponse.json({ message: "没有权限" }, { status: 404 });

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
