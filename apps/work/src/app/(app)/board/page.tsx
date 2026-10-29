import Link from "next/link";
import { requireAppAccess } from "@/auth";
import { listProjects, listPersonSummary } from "@/server";
import { GanttBar, type BarTip } from "./gantt-bar";
import { ScrollToDate } from "./scroll-to";

export const dynamic = "force-dynamic";

const PHASE_BG: Record<string, string> = {
  商务阶段: "#dbe7fb",
  项目准备阶段: "#f3e8d8",
  研发节点: "#d7ecff",
  SIT测试阶段: "#e6dcfa",
  UAT阶段: "#fdeacc",
  准备上线: "#d7f0e4",
};

/** 人员视图按项目上色：同一个项目永远同一个颜色，方便一眼看出哪几段是同一个项目 */
const PROJECT_COLORS = [
  { bg: "#dbeafe", fg: "#1d3a72", line: "#a9c6f5" },
  { bg: "#dcfce7", fg: "#15563a", line: "#a5e8bb" },
  { bg: "#fef3c7", fg: "#7a430e", line: "#f3d489" },
  { bg: "#fae8ff", fg: "#701a75", line: "#eab6f5" },
  { bg: "#e0f2fe", fg: "#0c4a6e", line: "#a5dcf5" },
  { bg: "#e0e7ff", fg: "#312e81", line: "#b9c2f7" },
  { bg: "#ede9fe", fg: "#4c1d95", line: "#c9bdf7" },
  { bg: "#d1fae5", fg: "#065f46", line: "#98e9c7" },
  { bg: "#ffedd5", fg: "#7c2d12", line: "#fbcb9c" },
  { bg: "#e2e8f0", fg: "#1e293b", line: "#c3cdda" },
  { bg: "#fef9c3", fg: "#713f12", line: "#f2e18a" },
  { bg: "#cffafe", fg: "#155e75", line: "#9fe3ef" },
];

function projectColor(projectId: number) {
  if (!Number.isFinite(projectId)) return PROJECT_COLORS[9];
  return PROJECT_COLORS[Math.abs(projectId) % PROJECT_COLORS.length];
}

// 筛选 chips：按 kind 匹配（label 是全称如“UAT阶段”，简称精确匹配对不上）。已上线不参与日历
const PHASE_FILTERS = [
  { kind: "BUSINESS", short: "商务" },
  { kind: "PREPARE", short: "项目准备" },
  { kind: "DEV", short: "研发" },
  { kind: "SIT", short: "SIT" },
  { kind: "UAT", short: "UAT" },
  { kind: "PRELAUNCH", short: "上线准备" },
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
  projectId: number;
  kind?: string;
  label: string;
  note?: string;
  from: string;
  to: string;
  bg: string;
  fg: string;
  line?: string;
  minWidth?: number;
  conflict?: boolean;
  tip: BarTip;
}

interface Row {
  key: string;
  name: string;
  sub: string;
  bars: Bar[];
  /** 人员视图：本周按投入比例算的占用（平均 / 单日峰值） */
  load?: { avg: number; peak: number };
}

function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const dow = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dow);
  return date.toISOString().slice(0, 10);
}

/** 这一周每天把在跑的阶段投入加起来，平均和峰值都返回，超过 100% 就是排满了。 */
function weeklyLoad(
  segments: { kind: string; from: string; to: string; ratio: number }[],
  weekStart: string,
): { avg: number; peak: number } {
  let total = 0;
  let peak = 0;
  for (let day = 0; day < 7; day += 1) {
    const date = addDays(weekStart, day);
    let load = 0;
    for (const segment of segments) {
      if (segment.kind === "LIVE" || !segment.from || !segment.to) continue;
      if (segment.from <= date && date <= segment.to) load += segment.ratio;
    }
    total += load;
    if (load > peak) peak = load;
  }
  return { avg: Math.round(total / 7), peak };
}

