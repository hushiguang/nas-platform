/**
 * 用高德 Web 服务做「地名 → 坐标」。需要单独申请的 Web服务 Key（AMAP_WEB_KEY），
 * 与地图展示用的 Web端(JS API) Key 不是同一把。没配就退化成手动填坐标。
 */
import { TravelError } from "./errors";

export interface GeoResult {
  lat: number;
  lng: number;
  formatted: string;
}

interface GeoResponse {
  status?: string;
  geocodes?: Array<{ location?: string; formatted_address?: string }>;
}

export async function geocode(address: string): Promise<GeoResult> {
  const key = process.env.AMAP_WEB_KEY || "";
  const query = String(address || "").trim();
  if (!query) throw new TravelError("先填个地点");
  if (!key) throw new TravelError("还没配置高德的 Web服务 Key（AMAP_WEB_KEY），先手动填经纬度");

  const url = new URL("https://restapi.amap.com/v3/geocode/geo");
  url.searchParams.set("address", query);
  url.searchParams.set("key", key);

  let data: GeoResponse;
  try {
    const res = await fetch(url, { cache: "no-store" });
    data = (await res.json()) as GeoResponse;
  } catch {
    throw new TravelError("查询失败，稍后再试", 502);
  }

  const first = data.status === "1" ? data.geocodes?.[0] : undefined;
  if (!first?.location) throw new TravelError("没查到这个地点");

  const [lngStr, latStr] = first.location.split(",");
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new TravelError("坐标解析失败");
  return { lat, lng, formatted: first.formatted_address || query };
}
