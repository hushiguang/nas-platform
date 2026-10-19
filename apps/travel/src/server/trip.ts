import { scopeCondition, zonedDate, type PlatformAccess, type SessionUser } from "@nas/core";
import { prisma, Prisma } from "@nas/db";
import { TravelError } from "./errors";
import { assertSafePaths, photoUrl } from "./photos";

export interface PhotoDraft {
  path: string;
  caption: string;
}

export interface StopDraft {
  name: string;
  lat: string;
  lng: string;
  stopDate: string;
  note: string;
  photos: string[];
}

export interface TripDraft {
  id?: number;
  title: string;
  cityId: number | null;
  startDate: string;
  endDate: string;
  companions: string;
  cost: string;
  cover: string;
  summary: string;
  content: string;
  photos: PhotoDraft[];
  stops: StopDraft[];
}

export interface TripPhotoView {
  id: number;
  path: string;
  url: string;
  caption: string | null;
}

export interface StopView {
  id: number;
  name: string;
  lat: number;
  lng: number;
  stopDate: string | null;
  note: string | null;
  photos: string[];
  photoUrls: string[];
}

export interface TripView {
  id: number;
  title: string;
  cityId: number | null;
  cityName: string | null;
  startDate: string;
  endDate: string;
  days: number;
  companions: string | null;
  cost: string | null;
  cover: string | null;
  coverUrl: string | null;
  summary: string | null;
  content: string | null;
  photos: TripPhotoView[];
  stops: StopView[];
  draft: TripDraft;
}

export interface MapPoint {
  id: string;
  kind: "stop" | "city" | "wish";
  name: string;
  lat: number;
  lng: number;
  note: string | null;
  photos: string[];
}

const withRelations = {
  city: true,
  stops: { orderBy: { sort: "asc" as const } },
  photos: { orderBy: { sort: "asc" as const } },
} satisfies Prisma.TravelTripInclude;

type TripRow = Prisma.TravelTripGetPayload<{ include: typeof withRelations }>;

function scope(access: PlatformAccess, userId: number) {
  return scopeCondition(access, userId);
}

export function ymd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseIsoDate(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TravelError(`${label}不对`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TravelError(`${label}不对`);
  }
  return date;
}

function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function money(v: Prisma.Decimal | null): string | null {
  if (v == null) return null;
  const n = Number(v.toString());
  return n ? n.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : null;
}

/** 封面：空 → 用第一张照片；否则相对路径走代理 */
function coverUrlOf(cover: string | null, photos: { nasPath: string }[]): string | null {
  if (cover) return photoUrl(cover);
  const first = photos[0];
  return first ? photoUrl(first.nasPath) : null;
}

export function present(row: TripRow): TripView {
  const photos: TripPhotoView[] = row.photos.map((p) => ({
    id: p.id,
    path: p.nasPath,
    url: photoUrl(p.nasPath),
    caption: p.caption,
  }));
  const stops: StopView[] = row.stops.map((s) => {
    const paths = Array.isArray(s.photos) ? (s.photos as string[]) : [];
    return {
      id: s.id,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      stopDate: s.stopDate ? ymd(s.stopDate) : null,
      note: s.note,
      photos: paths,
      photoUrls: paths.map(photoUrl),
    };
  });
  const draft: TripDraft = {
    id: row.id,
    title: row.title,
    cityId: row.cityId,
    startDate: ymd(row.startDate),
    endDate: ymd(row.endDate),
    companions: row.companions ?? "",
    cost: row.cost == null ? "" : row.cost.toString(),
    cover: row.cover ?? "",
    summary: row.summary ?? "",
    content: row.content ?? "",
    photos: photos.map((p) => ({ path: p.path, caption: p.caption ?? "" })),
    stops: stops.map((s) => ({
      name: s.name,
      lat: String(s.lat),
      lng: String(s.lng),
      stopDate: s.stopDate ?? "",
      note: s.note ?? "",
      photos: s.photos,
    })),
  };
  return {
    id: row.id,
    title: row.title,
    cityId: row.cityId,
    cityName: row.city?.name ?? null,
    startDate: ymd(row.startDate),
    endDate: ymd(row.endDate),
    days: daysBetween(row.startDate, row.endDate),
    companions: row.companions,
    cost: money(row.cost),
    cover: row.cover,
    coverUrl: coverUrlOf(row.cover, row.photos),
    summary: row.summary,
    content: row.content,
    photos,
    stops,
    draft,
  };
}

