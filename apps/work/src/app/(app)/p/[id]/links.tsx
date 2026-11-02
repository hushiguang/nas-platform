"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveProjectLinksAction } from "../../mutate";

type LinkKind = "changeList" | "jira";

const LIMIT = 20;

function tidy(rows: string[]): { links: string[] } | { error: string } {
  const links: string[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const value = raw.trim();
    if (!value) continue;
    if (value.length > 500) return { error: "链接太长了" };
    if (!/^https?:\/\//i.test(value)) return { error: "链接要以 http:// 或 https:// 开头" };
    if (seen.has(value)) continue;
    seen.add(value);
    links.push(value);
  }
  if (links.length > LIMIT) return { error: "链接太多了，最多 20 条" };
  return { links };
}

function LinkGroup({
  projectId,
  kind,
  label,
  links,
  canEdit,
}: {
  projectId: number;
  kind: LinkKind;
  label: string;
  links: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const signature = links.join("\n");
  const [seen, setSeen] = useState(signature);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(links.length ? links : [""]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (seen !== signature) {
    setSeen(signature);
    setDraft(links.length ? links : [""]);
    setEditing(false);
    setPending(false);
    setError(null);
  }

  function update(index: number, value: string) {
    setError(null);
    setDraft((rows) => rows.map((row, i) => (i === index ? value : row)));
  }

  function remove(index: number) {
    setDraft((rows) => {
      const next = rows.filter((_, i) => i !== index);
      return next.length > 0 ? next : [""];
    });
  }

  async function save() {
    const cleaned = tidy(draft);
    if ("error" in cleaned) {
      setError(cleaned.error);
      return;
    }
    setPending(true);
    setError(null);
    const result = await saveProjectLinksAction(projectId, kind, cleaned.links);
    if (result?.message) {
      setPending(false);
      setError(result.message);
      return;
    }
    setPending(false);
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="work-link-row">
      <i className="work-link-label">{label}</i>
      {editing ? (
        <form
          className="work-link-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {draft.map((value, index) => (
            <div className="work-link-edit-line" key={index}>
              <input
                className="field sm"
                value={value}
                placeholder="https://"
                disabled={pending}
                aria-label={`${label}链接 ${index + 1}`}
                onChange={(event) => update(index, event.target.value)}
              />
              <button type="button" className="ghost work-link-action" disabled={pending} onClick={() => remove(index)}>
                移除
              </button>
            </div>
          ))}
          <div className="work-link-edit-tools">
            <button
              type="button"
              className="ghost work-link-action"
              disabled={pending || draft.length >= LIMIT}
              onClick={() => setDraft((rows) => [...rows, ""])}
            >
              添加一条
            </button>
            <button type="submit" className="btn sm" disabled={pending}>
              {pending ? "保存中" : "保存"}
            </button>
            <button
              type="button"
              className="ghost work-link-action"
              disabled={pending}
              onClick={() => {
                setDraft(links.length ? links : [""]);
                setEditing(false);
                setError(null);
              }}
            >
              取消
            </button>
          </div>
          {error ? <p className="work-link-error">{error}</p> : null}
        </form>
      ) : (
        <>
          {links.length > 0 ? (
            <div className="work-link-list">
              {links.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="link work-link-anchor" title={url}>
                  {url}
                </a>
              ))}
            </div>
          ) : (
            <span className="work-link-empty">未添加</span>
          )}
          {canEdit ? (
            <button
              type="button"
              className="ghost work-link-action"
              onClick={() => {
                setDraft(links.length ? links : [""]);
                setError(null);
                setEditing(true);
              }}
            >
              编辑
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

export function ProjectLinks({
  projectId,
  changeListLinks,
  jiraLinks,
  canEdit,
}: {
  projectId: number;
  changeListLinks: string[];
  jiraLinks: string[];
  canEdit: boolean;
}) {
  return (
    <div className="work-link-rows">
      <LinkGroup projectId={projectId} kind="changeList" label="Change list" links={changeListLinks} canEdit={canEdit} />
      <LinkGroup projectId={projectId} kind="jira" label="Jira" links={jiraLinks} canEdit={canEdit} />
    </div>
  );
}
