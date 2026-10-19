import Link from "next/link";
import { requireAppAccess } from "@/auth";
import { amapKey, amapSecurityCode } from "@/lib/amap";
import { dateRange, fallbackGradient } from "@/lib/labels";
import { listCities, listTrips, mapPoints, statsOf } from "@/server";
import { TravelMap } from "./components/travel-map";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { user, access } = await requireAppAccess();
  const [cities, trips, points] = await Promise.all([
    listCities(access, user.id),
    listTrips(access, user.id),
    mapPoints(access, user.id),
  ]);
  const stats = statsOf(cities);
  const recent = trips.slice(0, 4);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">nas-platform</span>
          <h1>旅行足迹</h1>
        </div>
        <Link className="btn" href="/trips/new">
          记一趟
        </Link>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <b>{stats.visited}</b>
          <span>去过的城市</span>
        </div>
        <div className="stat-card">
          <b>{stats.countries}</b>
          <span>国家 / 地区</span>
        </div>
        <div className="stat-card">
          <b>{trips.length}</b>
          <span>趟行程</span>
        </div>
        <div className="stat-card">
          <b>{stats.wishlist}</b>
          <span>想去的地方</span>
        </div>
      </div>

      <section style={{ marginBottom: 24 }}>
        <div className="section-title">
          <span>足迹地图</span>
          <Link className="link" href="/map">
            全屏查看
          </Link>
        </div>
        <TravelMap points={points} amapKey={amapKey()} securityCode={amapSecurityCode()} height={320} />
      </section>

      <section>
        <div className="section-title">
          <span>最近行程</span>
          <Link className="link" href="/trips">
            全部
          </Link>
        </div>
        {recent.length === 0 ? (
          <div
            className="card"
            style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 32 }}
          >
            还没有行程。点右上角「记一趟」开始记录，照片从飞牛相册直接引用。
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {recent.map((trip) => (
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
                    {trip.photos.length ? <span>{trip.photos.length} 张照片</span> : null}
                  </div>
                  {trip.summary ? <p className="trip-summary">{trip.summary}</p> : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
