"use client";

/**
 * 新建 / 编辑待办的弹窗。
 *
 * 为什么客户端：图片要即时预览（File → objectURL），弹窗开关也得有状态。
 * 提交仍然走 Server Action —— 表单直接 submit 一个 FormData，File 会一起带过去，
 * 不需要再开上传接口。
 *
 * 日期时间一律按本地时区拼，服务端 parseDue 也按 +08:00 解析，两边口径一致。
 */
import { useEffect, useRef, useState } from "react";
import { useImagePaste } from "@nas/ui";
import { LightboxImage } from "./lightbox";
import { useScrollLock } from "./use-scroll-lock";

export interface ListOption {
  id: number;
  name: string;
  icon: string | null;
}

export interface TodoInitial {
  id: number;
  title: string;
  description: string | null;
  images: string[];
  /** 以下字段精简模式（分享页）不展示，可以不传 */
  listId?: number | null;
  priority?: string;
  dueDate?: string;
  dueTime?: string;
  remindOffsets?: number[];
  remindTime?: string;
}

/** 常用提醒档位。勾多个会各推一条（引擎按 offsetDays 逐条派发） */
const REMIND_PRESETS = [
  { value: 0, label: "当天" },
  { value: 1, label: "提前 1 天" },
  { value: 3, label: "提前 3 天" },
  { value: 7, label: "提前 7 天" },
];

const PRIORITIES = [
  { value: "HIGH", label: "重要" },
  { value: "MEDIUM", label: "普通" },
  { value: "LOW", label: "次要" },
];

/** 图片地址 → 可显示的 URL。本地兜底图与图床图都过 /api/image 这一层 */
export function imageSrc(address: string): string {
  return `/api/image?u=${encodeURIComponent(address)}`;
}

