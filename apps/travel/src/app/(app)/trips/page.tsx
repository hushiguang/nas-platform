import Link from "next/link";
import { requireAppAccess } from "@/auth";
import { dateRange, fallbackGradient } from "@/lib/labels";
import { timeline } from "@/server";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const { user, access } = await requireAppAccess();
  const groups = await timeline(access, user.id);
  const total = groups.reduce((sum, group) => sum + group.trips.length, 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">时间轴</span>
          <h1>旅行日记</h1>
        </div>
        <Link className="btn" href="/trips/new">
          记一趟
        </Link>
      </div>

      {total === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 32 }}>
          还没有行程记录。点「记一趟」，写日记、从飞牛相册引用照片、标出地图站点。
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.year}>
            <div className="timeline-year">{group.year} 年 · {group.trips.length} 趟</div>
            {group.trips.map((trip) => (
              <Link className="trip-card" key={trip.id} href={`/trips/${trip.id}`}>
                <div
                  className="trip-cover"
                  style={{
                    backgroundImage: trip.coverUrl ? `url("${trip.coverUrl}")` : fallbackGradient(trip.id),
                  }}
                />
                <div className="trip-body">
                  <h3>{trip.title}</h3>
                  <div className="trip-meta">
                    <span>{dateRange(trip.startDate, trip.endDate)}</span>
                    {trip.cityName ? <span>📍 {trip.cityName}</span> : null}
                    <span>{trip.days} 天</span>
                    {trip.stops.length ? <span>{trip.stops.length} 个站点</span> : null}
                    {trip.photos.length ? <span>{trip.photos.length} 张照片</span> : null}
                    {trip.companions ? <span>👥 {trip.companions}</span> : null}
                  </div>
                  {trip.summary ? <p className="trip-summary">{trip.summary}</p> : null}
                </div>
              </Link>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
