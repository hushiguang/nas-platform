import { NextResponse } from "next/server";
import { prisma } from "@nas/db";
import { allowHostsDiagnostic, imageHostConfig } from "@nas/media";

/**
 * 健康检查：容器编排与人工排查都用它。顺带确认数据库可达，
 * 不然「进程活着但库连不上」这种状态看不出来。
 *
 * 同时回源白名单的当前状态。图床没配好时，现象是全站图片裂开，
 * 但服务端只抛一句「这个地址不允许」——到底是配置漏了还是某个
 * 主机不在名单里，从外面完全看不出区别。放在免登录的健康检查里，
 * 就能直接 curl 出到底是哪一种。
 *
 * 只回主机名与布尔状态，不回 token、也不回完整上传地址。
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ ok: false, app: "portal", db: false }, { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    app: "portal",
    db: true,
    imageHost: {
      // url 与 token 都配了才算数，缺一个上传接口就返回 501
      configured: Boolean(imageHostConfig.token && imageHostConfig.url),
      allowHosts: allowHostsDiagnostic(),
    },
  });
}