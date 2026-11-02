import { NextResponse } from "next/server";
import { attachmentError, uploadShareFile } from "@/server/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ message: "没有选到文件" }, { status: 400 });
  try {
    return NextResponse.json(await uploadShareFile(token, form));
  } catch (err) {
    const { message, status } = attachmentError(err, "上传失败");
    return NextResponse.json({ message }, { status });
  }
}
