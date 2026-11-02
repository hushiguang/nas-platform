import { NextResponse } from "next/server";
import { attachmentError, uploadProjectFile } from "@/server/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ message: "没有选到文件" }, { status: 400 });
  try {
    return NextResponse.json(await uploadProjectFile(form));
  } catch (err) {
    const { message, status } = attachmentError(err, "上传失败");
    return NextResponse.json({ message }, { status });
  }
}
