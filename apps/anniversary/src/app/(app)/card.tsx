import Link from "next/link";
import { coverPresentation, fallbackGradient } from "@/lib/cover";
import type { AnniversaryView } from "@/server";
import { NoteClamp } from "./note";

function DayFigure({ label, days, phrase }: { label: string; days: number | null; phrase?: string }) {
  const showNumber = days != null && days > 0;
  return (
    <div className="anniv-figure">
      <span className="anniv-figure-label">{label}</span>
      {showNumber ? (
        <span className="anniv-figure-value">
          <b>{days}</b>
          <span>天</span>
        </span>
      ) : (
        <span className="anniv-figure-plain">{phrase}</span>
      )}
    </div>
  );
}

export function AnniversaryCard({ item }: { item: AnniversaryView }) {
  const cover = coverPresentation(item.background);
  const photo = cover.image
    ? `url("${cover.image}")`
    : cover.gradient || fallbackGradient(item.type);

  return (
    <article className="anniv-card" style={{ backgroundImage: fallbackGradient(item.type) }}>
      <div className="anniv-photo" style={{ backgroundImage: photo }} />
      <div className="anniv-shade" />
      <div className="anniv-body">
        <div className="anniv-title">
          <div className="anniv-name">{item.name}</div>
          {item.occurrence.origin ? <div className="anniv-origin">{item.occurrence.origin}</div> : null}
        </div>
        {item.note ? <NoteClamp text={item.note} /> : null}
        <div className="anniv-foot">
          <div className="anniv-foot-main">
            <div className="anniv-figures">
              {item.occurrence.elapsedDays != null ? (
                <>
                  <DayFigure label="已过" days={item.occurrence.elapsedDays} phrase="今天" />
                  <DayFigure label="下个周期" days={item.occurrence.days} phrase="就是今天" />
                </>
              ) : (
                <DayFigure
                  label={item.occurrence.days != null && item.occurrence.days > 0 ? "还有" : "下次"}
                  days={item.occurrence.days}
                  phrase={item.occurrence.countdown}
                />
              )}
            </div>
            {item.occurrence.elapsedDays == null && item.occurrence.date ? (
              <div className="anniv-when">{item.occurrence.when.replace("下次 ", "")}</div>
            ) : null}
          </div>
          {item.yearsLabel && (item.type === "BIRTHDAY" || item.type === "MARRIAGE" || item.type === "PROPOSAL") ? (
            <span className="anniv-age">{item.yearsLabel}</span>
          ) : null}
        </div>
      </div>
      <Link className="anniv-hit" href={`/a/${item.id}`} aria-label={item.name} />
    </article>
  );
}
