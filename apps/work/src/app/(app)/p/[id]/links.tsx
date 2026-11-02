"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveProjectLinksAction } from "../../mutate";

type LinkKind = "changeList" | "jira";

export interface ProjectLinkItem {
  title: string;
  url: string;
}

const LIMIT = 20;
const TITLE_LIMIT = 80;
const URL_LIMIT = 2000;

function emptyLink(): ProjectLinkItem {
  return { title: "", url: "" };
}

function tidy(rows: ProjectLinkItem[]): { links: ProjectLinkItem[] } | { error: string } {
  const links: ProjectLinkItem[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const title = row.title.replace(/\s+/g, " ").trim();
    const url = row.url.trim();
    if (!title && !url) continue;
    if (!title) return { error: "先写个标题" };
    if (!url) return { error: "先贴上链接" };
    if (title.length > TITLE_LIMIT) return { error: "标题太长了" };
    if (url.length > URL_LIMIT) return { error: "链接太长了" };
    if (!/^https?:\/\//i.test(url)) return { error: "链接要以 http:// 或 https:// 开头" };
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ title, url });
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
  links: ProjectLinkItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const signature = links.map((item) => `${item.title}\n${item.url}`).join("\n\n");
  const [seen, setSeen] = useState(signature);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProjectLinkItem[]>(links.length ? links.map((item) => ({ ...item })) : [emptyLink()]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (seen !== signature) {
    setSeen(signature);
    setDraft(links.length ? links.map((item) => ({ ...item })) : [emptyLink()]);
    setEditing(false);
    setPending(false);
    setError(null);
  }

  function update(index: number, patch: Partial<ProjectLinkItem>) {
    setError(null);
    setDraft((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function remove(index: number) {
    setDraft((rows) => {
      const next = rows.filter((_, i) => i !== index);
      return next.length > 0 ? next : [emptyLink()];
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
          {draft.map((row, index) => (
            <div className="work-link-edit-line" key={index}>
              <input
                className="field sm work-link-title"
                value={row.title}
                placeholder="标题"
                disabled={pending}
                aria-label={`${label}标题 ${index + 1}`}
                onChange={(event) => update(index, { title: event.target.value })}
              />
              <input
                className="field sm work-link-url"
                value={row.url}
                placeholder="https://"
                disabled={pending}
                aria-label={`${label}链接 ${index + 1}`}
                onChange={(event) => update(index, { url: event.target.value })}
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
              onClick={() => setDraft((rows) => [...rows, emptyLink()])}
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
                setDraft(links.length ? links.map((item) => ({ ...item })) : [emptyLink()]);
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
              {links.map((item) => (
                <a
                  key={item.url}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="link work-link-anchor"
                  title={item.url}
                >
                  {item.title}
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
                setDraft(links.length ? links.map((item) => ({ ...item })) : [emptyLink()]);
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
  changeListLinks: ProjectLinkItem[];
  jiraLinks: ProjectLinkItem[];
  canEdit: boolean;
}) {
  return (
    <div className="work-link-rows">
      <LinkGroup projectId={projectId} kind="changeList" label="Change list" links={changeListLinks} canEdit={canEdit} />
      <LinkGroup projectId={projectId} kind="jira" label="Jira" links={jiraLinks} canEdit={canEdit} />
    </div>
  );
}
