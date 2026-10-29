"use client";

import { useState } from "react";
import { LightboxImage, SiteLink } from "@nas/ui";

type ServerAction = (form: FormData) => Promise<void>;

const PRIORITY_COLOR: Record<string, string> = {
  HIGH: "var(--coral)",
  MEDIUM: "var(--yellow)",
  LOW: "var(--muted)",
};

const PRIORITY_LABEL: Record<string, string> = { HIGH: "重要", MEDIUM: "普通", LOW: "次要" };

/** 备注收起时的预览长度：跟待办应用一致 */
const NOTE_PREVIEW = 42;

export type PortalTodoRowProps = {
  id: number;
  title: string;
  /** 标题要跳的地址（账单 / 纪念日详情），没有就是纯文字 */
  href?: string;
  priority: string;
  due: string;
  hasDue: boolean;
  overdue: boolean;
  done: boolean;
  cancelled: boolean;
  focus: boolean;
  /** 小字第一段：来源名 */
  sourceLabel: string;
  /** 来源补充说明（纪念日提醒 / 账单跟进），没有就不显示 */
  extra?: string;
  listName?: { icon: string | null; name: string };
  workBadge?: string;
  snoozeText?: string;
  ownerName?: string;
  note?: string;
  images: string[];
  bills?: { href: string; label: string; createdAt: string }[];
  editHref?: string;
  workHref?: string;
  markDoneAction: ServerAction;
  cancelAction: ServerAction;
  deleteAction: ServerAction;
};

/**
 * 门户「待办管理」的待办行。
 *
 * 结构和待办应用的待办行（apps/todo 的 TodoRow）完全对齐：
 * 优先级点 · 勾选框 · 「标题 / 到期胶囊 / 行内操作」 · 一行小字。
 * 备注默认收起成一行预览，点一下展开全文；图片默认收起，点「📷 n」铺缩略图，
 * 缩略图再点开是全屏灯箱。样式全在 @nas/ui/globals.css，两边共用。
 */
export function PortalTodoRow({
  id,
  title,
  href,
  priority,
  due,
  hasDue,
  overdue,
  done,
  cancelled,
  focus,
  sourceLabel,
  extra,
  listName,
  workBadge,
  snoozeText,
  ownerName,
  note,
  images,
  bills,
  editHref,
  workHref,
  markDoneAction,
  cancelAction,
  deleteAction,
}: PortalTodoRowProps) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false);
  const notePreview =
    note && note.length > NOTE_PREVIEW ? `${note.slice(0, NOTE_PREVIEW)}…` : note;
  const openLink = workHref || editHref;

  return (
    <li
      className={`todo-row is-compact${done ? " done" : ""}${focus ? " is-focus" : ""}`}
    >
      <span
        className="todo-dot"
        style={{ background: PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.MEDIUM }}
        title={PRIORITY_LABEL[priority] ?? PRIORITY_LABEL.MEDIUM}
      />

      {done ? (
        <span className="todo-check">
          <span className="todo-box on" title="已完成">
            ✓
          </span>
        </span>
      ) : cancelled ? (
        <span className="todo-check">
          <span className="todo-box" title="已取消" style={{ opacity: 0.45 }}>
            ✕
          </span>
        </span>
      ) : (
        <form action={markDoneAction} className="todo-check">
          <input type="hidden" name="id" value={id} />
          <button type="submit" className="todo-box" title="标记完成" />
        </form>
      )}

      <div className="todo-main">
        <div className="todo-line">
          {href ? (
            <SiteLink href={href} className="todo-title">
              {title}
            </SiteLink>
          ) : (
            <span className="todo-title" title={title}>
              {title}
            </span>
          )}
          <span
            className={`todo-due${overdue ? " is-overdue" : ""}${hasDue ? "" : " is-none"}`}
            title={hasDue ? due : "无截止日期"}
          >
            {due}
          </span>
          <span className="todo-ops">
            {bills && bills.length > 0 && (
              <span className="todo-bills">
                <span className="todo-op">查看账单</span>
                <div className="line-pop">
                  {bills.map((bill) => (
                    <SiteLink key={`${bill.href}-${bill.label}`} href={bill.href}>
                      <span>{bill.label}</span>
                      <time>{bill.createdAt}</time>
                    </SiteLink>
                  ))}
                </div>
              </span>
            )}
            {openLink && !done && !cancelled && (
              <SiteLink href={openLink} className="todo-op">
                {workHref ? "去处理" : "编辑"}
              </SiteLink>
            )}
            {!done && !cancelled && (
              <form
                action={async (form: FormData) => {
                  if (!confirm(`确定取消「${title}」？取消后可在「全部」里找回。`)) return;
                  await cancelAction(form);
                }}
              >
                <input type="hidden" name="id" value={id} />
                <button type="submit" className="todo-op">
                  取消
                </button>
              </form>
            )}
            <form
              action={async (form: FormData) => {
                if (!confirm(`确定删除「${title}」？`)) return;
                await deleteAction(form);
              }}
            >
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="todo-op is-danger">
                删除
              </button>
            </form>
          </span>
        </div>

        <div className="todo-meta">
          {overdue && <span className="todo-flag">逾期</span>}
          {cancelled && <span className="badge soft">已取消</span>}
          <span>{sourceLabel}</span>
          {listName && (
            <span className="badge soft">
              {listName.icon} {listName.name}
            </span>
          )}
          {extra && <span>{extra}</span>}
          {workBadge && <span className="badge soft">{workBadge}</span>}
          {snoozeText && <span>{snoozeText}</span>}
          {ownerName && <span>{ownerName}</span>}
          {images.length > 0 && (
            <button type="button" className="todo-op" onClick={() => setImagesOpen((v) => !v)}>
              {imagesOpen ? "收起图片" : `📷 ${images.length}`}
            </button>
          )}
          {note && (
            <button type="button" className="todo-op" onClick={() => setNoteOpen((v) => !v)}>
              {noteOpen ? "收起备注" : `备注：${notePreview}`}
            </button>
          )}
        </div>

        {note && noteOpen && <div className="todo-note is-full">{note}</div>}

        {imagesOpen && images.length > 0 && (
          <div className="todo-thumbs">
            {images.map((src, index) => (
              <LightboxImage key={src} src={src} images={images} index={index} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
