"use client";

import { useState } from "react";
import { saveCityAction } from "../mutate";

export interface CityDraft {
  id?: number;
  name: string;
  country: string;
  status: "VISITED" | "WISHLIST";
  visits: string;
  firstVisit: string;
  lastVisit: string;
  lat: string;
  lng: string;
}

export function CityForm({
  initial,
  onDone,
}: {
  initial: CityDraft;
  onDone?: () => void;
}) {
  const [status, setStatus] = useState(initial.status);
  const [name, setName] = useState(initial.name);
  const [lat, setLat] = useState(initial.lat);
  const [lng, setLng] = useState(initial.lng);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function locate() {
    if (!name.trim()) {
      setError("先填城市名");
      return;
    }
    setError(null);
    const res = await fetch(`/api/geocode?name=${encodeURIComponent(name.trim())}`);
    const data = (await res.json().catch(() => ({}))) as { lat?: number; lng?: number; message?: string };
    if (!res.ok || data.lat == null || data.lng == null) {
      setError(data.message || "没查到坐标");
      return;
    }
    setLat(String(data.lat));
    setLng(String(data.lng));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      form.set("status", status);
      const result = await saveCityAction(form);
      if (result?.message) setError(result.message);
      else onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form-stack" onSubmit={onSubmit}>
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="status" value={status} />

      {error ? <div className="notice">{error}</div> : null}

      <div className="form-row">
        <label className="form-label">
          城市
          <input className="field" name="name" value={name} maxLength={40} required placeholder="大理" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="form-label">
          国家 / 地区
          <input className="field" name="country" defaultValue={initial.country || "中国"} maxLength={40} />
        </label>
      </div>

      <div className="form-label">
        状态
        <div className="choice-row">
          <button type="button" className={status === "VISITED" ? "choice active" : "choice"} onClick={() => setStatus("VISITED")}>
            ✔ 已去过
          </button>
          <button type="button" className={status === "WISHLIST" ? "choice active" : "choice"} onClick={() => setStatus("WISHLIST")}>
            ☆ 想去
          </button>
        </div>
      </div>

      <div className="form-row">
        <label className="form-label">
          纬度
          <input className="field" name="lat" value={lat} placeholder="25.6" onChange={(e) => setLat(e.target.value)} />
        </label>
        <label className="form-label">
          经度
          <input className="field" name="lng" value={lng} placeholder="100.2" onChange={(e) => setLng(e.target.value)} />
        </label>
        <button type="button" className="btn ghost" onClick={() => void locate()}>
          按名称查坐标
        </button>
      </div>

      <div className="form-row">
        <label className="form-label">
          到访次数
          <input className="field" name="visits" inputMode="numeric" defaultValue={initial.visits} placeholder="1" />
        </label>
        <label className="form-label">
          首次到访
          <input className="field" type="date" name="firstVisit" defaultValue={initial.firstVisit} />
        </label>
        <label className="form-label">
          最近到访
          <input className="field" type="date" name="lastVisit" defaultValue={initial.lastVisit} />
        </label>
      </div>

      <button className="btn" type="submit" disabled={busy}>
        {busy ? "保存中…" : "保存城市"}
      </button>
    </form>
  );
}
