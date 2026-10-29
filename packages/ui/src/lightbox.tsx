"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 图片缩略图 + 点击看大图（灯箱）。
 *
 * 支持多图预览：传入 `images`（一组图片地址）和当前缩略图对应的 `index`，
 * 打开后可以用左右按钮、键盘方向键或左右滑动切换预览。
 * 不传 `images` 时退化为单图预览。
 */
export function LightboxImage({
  src,
  alt = "",
  className = "todo-thumb",
  children,
  images,
  index = 0,
}: {
  src: string;
  alt?: string;
  className?: string;
  children?: React.ReactNode;
  images?: string[];
  index?: number;
}) {
  const list = images && images.length > 0 ? images : [src];
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(index);
  const touchStartX = useRef<number | null>(null);
  const touched = useRef(false);

  useEffect(() => {
    if (open) setCurrent(index);
  }, [open, index]);

  const safeIndex = Math.min(Math.max(current, 0), list.length - 1);

  function go(delta: number) {
    setCurrent((value) => {
      const next = value + delta;
      if (next < 0) return list.length - 1;
      if (next >= list.length) return 0;
      return next;
    });
  }

  // Esc 关闭；左右方向键切换。捕获阶段掐断传播，避免把下层弹窗也一起关掉。
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        go(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        go(1);
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, list.length]);

  function onTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
    touched.current = false;
  }

  function onTouchEnd(event: React.TouchEvent) {
    if (touchStartX.current == null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
    const delta = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 40) return;
    touched.current = true;
    if (delta < 0) go(1);
    else go(-1);
  }

  return (
    <span className={className}>
      <button type="button" className="todo-thumb-open" onClick={() => setOpen(true)} title="点击看大图">
        <img src={src} alt={alt} loading="lazy" />
      </button>
      {children}
      {open &&
        createPortal(
          <span
            className="lightbox"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              if (touched.current) {
                touched.current = false;
                return;
              }
              setOpen(false);
            }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {list.length > 1 ? (
              <>
                <button
                  type="button"
                  className="lightbox-nav lightbox-prev"
                  onClick={(event) => {
                    event.stopPropagation();
                    touched.current = false;
                    go(-1);
                  }}
                  aria-label="上一张"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="lightbox-nav lightbox-next"
                  onClick={(event) => {
                    event.stopPropagation();
                    touched.current = false;
                    go(1);
                  }}
                  aria-label="下一张"
                >
                  ›
                </button>
              </>
            ) : null}
            <img
              src={list[safeIndex]}
              alt={alt}
              onClick={(event) => {
                event.stopPropagation();
                if (touched.current) {
                  touched.current = false;
                  return;
                }
                setOpen(false);
              }}
            />
            {list.length > 1 ? (
              <span className="lightbox-counter">
                {safeIndex + 1} / {list.length}
              </span>
            ) : null}
          </span>,
          document.body,
        )}
    </span>
  );
}
