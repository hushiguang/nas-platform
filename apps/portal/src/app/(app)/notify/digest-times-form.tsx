"use client";

import { useState } from "react";

/**
 * 每日汇总的发送时点：可以加 / 删多个 HH:mm。
 * 用受控 input 而不是 defaultValue —— 删掉中间一行后 index 会移位，非受控会串值。
 */
export function DigestTimesForm({
  times,
  action,
  reset,
}: {
  times: string[];
  action: (formData: FormData) => Promise<void>;
  reset: () => Promise<void>;
}) {
  const [rows, setRows] = useState<string[]>(times.length > 0 ? times : ["08:10"]);

  const setAt = (index: number, value: string) =>
    setRows((prev) => prev.map((row, i) => (i === index ? value : row)));
  const removeAt = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));

  return (
    <form action={action} style={{ display: "grid", gap: 12, maxWidth: 640 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((row, index) => (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="time"
              name="digestTime"
              value={row}
              onChange={(e) => setAt(index, e.target.value)}
              className="field"
              style={{ width: 150 }}
              required
            />
            <span className="muted" style={{ fontSize: 12 }}>
              每天 {row || "--:--"} 推一次汇总
            </span>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => removeAt(index)}
              disabled={rows.length <= 1}
            >
              删掉
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn ghost" onClick={() => setRows((prev) => [...prev, "18:00"])}>
          再加一个时间
        </button>
        <button type="submit" className="btn primary">
          保存
        </button>
        <button type="submit" formAction={reset} className="btn ghost">
          恢复默认
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          保存后约 15 秒生效，不用重启 worker
        </span>
      </div>
    </form>
  );
}
