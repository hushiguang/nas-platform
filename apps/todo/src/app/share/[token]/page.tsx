import type { Metadata } from "next";
import { portalUrl } from "@nas/core";
import { listTodos, listByShareToken } from "@nas/todo";
import { SharedTodoRow } from "@/components/shared-todo-row";
import { ShareAddForm } from "@/components/share-add-form";

/**
 * 清单分享页 —— 免登录。
 *
 * 放在 (app) 组之外，因此不经过 requireUser；URL 里的 token 就是授权凭证。
 * 与账单的账本分享一致：默认只读，owner 可以改成「可勾选」，
 * 允许拿到链接的人勾掉条目、补充新条目。
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "清单分享 · 家庭 NAS 待办",
  // 分享链接是凭证，别让搜索引擎收录
  robots: { index: false, follow: false },
};

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const list = await listByShareToken(token);

  if (!list) {
    return (
      <div className="share-page">
        <div className="card share-missing">
          <span className="page-eyebrow">家庭 NAS · 待办分享</span>
          <h1>链接已失效</h1>
          <p className="muted">这个分享可能已经关闭，找清单的主人要一下新的链接。</p>
          {portalUrl() && (
            <a className="btn" href={portalUrl()}>
              回到家庭 NAS
            </a>
          )}
        </div>
      </div>
    );
  }

  const todos = await listTodos({
    userId: list.ownerId,
    listId: list.id,
    scope: "all",
    take: 500,
  });
  const pending = todos.filter((todo) => todo.status !== "DONE" && todo.status !== "CANCELLED");
  const done = todos
    .filter((todo) => todo.status === "DONE")
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  const readOnly = !list.shareWritable;

  return (
    <div className="share-page">
      <header className="card share-head">
        <span className="page-eyebrow">家庭 NAS · 待办分享</span>
        <h1>
          {list.icon ? `${list.icon} ` : ""}
          {list.name}
        </h1>
        <div className="share-meta">
          <span className={`badge ${readOnly ? "soft" : "warn"}`}>
            {readOnly ? "只读分享" : "可勾选分享"}
          </span>
          <span className="muted">
            {readOnly ? "只能查看清单内容" : "点圆圈勾掉，也可以补充新条目"}
          </span>
        </div>
        <div className="share-stats">
          <div className="share-stat">
            <b>{pending.length}</b>
            <span>待完成</span>
          </div>
          <div className="share-stat">
            <b>{done.length}</b>
            <span>已完成</span>
          </div>
        </div>
      </header>

      {!readOnly && <ShareAddForm token={token} />}

      <section className="card share-list">
        <div className="card-head">
          <b>待完成</b>
          <span className="muted" style={{ fontSize: 12 }}>{pending.length} 条</span>
        </div>
        {pending.length === 0 ? (
          <p className="muted share-empty">都做完了，清清爽爽。</p>
        ) : (
          <ul className="todo-list">
            {pending.map((todo) => (
              <SharedTodoRow key={todo.id} todo={todo} token={token} writable={!readOnly} />
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <details className="card share-list share-done">
          <summary>
            已完成 {done.length} 条
            <span className="muted">（点开查看）</span>
          </summary>
          <ul className="todo-list">
            {done.map((todo) => (
              <SharedTodoRow key={todo.id} todo={todo} token={token} writable={!readOnly} />
            ))}
          </ul>
        </details>
      )}

      <footer className="share-foot muted">
        <span>由家庭 NAS 待办分享 · {readOnly ? "只读" : "可勾选"}</span>
        <span>清单主人关闭分享后，这个链接立即失效。</span>
      </footer>
    </div>
  );
}
