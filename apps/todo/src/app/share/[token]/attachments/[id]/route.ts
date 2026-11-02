import { NextResponse } from "next/server";
import { attachmentError, deleteShareFile, openShareFile } from "@/server/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ message: "附件不存在" }, { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  try {
    return await openShareFile(token, id, download);
  } catch (err) {
    const { message, status } = attachmentError(err, "打不开这个附件");
    return NextResponse.json({ message }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ message: "附件不存在" }, { status: 404 });
  try {
    return NextResponse.json(await deleteShareFile(token, id));
  } catch (err) {
    const { message, status } = attachmentError(err, "删除失败");
    return NextResponse.json({ message }, { status });
  }
}