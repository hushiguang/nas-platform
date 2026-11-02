"use client";

import { useState } from "react";

/** 页面上展示的附件。只含文件名和类型，存储位置不带到浏览器。 */
export interface AttachmentItem {
  id: number;
  filename: string;
  mime: string;
  size: number;
}

function formatSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function previewKind(mime: string): "image" | "frame" | null {
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return "image";
  if (mime === "application/pdf" || mime === "text/plain" || mime === "text/csv") return "frame";
  return null;
}

function fileBadge(filename: string): string {
  const base = filename.trim();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "文件";
  const ext = base.slice(dot + 1).replace(/[^a-z0-9]/gi, "").slice(0, 4);
  return ext ? ext.toUpperCase() : "文件";
}

/**
 * 附件列表：文件名、大小、页面内浏览、直接下载。
 * 传了 uploadFile 才能添加；传了 onChange 才能移除（移除后的名单由调用方保存）。
 */
export function AttachmentFiles({
  items,
  href,
  uploadFile,
  onChange,
  disabled = false,
  emptyText = "还没有附件。PDF、表格、压缩包都能选，图片和 PDF 可以在这里打开。",
}: {
  items: AttachmentItem[];
  href: (item: AttachmentItem, kind: "view" | "download") => string;
  uploadFile?: (file: File) => Promise<AttachmentItem>;
  onChange?: (items: AttachmentItem[]) => void | Promise<void>;
  disabled?: boolean;
  emptyText?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  async function pick(list: FileList | null) {
    if (!uploadFile || !list?.length || busy || disabled) return;
    const files = [...list];
    setBusy(true);
    setError(null);
    let next = items;
    try {
      for (const file of files) {
        const item = await uploadFile(file);
        next = [...next, item];
        await onChange?.(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: AttachmentItem) {
    if (!onChange || busy || disabled) return;
    setError(null);
    try {
      await onChange(items.filter((row) => row.id !== item.id));
      if (openId === item.id) setOpenId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除失败");
    }
  }

  return (
    <div className="attach-files" onClick={(event) => event.stopPropagation()}>
      {uploadFile ? (
        <label className={`attach-pick${busy || disabled ? " is-off" : ""}`}>
          {busy ? "上传中…" : "选择文件"}
          <input
            type="file"
            multiple
            accept="*/*"
            disabled={busy || disabled}
            onChange={(event) => {
              void pick(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      ) : null}
      {error ? <p className="attach-error">{error}</p> : null}
      {items.length > 0 ? (
        <ul className="attach-list">
          {items.map((item) => {
            const kind = previewKind(item.mime);
            const open = openId === item.id;
            return (
              <li key={item.id} className="attach-item">
                <div className="attach-row">
                  <span className="attach-badge" aria-hidden="true">{fileBadge(item.filename)}</span>
                  <span className="attach-name" title={item.filename}>
                    {item.filename}
                  </span>
                  <span className="attach-size">{formatSize(item.size)}</span>
                  <span className="attach-actions">
                    {kind ? (
                      <button type="button" className="attach-act" onClick={() => setOpenId(open ? null : item.id)}>
                        {open ? "收起" : "浏览"}
                      </button>
                    ) : null}
                    <a className="attach-act" href={href(item, "download")}>
                      下载
                    </a>
                    {onChange ? (
                      <button type="button" className="attach-act is-danger" onClick={() => void remove(item)}>
                        移除
                      </button>
                    ) : null}
                  </span>
                </div>
                {open ? (
                  <div className="attach-preview">
                    {kind === "image" ? (
                      <img src={href(item, "view")} alt={item.filename} />
                    ) : kind === "frame" ? (
                      <iframe title={item.filename} src={href(item, "view")} />
                    ) : (
                      <p className="attach-empty">这个格式不能在页面里打开，点下载即可。</p>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : uploadFile ? (
        <p className="attach-empty">{emptyText}</p>
      ) : null}
    </div>
  );
}
