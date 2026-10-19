import { recordAudit } from "@nas/core";
import type { NextRequest } from "next/server";
import { requireAppAccess } from "@/auth";
import { importProjects, WorkError } from "@/server";

export const dynamic = "force-dynamic";

/** 上传导出模板填好的 xlsx，导入项目、阶段日期、阶段人员和未解决问题。 */
export async function POST(request: NextRequest) {
  const { user, access } = await requireAppAccess();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ ok: false, message: "先选个文件" }, { status: 400 });
  }
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
    return Response.json({ ok: false, message: "只认 xlsx 文件" }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const result = await importProjects(access, user, buffer);
    await recordAudit({
      app: "work",
      action: "import",
      target: "work_project",
      summary: `导入项目：新增 ${result.created}，更新 ${result.updated}，失败 ${result.errors.length}`,
      actorId: user.id,
      actorName: user.nickname,
    });
    return Response.json({ ok: true, result });
  } catch (err) {
    if (!(err instanceof WorkError)) console.error("[work] import failed", err);
    const message = err instanceof WorkError ? err.message : "导入失败";
    return Response.json({ ok: false, message }, { status: 400 });
  }
}
