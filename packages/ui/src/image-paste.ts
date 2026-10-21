"use client";

import { useEffect, useRef } from "react";

/** 从剪贴板里挑出图片文件。文字内容不碰，交给浏览器默认粘贴。 */
export function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  // 截图工具通常把图放在 items 里，files 只在部分浏览器上同步
  for (const item of data.items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length > 0) return files;
  for (const file of data.files) {
    if (file.type.startsWith("image/")) files.push(file);
  }
  return files;
}

/**
 * 页面级「粘贴截图」。
 *
 * 剪贴板里没有图片时完全不拦截，输入框里的文字照常粘贴；
 * 有图片时 preventDefault 并交给 onFiles。
 * 一般挂在弹窗/表单组件上，用 enabled 控制只在打开期间生效。
 */
export function useImagePaste(onFiles: (files: File[]) => void, enabled = true): void {
  const handler = useRef(onFiles);
  handler.current = onFiles;

  useEffect(() => {
    if (!enabled) return;
    function onPaste(event: ClipboardEvent) {
      const files = clipboardImageFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      handler.current(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [enabled]);
}
