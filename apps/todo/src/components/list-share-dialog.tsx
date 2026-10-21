"use client";

import { useState } from "react";
import { setListShareAction } from "@/app/actions";

export interface ListShareState {
  id: number;
  name: string;
  shareEnabled: boolean;
  shareToken: string;
  shareWritable: boolean;
}

/**
 * 清单分享弹窗 —— 与账单的「账本分享」同一套交互：
 * 开启时生成 token（已有则复用），关闭只让链接失效、token 留着，
 * 所以「关了再开」不会让已经发出去的旧链接突然复活。
 */
export function ListShareDialog({
  list,
  trigger,
}: {
  list: ListShareState;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  function shareLink(): string {
    if (!list.shareToken) return "";
    if (typeof window === "undefined") return `/share/${list.shareToken}`;
    return `${window.location.origin}/share/${list.shareToken}`;
  }

  async function copyLink() {
    const link = shareLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const area = document.createElement("textarea");
      area.value = link;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function submit(form: FormData) {
    setPending(true);
    try {
      await setListShareAction(form);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <span onClick={() => setOpen(true)} className="todo-trigger">
        {trigger}
      </span>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal card share-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-head">
              <b>分享「{list.name}」</b>
              <button type="button" className="ghost" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>

            <p className="muted share-tip">
              {`开启后，拿到链接的人不用登录就能打开这个清单${
                list.shareWritable ? "，还能勾选条目、补充新条目。" : "，但只能查看。"
              }`}
            </p>

            {!list.shareEnabled ? (
              <div className="share-actions">
                <form action={submit}>
                  <input type="hidden" name="id" value={list.id} />
                  <input type="hidden" name="enabled" value="1" />
                  <input type="hidden" name="writable" value="0" />
                  <button className="btn" type="submit" disabled={pending}>
                    {pending ? "开启中…" : "开启只读分享"}
                  </button>
                </form>
                <form action={submit}>
                  <input type="hidden" name="id" value={list.id} />
                  <input type="hidden" name="enabled" value="1" />
                  <input type="hidden" name="writable" value="1" />
                  <button className="ghost" type="submit" disabled={pending}>
                    开启可勾选分享
                  </button>
                </form>
              </div>
            ) : (
              <>
                <div className="share-state">
                  <span className="badge soft">分享中</span>
                  <span className="muted">
                    {list.shareWritable ? "可勾选 / 可补条目" : "只读，仅可查看"}
                  </span>
                </div>

                <div className="share-link">
                  <div className="share-link-head">
                    <span className="muted">免登录链接</span>
                    <button type="button" className="ghost sm" onClick={copyLink}>
                      {copied ? "已复制" : "复制链接"}
                    </button>
                  </div>
                  <code>{shareLink()}</code>
                </div>

                <div className="share-actions">
                  <form action={submit}>
                    <input type="hidden" name="id" value={list.id} />
                    <input type="hidden" name="enabled" value="1" />
                    <input type="hidden" name="writable" value={list.shareWritable ? "0" : "1"} />
                    <button className="btn" type="submit" disabled={pending}>
                      {list.shareWritable ? "改为只读" : "改为可勾选"}
                    </button>
                  </form>
                  <form action={submit}>
                    <input type="hidden" name="id" value={list.id} />
                    <input type="hidden" name="enabled" value="0" />
                    <button
                      className="ghost"
                      type="submit"
                      style={{ color: "var(--coral)" }}
                      disabled={pending}
                    >
                      关闭分享链接
                    </button>
                  </form>
                </div>
              </>
            )}

            <p className="muted share-note">
              关闭后链接立即失效；重新开启会沿用旧链接，不用再发一遍。
            </p>
          </div>
        </div>
      )}
    </>
  );
}
