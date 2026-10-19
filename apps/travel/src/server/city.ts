import { scopeCondition, type PlatformAccess, type SessionUser } from "@nas/core";
import { prisma, type CityStatus, type Prisma } from "@nas/db";
import { TravelError } from "./errors";
import { ymd } from "./trip";

export interface CityView {
  id: number;
  name: string;
  country: string;
  status: CityStatus;
  visits: number;
  firstVisit: string | null;
  lastVisit: string | null;
  lat: number | null;
  lng: number | null;
  tripCount: number;
}

const withCount = {
  _count: { select: { trips: true } },
} satisfies Prisma.TravelCityInclude;

type CityRow = Prisma.TravelCityGetPayload<{ include: typeof withCount }>;

function scope(access: PlatformAccess, userId: number) {
  return scopeCondition(access, userId);
}

function geoOf(geo: Prisma.JsonValue | null): { lat: number | null; lng: number | null } {
  if (geo && typeof geo === "object" && !Array.isArray(geo)) {
    const lat = Number((geo as { lat?: unknown }).lat);
    const lng = Number((geo as { lng?: unknown }).lng);
    return {
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    };
  }
  return { lat: null, lng: null };
}

export function presentCity(row: CityRow): CityView {
  const { lat, lng } = geoOf(row.geo);
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    status: row.status,
    visits: row.visits,
    firstVisit: row.firstVisit ? ymd(row.firstVisit) : null,
    lastVisit: row.lastVisit ? ymd(row.lastVisit) : null,
    lat,
    lng,
    tripCount: row._count.trips,
  };
}

export async function listCities(access: PlatformAccess, userId: number): Promise<CityView[]> {
  const rows = await prisma.travelCity.findMany({
    where: scope(access, userId),
    include: withCount,
    orderBy: [{ status: "asc" }, { lastVisit: "desc" }, { name: "asc" }],
  });
  return rows.map(presentCity);
}

export interface CityStats {
  visited: number;
  wishlist: number;
  countries: number;
}

export function statsOf(cities: CityView[]): CityStats {
  const visited = cities.filter((c) => c.status === "VISITED");
  return {
    visited: visited.length,
    wishlist: cities.length - visited.length,
    countries: new Set(visited.map((c) => c.country)).size,
  };
}

function readText(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function parseOptionalDate(raw: string, label: string): Date | null {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new TravelError(`${label}不对`);
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TravelError(`${label}不对`);
  }
  return date;
}

export async function saveCity(user: SessionUser, access: PlatformAccess, form: FormData): Promise<number> {
  const name = readText(form, "name");
  if (!name) throw new TravelError("先写个城市名");
  if (name.length > 40) throw new TravelError("城市名太长了");

  const statusRaw = readText(form, "status");
  const status: CityStatus = statusRaw === "VISITED" ? "VISITED" : "WISHLIST";

  const visitsRaw = readText(form, "visits");
  let visits = 0;
  if (visitsRaw) {
    visits = Number(visitsRaw);
    if (!Number.isInteger(visits) || visits < 0 || visits > 999) throw new TravelError("到访次数不对");
  }
  if (status === "VISITED" && visits === 0) visits = 1;

  const latRaw = readText(form, "lat");
  const lngRaw = readText(form, "lng");
  let geo: Prisma.InputJsonValue | undefined;
  if (latRaw && lngRaw) {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new TravelError("纬度不对");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new TravelError("经度不对");
    geo = { lat, lng };
  }

  const data = {
    name,
    country: readText(form, "country").slice(0, 40) || "中国",
    status,
    visits,
    firstVisit: parseOptionalDate(readText(form, "firstVisit"), "首次到访"),
    lastVisit: parseOptionalDate(readText(form, "lastVisit"), "最近到访"),
    geo,
  };

  const rawId = Number(readText(form, "id"));
  const id = Number.isInteger(rawId) && rawId > 0 ? rawId : null;

  if (!id) {
    const created = await prisma.travelCity.create({ data: { ...data, ownerId: user.id } });
    return created.id;
  }
  const existing = await prisma.travelCity.findFirst({
    where: { id, ...scope(access, user.id) },
    select: { id: true },
  });
  if (!existing) throw new TravelError("找不到这个城市", 404);
  await prisma.travelCity.update({ where: { id }, data });
  return id;
}

export async function removeCity(access: PlatformAccess, userId: number, id: number): Promise<void> {
  const existing = await prisma.travelCity.findFirst({
    where: { id, ...scope(access, userId) },
    select: { id: true },
  });
  if (!existing) throw new TravelError("找不到这个城市", 404);
  await prisma.travelCity.delete({ where: { id } });
}
