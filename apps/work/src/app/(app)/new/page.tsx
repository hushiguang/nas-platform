import { requireAppAccess } from "@/auth";
import { emptyDraft, listPeople } from "@/server";
import { ProjectForm } from "../form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  await requireAppAccess();
  const people = await listPeople();
  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">阶段、优先级与上线时间</span>
          <h1>新建项目</h1>
        </div>
      </div>
      <ProjectForm
        initial={emptyDraft()}
        suggestions={people.map((person) => person.nickname)}
        memberNames={[]}
      />
    </div>
  );
}
