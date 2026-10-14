import Link from "next/link";
import { requireUser, type SessionUser } from "@/modules/core/auth/session";
import { getUserPlatforms, type PlatformAccess } from "@/modules/core/rbac";
import { PLATFORM_HREF } from "@/modules/core/rbac/platform-links";
import { getPortalSummaries, type PortalSummary } from "@/modules/core/portal/summary";
import { zonedDate, zonedTime } from "@/lib/time";

// 图标底色：按 code 稳定取色，避免所有卡片一个灰块
const ACCENTS = [
  "linear-gradient(135deg, rgba(255,77,106,.16), rgba(255,138,61,.16))",
  "linear-gradient(135deg, rgba(124,92,252,.16), rgba(61,139,253,.16))",
  "linear-gradient(135deg, rgba(18,185,129,.16), rgba(61,139,253,.16))",
  "linear-gradient(135deg, rgba(255,95,143,.16), rgba(124,92,252,.16))",
  "linear-gradient(135deg, rgba(255,197,61,.22), rgba(255,138,61,.16))",
  "linear-gradient(135deg, rgba(61,139,253,.16), rgba(18,185,129,.16))",
];

function accent(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

function groupBy(list: PlatformAccess[]): [string, PlatformAccess[]][] {
  const map = new Map<string, PlatformAccess[]>();
  for (const item of list) {
    const group = item.group ?? "未分组";
    if (!map.has(group)) map.set(group, []);
    map.get(group)!.push(item);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function SummaryBlock({ summary, isExternal }: { summary: PortalSummary | null; isExternal: boolean }) {
  if (!summary) {
    return (
      <div className="app-summary">
        <div className="app-note">{isExternal ? "外部独立服务 · 点击查看" : "暂无概览数据"}</div>
      </div>
    );
  }
  return (
    <div className="app-summary">
      {summary.stats.length > 0 && (
        <div className="app-stats">
          {summary.stats.map((s) => {
            const cls = `stat${s.tone === "warn" ? " warn" : ""}`;
            const inner = (
              <>
                <b>{s.value}</b>
                {s.label}
              </>
            );
            return s.href ? (
              <Link key={s.label} href={s.href} className={cls}>
                {inner}
              </Link>
            ) : (
              <span key={s.label} className={cls}>
                {inner}
              </span>
            );
          })}
        </div>
      )}
      {summary.lines.length > 0 ? (
        <ul className="app-lines">
          {summary.lines.map((l, i) => (
            <li key={i} className={l.tone === "warn" ? "warn" : undefined} title={l.text}>
              {l.href ? (
                <Link href={l.href}>
                  <span>{l.text}</span>
                </Link>
              ) : (
                <span>{l.text}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        summary.note && <div className="app-note">{summary.note}</div>
      )}
    </div>
  );
}

function AppCard({ platform, summary }: { platform: PlatformAccess; summary: PortalSummary | null }) {
  const href = platform.isExternal ? platform.url : PLATFORM_HREF[platform.code] ?? `/${platform.code}`;
  const disabled = !href;

  // 整卡可点：标题链接用 stretched 覆盖整卡；摘要区层级更高，其链接独立可点
  const nameNode = disabled ? (
    <div className="app-name">{platform.name}</div>
  ) : platform.isExternal ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="app-name app-hit">
      {platform.name}
    </a>
  ) : (
    <Link href={href} className="app-name app-hit">
      {platform.name}
    </Link>
  );

  return (
    <div className={disabled ? "app-card is-disabled" : "app-card is-link"}>
      <div className="app-card-head">
        <div className="app-icon" style={{ background: accent(platform.code) }}>
          {platform.icon}
        </div>
        {disabled ? (
          <span className="badge soft">未配置</span>
        ) : platform.isExternal ? (
          <span className="badge soft">外部</span>
        ) : null}
      </div>
      <div>
        {nameNode}
        <div className="app-desc">{platform.description || "暂无描述"}</div>
      </div>
      <SummaryBlock summary={summary} isExternal={platform.isExternal} />
    </div>
  );
}

/** 顶部今日概览：把各应用的关键指标抽出来一行展示 */
function TodayOverview({ summaries }: { summaries: Record<string, PortalSummary | null> }) {
  const todo = summaries["todo"];
  const anniversary = summaries["anniversary"];
  const chips: { value: string; label: string; warn?: boolean; href?: string }[] = [];

  const open = todo?.stats.find((s) => s.label === "待处理");
  const overdue = todo?.stats.find((s) => s.label === "逾期");
  if (open) chips.push({ value: open.value, label: "待办待处理", href: open.href });
  if (overdue) chips.push({ value: overdue.value, label: "已逾期", warn: true, href: overdue.href });

  const near = anniversary?.lines[0];
  if (near) chips.push({ value: "", label: near.text, warn: near.tone === "warn", href: near.href });

  if (chips.length === 0) return null;
  return (
    <div className="overview">
      <span className="overview-title">今日概览</span>
      {chips.map((c, i) => {
        const cls = `stat lg${c.warn ? " warn" : ""}`;
        const inner = (
          <>
            {c.value && <b>{c.value}</b>}
            {c.label}
          </>
        );
        return c.href ? (
          <Link key={i} href={c.href} className={cls}>
            {inner}
          </Link>
        ) : (
          <span key={i} className={cls}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}

// 导航门户 · 应用卡片：入口 + 每个应用最近的数据摘要。
export default async function PortalPage() {
  const user: SessionUser = await requireUser();
  const platforms = await getUserPlatforms(user);
  const summaries = await getPortalSummaries(user.id, platforms);
  const now = new Date();

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">
            {zonedDate(now)} · {zonedTime(now)}
          </span>
          <h1>你好，{user.nickname}</h1>
        </div>
        {user.role === "ADMIN" && (
          <Link href="/admin/platforms" className="btn ghost">
            + 管理应用
          </Link>
        )}
      </div>

      <TodayOverview summaries={summaries} />

      {platforms.length === 0 ? (
        <div className="card muted">还没有可用应用，请联系管理员授权。</div>
      ) : (
        groupBy(platforms).map(([group, items]) => (
          <section className="section" key={group}>
            <h2 className="section-title">{group}</h2>
            <div className="app-grid">
              {items.map((p) => (
                <AppCard key={p.code} platform={p} summary={summaries[p.code] ?? null} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
