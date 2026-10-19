import { requireAppAccess } from "@/auth";
import { statsOf, listCities } from "@/server";
import { CityDialog } from "../components/city-dialog";
import { RemoveCityButton } from "../components/remove-city-button";

export const dynamic = "force-dynamic";

const EMPTY = {
  name: "",
  country: "中国",
  status: "VISITED" as const,
  visits: "",
  firstVisit: "",
  lastVisit: "",
  lat: "",
  lng: "",
};

export default async function CitiesPage() {
  const { user, access } = await requireAppAccess();
  const cities = await listCities(access, user.id);
  const stats = statsOf(cities);
  const visited = cities.filter((c) => c.status === "VISITED");
  const wish = cities.filter((c) => c.status === "WISHLIST");

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">城市足迹</span>
          <h1>去过的城市</h1>
        </div>
        <CityDialog initial={EMPTY} label="+ 添加城市" />
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <b>{stats.visited}</b>
          <span>已去过</span>
        </div>
        <div className="stat-card">
          <b>{stats.countries}</b>
          <span>国家 / 地区</span>
        </div>
        <div className="stat-card">
          <b>{stats.wishlist}</b>
          <span>想去</span>
        </div>
      </div>

      <section style={{ marginBottom: 24 }}>
        <div className="section-title">✔ 已去过</div>
        {visited.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>还没有。</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {visited.map((city) => (
              <CityRow key={city.id} city={city} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-title">☆ 想去</div>
        {wish.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>还没有。</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {wish.map((city) => (
              <CityRow key={city.id} city={city} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CityRow({ city }: { city: Awaited<ReturnType<typeof listCities>>[number] }) {
  return (
    <div className="card" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "10px 14px" }}>
      <div>
        <strong>{city.name}</strong>
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
          {city.country}
          {city.visits ? ` · 去了 ${city.visits} 次` : ""}
          {city.tripCount ? ` · ${city.tripCount} 趟行程` : ""}
        </span>
        {city.lastVisit ? (
          <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>最近 {city.lastVisit}</span>
        ) : null}
      </div>
      <RemoveCityButton id={city.id} />
    </div>
  );
}
