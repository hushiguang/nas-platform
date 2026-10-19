import { notFound } from "next/navigation";
import { appBaseUrl } from "@nas/core";
import { imageHostConfigured } from "@nas/media";
import { requireAppAccess } from "@/auth";
import { getAnniversary } from "@/server";
import { AnniversaryForm } from "../../../form";

export const dynamic = "force-dynamic";

export default async function EditAnniversaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, access } = await requireAppAccess();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const item = await getAnniversary(access, user.id, id);
  if (!item) notFound();

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">修改</span>
          <h1>{item.name}</h1>
        </div>
      </div>
      <AnniversaryForm
        initial={item.draft}
        canUpload={imageHostConfigured}
        billBase={appBaseUrl("bill")}
      />
    </div>
  );
}
