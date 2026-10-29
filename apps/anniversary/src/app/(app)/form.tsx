"use client";

import { useState } from "react";
import type { AnniversaryType } from "@nas/db";
import { GALLERY, GRADIENTS } from "@nas/media/catalog";
import { useImagePaste } from "@nas/ui";
import { LUNAR_DAYS, LUNAR_MONTHS, REMIND_CHOICES, TYPE_OPTIONS, lunarDayName } from "@/lib/labels";
import { coverPresentation } from "@/lib/cover";
import type { AnniversaryDraft, BillDraft, YearNoteDraft } from "@/server";
import { saveAnniversaryAction } from "./mutate";

export function AnniversaryForm({
  initial,
  canUpload,
  billBase,
}: {
  initial: AnniversaryDraft;
  canUpload: boolean;
  billBase: string;
}) {
  const [type, setType] = useState<AnniversaryType>(initial.type === "COUNTDOWN" ? "OTHER" : initial.type);
  const initialParts = initial.date.split("-");
  const [birthYear, setBirthYear] = useState(initialParts[0] ?? "");
  const [birthMonth, setBirthMonth] = useState(initialParts[1] ? String(Number(initialParts[1])) : "");
  const [birthDay, setBirthDay] = useState(initialParts[2] ? String(Number(initialParts[2])) : "");
  const birthDate =
    birthYear && birthMonth && birthDay
      ? `${birthYear}-${birthMonth.padStart(2, "0")}-${birthDay.padStart(2, "0")}`
      : "";
  const [calendar, setCalendar] = useState(initial.calendar);
  const [background, setBackground] = useState(initial.background);
  const [uploaded, setUploaded] = useState(
    initial.background.startsWith("http") ? initial.background : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bills, setBills] = useState<Array<BillDraft & { key: string }>>(() => {
    const rows = initial.bills.length
      ? initial.bills
      : [{ year: String(new Date().getFullYear()), label: "", href: "" }];
    return rows.map((bill, index) => ({ ...bill, key: `bill-${index}` }));
  });
  const [notes, setNotes] = useState<Array<YearNoteDraft & { key: string }>>(() => {
    const rows = initial.notes.length
      ? initial.notes
      : [{ year: String(new Date().getFullYear()), note: "" }];
    return rows.map((note, index) => ({ ...note, key: `note-${index}` }));
  });

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("image", file);
      const res = await fetch("/api/media/upload", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!res.ok || !data.url) {
        setError(data.message || "上传失败");
        return;
      }
      setUploaded(data.url);
      setBackground(data.url);
    } finally {
      setBusy(false);
    }
  }

  // 表单开着时，剪贴板里的截图直接当封面；没有图片的粘贴不拦，文字照常
  useImagePaste(
    (files) => {
      const file = files[0];
      if (file && canUpload && !busy) void onUpload(file);
    },
    canUpload && !busy,
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    form.set("type", type);
    form.set("calendar", calendar);
    form.set("background", background);
    form.delete("billId");
    form.delete("billYear");
    form.delete("billLabel");
    form.delete("billHref");
    for (const bill of bills) {
      if (!bill.href.trim() && !bill.label.trim()) continue;
      form.append("billId", bill.id ? String(bill.id) : "");
      form.append("billYear", bill.year.trim());
      form.append("billLabel", bill.label.trim());
      form.append("billHref", bill.href.trim());
    }
    form.delete("noteId");
    form.delete("noteYear");
    form.delete("noteText");
    for (const note of notes) {
      if (!note.note.trim() && !note.year.trim()) continue;
      form.append("noteId", note.id ? String(note.id) : "");
      form.append("noteYear", note.year.trim());
      form.append("noteText", note.note.trim());
    }
    const result = await saveAnniversaryAction(form);
    if (result?.message) setError(result.message);
  }

  const uploadedPreview = uploaded ? coverPresentation(uploaded).image : null;

  return (
    <form className="card form-stack" onSubmit={onSubmit}>
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="calendar" value={calendar} />
      <input type="hidden" name="background" value={background} />

      {error ? <div className="notice">{error}</div> : null}

      <label className="form-label">
        名字
        <input className="field" name="name" defaultValue={initial.name} maxLength={40} required placeholder="比如 妈妈的生日" />
      </label>

      <div className="form-label">
        类型
        <div className="choice-row">
          {TYPE_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={type === item.value ? "choice active" : "choice"}
              onClick={() => setType(item.value)}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-label">
        历法
        <div className="choice-row">
          <button
            type="button"
            className={calendar === "SOLAR" ? "choice active" : "choice"}
            onClick={() => setCalendar("SOLAR")}
          >
            公历
          </button>
          <button
            type="button"
            className={calendar === "LUNAR" ? "choice active" : "choice"}
            onClick={() => setCalendar("LUNAR")}
          >
            农历
          </button>
        </div>
      </div>

      {calendar === "SOLAR" && type === "BIRTHDAY" ? (
        <div className="form-label">
          出生年月日
          <div className="form-row">
            <label className="form-label">
              年
              <input
                className="field"
                type="number"
                min={1900}
                max={new Date().getFullYear()}
                value={birthYear}
                required
                placeholder="1990"
                onChange={(event) => setBirthYear(event.target.value)}
              />
            </label>
            <label className="form-label">
              月
              <select className="field" value={birthMonth} required onChange={(event) => setBirthMonth(event.target.value)}>
                <option value="">月</option>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                  <option key={month} value={month}>
                    {month} 月
                  </option>
                ))}
              </select>
            </label>
            <label className="form-label">
              日
              <select className="field" value={birthDay} required onChange={(event) => setBirthDay(event.target.value)}>
                <option value="">日</option>
                {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                  <option key={day} value={day}>
                    {day} 日
                  </option>
                ))}
              </select>
            </label>
          </div>
          <input type="hidden" name="date" value={birthDate} />
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
            按出生那天算岁数。还没到的生日，卡片上是即将满的岁数。
          </p>
        </div>
      ) : calendar === "SOLAR" ? (
        <label className="form-label">
          日期
          <input
            className="field"
            type="date"
            name="date"
            value={birthDate}
            required
            onChange={(event) => {
              const [year, month, day] = event.target.value.split("-");
              setBirthYear(year ?? "");
              setBirthMonth(month ? String(Number(month)) : "");
              setBirthDay(day ? String(Number(day)) : "");
            }}
          />
        </label>
      ) : (
        <div className="form-label">
        <div className="form-row">
          <label className="form-label">
            {type === "BIRTHDAY" ? "出生年" : "农历年"}
            <input
              className="field"
              type="number"
              name="lunarYear"
              min={1900}
              max={type === "BIRTHDAY" ? new Date().getFullYear() : 2100}
              defaultValue={initial.lunarYear}
              required
            />
          </label>
          <label className="form-label">
            月
            <select className="field" name="lunarMonth" defaultValue={initial.lunarMonth}>
              {LUNAR_MONTHS.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            日
            <select className="field" name="lunarDay" defaultValue={initial.lunarDay}>
              {LUNAR_DAYS.map((day) => (
                <option key={day} value={day}>
                  {lunarDayName(day)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            闰月
            <span className="choice" style={{ justifyContent: "flex-start" }}>
              <input type="checkbox" name="lunarLeap" defaultChecked={initial.lunarLeap} />
              这一月是闰月
            </span>
          </label>
        </div>
        {type === "BIRTHDAY" ? (
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
            按农历出生日算岁数。还没到的生日，卡片上是即将满的岁数。
          </p>
        ) : null}
        </div>
      )}

      <div className="form-label">
        背景
        <div className="cover-grid">
          <button
            type="button"
            className={background === "" ? "cover-opt active" : "cover-opt"}
            onClick={() => setBackground("")}
          >
            <span>不设</span>
          </button>
          {GRADIENTS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={background === `gradient:${item.id}` ? "cover-opt active" : "cover-opt"}
              style={{ backgroundImage: item.background }}
              onClick={() => setBackground(`gradient:${item.id}`)}
            >
              <span>{item.name}</span>
            </button>
          ))}
          {GALLERY.map((item) => (
            <button
              key={item.id}
              type="button"
              className={background === `gallery:${item.id}` ? "cover-opt active" : "cover-opt"}
              style={{ backgroundImage: `url("/api/media/gallery/${item.id}")` }}
              onClick={() => setBackground(`gallery:${item.id}`)}
            >
              <span>{item.name}</span>
            </button>
          ))}
          {uploadedPreview ? (
            <button
              type="button"
              className={background === uploaded ? "cover-opt active" : "cover-opt"}
              style={{ backgroundImage: `url("${uploadedPreview}")` }}
              onClick={() => setBackground(uploaded)}
            >
              <span>我的</span>
            </button>
          ) : null}
          <label className={busy ? "cover-opt busy" : "cover-opt"}>
            <span>{busy ? "上传中" : "上传"}</span>
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void onUpload(file);
              }}
            />
          </label>
        </div>
        <span>
          {canUpload
            ? "点一张就用它，也可以直接粘贴截图。自己上传的图片和账单走同一套图床。照片来自 Unsplash。"
            : "图床还没配置，先从图库里选。配好 IMAGE_HOST 之后就能上传。"}
        </span>
      </div>

      <label className="form-label">
        图标
        <input className="field" name="icon" defaultValue={initial.icon} maxLength={8} placeholder="不填就按类型显示" />
      </label>

      <label className="form-label">
        备注
        <textarea className="field" name="note" defaultValue={initial.note} maxLength={500} placeholder="想记住的话" />
      </label>

      <div className="form-label">
        每年的备注
        <div className="bill-list">
          {notes.map((note) => (
            <div className="bill-row" key={note.key} style={{ alignItems: "flex-start" }}>
              <input
                className="field"
                inputMode="numeric"
                maxLength={4}
                value={note.year}
                placeholder="年份"
                aria-label="年份"
                onChange={(event) =>
                  setNotes((rows) =>
                    rows.map((row) => (row.key === note.key ? { ...row, year: event.target.value } : row)),
                  )
                }
              />
              <textarea
                className="field"
                maxLength={500}
                value={note.note}
                placeholder="这一年想记住的话"
                aria-label="备注"
                rows={2}
                style={{ flex: 1, minHeight: 60 }}
                onChange={(event) =>
                  setNotes((rows) =>
                    rows.map((row) => (row.key === note.key ? { ...row, note: event.target.value } : row)),
                  )
                }
              />
              <button
                type="button"
                className="btn ghost"
                onClick={() => setNotes((rows) => rows.filter((row) => row.key !== note.key))}
              >
                去掉
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              setNotes((rows) => [
                ...rows,
                { key: `note-${Date.now()}`, year: String(new Date().getFullYear()), note: "" },
              ])
            }
          >
            再加一条
          </button>
        </div>
      </div>
      <span className="muted" style={{ fontSize: 12, marginTop: -8 }}>
        每年留下一句话，按年份保存。空着的不会保存。
      </span>

      <div className="form-label">
        每年的账单
        <div className="bill-list">
          {bills.map((bill) => (
            <div className="bill-row" key={bill.key}>
              <input
                className="field"
                inputMode="numeric"
                maxLength={4}
                value={bill.year}
                placeholder="年份"
                aria-label="年份"
                onChange={(event) =>
                  setBills((rows) =>
                    rows.map((row) => (row.key === bill.key ? { ...row, year: event.target.value } : row)),
                  )
                }
              />
              <input
                className="field"
                maxLength={24}
                value={bill.label}
                placeholder="蛋糕"
                aria-label="买了什么"
                onChange={(event) =>
                  setBills((rows) =>
                    rows.map((row) => (row.key === bill.key ? { ...row, label: event.target.value } : row)),
                  )
                }
              />
              <input
                className="field"
                value={bill.href}
                placeholder={billBase ? `${billBase}/` : "/bills"}
                aria-label="账单链接"
                onChange={(event) =>
                  setBills((rows) =>
                    rows.map((row) => (row.key === bill.key ? { ...row, href: event.target.value } : row)),
                  )
                }
              />
              <button
                type="button"
                className="btn ghost"
                onClick={() => setBills((rows) => rows.filter((row) => row.key !== bill.key))}
              >
                去掉
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              setBills((rows) => [
                ...rows,
                {
                  key: `bill-${Date.now()}`,
                  year: String(new Date().getFullYear()),
                  label: "",
                  href: "",
                },
              ])
            }
          >
            再加一笔
          </button>
        </div>
      </div>
      <span className="muted" style={{ fontSize: 12, marginTop: -8 }}>
        每年买的东西可以各记一笔，填账单里的地址，保存后就能点过去。空着的一行不会保存。
      </span>

      <div className="form-label">
        提醒
        <div className="choice-row">
          {REMIND_CHOICES.map((item) => (
            <label key={item.days} className="choice" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                name="remindDays"
                value={item.days}
                defaultChecked={initial.remindDays.includes(item.days)}
              />
              {item.label}
            </label>
          ))}
        </div>
      </div>

      <label className="form-label">
        提醒时刻
        <input className="field" type="time" name="remindTime" defaultValue={initial.remindTime || "09:00"} />
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" type="submit" disabled={busy}>
          保存
        </button>
      </div>
    </form>
  );
}
