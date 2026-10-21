"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 图片缩略图 + 点击看大图（灯箱）。
 *
 * 待办应用的待办行、编辑弹窗都用它 —— 之前缩略图点了没反应/只是开新窗口，
 * 体验不一致。这里统一成：点缩略图弹全屏遮罩，点任意处（含大图本身）或按 Esc 关闭。
 * `children` 用于在缩略图上叠额外元素（如编辑弹窗里的删除按钮）。
 *
 * 遮罩用 portal 挂到 body：编辑弹窗那层有 backdrop-filter，会给 fixed 子元素
 * 造一个新的包含块，直接放里面会被裁掉。
 */
export function LightboxImage({
  src,
  alt = "",
  className = "todo-thumb",
  children,
}: {
  src: string;
  alt?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // Esc 关闭。挂在捕获阶段并掐断传播：大图常盖在编辑弹窗之上，
  // 冒泡阶段的 Esc 会把下层弹窗也一起关掉。
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  return (
    <span className={className}>
      <button type="button" className="todo-thumb-open" onClick={() => setOpen(true)} title="点击看大图">
        <img src={src} alt={alt} loading="lazy" />
      </button>
      {children}
      {open &&
        createPortal(
          <span className="lightbox" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
            <img src={src} alt={alt} />
          </span>,
          document.body,
        )}
    </span>
  );
}

