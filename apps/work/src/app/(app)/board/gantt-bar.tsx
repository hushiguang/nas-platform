"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const barRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<TipPos | null>(null);

  const follow = useCallback((event: React.MouseEvent) => {
    setPos({ x: event.clientX, y: event.clientY });
  }, []);

  // 触摸屏没有 hover：点一下条块就把提示钉在手指位置，点空白处或滚动再收起
  const startTouch = useCallback((event: React.PointerEvent) => {
    if (event.pointerType === "mouse") return;
    touchStart.current = { x: event.clientX, y: event.clientY };
  }, []);

  const toggleByTouch = useCallback((event: React.PointerEvent) => {
    if (event.pointerType === "mouse") return;
    const start = touchStart.current;
    touchStart.current = null;
    // 横向拖动时间轴时不要误弹提示
    if (start && Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) > 8) return;
    const rect = barRef.current?.getBoundingClientRect();
    setPos({ x: event.clientX || rect?.left || 0, y: event.clientY || rect?.top || 0 });
  }, []);

  // 键盘/读屏也能拿到同样的信息
  const showFromBar = useCallback(() => {
    const rect = barRef.current?.getBoundingClientRect();
    if (rect) setPos({ x: rect.left + rect.width / 2, y: rect.top + rect.height });
  }, []);

  // 滚动时立刻收起，避免提示框停在原地和条块脱节
  useEffect(() => {
    if (!pos) return;
    const hide = () => setPos(null);
    const hideOutside = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setPos(null);
    };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    document.addEventListener("pointerdown", hideOutside);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      document.removeEventListener("pointerdown", hideOutside);
    };
  }, [pos]);

  const tipText = [tip.heading, tip.meta, ...(tip.lines ?? []), tip.warn].filter(Boolean).join(" / ");

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
        ref={barRef}
        className="gantt-bar"
        role="button"
        tabIndex={0}
        title={tipText}
        aria-label={tipText}
        onMouseEnter={follow}
        onMouseMove={follow}
        onMouseLeave={() => setPos(null)}
        onPointerDown={startTouch}
        onPointerUp={toggleByTouch}
        onFocus={showFromBar}
        onBlur={() => setPos(null)}
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
