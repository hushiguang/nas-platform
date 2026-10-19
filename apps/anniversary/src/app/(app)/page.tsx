import Link from "next/link";
import { requireAppAccess } from "@/auth";
import { TYPE_OPTIONS } from "@/lib/labels";
import { listAnniversaries } from "@/server";
import { AnniversaryCard } from "./card";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { user, access } = await requireAppAccess();
  const items = await listAnniversaries(access, user.id);
  const groups = TYPE_OPTIONS.map((option) => ({
    ...option,
    items: items
      .filter((item) => item.type === option.value || (option.value === "OTHER" && item.type === "COUNTDOWN"))
      .sort((a, b) => (a.occurrence.days ?? 99_999) - (b.occurrence.days ?? 99_999)),
  })).filter((group) => group.items.length > 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">农历与公历</span>
          <h1>纪念日</h1>
        </div>
        <Link href="/new" className="btn">
          记下一天
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontFamily: "Source Serif 4, serif", fontSize: 22 }}>还没有纪念日</div>
          <p className="muted" style={{ fontSize: 13 }}>
            生日、结婚、求婚，公历农历都可以。临近一个月的会出现在门户上。
          </p>
          <Link href="/new" className="btn">
            记下第一天
          </Link>
        </div>
      ) : (
        <>
          {groups.map((group) => (
            <section className="section" key={group.value}>
              <h2 className="section-title">
                {group.icon} {group.label} · {group.items.length}
              </h2>
              <div className="anniv-grid">
                {group.items.map((item) => (
                  <AnniversaryCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
