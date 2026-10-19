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
import { LightboxImage } from "./lightbox";

export interface ListOption {
  id: number;
  name: string;
  icon: string | null;
}

export interface TodoInitial {
  id: number;
  title: string;
  description: string | null;
  listId: number | null;
  priority: string;
  dueDate: string;
  dueTime: string;
  remindOffsets: number[];
  remindTime: string;
  images: string[];
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
}: {
  lists: ListOption[];
  action: (form: FormData) => Promise<void>;
  initial?: TodoInitial;
  defaultListId?: number | null;
  /** 新建时"哪天"默认填今天（只定日期，几点留空） */
  defaultDueDate?: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const [keepImages, setKeepImages] = useState<string[]>(initial?.images ?? []);
  const fileRef = useRef<HTMLInputElement>(null);
  const isEdit = Boolean(initial);

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

  async function submit(form: FormData) {
    await action(form);
    setOpen(false);
  }

  return (
    <>
      <span onClick={() => setOpen(true)} className="todo-trigger">
        {trigger}
      </span>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">
              <b>{isEdit ? "编辑待办" : "记一件事"}</b>
              <button type="button" className="ghost" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>

            <form action={submit} className="form-stack">
              {isEdit && <input type="hidden" name="id" value={initial!.id} />}

              <label className="field">
                <span className="form-label">要做什么</span>
                <input
                  className="input"
                  name="title"
                  defaultValue={initial?.title ?? ""}
                  placeholder="买牛奶 / 交水电费 / 给车做保养"
                  autoFocus
                  required
                />
              </label>

              <label className="field">
                <span className="form-label">备注（可空）</span>
                <textarea className="input" name="description" rows={2} defaultValue={initial?.description ?? ""} />
              </label>

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

              <div className="field">
                <span className="form-label">图片（可空，最多 9 张）</span>
                <input
                  ref={fileRef}
                  className="input"
                  type="file"
                  name="files"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    previews.forEach((url) => URL.revokeObjectURL(url));
                    const files = Array.from(e.target.files ?? []);
                    setPreviews(files.slice(0, 9).map((file) => URL.createObjectURL(file)));
                  }}
                />

                {(keepImages.length > 0 || previews.length > 0) && (
                  <div className="todo-thumbs">
                    {keepImages.map((address) => (
                      <LightboxImage key={address} src={imageSrc(address)}>
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
                    {previews.map((url) => (
                      <LightboxImage key={url} src={url} />
                    ))}
                  </div>
                )}
              </div>

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
