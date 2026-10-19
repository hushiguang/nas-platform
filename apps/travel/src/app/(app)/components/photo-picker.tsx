"use client";

import { useCallback, useEffect, useState } from "react";

interface DirEntry {
  name: string;
  path: string;
}
interface PhotoEntry {
  name: string;
  path: string;
  url: string;
}
interface BrowseData {
  root: string;
  dir: string;
  parent: string | null;
  dirs: DirEntry[];
  photos: PhotoEntry[];
}

/**
 * 飞牛相册浏览器。目录即相册，点目录进入、点照片勾选。
 * 只返回相对路径 —— 不复制文件，引用即可。
 */
export function PhotoPicker({
  open,
  title = "从飞牛相册选照片",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  onConfirm: (paths: string[]) => void;
}) {
  const [data, setData] = useState<BrowseData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const load = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/photos?path=${encodeURIComponent(path)}`);
      const json = (await res.json().catch(() => ({}))) as BrowseData & { message?: string };
      if (!res.ok) {
        setError(json.message || "读取失败");
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError("读取失败");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setPicked([]);
      void load("");
    }
  }, [open, load]);

  if (!open) return null;

  const toggle = (path: string) => {
    setPicked((rows) => (rows.includes(path) ? rows.filter((p) => p !== path) : [...rows, path]));
  };

  const segments = data?.dir ? data.dir.split("/") : [];

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-panel" onClick={(event) => event.stopPropagation()}>
        <div className="picker-head">
          <strong>{title}</strong>
          <button type="button" className="btn ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="picker-crumbs">
          <button type="button" className="crumb" onClick={() => void load("")}>
            根目录
          </button>
          {segments.map((seg, index) => {
            const target = segments.slice(0, index + 1).join("/");
            return (
              <span key={target}>
                <span className="crumb-sep">/</span>
                <button type="button" className="crumb" onClick={() => void load(target)}>
                  {seg}
                </button>
              </span>
            );
          })}
        </div>

        <div className="picker-body">
          {loading ? <p className="muted">读取中…</p> : null}
          {error ? <p className="notice">{error}</p> : null}

          {data && (data.dirs.length > 0 || data.parent !== null) ? (
            <>
              <div className="picker-sec-title">相册 / 目录</div>
              <div className="picker-dirs">
                {data.parent !== null ? (
                  <button type="button" className="dir-chip" onClick={() => void load(data.parent as string)}>
                    ↩ 上一级
                  </button>
                ) : null}
                {data.dirs.map((dir) => (
                  <button key={dir.path} type="button" className="dir-chip" onClick={() => void load(dir.path)}>
                    📁 {dir.name}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {data ? (
            <>
              <div className="picker-sec-title">照片（{data.photos.length}）</div>
              {data.photos.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>
                  这个目录没有图片。换个目录，或确认照片目录已挂载。
                </p>
              ) : (
                <div className="picker-grid">
                  {data.photos.map((photo) => {
                    const active = picked.includes(photo.path);
                    return (
                      <button
                        key={photo.path}
                        type="button"
                        className={active ? "picker-cell selected" : "picker-cell"}
                        onClick={() => toggle(photo.path)}
                        title={photo.name}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.url} alt={photo.name} loading="lazy" />
                        {active ? <span className="picker-tick">✓</span> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="picker-foot">
          <span className="muted">已选 {picked.length} 张</span>
          <button
            type="button"
            className="btn"
            disabled={picked.length === 0}
            onClick={() => {
              onConfirm(picked);
              onClose();
            }}
          >
            引用这些照片
          </button>
        </div>
      </div>
    </div>
  );
}
