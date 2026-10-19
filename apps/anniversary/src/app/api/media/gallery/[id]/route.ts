import { NextResponse } from "next/server";
import { readGalleryFile } from "@nas/media";

export const runtime = "nodejs";

/** 内置背景图。id 只能命中图库目录，读不到就 404。 */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const file = readGalleryFile(id);
  if (!file) return NextResponse.json({ message: "没有这张图" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
