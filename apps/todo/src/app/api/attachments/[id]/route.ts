import { NextResponse } from "next/server";
import { attachmentError, deleteTodoFile, openTodoFile } from "@/server/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fileId(raw: string): number {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = fileId((await params).id);
  if (!id) return NextResponse.json({ message: "附件不存在" }, { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  try {
    return await openTodoFile(id, download);
  } catch (err) {
    const { message, status } = attachmentError(err, "打不开这个附件");
    return NextResponse.json({ message }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = fileId((await params).id);
  if (!id) return NextResponse.json({ message: "附件不存在" }, { status: 404 });
  try {
    return NextResponse.json(await deleteTodoFile(id));
  } catch (err) {
    const { message, status } = attachmentError(err, "删除失败");
    return NextResponse.json({ message }, { status });
  }
}
