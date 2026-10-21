"use client";

import { useRef, useState } from "react";
import { useImagePaste } from "@nas/ui";
import { guestAddTodoAction } from "@/app/share/actions";
import { LightboxImage } from "./lightbox";

const MAX_IMAGES = 9;
/** 与 next.config 的 bodySizeLimit=30mb、服务端 saveImage 的 12MB 单张上限对齐 */
const MAX_IMAGE_MB = 12;
const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;
const MAX_TOTAL_BYTES = 28 * 1024 * 1024;

/**
 * 分享页的补条目表单（仅「可勾选」模式出现）。
 *
 * 与待办应用内的新建保持一致：标题必填，备注和图片收在「＋备注/图片」里，
 * 展开后支持多选图片、预览、删图，也能直接粘贴截图。
 *
 * 图片要传到图床，比纯文字慢得多：
 *   - 提交期间整个表单锁住、按钮转圈，先用 ref 同步挡掉连点，避免重复添加；
 *   - 用 onSubmit + preventDefault 自己控制提交，失败时保留已填内容（React 的
 *     表单 action 会在结束后重置非受控字段，出错就把人家写的东西清空了）；
 *   - 体积在客户端先拦一道，选图/提交都不会白等一场才失败。
 */
export function ShareAddForm({ token }: { token: string }) {
  const [extraOpen, setExtraOpen] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 选文件与粘贴截图共用：预览走 objectURL，提交靠 input.files 原样带走 */
  function applyFiles(files: File[]) {
    if (inFlight.current) return;

    const images = files.filter((file) => file.type.startsWith("image/"));
    let message: string | null = null;

    const next: File[] = [];
    let total = 0;
    for (const file of images) {
      if (file.size > MAX_IMAGE_BYTES) {
        message = `「${file.name}」太大了，单张图片不能超过 ${MAX_IMAGE_MB}MB`;
        continue;
      }
      if (next.length >= MAX_IMAGES) {
        message = message ?? `最多只能选 ${MAX_IMAGES} 张图片`;
        break;
      }
      if (total + file.size > MAX_TOTAL_BYTES) {
        message = message ?? "图片总大小超过 28MB，请少选几张";
        continue;
      }
      next.push(file);
      total += file.size;
    }

    setError(message);
    previews.forEach((url) => URL.revokeObjectURL(url));
    setPreviews(next.map((file) => URL.createObjectURL(file)));
    if (fileRef.current) {
      const transfer = new DataTransfer();
      next.forEach((file) => transfer.items.add(file));
      fileRef.current.files = transfer.files;
    }
    if (next.length > 0) setExtraOpen(true);
  }

  function removeAt(index: number) {
    if (inFlight.current) return;
    const picked = Array.from(fileRef.current?.files ?? []).filter((_, i) => i !== index);
    applyFiles(picked);
  }

  // 页面上的粘贴默认只认图片：有截图就加进表单，纯文字照常粘贴进输入框
  useImagePaste((files) => {
    const picked = Array.from(fileRef.current?.files ?? []);
    applyFiles([...picked, ...files]);
  });

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    // 同步闸门：连点时只有第一次会真正发出，其余在 state 刷新前就被挡掉
    if (inFlight.current) return;

    const form = event.currentTarget;
    // 必须在锁表单之前取：输入框一旦 disabled，FormData 里就没有值了
    const data = new FormData(form);

    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await guestAddTodoAction(data);
      if (!result.ok) {
        setError(result.message ?? "添加失败，请稍后再试");
        return;
      }
      form.reset();
      previews.forEach((url) => URL.revokeObjectURL(url));
      setPreviews([]);
      setExtraOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络异常，请稍后再试");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className={`card share-add${pending ? " is-busy" : ""}`}
      aria-busy={pending}
    >
      <input type="hidden" name="token" value={token} />
      <div className="share-add-row">
        <input
          className="input"
          name="title"
          placeholder="加一条要做 / 要买的事…"
          maxLength={200}
          disabled={pending}
          required
        />
        <button
          type="button"
          className={`ghost share-add-toggle${extraOpen ? " on" : ""}`}
          onClick={() => setExtraOpen((value) => !value)}
          disabled={pending}
        >
          {extraOpen ? "收起" : "＋备注/图片"}
        </button>
        <button className="btn" type="submit" disabled={pending}>
          {pending && <span className="btn-spinner" aria-hidden />}
          {pending ? "添加中…" : "添加"}
        </button>
      </div>

      {extraOpen && (
        <div className="share-add-extra">
          <textarea
            className="input"
            name="description"
            rows={2}
            maxLength={2000}
            placeholder="备注（可空）"
            disabled={pending}
          />
          <div className="share-add-images">
            <input
              ref={fileRef}
              className="input"
              type="file"
              name="files"
              accept="image/*"
              multiple
              disabled={pending}
              onChange={(e) => applyFiles(Array.from(e.target.files ?? []))}
            />
            <span className="muted share-add-hint">
              最多 {MAX_IMAGES} 张、单张不超过 {MAX_IMAGE_MB}MB，也能直接粘贴截图
            </span>
          </div>
          {previews.length > 0 && (
            <div className="todo-thumbs">
              {previews.map((url, index) => (
                <LightboxImage key={url} src={url}>
                  <button
                    type="button"
                    className="todo-thumb-del"
                    title="移除这张"
                    disabled={pending}
                    onClick={() => removeAt(index)}
                  >
                    ×
                  </button>
                </LightboxImage>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="share-add-error" role="alert">
          {error}
        </p>
      )}

      {pending && (
        <p className="share-add-status" role="status" aria-live="polite">
          {previews.length > 0 ? "正在上传图片并添加，请稍候…" : "正在添加…"}
        </p>
      )}
    </form>
  );
}
