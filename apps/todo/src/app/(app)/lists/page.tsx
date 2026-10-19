import Link from "next/link";
import { prisma } from "@nas/db";
import { requireUser } from "@/auth";
import { listMembers, listVisibleLists } from "@nas/todo";
import {
  createListAction,
  deleteListAction,
  saveListAction,
} from "@/app/actions";
import { ListDialog } from "@/components/list-dialog";
import { ListDeleteButton } from "@/components/list-delete-button";

/**
 * 清单管理：列表 + 操作按钮 + 弹窗。
 * 行内只放主要信息（名称 / 类型 / 未完成数 / 成员），新建和编辑都走弹窗，
 * 删除行内确认。后续列表页都按这个格式来。
 */
export default async function ListsPage() {
  const user = await requireUser();
  const lists = await listVisibleLists(user.id, { includeArchived: true });
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    orderBy: { id: "asc" },
    select: { id: true, nickname: true, username: true },
  });
  const membersByList = new Map(
    await Promise.all(lists.map(async (list) => [list.id, await listMembers(list.id)] as const)),
  );
  // 弹窗里只列"别人" —— 创建者默认在内，不用勾自己
  const candidates = users.filter((u) => u.id !== user.id);

  return (
    <div className="todo-home">
      <div className="page-head">
        <div>
          <span className="page-eyebrow">把待办分门别类</span>
          <h1>清单</h1>
        </div>
        <div className="row-actions">
          <span className="badge soft">{lists.length} 个清单</span>
          <ListDialog
            action={createListAction}
            users={candidates}
            trigger={<button type="button" className="btn">+ 新建清单</button>}
          />
        </div>
      </div>

      {lists.length === 0 ? (
        <div className="card muted" style={{ fontSize: 13 }}>
          还没有清单，点右上角新建一个。
        </div>
      ) : (
        <section className="card list-table-card">
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>清单</th>
                  <th>类型</th>
                  <th>未完成</th>
                  <th>成员</th>
                  <th style={{ textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {lists.map((list) => {
                  const members = membersByList.get(list.id) ?? [];
                  const names = members
                    .filter((m) => m.userId !== list.ownerId)
                    .map((m) => m.nickname);
                  const isOwner = list.role === "OWNER";
                  return (
                    <tr key={list.id}>
                      <td>
                        <Link href={list.id ? `/?list=${list.id}` : "/"} className="list-name">
                          {list.icon ? `${list.icon} ` : ""}
                          {list.name}
                        </Link>
                      </td>
                      <td>
                        <span className="badge soft">{list.kind === "SHARED" ? "家庭共享" : "仅自己"}</span>
                      </td>
                      <td>{list.openCount}</td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {list.kind === "SHARED"
                          ? names.length > 0
                            ? names.join("、")
                            : "暂无成员"
                          : "—"}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {isOwner ? (
                          <span className="todo-ops">
                            <ListDialog
                              action={saveListAction}
                              users={candidates}
                              trigger={<button type="button" className="todo-op">编辑</button>}
                              initial={{
                                id: list.id,
                                name: list.name,
                                icon: list.icon,
                                kind: list.kind,
                                memberIds: members.map((m) => m.userId),
                              }}
                            />
                            <ListDeleteButton
                              action={deleteListAction}
                              id={list.id}
                              name={list.name}
                            />
                          </span>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>仅查看</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted list-hint">删除清单不会删待办，里面的待办退回「未归类」。</p>
        </section>
      )}
    </div>
  );
}
