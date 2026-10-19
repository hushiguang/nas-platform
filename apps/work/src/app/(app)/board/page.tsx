import Link from "next/link";
import { requireAppAccess } from "@/auth";
import { listProjects, listPersonSummary } from "@/server";

export const dynamic = "force-dynamic";

const PHASE_BG: Record<string, string> = {
  商务阶段: "#dbe7fb",
  研发节点: "#d7ecff",
  SIT测试阶段: "#e6dcfa",
  UAT阶段: "#fdeacc",
  准备上线: "#d7f0e4",
  已上线: "#d9f2e3",
};
// 筛选 chips：按 kind 匹配（label 是全称如“UAT阶段”，简称精确匹配对不上）
const PHASE_FILTERS = [
  { kind: "BUSINESS", short: "商务" },
  { kind: "DEV", short: "研发" },
  { kind: "SIT", short: "SIT" },
  { kind: "UAT", short: "UAT" },
  { kind: "PRELAUNCH", short: "上线准备" },
  { kind: "LIVE", short: "已上线" },
] as const;

function toDay(s: string): string {
  return s.slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  return Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400000);
}

function monthLabel(iso: string): string {
  const [y, m] = iso.split("-");
  return `${y}年${Number(m)}月`;
}

function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "/board";
}

interface Bar {
  key: string;
  kind?: string;
  label: string;
  title: string;
  from: string;
  to: string;
  bg: string;
  members?: string[];
  devCount?: number;
  qaCount?: number;
  conflict?: boolean;
}

