"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

export interface GalleryItem {
  src: string;
  alt?: string;
  caption?: string;
}

export function PhotoGallery({ items }: { items: GalleryItem[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (index == null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIndex(null);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, items.length]);

  if (items.length === 0) {
    return null;
  }

  function close() {
    setIndex(null);
  }

  function go(delta: number) {
    setIndex((prev) => {
      if (prev == null) return prev;
      const next = prev + delta;
      if (next < 0) return items.length - 1;
      if (next >= items.length) return 0;
      return next;
    });
  }

  return (
    <>
      <div className="gallery-grid">
        {items.map((item, i) => (
          <figure key={i}>
            <button
              type="button"
              className="gallery-thumb"
              onClick={() => setIndex(i)}
              aria-label={item.caption || item.alt || `查看第 ${i + 1} 张`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.src} alt={item.alt ?? item.caption ?? ""} loading="lazy" />
            </button>
            {item.caption ? <figcaption>{item.caption}</figcaption> : null}
          </figure>
        ))}
      </div>

      {index != null &&
        createPortal(
          <div
            className="travel-lightbox"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              if (moved.current) {
                moved.current = false;
                return;
              }
              close();
            }}
            onTouchStart={(event) => {
              touchStartX.current = event.touches[0]?.clientX ?? null;
              moved.current = false;
            }}
            onTouchEnd={(event) => {
              const startX = touchStartX.current;
              if (startX == null) return;
              const endX = event.changedTouches[0]?.clientX ?? startX;
              const delta = endX - startX;
              touchStartX.current = null;
              if (Math.abs(delta) < 40) return;
              moved.current = true;
              if (delta < 0) go(1);
              else go(-1);
            }}
          >
            <button type="button" className="travel-lightbox-close" onClick={close}>
              关闭
            </button>
            {items.length > 1 ? (
              <>
                <button
                  type="button"
                  className="travel-lightbox-nav travel-lightbox-prev"
                  onClick={(event) => {
                    event.stopPropagation();
                    moved.current = false;
                    go(-1);
                  }}
                  aria-label="上一张"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="travel-lightbox-nav travel-lightbox-next"
                  onClick={(event) => {
                    event.stopPropagation();
                    moved.current = false;
                    go(1);
                  }}
                  aria-label="下一张"
                >
                  ›
                </button>
              </>
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={items[index].src}
              alt={items[index].alt ?? items[index].caption ?? ""}
              onClick={(event) => {
                event.stopPropagation();
                if (moved.current) {
                  moved.current = false;
                  return;
                }
                close();
              }}
            />
            {items.length > 1 ? (
              <span className="travel-lightbox-counter">
                {index + 1} / {items.length}
              </span>
            ) : null}
            {items[index].caption ? (
              <span className="travel-lightbox-caption">{items[index].caption}</span>
            ) : null}
          </div>,
          document.body,
        )}
    </>
  );
}
