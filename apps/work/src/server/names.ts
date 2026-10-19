import { WorkError } from "./errors";

/**
 * 手填的人员名单。逗号、顿号、分号、空格、换行都当分隔符，去重去空，单个名字最长 20。
 * 参建的人大多没有系统账号，只能靠名字认。
 */
export function parseNames(form: FormData, key: string, max = 200): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const raw of form.getAll(key)) {
    for (const piece of String(raw).split(/[,，、;；\s]+/)) {
      const name = piece.trim();
      if (!name) continue;
      if (name.length > 20) throw new WorkError("名字太长了");
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  if (names.length > max) throw new WorkError("人数太多了");
  return names;
}