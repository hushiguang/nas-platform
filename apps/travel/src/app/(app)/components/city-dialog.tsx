"use client";

import { useState } from "react";
import { CityForm, type CityDraft } from "./city-form";

/** 城市页的新增/编辑弹层，点击按钮打开 */
export function CityDialog({ initial, label }: { initial: CityDraft; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? (
        <div className="picker-overlay" onClick={() => setOpen(false)}>
          <div
            className="picker-panel"
            style={{ width: "min(560px, 100%)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="picker-head">
              <strong>{label}</strong>
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
            <div className="picker-body">
              <CityForm initial={initial} onDone={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
