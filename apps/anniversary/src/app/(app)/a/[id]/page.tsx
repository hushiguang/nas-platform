import Link from "next/link";
import { SiteLink } from "@nas/ui";
import { notFound } from "next/navigation";
import { requireAppAccess } from "@/auth";
import { coverPresentation, fallbackGradient } from "@/lib/cover";
import { getAnniversary, remindText } from "@/server";
import { DeleteAnniversary } from "../../delete-button";
import { NoteClamp } from "../../note";

export const dynamic = "force-dynamic";

export default async function AnniversaryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, access } = await requireAppAccess();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const item = await getAnniversary(access, user.id, id);
  if (!item) notFound();

  const cover = coverPresentation(item.background);
  const photo = cover.image ? `url("${cover.image}")` : cover.gradient || fallbackGradient(item.type);
  const remind = remindText(item.remindDays, item.remindTime);

  return (
    <div>
      <Link href="/" className="link">
        全部纪念日
      </Link>
      <section className="anniv-hero" style={{ backgroundImage: fallbackGradient(item.type) }}>
        <div className="anniv-photo" style={{ backgroundImage: photo }} />
        <div className="anniv-shade" />
        <div className="anniv-body">
          <div className="anniv-kicker">
            {item.icon} {item.typeLabel}
            {item.yearsLabel ? ` · ${item.yearsLabel}` : ""}
          </div>
          <h1 className="anniv-name">{item.name}</h1>
          <div className="anniv-count">
            {item.occurrence.elapsedText ? (
              <>
                <div>{item.occurrence.elapsedText}</div>
                {item.occurrence.cycleText ? <div>{item.occurrence.cycleText}</div> : null}
              </>
            ) : (
              <>
                {item.occurrence.countdown}
                {item.occurrence.date ? ` · ${item.occurrence.when}` : ""}
              </>
            )}
          </div>
        </div>
      </section>

      <div className="card">
        <dl className="anniv-meta">
          <div>
            <dt>{item.type === "BIRTHDAY" ? "出生日期" : "日期"}</dt>
            <dd>{item.occurrence.origin}</dd>
          </div>
          {item.occurrence.elapsedText ? (
            <div>
              <dt>已过</dt>
              <dd>{item.occurrence.elapsedDays} 天</dd>
            </div>
          ) : null}
          <div>
            <dt>{item.occurrence.cycleText ? "下个周期" : "下次"}</dt>
            <dd>{item.occurrence.date ?? item.occurrence.when}</dd>
          </div>
          <div>
            <dt>历法</dt>
            <dd>{item.calendar === "LUNAR" ? "农历" : "公历"}</dd>
          </div>
          {remind ? (
            <div>
              <dt>提醒</dt>
              <dd>{remind}</dd>
            </div>
          ) : null}
          {item.note ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <dt>备注</dt>
              <dd>
                <NoteClamp text={item.note} />
              </dd>
            </div>
          ) : null}
        </dl>

        {item.bills.length > 0 ? (
          <div className="anniv-bills">
            <div className="muted" style={{ fontSize: 12 }}>
              每年的账单
            </div>
            {item.bills.map((bill) => (
              <SiteLink className="anniv-bill-row" href={bill.href} key={bill.id}>
                <span>{bill.year ?? "—"}</span>
                <span>{bill.label}</span>
              </SiteLink>
            ))}
          </div>
        ) : null}

        {item.notes.length > 0 ? (
          <div className="anniv-bills" style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              每年的备注
            </div>
            {item.notes.map((note) => (
              <div className="anniv-bill-row" key={note.id} style={{ cursor: "default" }}>
                <span>{note.year}</span>
                <span style={{ whiteSpace: "pre-wrap" }}>{note.note}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn ghost" href={`/a/${item.id}/edit`}>
            修改
          </Link>
          <DeleteAnniversary id={item.id} />
        </div>
      </div>
    </div>
  );
}
