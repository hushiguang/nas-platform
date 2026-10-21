"use client";

import { useLayoutEffect, useRef, useState } from "react";

export function NoteClamp({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [active, setActive] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflow(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div
      className={[overflow ? "anniv-note-wrap has-more" : "anniv-note-wrap", active ? "active" : ""]
        .filter(Boolean)
        .join(" ")}
      tabIndex={overflow ? 0 : undefined}
      role={overflow ? "button" : undefined}
      aria-expanded={overflow ? active : undefined}
      onClick={overflow ? () => setActive((value) => !value) : undefined}
      onKeyDown={
        overflow
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setActive((value) => !value);
              }
              if (event.key === "Escape") setActive(false);
            }
          : undefined
      }
    >
      <p ref={ref} className="anniv-note">
        {text}
      </p>
      {overflow ? (
        <div className="anniv-note-pop" role="tooltip">
          {text}
        </div>
      ) : null}
    </div>
  );
}
