"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { ProjectCard, type ProjectCardItem } from "./card";
import { PRI_DOT } from "./pri-style";
import { ProjectSearch } from "./project-search";

export interface PriChip {
  key: string;
  label: string;
  count: number;
}

function haystackOf(item: ProjectCardItem): string {
  return [
    item.name,
    item.code ?? "",
    item.ownerName,
    item.managerName ?? "",
    item.description ?? "",
    item.phaseLabel,
    ...item.members.map((member) => member.nickname),
    ...item.phases.flatMap((phase) => phase.members.map((member) => member.name)),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * 项目列表 + 优先级 chips + 关键字搜索。
 * 关键字只在前端过滤，输入时不触发服务端渲染，避免整页骨架闪烁和输入框失焦；
 * 优先级 / 提出方 / 平台的筛选仍然走地址栏。
 */
export function ProjectFilter({
  items,
  total,
  pris,
  pri,
  src,
  plat,
}: {
  items: ProjectCardItem[];
  total: number;
  pris: PriChip[];
  pri?: string;
  src?: string;
  plat?: string;
}) {
  const [keyword, setKeyword] = useState("");

  // 空格分隔多个关键字，每个都要命中（顺序不限）
  const deferred = useDeferredValue(keyword.trim().toLowerCase());
  const filtered = useMemo(() => {
    const needles = deferred.split(/\s+/).filter(Boolean);
    if (needles.length === 0) return items;
    return items.filter((item) => {
      const haystack = haystackOf(item);
      return needles.every((needle) => haystack.includes(needle));
    });
  }, [items, deferred]);
  const live = filtered.filter((item) => item.phase === "LIVE");
  const active = filtered.filter((item) => item.phase !== "LIVE");
  const typed = keyword.trim();

  const hrefOf = (patch: { pri?: string; src?: string; plat?: string }) => {
    const params = new URLSearchParams();
    const next = { pri, src, plat, ...patch };
    if (next.pri) params.set("pri", next.pri);
    if (next.src) params.set("src", next.src);
    if (next.plat) params.set("plat", next.plat);
    const query = params.toString();
    return query ? `/?${query}` : "/";
  };

  return (
    <>
      <div className="work-filter-row">
        <ProjectSearch value={keyword} onChange={setKeyword} />
        <Link
          href={hrefOf({ pri: undefined, src: undefined, plat: undefined })}
          className={`badge${!pri && !src && !plat ? "" : " soft"}`}
          style={{ textDecoration: "none" }}
        >
          全部 {total}
        </Link>
        {pris.map((p) => (
          <Link
            key={p.key}
            href={hrefOf({ pri: pri === p.key ? undefined : p.key })}
            className={`badge${pri === p.key ? "" : " soft"}`}
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, background: PRI_DOT[p.key] }} />
            {p.label} {p.count}
          </Link>
        ))}
        {typed ? (
          <span className="muted work-filter-hit">
            「{typed}」匹配 {filtered.length} 个
          </span>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontFamily: "Source Serif 4, serif", fontSize: 22 }}>
            {typed ? `没有匹配「${typed}」的项目` : "没有符合的项目"}
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            {typed ? (
              <>
                <button
                  type="button"
                  onClick={() => setKeyword("")}
                  style={{
                    border: 0,
                    padding: 0,
                    background: "none",
                    color: "var(--coral)",
                    font: "inherit",
                    textDecoration: "underline",
                    cursor: "pointer",
                  }}
                >
                  清除搜索
                </button>{" "}
                换个关键字，或者看看别的筛选条件。
              </>
            ) : (
              <>
                <Link href={hrefOf({ pri: undefined, src: undefined, plat: undefined })}>清除筛选</Link> 看全部项目。
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          <div className="work-grid work-grid-row">
            {active.map((item) => (
              <ProjectCard key={item.id} item={item} />
            ))}
          </div>
          {live.length > 0 ? (
            <section className="section">
              <h2 className="section-title">已上线 · {live.length}</h2>
              <div className="work-grid work-grid-row">
                {live.map((item) => (
                  <ProjectCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
