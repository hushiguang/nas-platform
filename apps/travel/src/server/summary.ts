import { prisma } from "@nas/db";
import { ymd } from "./trip";

export interface TravelSummary {
  tripCount: number;
  cityCount: number;
  visitedCount: number;
  photoCount: number;
  recent: { id: number; title: string; startDate: string; endDate: string; cityName: string | null }[];
}

/** 门户首页汇总用：某人的足迹概览 + 最近几趟行程 */
export async function travelSummary(userId: number): Promise<TravelSummary> {
  const [tripCount, cityCount, visitedCount, photoCount, recent] = await Promise.all([
    prisma.travelTrip.count({ where: { ownerId: userId } }),
    prisma.travelCity.count({ where: { ownerId: userId } }),
    prisma.travelCity.count({ where: { ownerId: userId, status: "VISITED" } }),
    prisma.travelPhoto.count({ where: { trip: { ownerId: userId } } }),
    prisma.travelTrip.findMany({
      where: { ownerId: userId },
      include: { city: { select: { name: true } } },
      orderBy: [{ startDate: "desc" }, { id: "desc" }],
      take: 4,
    }),
  ]);
  return {
    tripCount,
    cityCount,
    visitedCount,
    photoCount,
    recent: recent.map((t) => ({
      id: t.id,
      title: t.title,
      startDate: ymd(t.startDate),
      endDate: ymd(t.endDate),
      cityName: t.city?.name ?? null,
    })),
  };
}
