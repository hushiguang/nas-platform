"use client";

import Link from "next/link";
import { useState } from "react";
import { PRI_DOT } from "./pri-style";

export interface PriStat {
  key: string;
  label: string;
  count: number;
}

export interface SourceStat {
  code: string;
  count: number;
  delayed: number;
}

/** 右侧浮动统计栏：优先级汇总 + 提出方汇总 + 平台汇总，点击可过滤 */
export function WorkStatsSide({
  basePath,
  pris,
  sources,
  platforms,
  activePri,
  activeSource,
  activePlatform,
  extra,
}: {
  basePath: string;
  pris: PriStat[];
  sources: SourceStat[];
  platforms?: SourceStat[];
  activePri?: string;
  activeSource?: string;
  activePlatform?: string;
  extra?: React.ReactNode;
}) {
  const link = (pri?: string, source?: string, plat?: string) => {
    const q = new URLSearchParams();
    if (pri) q.set("pri", pri);
    if (source) q.set("src", source);
    if (plat) q.set("plat", plat);
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const filtering = activePri || activeSource || activePlatform;
  return (
    <aside className="work-side">
      <div className="card work-side-card">
        <div className="work-side-title">优先级</div>
        {pris.map((p) => (
          <Link
            key={p.key}
            className="work-side-row"
            href={link(activePri === p.key ? undefined : p.key, activeSource, activePlatform)}
            style={activePri === p.key ? { fontWeight: 700 } : undefined}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, background: PRI_DOT[p.key] ?? "var(--muted)" }} />
            {p.label}
            <b>{p.count}</b>
          </Link>
        ))}
        {(platforms ?? []).length > 0 ? (
          <>
            <div className="work-side-title" style={{ marginTop: 12 }}>
              平台汇总
            </div>
            {(platforms ?? []).map((s) => (
              <Link
                key={s.code}
                className="work-side-row"
                href={link(activePri, activeSource, activePlatform === s.code ? undefined : s.code)}
                style={activePlatform === s.code ? { fontWeight: 700 } : undefined}
              >
                {s.code}
                {s.delayed > 0 ? <span className="badge warn">{s.delayed} 延期</span> : null}
                <b>{s.count}</b>
              </Link>
            ))}
          </>
        ) : null}
        <div className="work-side-title" style={{ marginTop: 12 }}>
          提出方
        </div>
        {sources.map((s) => (
          <Link
            key={s.code}
            className="work-side-row"
            href={link(activePri, activeSource === s.code ? undefined : s.code, activePlatform)}
            style={activeSource === s.code ? { fontWeight: 700 } : undefined}
          >
            {s.code}
            {s.delayed > 0 ? <span className="badge warn">{s.delayed} 延期</span> : null}
            <b>{s.count}</b>
          </Link>
        ))}
        {filtering ? (
          <Link className="work-side-row muted" href={basePath} style={{ fontSize: 12 }}>
            清除筛选
          </Link>
        ) : null}
      </div>
      {extra}
    </aside>
  );
}

/** 人员问题 TAG：冲突 / 待修多 / 无排期 / 快上线 */
export function PersonTags({ tags }: { tags: string[] }) {
  const [open, setOpen] = useState(false);
  if (tags.length === 0) return null;
  const shown = open ? tags : tags.slice(0, 3);
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {shown.map((t) => (
        <span key={t} className="badge warn">
          {t}
        </span>
      ))}
      {tags.length > 3 ? (
        <button
          type="button"
          className="badge soft"
          style={{ cursor: "pointer", border: "none" }}
          onClick={() => setOpen(!open)}
        >
          {open ? "收起" : `+${tags.length - 3}`}
        </button>
      ) : null}
    </span>
  );
}
