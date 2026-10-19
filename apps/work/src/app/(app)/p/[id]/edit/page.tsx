import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppAccess } from "@/auth";
import { getProject, listPeople } from "@/server";
import { ProjectForm } from "../../../form";

export const dynamic = "force-dynamic";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, access } = await requireAppAccess();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const item = await getProject(access, user.id, id);
  if (!item || !item.canManage) notFound();
  const people = await listPeople();

  return (
    <div>
      <Link href={`/p/${item.id}`} className="link" style={{ display: "inline-block", marginBottom: 8 }}>
        返回项目
      </Link>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">修改</span>
          <h1>{item.name}</h1>
        </div>
      </div>
      <ProjectForm
        initial={item.draft}
        suggestions={people.map((person) => person.nickname)}
        memberNames={item.members.map((member) => member.nickname)}
      />
    </div>
  );
}