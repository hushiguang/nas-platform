import { readGalleryFile } from "@nas/media";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const file = readGalleryFile(id);
  if (!file) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(file.body), {
    headers: {
      "content-type": file.contentType,
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}
