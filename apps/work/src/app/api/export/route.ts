import type { NextRequest } from "next/server";
import { requireAppAccess } from "@/auth";
import { listProjects } from "@/server";
import { exportProjectsCsv, exportProjectsXlsx } from "@/server/export";

export const dynamic = "force-dynamic";

/** 导出当前用户可见的项目数据。?format=csv 导出 CSV，默认 xlsx。 */
export async function GET(request: NextRequest) {
  const { user, access } = await requireAppAccess();
  const items = await listProjects(access, user.id);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const format = request.nextUrl.searchParams.get("format");

  if (format === "csv") {
    const filename = `项目导出-${stamp}.csv`;
    return new Response(exportProjectsCsv(items), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="work-projects-${stamp}.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  }

  const filename = `项目导出-${stamp}.xlsx`;
  const buffer = await exportProjectsXlsx(items);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="work-projects-${stamp}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
