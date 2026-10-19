import { notFound } from "next/navigation";
import { requireAppAccess } from "@/auth";
import { getTrip, listCities, photoRoot } from "@/server";
import { TripForm } from "../../../components/trip-form";

export const dynamic = "force-dynamic";

export default async function EditTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tripId = Number(id);
  if (!Number.isInteger(tripId) || tripId <= 0) notFound();

  const { user, access } = await requireAppAccess();
  const [trip, cities] = await Promise.all([getTrip(access, user.id, tripId), listCities(access, user.id)]);
  if (!trip) notFound();

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">时间轴</span>
          <h1>编辑行程</h1>
        </div>
      </div>
      <TripForm
        initial={trip.draft}
        cities={cities.map((c) => ({ id: c.id, name: c.name }))}
        photoRootPath={photoRoot()}
      />
    </div>
  );
}
