import Link from "next/link";
import { requireAppAccess } from "@/auth";
import { platformOf } from "@/lib/platform";
import { listProjects } from "@/server";
import { ImportButton } from "./import-button";
import { ProjectFilter } from "./project-filter";
import { PRI_ORDER } from "./pri-style";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ pri?: string; src?: string; plat?: string }>;
}) {
  const { user, access } = await requireAppAccess();
  const { pri, src, plat } = await searchParams;
  const all = await listProjects(access, user.id);
  const items = all
    .filter(
      (item) =>
        (!pri || item.priority === pri) &&
        (!src || (item.code || "未分组") === src) &&
        (!plat || platformOf(item.name) === plat),
    )
    // 列表在前端做关键字过滤，节点 / 问题明细不必发给浏览器
    .map(({ nodes, issues, draft, ...card }) => card);

  const priStats = PRI_ORDER.map((key) => ({
    key,
    label: all.find((i) => i.priority === key)?.priorityLabel ?? key,
    count: all.filter((i) => i.priority === key).length,
  }));
  const srcMap = new Map<string, { count: number; delayed: number }>();
  for (const item of all) {
    const code = item.code || "未分组";
    const cur = srcMap.get(code) ?? { count: 0, delayed: 0 };
    cur.count += 1;
    if (item.delayed > 0) cur.delayed += 1;
    srcMap.set(code, cur);
  }
  const srcStats = [...srcMap.entries()]
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.count - a.count);

  const platMap = new Map<string, { count: number; delayed: number }>();
  for (const item of all) {
    const key = platformOf(item.name);
    const cur = platMap.get(key) ?? { count: 0, delayed: 0 };
    cur.count += 1;
    if (item.delayed > 0) cur.delayed += 1;
    platMap.set(key, cur);
  }
  const platformStats = [...platMap.entries()]
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.count - a.count);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">阶段、进度与人员</span>
          <h1>项目管理</h1>
        </div>
        <div className="work-actions">
          <ImportButton />
          <a className="btn ghost" href="/api/export" download>
            导出 Excel
          </a>
          <Link href="/new" className="btn">
            新建项目
          </Link>
        </div>
      </div>

      <div className="work-main">
        <ProjectFilter
          items={items}
          total={all.length}
          pris={priStats}
          sources={srcStats}
          platforms={platformStats}
          pri={pri}
          src={src}
          plat={plat}
        />
      </div>
    </div>
  );
}
