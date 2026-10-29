import type { NextRequest } from "next/server";
import { requireAppAccess } from "@/auth";
import { exportWeeklyReportXlsx, renderWeeklyReportMarkdown, weeklyReport } from "@/server/report";

export const dynamic = "force-dynamic";

/** 导出当前用户这一周能看到的周报。?format=md 导出 Markdown，默认 xlsx。 */
export async function GET(request: NextRequest) {
  const { user, access } = await requireAppAccess();
  const week = request.nextUrl.searchParams.get("week") ?? undefined;
  const report = await weeklyReport(access, user.id, week);
  const format = request.nextUrl.searchParams.get("format");
  const ext = format === "md" ? "md" : "xlsx";
  const filename = `${report.title}.${ext}`;
  const fallback = `weekly-report.${ext}`;
  const disposition = `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

  if (format === "md") {
    return new Response(renderWeeklyReportMarkdown(report), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": disposition,
        "Cache-Control": "no-store",
      },
    });
  }

  const buffer = await exportWeeklyReportXlsx(report);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
    },
  });
}