interface Row {
  key: string;
  name: string;
  sub: string;
  bars: Bar[];
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; mode?: string; date?: string; phase?: string }>;
}) {
  const { user, access } = await requireAppAccess();
  const sp = await searchParams;
  const view = sp.view === "person" ? "person" : "project";
  const mode = sp.mode === "week" ? "week" : "month";
  const PHASES = ["商务", "研发", "SIT", "UAT", "上线准备", "已上线"];
  const activePhase = view === "project" && sp.phase ? sp.phase : undefined;
  const today = new Date().toISOString().slice(0, 10);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? (sp.date as string) : today;

  let start: string;
  let end: string;
  if (mode === "week") {
    const dow = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7;
    start = addDays(anchor, -dow);
    end = addDays(start, 6);
  } else {
    start = anchor.slice(0, 7) + "-01";
    const next = new Date(`${start}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    end = addDays(next.toISOString().slice(0, 10), -1);
  }
  const nDays = diffDays(end, start) + 1;
  const days: string[] = Array.from({ length: nDays }, (_, i) => addDays(start, i));
  const step = mode === "week" ? 7 : 31;
  const prev = addDays(start, -step);
  const next = addDays(start, step);

  let rows: Row[] = [];
  if (view === "project") {
    const items = await listProjects(access, user.id);
    rows = items
      .filter((i) => i.phase !== "LIVE")
      .map((item) => {
        const bars: Bar[] = item.phases
          .filter((p) => p.enabled && p.startDate && p.endDate)
          .map((p) => {
            const names = (p.members ?? []).map((m) => m.name).filter(Boolean);
            const devs = (p.members ?? []).filter((m) => /研发|开发|前端|后端/.test(m.role || "")).map((m) => m.name);
            const qas = (p.members ?? []).filter((m) => /测试/.test(m.role || "")).map((m) => m.name);
            const who = names.length > 0 ? `｜${names.slice(0, 4).join("、")}${names.length > 4 ? `等${names.length}人` : ""}` : "｜未排人";
            return {
              key: String(p.id),
              kind: p.kind,
              label: p.label,
              title: `${item.name} · ${p.label} ${p.startDate}～${p.endDate}${who}`,
              from: toDay(p.startDate),
              to: toDay(p.endDate),
              bg: PHASE_BG[p.label] ?? "#dbe7fb",
              members: names,
              devCount: devs.length,
              qaCount: qas.length,
            };
          });
        if (item.launchDate) {
          bars.push({
            key: "launch",
            label: "上线",
            title: `${item.name} · 计划上线 ${item.launchDate}`,
            from: toDay(item.launchDate),
            to: toDay(item.launchDate),
            bg: "#ffd9d9",
          });
        }
        const devTotal = new Set(
          item.phases.flatMap((p) => (p.members ?? []).filter((m) => /研发|开发|前端|后端/.test(m.role || "")).map((m) => m.name)),
        ).size;
        const qaTotal = new Set(
          item.phases.flatMap((p) => (p.members ?? []).filter((m) => /测试/.test(m.role || "")).map((m) => m.name)),
        ).size;
        const staff = devTotal + qaTotal > 0 ? ` · 研发${devTotal} 测试${qaTotal}` : "";
        return { key: String(item.id), name: item.name, sub: `${item.ownerName} · ${item.phaseLabel}${staff}`, bars };
      });
  } else {
    const people = await listPersonSummary(access, user);
    rows = people.map((person) => {
      const isDev = person.roles.some((r) => /研发|开发|前端|后端/.test(r));
      const isQa = person.roles.some((r) => /测试/.test(r));
      return {
        key: person.key,
        name: `${person.conflict ? "⚠ " : ""}${person.name}`,
        sub: [person.roles.join(" / ") || (person.external ? "外部" : ""), person.conflict ? "时间冲突" : ""].filter(Boolean).join(" · "),
        bars: person.projects
          .filter((p) => p.from && p.to)
          .map((p) => ({
            key: String(p.projectId),
            label: p.projectName,
            title: `${person.name} · ${p.projectName} ${p.from}～${p.to}${p.phases ? `（${p.phases}）` : ""}`,
            from: p.from,
            to: p.to,
            bg: p.conflictWith.length > 0 ? "#ffd9d9" : isQa && !isDev ? "#e6dcfa" : isDev ? "#d7ecff" : "#dbe7fb",
            conflict: p.conflictWith.length > 0,
          })),
      };
    });
  }

  const filteredRows =
    view === "project" && activePhase
      ? rows.filter((row) =>
          activePhase === "LAUNCH"
            ? row.bars.some((b) => b.key === "launch")
            : row.bars.some((b) => b.kind === activePhase),
        )
      : rows;
  const placed = filteredRows.map((row) => ({
    ...row,
    bars: row.bars
      .map((b) => {
        const from = b.from < start ? start : b.from;
        const to = b.to > end ? end : b.to;
        if (from > to) return null;
        const left = (diffDays(from, start) / nDays) * 100;
        const width = ((diffDays(to, from) + 1) / nDays) * 100;
        return { ...b, left, width };
      })
      .filter((b) => b !== null),
  }));
  const showToday = today >= start && today <= end;
  const todayLeft = ((diffDays(today, start) + 0.5) / nDays) * 100;
  const minTrack = nDays * 48;

  const tab = (active: boolean) => ({
    textDecoration: "none" as const,
    fontSize: 13,
    padding: "4px 12px",
    borderRadius: 999,
    background: active ? "var(--ink)" : "transparent",
    color: active ? "var(--paper)" : "inherit",
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">时间排期</span>
          <h1>日历看板</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href={qs({ view, mode, date: prev })} className="btn" aria-label="上一段">
            〈
          </Link>
          <Link href={qs({ view, mode })} className="btn">
            今天
          </Link>
          <Link href={qs({ view, mode, date: next })} className="btn" aria-label="下一段">
            〉
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{monthLabel(start)}</span>
        <span style={{ display: "inline-flex", gap: 4 }}>
          <Link href={qs({ view, mode: "week", date: anchor })} style={tab(mode === "week")}>
            周
          </Link>
          <Link href={qs({ view, mode: "month", date: anchor })} style={tab(mode === "month")}>
            月
          </Link>
        </span>
        <span style={{ display: "inline-flex", gap: 4 }}>
          <Link href={qs({ view: "project", mode, date: anchor })} style={tab(view === "project")}>
            项目计划
          </Link>
          <Link href={qs({ view: "person", mode, date: anchor })} style={tab(view === "person")}>
            人员安排
          </Link>
        </span>
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
          {start} ～ {end}
        </span>
      </div>

      {view === "project" ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          {[...PHASE_FILTERS, { kind: "LAUNCH", short: "上线" } as const].map(({ kind, short: k }) => {
            const active = activePhase === kind;
            const bg = kind === "LAUNCH" ? "#ffd9d9" : (PHASE_BG[{ BUSINESS: "商务阶段", DEV: "研发节点", SIT: "SIT测试阶段", UAT: "UAT阶段", PRELAUNCH: "准备上线", LIVE: "已上线" }[kind as string] ?? ""] ?? "#dbe7fb");
            return (
              <Link
                key={k}
                href={
                  active
                    ? qs({ view, mode, date: anchor })
                    : qs({ view, mode, date: anchor, phase: k })
                }
                title={active ? `取消${k}筛选` : `只看${k}阶段的项目`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  padding: "4px 12px",
                  borderRadius: 999,
                  textDecoration: "none",
                  border: active ? "2px solid var(--ink)" : "1px solid var(--line)",
                  background: active ? bg : "var(--paper)",
                  color: "inherit",
                  fontWeight: active ? 700 : 400,
                }}
              >
                <span style={{ width: 20, height: 11, borderRadius: 4, background: bg, border: "1px solid rgba(0,0,0,0.08)" }} />
                {k}
              </Link>
            );
          })}
          {activePhase ? (
            <Link href={qs({ view, mode, date: anchor })} style={{ fontSize: 12 }}>
              ✕ 清除阶段筛选
            </Link>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>👨‍💻=研发人数 🧪=测试人数；悬停条块看完整名单</span>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12, fontSize: 12 }} className="muted">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 20, height: 11, borderRadius: 4, background: "#d7ecff" }} />研发</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 20, height: 11, borderRadius: 4, background: "#e6dcfa" }} />测试</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 20, height: 11, borderRadius: 4, background: "#ffd9d9", border: "1px solid var(--coral)" }} />时间冲突</span>
        </div>
      )}

      <div className="gantt-scroll">
        <div style={{ minWidth: 200 + minTrack }}>
          <div className="gantt-head">
            <div className="gantt-label muted" style={{ position: "sticky", left: 0, background: "var(--paper)", zIndex: 3 }}>
              {view === "project" ? `项目 · ${placed.length}` : `人员 · ${placed.length}`}
            </div>
            <div className="gantt-track" style={{ display: "flex" }}>
              {days.map((d) => {
                const dt = new Date(`${d}T00:00:00Z`);
                const dow = dt.getUTCDay();
                const weekend = dow === 0 || dow === 6;
                const week = ["日", "一", "二", "三", "四", "五", "六"][dow];
                return (
                  <div
                    key={d}
                    className={`gantt-day${weekend ? " weekend" : ""}`}
                    style={{
                      flex: "1 0 0",
                      padding: "8px 4px",
                      fontSize: 11,
                      textAlign: "center",
                      color: d === today ? "var(--coral)" : undefined,
                      fontWeight: d === today ? 700 : undefined,
                    }}
                  >
                    {Number(d.slice(8))}{week}
                  </div>
                );
              })}
            </div>
          </div>
          {placed.map((row) => (
            <div className="gantt-row" key={row.key}>
              <div className="gantt-label" style={{ position: "sticky", left: 0, background: "var(--paper)", zIndex: 3, whiteSpace: "normal", overflow: "visible" }} title={row.name}>
                {view === "project" ? (
                  <Link href={`/p/${row.key}`} style={{ textDecoration: "none", color: "inherit" }}>
                    <div style={{ whiteSpace: "normal", wordBreak: "break-all", lineHeight: 1.4, fontWeight: 600, cursor: "pointer" }}>
                      {row.name}
                    </div>
                  </Link>
                ) : (
                  <div style={{ whiteSpace: "normal", wordBreak: "break-all", lineHeight: 1.4, fontWeight: 600 }}>
                    {row.name}
                  </div>
                )}
                {row.sub ? (
                  <div className="muted" style={{ fontSize: 11, whiteSpace: "normal", wordBreak: "break-all", lineHeight: 1.4 }}>
                    {row.sub}
                  </div>
                ) : null}
              </div>
              <div className="gantt-track" style={{ minHeight: 38 }}>
                {showToday ? <div className="gantt-today" style={{ left: `${todayLeft}%` }} /> : null}
                {row.bars.length === 0 ? (
                  <span className="muted" style={{ fontSize: 11, position: "absolute", top: 10, left: 8 }}>
                    未排期
                  </span>
                ) : null}
                {row.bars.map((b) => (
                  <div
                    key={b.key}
                    className="gantt-bar"
                    title={b.title}
                    style={{
                      left: `${b.left}%`,
                      width: `${b.width}%`,
                      background: b.bg,
                      color: "#33415c",
                      border: b.conflict
                        ? "1px solid var(--coral)"
                        : activePhase && (activePhase === "LAUNCH" ? b.key !== "launch" : b.kind !== activePhase)
                          ? "1px dashed rgba(0,0,0,0.15)"
                          : undefined,
                      opacity: activePhase && (activePhase === "LAUNCH" ? b.key !== "launch" : b.kind !== activePhase) ? 0.45 : 1,
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontWeight: 700, flex: "none" }}>{b.label}</span>
                    {b.members && b.members.length > 0 ? (
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                        👨‍💻{b.devCount ?? 0} 🧪{b.qaCount ?? 0} {b.members.slice(0, 3).join("、")}
                        {b.members.length > 3 ? `等${b.members.length}人` : ""}
                      </span>
                    ) : b.members ? (
                      <span style={{ fontSize: 11, opacity: 0.7 }}>未排人</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
