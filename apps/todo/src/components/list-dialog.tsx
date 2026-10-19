"use client";

import { useState } from "react";

export interface ListUserOption {
  id: number;
  nickname: string;
  username: string;
}

export interface ListInitial {
  id: number;
  name: string;
  icon: string | null;
  kind: string;
  memberIds: number[];
}

/**
 * 新建 / 编辑清单的弹窗。后续列表页统一走「列表 + 操作按钮 + 弹窗」：
 * 行内只放主要信息和操作入口，重表单都收进弹窗里。
 */
export function ListDialog({
  action,
  initial,
  users,
  trigger,
}: {
  action: (form: FormData) => Promise<void>;
  initial?: ListInitial;
  /** 全部启用用户，供共享清单勾成员 */
  users: ListUserOption[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(initial?.kind ?? "PERSONAL");
  const isEdit = Boolean(initial);

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
              <b>{isEdit ? "编辑清单" : "新建清单"}</b>
              <button type="button" className="ghost" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>

            <form action={submit} className="form-stack">
              {isEdit && <input type="hidden" name="id" value={initial!.id} />}

              <div className="dlg-row-uneven">
                <label className="field">
                  <span className="form-label">图标</span>
                  <input
                    className="input"
                    name="icon"
                    defaultValue={initial?.icon ?? ""}
                    placeholder="🛒"
                    maxLength={4}
                  />
                </label>
                <label className="field">
                  <span className="form-label">清单名称</span>
                  <input
                    className="input"
                    name="name"
                    defaultValue={initial?.name ?? ""}
                    placeholder="购物清单 / 出行准备"
                    autoFocus
                    required
                  />
                </label>
              </div>

              <label className="field">
                <span className="form-label">类型</span>
                <select className="input" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="PERSONAL">仅自己</option>
                  <option value="SHARED">家庭共享</option>
                </select>
              </label>

              {kind === "SHARED" && (
                <div className="field">
                  <span className="form-label">成员（创建者默认在内，不用勾）</span>
                  <div className="choice-row">
                    {users.map((u) => (
                      <label key={u.id} className="choice">
                        <input
                          type="checkbox"
                          name="memberIds"
                          value={u.id}
                          defaultChecked={initial?.memberIds.includes(u.id)}
                        />
                        <span>
                          {u.nickname}（{u.username}）
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

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
