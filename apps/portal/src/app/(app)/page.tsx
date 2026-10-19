import Link from "next/link";
import { SiteLink } from "@nas/ui";
import { getUserPlatforms, resolvePlatformHref, zonedDate, zonedTime } from "@nas/core";
import { galleryById, gradientById } from "@nas/media/catalog";
import { appCoverByCode } from "@nas/media/portal-covers";
import type { PlatformAccess } from "@nas/core";
import { requireUser } from "@/auth";
import { ensureAnniversaryTodos, ensureBillFollowTodos, getPortalSummaries, type PortalSummary } from "@/server/summary";

export const dynamic = "force-dynamic";

// 图标底色：没配背景的老卡片才走这里，按 code 稳定取色
const ACCENTS = [
  "linear-gradient(135deg, rgba(255,77,106,.16), rgba(255,138,61,.16))",
  "linear-gradient(135deg, rgba(124,92,252,.16), rgba(61,139,253,.16))",
  "linear-gradient(135deg, rgba(18,185,129,.16), rgba(61,139,253,.16))",
  "linear-gradient(135deg, rgba(255,95,143,.16), rgba(124,92,252,.16))",
  "linear-gradient(135deg, rgba(255,197,61,.22), rgba(255,138,61,.16))",
  "linear-gradient(135deg, rgba(61,139,253,.16), rgba(18,185,129,.16))",
];

/** 纪念日同款：gallery:<id> / gradient:<id> / 外链，都变成可画的背景 */
function coverStyle(cover: string | null, code: string): { bg: string; photo: string | null } {
  if (cover?.startsWith("gallery:")) {
    const id = cover.slice("gallery:".length);
    if (galleryById(id)) return { bg: "#241c33", photo: `url("/api/media/gallery/${id}")` };
  }
  if (cover?.startsWith("gradient:")) {
    const g = gradientById(cover.slice("gradient:".length));
    if (g) return { bg: g.background, photo: null };
  }
  if (cover) return { bg: "#241c33", photo: `url("${cover}")` };
  // 没配过的应用：先用按应用语义配的专属图，不适用才回退纪念日渐变
  const preset = appCoverByCode(code.split(":")[0]);
  if (preset) return { bg: "#241c33", photo: `url("${preset.url}")` };
  return { bg: "linear-gradient(145deg, #3d8bfd, #7c5cfc)", photo: null };
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

function SummaryBlock({
  summary,
  isExternal,
}: {
  summary: PortalSummary | null;
  isExternal: boolean;
}) {
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
              <SiteLink key={s.label} href={s.href} className={cls}>
                {inner}
              </SiteLink>
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
            <li
              key={i}
              className={[l.tone === "warn" ? "warn" : "", l.bills?.length ? "has-pop" : ""].filter(Boolean).join(" ") || undefined}
              title={l.bills?.length ? undefined : l.text}
            >
              {l.href ? (
                <SiteLink href={l.href}>
                  <span>{l.text}</span>
                </SiteLink>
              ) : (
                <span>{l.text}</span>
              )}
              {l.bills?.length ? (
                <div className="line-pop">
                  {l.bills.map((bill) => (
                    <SiteLink key={`${bill.href}-${bill.label}`} href={bill.href}>
                      <span>{bill.label}</span>
                      <time>{bill.createdAt}</time>
                    </SiteLink>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        summary.note && <div className="app-note">{summary.note}</div>
      )}
    </div>
  );
}

function AppCard({
  platform,
  summary,
}: {
  platform: PlatformAccess;
  summary: PortalSummary | null;
}) {
  // 每个应用是独立部署的，地址从数据库配置或环境变量取，
  // 不再像单应用时代那样映射到同一个站内的 /bills 路由。
  const href = resolvePlatformHref(platform.code, platform.url);
  const disabled = !href;
  const cover = coverStyle(platform.cover, platform.code);

  const nameNode = disabled ? (
    <div className="app-name">{platform.name}</div>
  ) : (
    <SiteLink href={href} className="app-name app-hit">
      {platform.name}
    </SiteLink>
  );

  return (
    <div className={disabled ? "app-card has-cover is-disabled" : "app-card has-cover is-link"}>
      <div
        className="app-banner"
        style={
          cover.photo
            ? { backgroundImage: `${cover.photo}, linear-gradient(135deg, #3a2b4d, #241c33)` }
            : { background: cover.bg }
        }
      >
        <div className="app-card-head">
          <div className="app-icon">{platform.icon}</div>
          {disabled ? (
            <span className="badge soft">未配置</span>
          ) : platform.isExternal ? (
            <span className="badge soft">外部</span>
          ) : null}
        </div>
      </div>
      <div className="app-body">
        <div>
          {nameNode}
          <div className="app-desc">{platform.description || "暂无描述"}</div>
        </div>
        <SummaryBlock summary={summary} isExternal={platform.isExternal} />
      </div>
    </div>
  );
}

/** 顶部今日概览：把各应用的关键指标抽出来一行展示 */
function TodayOverview({ summaries }: { summaries: Record<string, PortalSummary | null> }) {
  const todo = summaries["todo"];
  const bill = summaries["bill"];
  const chips: { value: string; label: string; warn?: boolean; href?: string }[] = [];

  const open = todo?.stats.find((s) => s.label === "待处理");
  const overdue = todo?.stats.find((s) => s.label === "逾期");
  if (open) chips.push({ value: open.value, label: "待办待处理", href: open.href });
  if (overdue && overdue.value !== "0") {
    chips.push({ value: overdue.value, label: "已逾期", warn: true, href: overdue.href });
  }
  const spend = bill?.stats.find((s) => s.label.endsWith("支出"));
  if (spend) chips.push({ value: spend.value, label: spend.label, href: spend.href });
  const upcoming = summaries["anniversary"]?.stats.find((s) => s.label === "临近提醒") ?? summaries["anniversary"]?.stats.find((s) => s.label === "今日提醒");
  if (upcoming && upcoming.value !== "0") {
    chips.push({ value: upcoming.value, label: "纪念日提醒", href: upcoming.href });
  }
  const delayedWork = summaries["work"]?.stats.find((s) => s.label === "已延期");
  if (delayedWork && delayedWork.value !== "0") {
    chips.push({ value: delayedWork.value, label: "工作延期", warn: true, href: delayedWork.href });
  }

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
          <SiteLink key={i} href={c.href} className={cls}>
            {inner}
          </SiteLink>
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
  const user = await requireUser();
  // 人已经在门户上，不再给自己放一张卡片
  const platforms = (await getUserPlatforms(user)).filter((item) => item.code !== "portal");
  await Promise.all([ensureAnniversaryTodos(), ensureBillFollowTodos()]);
  const summaries = await getPortalSummaries(user, platforms);
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
