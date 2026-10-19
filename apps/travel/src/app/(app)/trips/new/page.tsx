import { requireAppAccess } from "@/auth";
import { emptyDraft, listCities, photoRoot } from "@/server";
import { TripForm } from "../../components/trip-form";

export const dynamic = "force-dynamic";

export default async function NewTripPage() {
  const { user, access } = await requireAppAccess();
  const cities = await listCities(access, user.id);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">时间轴</span>
          <h1>记一趟</h1>
        </div>
      </div>
      <TripForm
        initial={emptyDraft()}
        cities={cities.map((c) => ({ id: c.id, name: c.name }))}
        photoRootPath={photoRoot()}
      />
    </div>
  );
}
