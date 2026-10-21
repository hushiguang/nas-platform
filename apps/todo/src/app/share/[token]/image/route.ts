import { NextResponse } from "next/server";
import { prisma } from "@nas/db";
import { listByShareToken } from "@nas/todo";
import { MediaError } from "@nas/media";
import { readImage } from "@/server/images";

/**
 * 分享页的图片代理 —— 免登录。
 *
 * 不能直接复用 /api/image：那条路由在登录门槛后面，分享页没有会话。
 * 这里用 URL 里的 token 当凭证，并且只放行「这个清单里待办自己引用的图」，
 * 就算 token 泄露也只能看到清单内的图，拿不到别的文件。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const list = await listByShareToken(token);
  if (!list) return NextResponse.json({ message: "链接已失效" }, { status: 404 });

  const u = new URL(req.url).searchParams.get("u") || "";
  if (!u) return NextResponse.json({ message: "缺少图片地址" }, { status: 400 });

  const rows = await prisma.todo.findMany({
    where: { listId: list.id, source: "MANUAL" },
    select: { images: true },
  });
  const allowed = rows.some(
    (row) => Array.isArray(row.images) && row.images.some((value) => value === u),
  );
  if (!allowed) return NextResponse.json({ message: "图片不存在" }, { status: 404 });

  try {
    const { body, contentType } = await readImage(u);
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": contentType,
        // 文件名带随机串、内容不变，可以放心长缓存
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    const status = err instanceof MediaError ? err.status : 500;
    const message = err instanceof Error ? err.message : "读取失败";
    return NextResponse.json({ message }, { status });
  }
}
