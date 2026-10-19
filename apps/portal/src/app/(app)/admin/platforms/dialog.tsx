"use client";

import { useEffect, useState } from "react";
import { GALLERY, GRADIENTS } from "@nas/media/catalog";
import { APP_COVERS } from "@nas/media/portal-covers";

export interface PlatformInitial {
  id: number;
  code: string;
  name: string;
  icon: string | null;
  cover: string | null;
  group: string | null;
  sort: number;
  url: string | null;
  isExternal: boolean;
  description: string | null;
}

function randomCover(): string {
  const pool = [
    ...GALLERY.map((g) => `gallery:${g.id}`),
    ...GRADIENTS.map((g) => `gradient:${g.id}`),
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

function coverThumb(cover: string): React.CSSProperties {
  if (cover.startsWith("gallery:")) {
    const id = cover.slice("gallery:".length);
    return { backgroundImage: `url(/api/media/gallery/${id})` };
  }
  if (cover.startsWith("http")) return { backgroundImage: `url(${cover})` };
  const g = GRADIENTS.find((x) => `gradient:${x.id}` === cover);
  if (g) return { background: g.background };
  return { background: "var(--soft)" };
}

export function PlatformDialog({
  action,
  initial,
  trigger,
}: {
  action: (form: FormData) => Promise<void>;
  initial?: PlatformInitial;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // 首渲染必须确定性，否则 SSR 与客户端 hydration 对不上；新建的随机图等弹窗打开后再抽
  const [cover, setCover] = useState(initial?.cover ?? "gallery:cake");
  const isEdit = Boolean(initial);

  useEffect(() => {
    if (open && !initial?.cover) setCover(randomCover());
  }, [open, initial?.cover]);

  async function submit(form: FormData) {
    form.set("cover", cover);
    await action(form);
    setOpen(false);
  }

  return (
    <>
      <span onClick={() => setOpen(true)} className="dialog-trigger">
        {trigger}
      </span>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">
              <b>{isEdit ? "编辑应用" : "新增应用"}</b>
              <button type="button" className="ghost" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>

            <form action={submit} className="form-stack">
              {isEdit && <input type="hidden" name="id" value={initial!.id} />}
              <input type="hidden" name="cover" value={cover} />

              <div className="dlg-row-uneven">
                <label className="field">
                  <span className="form-label">图标</span>
                  <input className="input" name="icon" defaultValue={initial?.icon ?? "🧩"} maxLength={8} style={{ textAlign: "center" }} />
                </label>
                <label className="field">
                  <span className="form-label">名称</span>
                  <input className="input" name="name" defaultValue={initial?.name ?? ""} placeholder="家庭记账 / 旅行相册" autoFocus required />
                </label>
              </div>

              <div className="field">
                <span className="form-label">
                  卡片背景（纪念日同款图库）
                  <button type="button" className="text-btn" onClick={() => setCover(randomCover())}>
                    🎲 随机一张
                  </button>
                </span>
                <div className="cover-grid">
                  {initial && APP_COVERS.filter((c) => c.code === initial.code).map((c) => (
                    <button
                      key={c.url}
                      type="button"
                      className={`cover-opt${cover === c.url ? " active" : ""}`}
                      style={{ backgroundImage: `url(${c.url})` }}
                      onClick={() => setCover(c.url)}
                      title={`推荐 · ${c.label}`}
                    >
                      <span>推荐 · {c.label}</span>
                    </button>
                  ))}
                  {GALLERY.map((g) => {
                    const v = `gallery:${g.id}`;
                    return (
                      <button
                        key={v}
                        type="button"
                        className={`cover-opt${cover === v ? " active" : ""}`}
                        style={{ backgroundImage: `url(/api/media/gallery/${g.id})` }}
                        onClick={() => setCover(v)}
                        title={g.name}
                      >
                        <span>{g.name}</span>
                      </button>
                    );
                  })}
                  {GRADIENTS.map((g) => {
                    const v = `gradient:${g.id}`;
                    return (
                      <button
                        key={v}
                        type="button"
                        className={`cover-opt${cover === v ? " active" : ""}`}
                        style={{ background: g.background }}
                        onClick={() => setCover(v)}
                        title={g.name}
                      >
                        <span>{g.name}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="cover-preview" style={coverThumb(cover)}>
                  <div className="cover-preview-shade" />
                  <span>{initial?.name ?? "卡片预览 · 白字 + 黑色蒙版"}</span>
                </div>
              </div>

              <div className="form-row">
                <label className="field">
                  <span className="form-label">标识（小写字母开头）</span>
                  {isEdit ? (
                    <>
                      <input className="input" value={initial!.code} disabled />
                      <input type="hidden" name="code" value={initial!.code} />
                    </>
                  ) : (
                    <input className="input" name="code" placeholder="ledger" required />
                  )}
                </label>
                <label className="field">
                  <span className="form-label">分组</span>
                  <input className="input" name="group" defaultValue={initial?.group ?? ""} placeholder="财务 / 生活 / 工具" />
                </label>
              </div>

              <div className="form-row">
                <label className="field">
                  <span className="form-label">排序（小的在前）</span>
                  <input className="input" type="number" name="sort" defaultValue={initial?.sort ?? 99} min={0} max={9999} />
                </label>
                <label className="field">
                  <span className="form-label">外部链接（内部模块留空）</span>
                  <input className="input" name="url" defaultValue={initial?.url ?? ""} placeholder="http://example.com:8080" />
                </label>
              </div>

              <label className="field">
                <span className="form-label">描述</span>
                <input className="input" name="description" defaultValue={initial?.description ?? ""} placeholder="一句话说明这个应用做什么" maxLength={200} />
              </label>

              <label className="choice">
                <input type="checkbox" name="isExternal" defaultChecked={initial ? initial.isExternal : true} />
                <span>外部独立应用（不勾则走 nas-platform 内部路由）</span>
              </label>

              <div className="form-row">
                <button type="submit" className="btn">
                  {isEdit ? "保存" : "创建"}
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
