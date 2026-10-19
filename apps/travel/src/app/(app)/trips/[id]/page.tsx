import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppAccess } from "@/auth";
import { amapKey, amapSecurityCode } from "@/lib/amap";
import { dateRange, fallbackGradient } from "@/lib/labels";
import { getTrip, mapPoints } from "@/server";
import { DeleteButton } from "../../components/delete-button";
import { TravelMap } from "../../components/travel-map";
import { removeTripAction } from "../../mutate";

export const dynamic = "force-dynamic";

export default async function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tripId = Number(id);
  if (!Number.isInteger(tripId) || tripId <= 0) notFound();

  const { user, access } = await requireAppAccess();
  const [trip, points] = await Promise.all([
    getTrip(access, user.id, tripId),
    mapPoints(access, user.id),
  ]);
  if (!trip) notFound();

  const stopPoints = points.filter((p) => p.kind === "stop" && p.id.startsWith("stop-"));

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">{dateRange(trip.startDate, trip.endDate)}</span>
          <h1>{trip.title}</h1>
        </div>
        <div className="row-actions">
          <Link className="btn ghost" href={`/trips/${trip.id}/edit`}>
            编辑
          </Link>
          <DeleteButton action={removeTripAction.bind(null, trip.id)} />
        </div>
      </div>

      <div
        className="detail-hero"
        style={{
          backgroundImage: trip.coverUrl ? `url("${trip.coverUrl}")` : fallbackGradient(trip.id),
        }}
      />

      <div className="trip-meta" style={{ marginBottom: 16 }}>
        <span>🗓 {dateRange(trip.startDate, trip.endDate)} · {trip.days} 天</span>
        {trip.cityName ? <span>📍 {trip.cityName}</span> : null}
        {trip.companions ? <span>👥 {trip.companions}</span> : null}
        {trip.cost ? <span>💰 ¥{trip.cost}</span> : null}
      </div>

      {trip.content ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="detail-content">{trip.content}</div>
        </div>
      ) : null}

      {stopPoints.length ? (
        <section style={{ marginBottom: 22 }}>
          <div className="section-title">地图站点</div>
          <TravelMap points={stopPoints} amapKey={amapKey()} securityCode={amapSecurityCode()} height={300} />
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {trip.stops.map((stop) => (
              <div className="card" key={stop.id} style={{ padding: "10px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <strong>{stop.name}</strong>
                  {stop.stopDate ? <span className="muted" style={{ fontSize: 12 }}>{stop.stopDate}</span> : null}
                </div>
                {stop.note ? <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{stop.note}</p> : null}
                {stop.photos.length ? (
                  <div className="gallery-grid" style={{ marginTop: 8 }}>
                    {stop.photos.map((path) => (
                      <figure key={path}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/media/photo?path=${encodeURIComponent(path)}`} alt={stop.name} />
                      </figure>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {trip.photos.length ? (
        <section>
          <div className="section-title">相册（{trip.photos.length}）</div>
          <div className="gallery-grid">
            {trip.photos.map((photo) => (
              <figure key={photo.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.caption ?? ""} loading="lazy" />
                {photo.caption ? <figcaption>{photo.caption}</figcaption> : null}
              </figure>
            ))}
          </div>
        </section>
      ) : (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 24 }}>
          还没有照片。<Link className="link" href={`/trips/${trip.id}/edit`}>去引用飞牛相册里的照片</Link>
        </div>
      )}
    </div>
  );
}