export function TodoDialog({
  lists,
  action,
  initial,
  defaultListId,
  defaultDueDate,
  trigger,
  open: openProp,
  onOpenChange,
  imageUrl,
  hiddenFields,
  basic = false,
}: {
  lists: ListOption[];
  /** 可以返回 { message } 把失败原因显示在弹窗里（分享页的图片超限等） */
  action: (form: FormData) => Promise<{ message?: string } | void>;
  initial?: TodoInitial;
  defaultListId?: number | null;
  /** 新建时"哪天"默认填今天（只定日期，几点留空） */
  defaultDueDate?: string;
  trigger?: React.ReactNode;
  /** 受控打开：传了 open 就由外部决定开合（行内点标题、点「编辑」共用同一个弹窗） */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 图片地址 → 可显示 URL。分享页要换成免登录代理（/api/image 需要登录） */
  imageUrl?: (address: string) => string;
  /** 额外随表单提交的隐藏字段（分享页的 token） */
  hiddenFields?: Record<string, string>;
  /** 精简模式：只留标题、备注、图片（分享给外部的人改，清单/日期/提醒这些不给动） */
  basic?: boolean;
}) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (next: boolean) => {
    if (!controlled) setOpenState(next);
    onOpenChange?.(next);
  };
  const showImage = imageUrl ?? imageSrc;
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [keepImages, setKeepImages] = useState<string[]>(initial?.images ?? []);
  const fileRef = useRef<HTMLInputElement>(null);
  const isEdit = Boolean(initial);

  // 弹窗开着时背景列表不许滑（手机上手势很容易把下面的列表拖走）
  useScrollLock(open);

  // 关掉弹窗时释放 objectURL，否则连续开几次会攒一堆内存
  useEffect(() => {
    if (open) return undefined;
    previews.forEach((url) => URL.revokeObjectURL(url));
    setPreviews([]);
    if (fileRef.current) fileRef.current.value = "";
    return undefined;
    // 只在关闭时跑一次，previews 变化不触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 每次打开都按最新的 initial.images 重置已有图片。
  // 关键：这类弹窗是常驻的客户端组件，保存后 React 会复用它、**不会**重跑
  // useState 初始化 —— 不同步的话，"加了图保存后再编辑"看到的是旧值（空），
  // 再一保存还会把图片写没。
  const imagesKey = (initial?.images ?? []).join("|");
  useEffect(() => {
    if (open) setKeepImages(initial?.images ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, imagesKey]);

  // 每次打开都从干净状态开始：上一轮的错误提示不该带到下一次
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  // 打开时自动聚焦标题（桌面）。H5 上聚焦会直接弹起输入法遮住半屏，
  // 触摸设备就不抢焦点了，等用户自己点输入框。
  useEffect(() => {
    if (!open) return;
    if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) return;
    titleRef.current?.focus();
  }, [open]);

  // Esc 关闭弹窗：写在 window 上而不是弹窗节点上，输入框里按 Esc 也能收起来
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (controlled) onOpenChange?.(false);
      else setOpenState(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, controlled, onOpenChange]);

  async function submit(form: FormData) {
    const result = await action(form);
    if (result && typeof result.message === "string" && result.message) {
      setError(result.message);
      return;
    }
    setError(null);
    setOpen(false);
  }

  /** 选文件和粘贴截图共用一套：预览走 objectURL，提交靠 input.files 原样带走 */
  function setSelectedFiles(files: File[]) {
    const next = files.slice(0, 9);
    previews.forEach((url) => URL.revokeObjectURL(url));
    setPreviews(next.map((file) => URL.createObjectURL(file)));
    if (fileRef.current) {
      const transfer = new DataTransfer();
      next.forEach((file) => transfer.items.add(file));
      fileRef.current.files = transfer.files;
    }
  }

  // 弹窗开着的时候，剪贴板里的截图直接当图片用；文字不受影响，照常粘贴
  useImagePaste((files) => {
    const picked = [...(fileRef.current?.files ?? [])];
    setSelectedFiles([...picked, ...files]);
  }, open);

  return (
    <>
      {trigger && (
        <span onClick={() => setOpen(true)} className="todo-trigger">
          {trigger}
        </span>
      )}

      {open && (
        <div className="modal-backdrop todo-modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal card todo-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">
              <b>{isEdit ? "编辑待办" : "记一件事"}</b>
              <button type="button" className="ghost" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>

            <form action={submit} className="form-stack">
              {isEdit && <input type="hidden" name="id" value={initial!.id} />}
              {Object.entries(hiddenFields ?? {}).map(([key, value]) => (
                <input key={key} type="hidden" name={key} value={value} />
              ))}

              <label className="field">
                <span className="form-label">要做什么</span>
                <input
                  ref={titleRef}
                  className="input"
                  name="title"
                  defaultValue={initial?.title ?? ""}
                  placeholder="买牛奶 / 交水电费 / 给车做保养"
                  required
                />
              </label>

              <label className="field">
                <span className="form-label">备注（可空）</span>
                <textarea className="input" name="description" rows={2} defaultValue={initial?.description ?? ""} />
              </label>

              {!basic && (
                <div className="form-row">
                  <label className="field">
                    <span className="form-label">归到清单</span>
                    <select className="input" name="listId" defaultValue={String(initial?.listId ?? defaultListId ?? "")}>
                      <option value="">（不归类）</option>
                      {lists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.icon ? `${list.icon} ` : ""}
                          {list.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span className="form-label">优先级</span>
                    <select className="input" name="priority" defaultValue={initial?.priority ?? "MEDIUM"}>
                      {PRIORITIES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {!basic && (
                <div className="form-row">
                  <label className="field">
                    <span className="form-label">哪天（默认今天）</span>
                    <input className="input" type="date" name="dueDate" defaultValue={initial?.dueDate ?? defaultDueDate ?? ""} />
                  </label>
                  <label className="field">
                    <span className="form-label">几点（可空）</span>
                    <input className="input" type="time" name="dueTime" defaultValue={initial?.dueTime ?? ""} />
                  </label>
                </div>
              )}

              {!basic && (
                <div className="field">
                  <span className="form-label">什么时候提醒我</span>
                  <div className="choice-row">
                    {REMIND_PRESETS.map((preset) => (
                      <label key={preset.value} className="choice">
                        <input
                          type="checkbox"
                          name="remindOffsets"
                          value={preset.value}
                          defaultChecked={initial?.remindOffsets?.includes(preset.value) ?? preset.value === 0}
                        />
                        <span>{preset.label}</span>
                      </label>
                    ))}
                    <input
                      className="input"
                      type="time"
                      name="remindTime"
                      defaultValue={initial?.remindTime ?? "09:00"}
                      style={{ width: 110 }}
                    />
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>
                    都不勾就不提醒。日期没填的话，提醒不会触发。
                  </span>
                </div>
              )}

              <div className="field">
                <span className="form-label">图片（可空，最多 9 张；也能直接粘贴截图）</span>
                <input
                  ref={fileRef}
                  className="input"
                  type="file"
                  name="files"
                  accept="image/*"
                  multiple
                  onChange={(e) => setSelectedFiles(Array.from(e.target.files ?? []))}
                />

                {(keepImages.length > 0 || previews.length > 0) && (
                  <div className="todo-thumbs">
                    {keepImages.map((address, index) => (
                      <LightboxImage key={address} src={showImage(address)} images={keepImages.map(showImage)} index={index}>
                        {/* 已有图片走 hidden 回传，删掉就是移除 */}
                        <input type="hidden" name="images" value={address} />
                        <button
                          type="button"
                          className="todo-thumb-del"
                          onClick={() => setKeepImages((prev) => prev.filter((item) => item !== address))}
                          title="移除这张"
                        >
                          ×
                        </button>
                      </LightboxImage>
                    ))}
                    {previews.map((url, index) => (
                      <LightboxImage key={url} src={url} images={previews} index={index} />
                    ))}
                  </div>
                )}
              </div>

              {error && (
                <p className="todo-dialog-error" role="alert">
                  {error}
                </p>
              )}

              <div className="form-row">
                <button type="submit" className="btn">
                  {isEdit ? "保存" : "添加"}
                </button>
                <button type="button" className="ghost" onClick={() => setOpen(false)}>
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
