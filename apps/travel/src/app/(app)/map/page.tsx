import { requireAppAccess } from "@/auth";
import { amapKey, amapSecurityCode } from "@/lib/amap";
import { mapPoints } from "@/server";
import { TravelMap } from "../components/travel-map";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const { user, access } = await requireAppAccess();
  const points = await mapPoints(access, user.id);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">地图</span>
          <h1>足迹地图</h1>
        </div>
      </div>
      <div className="trip-meta" style={{ marginBottom: 12 }}>
        <span>共 {points.length} 个点</span>
        <span style={{ color: "#2563eb" }}>● 已去城市</span>
        <span style={{ color: "#f59e0b" }}>● 想去</span>
        <span style={{ color: "#e11d48" }}>● 行程站点</span>
      </div>
      <TravelMap points={points} amapKey={amapKey()} securityCode={amapSecurityCode()} height={560} />
    </div>
  );
}
