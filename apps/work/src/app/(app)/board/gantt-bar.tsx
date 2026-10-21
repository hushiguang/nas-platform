"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface BarTip {
  heading: string;
  meta?: string;
  lines?: string[];
  warn?: string;
}

export interface GanttBarProps {
  left: number;
  width: number;
  top: number;
  height: number;
  bg: string;
  fg: string;
  /** 描边色，不传就用底色 */
  line?: string;
  /** 单天或极短阶段的最小像素宽度，避免窄成一条缝 */
  minWidth?: number;
  label: string;
  note?: string;
  fontSize?: number;
  conflict?: boolean;
  /** 阶段筛选时，不匹配的条块淡出 */
  dim?: boolean;
  tip: BarTip;
}

interface TipPos {
  x: number;
  y: number;
}

const TIP_WIDTH = 268;
const TIP_HEIGHT_GUESS = 120;

export function GanttBar({
  left,
  width,
  top,
  height,
  bg,
  fg,
  line,
  minWidth,
  label,
  note,
  fontSize = 10.5,
  conflict,
  dim,
  tip,
}: GanttBarProps) {
  const [pos, setPos] = useState<TipPos | null>(null);

  const follow = useCallback((event: React.MouseEvent) => {
    setPos({ x: event.clientX, y: event.clientY });
  }, []);

  // 滚动时立刻收起，避免提示框停在原地和条块脱节
  useEffect(() => {
    if (!pos) return;
    const hide = () => setPos(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [pos]);

  let tipStyle: React.CSSProperties | undefined;
  if (pos) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = pos.x + 16 + TIP_WIDTH > vw ? Math.max(8, pos.x - TIP_WIDTH - 16) : pos.x + 16;
    const y = pos.y + 18 + TIP_HEIGHT_GUESS > vh ? Math.max(8, pos.y - TIP_HEIGHT_GUESS - 12) : pos.y + 18;
    tipStyle = { left: x, top: y };
  }

  return (
    <>
      <div
        className="gantt-bar"
        onMouseEnter={follow}
        onMouseMove={follow}
        onMouseLeave={() => setPos(null)}
        style={{
          left: `${left}%`,
          width: `${width}%`,
          minWidth,
          top,
          height,
          background: bg,
          color: fg,
          border: conflict ? "1.5px solid var(--coral)" : `1px solid ${line ?? "rgba(18,26,42,0.08)"}`,
          fontSize,
          opacity: dim ? 0.4 : 1,
        }}
      >
        <span className="gantt-bar-text" style={{ fontWeight: 600, flex: "0 0 auto" }}>
          {label}
        </span>
        {note ? (
          <span
            className="gantt-bar-text"
            style={{ fontSize: fontSize - 0.5, opacity: 0.82, flex: "0 1 auto", minWidth: 0 }}
          >
            {note}
          </span>
        ) : null}
      </div>
      {pos && tipStyle
        ? createPortal(
            <div
              style={{
                position: "fixed",
                ...tipStyle,
                zIndex: 90,
                width: TIP_WIDTH,
                padding: "10px 12px",
                borderRadius: 11,
                background: "rgba(22, 28, 40, 0.96)",
                color: "#f3f6fb",
                boxShadow: "0 14px 34px rgba(8, 14, 26, 0.38)",
                pointerEvents: "none",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: 12.5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: bg, flex: "none" }} />
                <span>{tip.heading}</span>
              </div>
              {tip.meta ? (
                <div style={{ marginTop: 3, fontSize: 11.5, opacity: 0.72 }}>{tip.meta}</div>
              ) : null}
              {tip.lines?.map((text) => (
                <div key={text} style={{ marginTop: 3, fontSize: 11.5, opacity: 0.92 }}>
                  {text}
                </div>
              ))}
              {tip.warn ? (
                <div style={{ marginTop: 5, fontSize: 11.5, color: "#ffb4b4" }}>{tip.warn}</div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
