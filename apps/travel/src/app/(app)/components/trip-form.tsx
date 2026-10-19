"use client";

import { useState } from "react";
import type { TripDraft } from "@/server";
import { saveTripAction } from "../mutate";
import { PhotoPicker } from "./photo-picker";

interface PhotoRow {
  path: string;
  caption: string;
}
interface StopRow {
  name: string;
  lat: string;
  lng: string;
  stopDate: string;
  note: string;
  photos: string[];
}

type PickerTarget = "cover" | "photos" | { stop: number } | null;

function photoSrc(path: string): string {
  return `/api/media/photo?path=${encodeURIComponent(path)}`;
}

export function TripForm({
  initial,
  cities,
  photoRootPath,
}: {
  initial: TripDraft;
  cities: { id: number; name: string }[];
  photoRootPath: string;
}) {
  const [cover, setCover] = useState(initial.cover);
  const [photos, setPhotos] = useState<PhotoRow[]>(initial.photos);
  const [stops, setStops] = useState<StopRow[]>(initial.stops);
  const [picker, setPicker] = useState<PickerTarget>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onPick(paths: string[]) {
    if (picker === "cover") {
      setCover(paths[0] ?? "");
    } else if (picker === "photos") {
      setPhotos((rows) => [
        ...rows,
        ...paths.filter((p) => !rows.some((r) => r.path === p)).map((path) => ({ path, caption: "" })),
      ]);
    } else if (picker && typeof picker === "object") {
      const index = picker.stop;
      setStops((rows) =>
        rows.map((row, i) =>
          i === index ? { ...row, photos: [...row.photos, ...paths.filter((p) => !row.photos.includes(p))] } : row,
        ),
      );
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      form.set("cover", cover);

      form.delete("photoPath");
      form.delete("photoCaption");
      for (const photo of photos) {
        form.append("photoPath", photo.path);
        form.append("photoCaption", photo.caption);
      }

      form.delete("stopName");
      form.delete("stopLat");
      form.delete("stopLng");
      form.delete("stopDate");
      form.delete("stopNote");
      form.delete("stopPhotos");
      for (const stop of stops) {
        form.append("stopName", stop.name);
        form.append("stopLat", stop.lat);
        form.append("stopLng", stop.lng);
        form.append("stopDate", stop.stopDate);
        form.append("stopNote", stop.note);
        form.append("stopPhotos", stop.photos.join("\n"));
      }

      const result = await saveTripAction(form);
      if (result?.message) setError(result.message);
    } finally {
      setBusy(false);
    }
  }

  async function locateStop(index: number) {
    const name = stops[index]?.name?.trim();
    if (!name) {
      setError("先填站点名字再查坐标");
      return;
    }
    setError(null);
    const res = await fetch(`/api/geocode?name=${encodeURIComponent(name)}`);
    const data = (await res.json().catch(() => ({}))) as { lat?: number; lng?: number; message?: string };
    if (!res.ok || data.lat == null || data.lng == null) {
      setError(data.message || "没查到坐标");
      return;
    }
    setStops((rows) => rows.map((row, i) => (i === index ? { ...row, lat: String(data.lat), lng: String(data.lng) } : row)));
  }

  return (
    <form className="card form-stack" onSubmit={onSubmit}>
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="cover" value={cover} />

      {error ? <div className="notice">{error}</div> : null}

      <label className="form-label">
        标题
        <input className="field" name="title" defaultValue={initial.title} maxLength={60} required placeholder="比如 大理三日" />
      </label>

      <div className="form-row">
        <label className="form-label">
          出发
          <input className="field" type="date" name="startDate" defaultValue={initial.startDate} required />
        </label>
        <label className="form-label">
          返程
          <input className="field" type="date" name="endDate" defaultValue={initial.endDate} required />
        </label>
      </div>

      <div className="form-row">
        <label className="form-label">
          城市
          <select className="field" name="cityId" defaultValue={initial.cityId ?? 0}>
            <option value={0}>不指定</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          同行人
          <input className="field" name="companions" defaultValue={initial.companions} maxLength={120} placeholder="和家人" />
        </label>
        <label className="form-label">
          花费
          <input className="field" name="cost" inputMode="decimal" defaultValue={initial.cost} placeholder="可选" />
        </label>
      </div>

      <label className="form-label">
        摘要
        <input className="field" name="summary" defaultValue={initial.summary} maxLength={200} placeholder="时间轴上的一句话" />
      </label>

      <label className="form-label">
        日记正文
        <textarea
          className="field"
          name="content"
          defaultValue={initial.content}
          rows={8}
          placeholder="这一趟去了哪、吃了什么、发生了什么…"
        />
      </label>

      <div className="form-label">
        封面
        <div className="cover-pick">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoSrc(cover)} alt="封面" />
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>
              不设就用第一张照片
            </span>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn ghost" onClick={() => setPicker("cover")}>
              选封面
            </button>
            {cover ? (
              <button type="button" className="btn ghost" onClick={() => setCover("")}>
                移除
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="form-label">
        相册
        <div className="photo-grid">
          {photos.map((photo, index) => (
            <div className="photo-item" key={photo.path}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoSrc(photo.path)} alt="" />
              <input
                className="field"
                value={photo.caption}
                maxLength={120}
                placeholder="图说"
                onChange={(event) =>
                  setPhotos((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, caption: event.target.value } : row)),
                  )
                }
              />
              <button
                type="button"
                className="btn ghost"
                onClick={() => setPhotos((rows) => rows.filter((_, i) => i !== index))}
              >
                移除
              </button>
            </div>
          ))}
          <button type="button" className="photo-add" onClick={() => setPicker("photos")}>
            + 从飞牛相册引用
          </button>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          照片目录：{photoRootPath}（只引用，不复制文件）
        </span>
      </div>

      <div className="form-label">
        地图站点（地图上的点标记）
        <div className="stop-list">
          {stops.map((stop, index) => (
            <div className="stop-card" key={index}>
              <div className="form-row">
                <label className="form-label">
                  名称
                  <input
                    className="field"
                    value={stop.name}
                    placeholder="洱海"
                    onChange={(event) =>
                      setStops((rows) => rows.map((row, i) => (i === index ? { ...row, name: event.target.value } : row)))
                    }
                  />
                </label>
                <label className="form-label">
                  日期
                  <input
                    className="field"
                    type="date"
                    value={stop.stopDate}
                    onChange={(event) =>
                      setStops((rows) => rows.map((row, i) => (i === index ? { ...row, stopDate: event.target.value } : row)))
                    }
                  />
                </label>
              </div>
              <div className="form-row">
                <label className="form-label">
                  纬度
                  <input
                    className="field"
                    value={stop.lat}
                    placeholder="25.7"
                    onChange={(event) =>
                      setStops((rows) => rows.map((row, i) => (i === index ? { ...row, lat: event.target.value } : row)))
                    }
                  />
                </label>
                <label className="form-label">
                  经度
                  <input
                    className="field"
                    value={stop.lng}
                    placeholder="100.2"
                    onChange={(event) =>
                      setStops((rows) => rows.map((row, i) => (i === index ? { ...row, lng: event.target.value } : row)))
                    }
                  />
                </label>
                <button type="button" className="btn ghost" onClick={() => void locateStop(index)}>
                  按名称查坐标
                </button>
              </div>
              <label className="form-label">
                备注
                <input
                  className="field"
                  value={stop.note}
                  maxLength={300}
                  placeholder="可选"
                  onChange={(event) =>
                    setStops((rows) => rows.map((row, i) => (i === index ? { ...row, note: event.target.value } : row)))
                  }
                />
              </label>
              <div className="photo-grid">
                {stop.photos.map((path) => (
                  <div className="photo-item" key={path}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoSrc(path)} alt="" />
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() =>
                        setStops((rows) =>
                          rows.map((row, i) =>
                            i === index ? { ...row, photos: row.photos.filter((p) => p !== path) } : row,
                          ),
                        )
                      }
                    >
                      移除
                    </button>
                  </div>
                ))}
                <button type="button" className="photo-add" onClick={() => setPicker({ stop: index })}>
                  + 站点照片
                </button>
              </div>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setStops((rows) => rows.filter((_, i) => i !== index))}
              >
                删除这个站点
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              setStops((rows) => [...rows, { name: "", lat: "", lng: "", stopDate: "", note: "", photos: [] }])
            }
          >
            + 添加站点
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </button>
      </div>

      <PhotoPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        onConfirm={onPick}
      />
    </form>
  );
}
