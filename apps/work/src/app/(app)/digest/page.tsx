import Link from "next/link";
import { requireAppAccess } from "@/auth";
import { digestFor, digestIsQuiet, type DigestItem } from "@/server";

export const dynamic = "force-dynamic";

const SERIF = `"Source Serif 4", serif`;
const HAIR = "1px solid var(--line)";

function DayBadge({ days }: { days?: number }) {
  if (days == null) return null;
  if (days < 0) return <span className="badge warn">逾期 {-days} 天</span>;
  if (days === 0) return <span className="badge">今天</span>;
  return <span className="badge soft">还有 {days} 天</span>;
}

function Figure({ n, label, href, hot }: { n: number; label: string; href: string; hot?: boolean }) {
  return (
    <a href={href} style={{ textDecoration: "none", color: "inherit" }}>
      <span style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 650, color: hot ? "var(--coral)" : undefined }}>
        {n}
      </span>
      <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>
        {label}
      </span>
    </a>
  );
}

function Item({ item, withDays }: { item: DigestItem; withDays?: boolean }) {
  return (
    <Link
      href={`/p/${item.projectId}`}
      style={{
        display: "flex",
        gap: 12,
        alignItems: "baseline",
        padding: "12px 4px",
        borderBottom: HAIR,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          flexShrink: 0,
          alignSelf: "center",
          background: item.tone === "warn" ? "var(--coral)" : item.days != null && item.days <= 7 ? "#e8930c" : "var(--sky)",
        }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14.5 }}>{item.text}</span>{" "}
        {withDays ? <DayBadge days={item.days} /> : null}
        <span className="muted" style={{ display: "block", fontSize: 12.5, marginTop: 2 }}>
          {item.projectName}
        </span>
      </span>
    </Link>
  );
}

function Block({
  no,
  id,
  title,
  items,
  withDays,
  empty,
}: {
  no: string;
  id: string;
  title: string;
  items: DigestItem[];
  withDays?: boolean;
  empty: string;
}) {
  return (
    <section id={id} style={{ scrollMarginTop: 16, marginTop: 40 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, paddingBottom: 4 }}>
        <span style={{ fontFamily: SERIF, fontSize: 13, color: "var(--muted)" }}>{no}</span>
        <h2 style={{ fontFamily: SERIF, fontSize: 21, fontWeight: 600, margin: 0 }}>{title}</h2>
        <span className="muted" style={{ fontSize: 13 }}>
          {items.length} 项
        </span>
      </div>
      {items.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5, padding: "12px 4px", borderBottom: HAIR, margin: 0 }}>
          {empty}
        </p>
      ) : (
        <div style={{ borderTop: HAIR }}>
          {items.slice(0, 10).map((item, i) => (
            <Item key={`${item.projectId}-${item.text}-${i}`} item={item} withDays={withDays} />
          ))}
        </div>
      )}
      {items.length > 10 ? (
        <p className="muted" style={{ fontSize: 12.5 }}>
          还有 {items.length - 10} 项，进项目看全部
        </p>
      ) : null}
    </section>
  );
}

export default async function DigestPage() {
  const { user, access } = await requireAppAccess();
  const digest = await digestFor(access, user.id);
  const quiet = digestIsQuiet(digest);

  const urgent = [...digest.delayed, ...digest.dueToday].sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  const worst = digest.delayed.length > 0 ? Math.min(...digest.delayed.map((i) => i.days ?? 0)) : null;
  const lede = quiet
    ? "干干净净，当前阶段都在计划内，也没有没关上的问题。"
    : [
        `在办 ${digest.running} 个项目`,
        digest.delayed.length > 0 ? `阶段逾期 ${digest.delayed.length} 项${worst != null ? `（最长逾期 ${-worst} 天）` : ""}` : null,
        digest.dueToday.length > 0 ? `阶段今天结束 ${digest.dueToday.length} 项` : null,
        digest.dueSoon.length > 0 ? `未来 7 天还有 ${digest.dueSoon.length} 个阶段要结束` : null,
        digest.bugs.length > 0 ? `缺陷 ${digest.bugs.length} 个没关` : null,
      ]
        .filter(Boolean)
        .join("，") + "。";

  return (
    <div style={{ maxWidth: 780 }}>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">
            {digest.dayText} · {digest.title}
          </span>
          <h1 style={{ fontFamily: SERIF }}>风险预报</h1>
        </div>
        <Link href="/new" className="btn">
          新建项目
        </Link>
      </div>

      <p style={{ fontFamily: SERIF, fontSize: 19, lineHeight: 1.7, margin: "4px 0 28px" }}>{lede}</p>

      <div style={{ display: "flex", gap: 36, flexWrap: "wrap", paddingBottom: 8, borderBottom: HAIR }}>
        <Figure n={urgent.length} label="阶段逾期" href="#sec-urgent" hot={urgent.length > 0} />
        <Figure n={digest.dueSoon.length} label="7 天内结束" href="#sec-soon" hot={digest.dueSoon.length > 0} />
        <Figure n={digest.bugs.length} label="缺陷未关" href="#sec-bugs" hot={digest.bugs.length > 0} />
        <Figure n={digest.improvements.length} label="优化未关" href="#sec-imp" />
      </div>

      {quiet ? null : (
        <>
          <Block no="01" id="sec-urgent" title="阶段逾期 / 今天结束" items={urgent} withDays empty="当前阶段都没逾期，今天也没有阶段结束" />
          <Block no="02" id="sec-soon" title="7 天内结束的阶段" items={digest.dueSoon} withDays empty="未来 7 天没有阶段结束" />
          <Block no="03" id="sec-bugs" title="缺陷未关" items={digest.bugs} empty="缺陷都关完了" />
          <Block no="04" id="sec-imp" title="优化未关" items={digest.improvements} empty="优化都关完了" />
          <p className="muted" style={{ fontSize: 12, marginTop: 48 }}>
            08:30 和 18:30 会把你负责或参与的项目推到已打开的通知渠道。同一天同一时段不会重复发。
          </p>
        </>
      )}
    </div>
  );
}