export async function listTrips(access: PlatformAccess, userId: number): Promise<TripView[]> {
  const rows = await prisma.travelTrip.findMany({
    where: scope(access, userId),
    include: withRelations,
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
  });
  return rows.map(present);
}

export async function getTrip(access: PlatformAccess, userId: number, id: number): Promise<TripView | null> {
  const row = await prisma.travelTrip.findFirst({
    where: { id, ...scope(access, userId) },
    include: withRelations,
  });
  return row ? present(row) : null;
}

/** 时间轴：按年份分组的行程 */
export interface TimelineGroup {
  year: string;
  trips: TripView[];
}

export async function timeline(access: PlatformAccess, userId: number): Promise<TimelineGroup[]> {
  const trips = await listTrips(access, userId);
  const groups = new Map<string, TripView[]>();
  for (const trip of trips) {
    const year = trip.startDate.slice(0, 4);
    const bucket = groups.get(year) ?? [];
    bucket.push(trip);
    groups.set(year, bucket);
  }
  return [...groups.entries()].map(([year, list]) => ({ year, trips: list }));
}

/** 地图点：行程站点 + 有坐标的城市 */
export async function mapPoints(access: PlatformAccess, userId: number): Promise<MapPoint[]> {
  const [stops, cities] = await Promise.all([
    prisma.travelStop.findMany({
      where: { trip: { ...scope(access, userId) } },
      include: { trip: { select: { title: true } } },
      orderBy: [{ stopDate: "asc" }, { sort: "asc" }],
    }),
    prisma.travelCity.findMany({ where: scope(access, userId) }),
  ]);

  const points: MapPoint[] = [];
  for (const city of cities) {
    const geo = city.geo as { lat?: number; lng?: number } | null;
    if (geo && typeof geo.lat === "number" && typeof geo.lng === "number") {
      points.push({
        id: `city-${city.id}`,
        kind: city.status === "VISITED" ? "city" : "wish",
        name: city.name,
        lat: geo.lat,
        lng: geo.lng,
        note: null,
        photos: [],
      });
    }
  }
  for (const stop of stops) {
    const paths = Array.isArray(stop.photos) ? (stop.photos as string[]) : [];
    points.push({
      id: `stop-${stop.id}`,
      kind: "stop",
      name: stop.name,
      lat: stop.lat,
      lng: stop.lng,
      note: stop.note ?? stop.trip.title,
      photos: paths.map(photoUrl),
    });
  }
  return points;
}

function readText(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optText(form: FormData, key: string, max: number, label: string): string | null {
  const value = readText(form, key);
  if (value.length > max) throw new TravelError(`${label}太长了`);
  return value || null;
}

function parseCost(raw: string): Prisma.Decimal | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999) throw new TravelError("花费不对");
  return new Prisma.Decimal(n);
}

function parsePhotoPaths(form: FormData, key: string): Map<string, string> {
  const paths = form.getAll(key).map(String);
  assertSafePaths(paths);
  return new Map(paths.map((p) => [p, p]));
}

function parseStops(form: FormData): StopDraft[] {
  const names = form.getAll("stopName").map(String);
  const lats = form.getAll("stopLat").map(String);
  const lngs = form.getAll("stopLng").map(String);
  const dates = form.getAll("stopDate").map(String);
  const notes = form.getAll("stopNote").map(String);
  const photos = form.getAll("stopPhotos").map(String);
  if (names.length !== lats.length || names.length !== lngs.length || names.length !== dates.length) {
    throw new TravelError("站点没填完整");
  }
  const stops: StopDraft[] = [];
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i].trim();
    if (!name) continue;
    const lat = Number(lats[i]);
    const lng = Number(lngs[i]);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new TravelError("站点纬度不对");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new TravelError("站点经度不对");
    const paths = (photos[i] ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    assertSafePaths(paths);
    stops.push({
      name: name.slice(0, 40),
      lat: String(lat),
      lng: String(lng),
      stopDate: dates[i]?.trim() ?? "",
      note: (notes[i] ?? "").trim().slice(0, 300),
      photos: paths,
    });
  }
  if (stops.length > 60) throw new TravelError("站点太多了");
  return stops;
}

