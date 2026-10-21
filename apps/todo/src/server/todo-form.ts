/**
 * 待办表单的字段解析。
 *
 * 登录态（app/actions.ts）和免登录分享页（share/actions.ts）共用这一套口径，
 * 避免两边保存出来的字段（时间格式、提醒规则、图片）不一致。
 */
import type { RemindRule } from "@nas/todo";
import { saveImage } from "@/server/images";

/** 表单里的空串一律当"没填"，避免把 "" 写进时间/数字字段 */
export function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function optionalText(form: FormData, key: string): string | null {
  const value = text(form, key);
  return value || null;
}

/**
 * 到期时间：日期必填才解析，时间缺省 08:00。
 * 一律按本地时区（Asia/Shanghai）拼，再交给 Date 解析 —— 全项目时间口径一致。
 */
export function parseDue(form: FormData): Date | null {
  const date = text(form, "dueDate");
  if (!date) return null;
  const time = text(form, "dueTime") || "08:00";
  const parsed = new Date(`${date}T${time}:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * 提醒规则：界面给的是「提前 N 天 + 时点」一组多选，这里拼成引擎认识的数组。
 * 一个都没勾 = 不提醒（remindRules 为空数组，引擎不会派发）。
 */
export function parseRemindRules(form: FormData): RemindRule[] {
  const offsets = form.getAll("remindOffsets").map((v) => Number(v));
  const time = text(form, "remindTime") || "09:00";
  return offsets
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((offsetDays) => ({ offsetDays, time }));
}

/** 从表单里取已有图片地址（编辑时保留的） */
export function parseImages(form: FormData): string[] {
  return form
    .getAll("images")
    .map((v) => String(v))
    .filter((v) => v.length > 0);
}

/** 上传表单里的图片文件，返回存好的地址列表 */
export async function uploadFromForm(form: FormData): Promise<string[]> {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const urls: string[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    urls.push(await saveImage({ buffer, mimetype: file.type, filename: file.name }));
  }
  return urls;
}
