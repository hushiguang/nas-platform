import { appBaseUrl } from "@nas/core";
import { imageHostConfigured } from "@nas/media";
import { requireAppAccess } from "@/auth";
import { emptyDraft } from "@/server";
import { AnniversaryForm } from "../form";

export const dynamic = "force-dynamic";

export default async function NewAnniversaryPage() {
  await requireAppAccess();
  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">新的一天</span>
          <h1>记下纪念日</h1>
        </div>
      </div>
      <AnniversaryForm
        initial={emptyDraft()}
        canUpload={imageHostConfigured}
        billBase={appBaseUrl("bill")}
      />
    </div>
  );
}