export async function saveTrip(user: SessionUser, access: PlatformAccess, form: FormData): Promise<number> {
  const title = readText(form, "title");
  if (!title) throw new TravelError("先写个标题");
  if (title.length > 60) throw new TravelError("标题太长了");

  const startDate = parseIsoDate(readText(form, "startDate"), "开始日期");
  const endRaw = readText(form, "endDate") || ymd(startDate);
  const endDate = parseIsoDate(endRaw, "结束日期");
  if (endDate < startDate) throw new TravelError("结束日期不能早于开始日期");

  const cityIdRaw = readText(form, "cityId");
  let cityId: number | null = null;
  if (cityIdRaw && cityIdRaw !== "0") {
    const n = Number(cityIdRaw);
    if (!Number.isInteger(n) || n <= 0) throw new TravelError("城市不对");
    cityId = n;
  }

  const content = readText(form, "content");
  if (content.length > 20_000) throw new TravelError("正文太长了");

  const coverRaw = readText(form, "cover");
  if (coverRaw) assertSafePaths([coverRaw]);

  const photoPaths = form.getAll("photoPath").map(String);
  const photoCaptions = form.getAll("photoCaption").map(String);
  assertSafePaths(photoPaths);
  if (photoPaths.length !== photoCaptions.length) throw new TravelError("照片没填完整");

  const stops = parseStops(form);

  const data = {
    title,
    startDate,
    endDate,
    cityId,
    companions: optText(form, "companions", 120, "同行人"),
    cost: parseCost(readText(form, "cost")),
    cover: coverRaw || null,
    summary: optText(form, "summary", 200, "摘要"),
    content: content || null,
  };

  const rawId = Number(readText(form, "id"));
  const id = Number.isInteger(rawId) && rawId > 0 ? rawId : null;

  return prisma.$transaction(async (tx) => {
    let tripId = id;
    if (!tripId) {
      const created = await tx.travelTrip.create({ data: { ...data, ownerId: user.id } });
      tripId = created.id;
    } else {
      const existing = await tx.travelTrip.findFirst({
        where: { id: tripId, ...scope(access, user.id) },
        select: { id: true },
      });
      if (!existing) throw new TravelError("找不到这趟行程", 404);
      await tx.travelTrip.update({ where: { id: tripId }, data });
    }

    // 照片：整体重建（顺序即数组顺序）
    await tx.travelPhoto.deleteMany({ where: { tripId } });
    if (photoPaths.length) {
      await tx.travelPhoto.createMany({
        data: photoPaths.map((nasPath, index) => ({
          tripId: tripId as number,
          nasPath,
          caption: (photoCaptions[index] ?? "").trim().slice(0, 120) || null,
          sort: index,
        })),
      });
    }

    // 站点：整体重建
    await tx.travelStop.deleteMany({ where: { tripId } });
    if (stops.length) {
      await tx.travelStop.createMany({
        data: stops.map((stop, index) => ({
          tripId: tripId as number,
          name: stop.name,
          lat: Number(stop.lat),
          lng: Number(stop.lng),
          stopDate: stop.stopDate ? parseIsoDate(stop.stopDate, "站点日期") : null,
          note: stop.note || null,
          photos: stop.photos,
          sort: index,
        })),
      });
    }
    return tripId;
  });
}

export async function removeTrip(access: PlatformAccess, userId: number, id: number): Promise<void> {
  const existing = await prisma.travelTrip.findFirst({
    where: { id, ...scope(access, userId) },
    select: { id: true },
  });
  if (!existing) throw new TravelError("找不到这趟行程", 404);
  await prisma.travelTrip.delete({ where: { id } });
}

export function emptyDraft(): TripDraft {
  const today = zonedDate(new Date());
  return {
    title: "",
    cityId: null,
    startDate: today,
    endDate: today,
    companions: "",
    cost: "",
    cover: "",
    summary: "",
    content: "",
    photos: [],
    stops: [],
  };
}