interface PlacedBar extends Bar {
  left: number;
  width: number;
  lane: number;
  fromIdx: number;
  toIdx: number;
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; mode?: string; date?: string; phase?: string; person?: string }>;
}) {
  const { user, access } = await requireAppAccess();
  const sp = await searchParams;
  const view = sp.view === "person" ? "person" : "project";
  const mode = sp.mode === "week" ? "week" : "month";
  const personFilter = view === "person" && sp.person ? sp.person : undefined;
  const activePhase = view === "project" && sp.phase && sp.phase !== "已上线" ? sp.phase : undefined;
  const today = new Date().toISOString().slice(0, 10);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? (sp.date as string) : today;

  let rows: Row[] = [];
  if (view === "project") {
    const items = await listProjects(access, user.id);
    rows = items
      .filter((i) => i.phase !== "LIVE")
      .map((item) => {
        const bars: Bar[] = item.phases
          // 已上线属于收尾状态，日历上不再占格
          .filter((p) => p.enabled && p.startDate && p.endDate && p.kind !== "LIVE")
          .map((p) => {
            const names = (p.members ?? []).map((m) => m.name).filter(Boolean);
            const short = names.length > 0
              ? `${names.slice(0, 3).join("、")}${names.length > 3 ? `等${names.length}人` : ""}`
              : "未排人";
            return {
              key: String(p.id),
              projectId: item.id,
              kind: p.kind,
              label: p.label,
              note: short,
              from: toDay(p.startDate),
              to: toDay(p.endDate),
              bg: PHASE_BG[p.label] ?? "#dbe7fb",
              fg: "#33415c",
              line: "rgba(51,65,92,0.12)",
              minWidth: 26,
              tip: {
                heading: item.name,
                meta: `${p.label} · ${toDay(p.startDate)} ～ ${toDay(p.endDate)}${p.days ? `（${p.days} 天）` : ""}`,
                lines: [
                  names.length > 0 ? `人员：${names.join("、")}` : "人员：暂未排人",
                  `进度：实际 ${p.progress}%${p.expected != null ? ` · 预期 ${p.expected}%` : ""}`,
                  `事项 ${p.itemDone}/${p.itemTotal}`,
                  ...p.items
                    .filter((item) => item.trackProgress)
                    .map((item) => `${item.name}：${item.progress}%`),
                ],
              },
            };
          });
        if (item.launchDate) {
          bars.push({
            key: "launch",
            projectId: item.id,
            label: "上线",
            from: toDay(item.launchDate),
            to: toDay(item.launchDate),
            bg: "#ffd9d9",
            fg: "#8c2b2b",
            line: "rgba(163,61,61,0.24)",
            minWidth: 34,
            tip: {
              heading: item.name,
              meta: `计划上线 ${toDay(item.launchDate)}`,
              lines: [`负责人：${item.ownerName}`],
            },
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
    rows = people.flatMap((person) => {
      // 冲突按每个阶段真实占用的区间算，不再用「各阶段合并成一大段」的粗区间；已上线不参与
      const rangesOf = (projectId: number) => {
        const project = person.projects.find((p) => p.projectId === projectId);
        if (!project) return [];
        const segments = project.segments.filter((s) => s.kind !== "LIVE");
        if (segments.length > 0) return segments.map((s) => ({ from: s.from, to: s.to }));
        if (project.segments.length > 0) return [];
        return project.from && project.to ? [{ from: project.from, to: project.to }] : [];
      };
      const clashNames = (projectId: number, from: string, to: string) => {
        const names = new Set<string>();
        for (const other of person.projects) {
          if (other.projectId === projectId) continue;
          if (rangesOf(other.projectId).some((r) => r.from && r.to && from <= r.to && r.from <= to)) {
            names.add(other.projectName);
          }
        }
        return [...names];
      };

      const bars = person.projects
        .filter((p) => p.from && p.to)
        .flatMap((p) => {
          const color = projectColor(p.projectId);
          const base = {
            projectId: p.projectId,
            bg: color.bg,
            fg: color.fg,
            line: color.line,
            minWidth: 26,
          };
          const segments = p.segments.filter((s) => s.kind !== "LIVE");
          const phaseText = p.phases
            .split("、")
            .filter((name) => name && name !== "已上线")
            .join("、");
          if (p.segments.length > 0 && segments.length === 0) return [];
          if (segments.length === 0) {
            const clash = clashNames(p.projectId, p.from, p.to);
            return [
              {
                key: `${p.projectId}`,
                ...base,
                label: p.projectName,
                note: `${phaseText || "时间未定"} · ${p.ratio}%`,
                from: p.from,
                to: p.to,
                conflict: clash.length > 0,
                tip: {
                  heading: p.projectName,
                  meta: `${p.from} ～ ${p.to}${phaseText ? ` · ${phaseText}` : ""}`,
                  lines: [`投入 ${p.ratio}%`, `预计释放：${p.release}`],
                  warn: clash.length > 0 ? `⚠ 与「${clash.join("」「")}」时间冲突` : undefined,
                },
              },
            ];
          }
          // 每个阶段单独成条，画的就是真正排的时间段
          return segments.map((s) => {
            const clash = clashNames(p.projectId, s.from, s.to);
            return {
              key: `${p.projectId}:${s.kind}`,
              ...base,
              label: s.label,
              note: `${p.projectName} · ${s.ratio}%`,
              from: s.from,
              to: s.to,
              conflict: clash.length > 0,
              tip: {
                heading: p.projectName,
                meta: `${s.label} · ${s.from} ～ ${s.to}`,
                lines: [`投入 ${s.ratio}%`, `该项目占用 ${p.from} ～ ${p.to}`, `预计释放：${p.release}`],
                warn: clash.length > 0 ? `⚠ 与「${clash.join("」「")}」时间冲突` : undefined,
              },
            };
          });
        });

      const conflict = bars.some((b) => b.conflict);
      // 排过的阶段全是「已上线」的人，日历上没东西可画，直接不占一行
      const hasSchedule = person.projects.some(
        (p) => p.segments.some((s) => s.kind !== "LIVE") || (p.segments.length === 0 && p.from && p.to),
      );
      if (bars.length === 0 && hasSchedule) return [];
      return [
        {
          key: person.key,
          name: `${conflict ? "⚠ " : ""}${person.name}`,
          sub: [person.roles.join(" / ") || (person.external ? "外部" : ""), conflict ? "时间冲突" : ""]
            .filter(Boolean)
            .join(" · "),
          bars,
          load: weeklyLoad(
            person.projects.flatMap((p) => p.segments),
            mondayOf(today),
          ),
        },
      ];
    });
  }

  if (personFilter) rows = rows.filter((row) => row.key === personFilter);
  const personName = personFilter
    ? rows[0]?.name.replace(/^⚠\s*/, "") ?? personFilter.replace(/^name:/, "")
    : "";

  // 时间轴范围：周视图固定一周；月视图从锚点月份开始，并延伸到所有排期的最晚月份，保证能一直滑到最右侧
  let start: string;
  let end: string;
  if (mode === "week") {
    const dow = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7;
    start = addDays(anchor, -dow);
    end = addDays(start, 6);
  } else {
    start = anchor.slice(0, 7) + "-01";
    const nextMonth = new Date(`${start}T00:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    end = addDays(nextMonth.toISOString().slice(0, 10), -1);
    let latest = end;
    for (const row of rows) {
      for (const b of row.bars) {
        if (b.to > latest) latest = b.to;
      }
    }
    if (latest > end) {
      const [ly, lm] = latest.split("-").map(Number);
      const monthAfter = new Date(Date.UTC(ly, lm, 1));
      end = addDays(monthAfter.toISOString().slice(0, 10), -1);
    }
    // 往前也铺到最早的排期，避免「有排期但在别的月份」的行整行空着看不到；最多回看 12 个月，防止异常日期把时间轴拉爆
    let earliest = "";
    for (const row of rows) {
      for (const b of row.bars) {
        if (b.from && (!earliest || b.from < earliest)) earliest = b.from;
      }
    }
    if (earliest && earliest < start) {
      const floor = new Date(`${start}T00:00:00Z`);
      floor.setUTCMonth(floor.getUTCMonth() - 12);
      const floorMonth = `${floor.toISOString().slice(0, 7)}-01`;
      start = earliest >= floorMonth ? `${earliest.slice(0, 7)}-01` : floorMonth;
    }
  }
  const nDays = diffDays(end, start) + 1;
  const days: string[] = Array.from({ length: nDays }, (_, i) => addDays(start, i));
  const step = mode === "week" ? 7 : 31;
  const shiftMonth = (iso: string, n: number) => {
    const [y, m] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
  };
  // 翻页按锚点走，而不是按时间轴左边缘，否则时间轴往前铺开后〈 〉会没反应
  const prev = mode === "week" ? addDays(anchor, -step) : shiftMonth(anchor, -1);
  const next = mode === "week" ? addDays(anchor, step) : shiftMonth(anchor, 1);

  const filteredRows =
    view === "project" && activePhase
      ? rows.filter((row) =>
          activePhase === "LAUNCH"
            ? row.bars.some((b) => b.key === "launch")
            : row.bars.some((b) => b.kind === activePhase),
        )
      : rows;

  const placed = filteredRows.map((row) => {
    const bars: PlacedBar[] = row.bars
      .map((b) => {
        const from = b.from < start ? start : b.from;
        const to = b.to > end ? end : b.to;
        if (from > to) return null;
        const fromIdx = diffDays(from, start);
        const toIdx = diffDays(to, start);
        return {
          ...b,
          fromIdx,
          toIdx,
          left: (fromIdx / nDays) * 100,
          width: ((toIdx - fromIdx + 1) / nDays) * 100,
          lane: 0,
        };
      })
      .filter((b): b is PlacedBar => b !== null)
      .sort((a, b) => a.fromIdx - b.fromIdx || a.toIdx - b.toIdx);

    // 同一行里时间不重叠的条块共用一条泳道，重叠的往下叠，冲突就一眼看得出来
    const laneEnds: number[] = [];
    for (const bar of bars) {
      let lane = laneEnds.findIndex((laneEnd) => laneEnd < bar.fromIdx);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(bar.toIdx);
      } else {
        laneEnds[lane] = bar.toIdx;
      }
      bar.lane = lane;
    }
    return { ...row, bars, lanes: Math.max(1, laneEnds.length), hasBars: row.bars.length > 0 };
  });

  // 两个视图统一成同一种条块尺寸，和人员安排保持一致
  const barHeight = 17;
  const barGap = 4;
  const lanePad = 7;
  const rowHeightOf = (lanes: number) => Math.max(40, lanePad * 2 + lanes * barHeight + (lanes - 1) * barGap);

  const showToday = today >= start && today <= end;
  const todayLeft = ((diffDays(today, start) + 0.5) / nDays) * 100;
  // 月视图一进来（或翻月之后）就把滚动位置对到锚点：锚点在当月就对到今天
  const anchorLeft = (() => {
    if (mode !== "month") return null;
    if (anchor.slice(0, 7) === today.slice(0, 7) && showToday) return todayLeft;
    const value = (diffDays(`${anchor.slice(0, 7)}-01`, start) / nDays) * 100;
    return value >= 0 && value <= 100 ? value : null;
  })();
  const dayWidth = nDays > 200 ? 38 : nDays > 90 ? 44 : nDays > 45 ? 50 : 60;
  const minTrack = nDays * dayWidth;
  const dayFont = nDays > 90 ? 9.5 : 11;

  const monthBands: { key: string; label: string; days: number }[] = [];
  for (const d of days) {
    const key = d.slice(0, 7);
    const last = monthBands[monthBands.length - 1];
    if (last && last.key === key) last.days += 1;
    else {
      const [y, m] = key.split("-").map(Number);
      monthBands.push({ key, label: m === 1 || monthBands.length === 0 ? `${y}年${m}月` : `${m}月`, days: 1 });
    }
  }

  const legendProjects =
    view === "person"
      ? (() => {
          const seen = new Map<number, string>();
          for (const row of placed) {
            for (const b of row.bars) if (!seen.has(b.projectId)) seen.set(b.projectId, b.tip.heading);
          }
          return [...seen.entries()].map(([id, name]) => ({ id, name, color: projectColor(id) }));
        })()
      : [];

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
          <Link href={qs({ view, mode, date: prev, person: personFilter })} className="btn" aria-label="上一段">
            〈
          </Link>
          <Link href={qs({ view, mode, person: personFilter })} className="btn">
            今天
          </Link>
          <Link href={qs({ view, mode, date: next, person: personFilter })} className="btn" aria-label="下一段">
            〉
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>
          {monthLabel(start)}
          {end.slice(0, 7) !== start.slice(0, 7) ? ` – ${monthLabel(end)}` : ""}
        </span>
        <span style={{ display: "inline-flex", gap: 4 }}>
          <Link href={qs({ view, mode: "week", date: anchor, person: personFilter })} style={tab(mode === "week")}>
            周
          </Link>
          <Link href={qs({ view, mode: "month", date: anchor, person: personFilter })} style={tab(mode === "month")}>
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
        {view === "person" && personFilter ? (
          <Link href={qs({ view: "person", mode, date: anchor })} className="badge soft" style={{ textDecoration: "none" }}>
            只看 {personName} ✕
          </Link>
        ) : null}
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
          {start} ～ {end}
        </span>
      </div>

      {view === "project" ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          {[...PHASE_FILTERS, { kind: "LAUNCH", short: "上线" } as const].map(({ kind, short: k }) => {
            const active = activePhase === kind;
            const bg = kind === "LAUNCH" ? "#ffd9d9" : (PHASE_BG[{ BUSINESS: "商务阶段", PREPARE: "项目准备阶段", DEV: "研发节点", SIT: "SIT测试阶段", UAT: "UAT阶段", PRELAUNCH: "准备上线" }[kind as string] ?? ""] ?? "#dbe7fb");
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
            <span className="muted" style={{ fontSize: 12 }}>点按条块查看阶段日期与人员名单</span>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12, fontSize: 11.5 }}>
          <span className="muted">同项目同色：</span>
          {legendProjects.map((p) => (
            <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 14, height: 10, borderRadius: 3, background: p.color.bg, border: `1px solid ${p.color.line}` }} />
              <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            </span>
          ))}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
            <span style={{ width: 14, height: 10, borderRadius: 3, background: "#f4f6fa", border: "1.5px solid var(--coral)" }} />
            时间冲突
          </span>
          <span className="muted" style={{ marginLeft: "auto" }}>
            条块按阶段拆开，点按查看所属项目与日期
          </span>
        </div>
      )}

      <div className="gantt-scroll">
        {anchorLeft !== null ? <ScrollToDate percent={anchorLeft} /> : null}
        <div style={{ minWidth: `calc(var(--gantt-label-w, 200px) + ${minTrack}px)` }}>
          <div className="gantt-head">
            <div className="gantt-label muted" style={{ position: "sticky", left: 0, background: "var(--paper)", zIndex: 3 }}>
              {view === "project" ? `项目 · ${placed.length}` : `人员 · ${placed.length}`}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", borderBottom: "1px solid var(--line)" }}>
                {monthBands.map((m) => (
                  <div
                    key={m.key}
                    style={{
                      width: `${(m.days / nDays) * 100}%`,
                      padding: "5px 8px",
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: "var(--muted)",
                      borderLeft: "1px solid var(--line)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                    }}
                  >
                    {m.label}
                  </div>
                ))}
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
                        padding: nDays > 90 ? "8px 2px" : "8px 4px",
                        fontSize: dayFont,
                        whiteSpace: "nowrap",
                        textAlign: "center",
                        color: d === today ? "var(--coral)" : undefined,
                        fontWeight: d === today ? 700 : undefined,
                      }}
                    >
                      {Number(d.slice(8))}
                      {week}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {placed.map((row) => {
            const rowHeight = rowHeightOf(row.lanes);
            return (
              <div className="gantt-row" key={row.key}>
                <div
                  className="gantt-label"
                  style={{
                    position: "sticky",
                    left: 0,
                    background: "var(--paper)",
                    zIndex: 3,
                    whiteSpace: "normal",
                    overflow: "visible",
                  }}
                  title={row.name}
                >
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
                  {view === "person" && row.load ? (
                    <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                      <span className="load-bar" aria-hidden="true">
                        <i
                          style={{
                            width: `${Math.min(100, row.load.avg)}%`,
                            background: row.load.peak > 100 ? "var(--coral)" : undefined,
                          }}
                        />
                      </span>
                      <span
                        style={{
                          color: row.load.peak > 100 ? "var(--coral)" : "var(--muted)",
                          whiteSpace: "nowrap",
                        }}
                        title="按每个阶段的人员投入比例，算这一周平均每天占用多少；同天加起来超过 100% 就是排满了"
                      >
                        本周 {row.load.avg}%{row.load.peak > 100 ? ` · 峰 ${row.load.peak}%` : ""}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="gantt-track" style={{ minHeight: rowHeight }}>
                  {showToday ? <div className="gantt-today" style={{ left: `${todayLeft}%` }} /> : null}
                  {row.bars.length === 0 ? (
                    <div
                      style={{
                        position: "sticky",
                        left: "calc(var(--gantt-label-w, 200px) + 8px)",
                        width: "max-content",
                        padding: "12px 0 0 8px",
                        fontSize: 11,
                      }}
                    >
                      <span className="muted">{row.hasBars ? "本时段无排期" : "未排期"}</span>
                    </div>
                  ) : null}
                  {row.bars.map((b) => {
                    const dim = activePhase && (activePhase === "LAUNCH" ? b.key !== "launch" : b.kind !== activePhase);
                    return (
                      <GanttBar
                        key={b.key}
                        left={b.left}
                        width={b.width}
                        top={lanePad + b.lane * (barHeight + barGap)}
                        height={barHeight}
                        bg={b.bg}
                        fg={b.fg}
                        line={b.line}
                        minWidth={b.minWidth}
                        label={b.label}
                        note={b.note}
                        fontSize={10}
                        conflict={b.conflict}
                        dim={Boolean(dim)}
                        tip={b.tip}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
