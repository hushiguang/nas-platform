"use client";

/** 门户待办行的取消按钮：confirm 确认后置为 CANCELLED（与完成同一判权） */
export function PortalCancelButton({
  action,
  id,
  title,
}: {
  action: (form: FormData) => Promise<void>;
  id: number;
  title: string;
}) {
  return (
    <form
      action={async (form: FormData) => {
        if (!confirm(`确定取消「${title}」？取消后可在「全部」里找回。`)) return;
        await action(form);
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn ghost sm">
        取消
      </button>
    </form>
  );
}
export function PortalDeleteButton({
  action,
  id,
  title,
}: {
  action: (form: FormData) => Promise<void>;
  id: number;
  title: string;
}) {
  return (
    <form
      action={async (form: FormData) => {
        if (!confirm(`确定删除「${title}」？`)) return;
        await action(form);
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn ghost sm danger">
        删除
      </button>
    </form>
  );
}
