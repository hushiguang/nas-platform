import Link from "next/link";
import type { NotifyChannelType, NotifyStatus } from "@nas/db";
import { prisma } from "@nas/db";
import { zonedDate, zonedTime } from "@nas/core";
import { requireUser } from "@/auth";
import { testSendDigest } from "./digest-actions";

const STATUS_LABEL: Record<NotifyStatus, string> = {
  PENDING: "待发送",
  SENT: "已发送",
  FAILED: "失败",
};

const CHANNEL_LABEL: Record<NotifyChannelType, string> = {
  WECOM: "企业微信",
  WX: "微信",
  MAIL: "邮件",
};

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "PENDING", label: "待发送" },
  { key: "SENT", label: "已发送" },
  { key: "FAILED", label: "失败" },
] as const;

function when(date: Date): string {
  return `${zonedDate(date)} ${zonedTime(date)}`;
}

export default async function NotifyPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; notice?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    return <div className="card muted">仅管理员可查看发送记录</div>;
  }

  const { status = "all", notice } = await searchParams;
  const current = FILTERS.some((item) => item.key === status) ? status : "all";
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    orderBy: { id: "asc" },
    select: { id: true, nickname: true, username: true },
  });
  const rows = await prisma.notifyLog.findMany({
    where: current === "all" ? {} : { status: current as NotifyStatus },
    include: { user: { select: { nickname: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">通知</span>
          <h1>发送记录</h1>
        </div>
        <div className="row-actions">
          <span className="badge soft">最近 {rows.length} 条</span>
          <Link href="/notify/channels" className="btn ghost">
            渠道配置 →
          </Link>
        </div>
      </div>

      {notice ? (
        <div className="notice" style={{ marginBottom: 14 }}>
          {notice.includes("失败") || notice.includes("异常") || notice.includes("没有启用") ? (
            <span style={{ color: "var(--coral)" }}>{notice}</span>
          ) : (
            notice
          )}
        </div>
      ) : null}

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h2>每日汇报试发送</h2>
          <span className="muted" style={{ fontSize: 12 }}>邮件含全量 Excel 附件 · 企微推送各平台汇总</span>
        </div>
        <form action={testSendDigest} className="row" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <select name="userId" defaultValue={user.id} style={{ minWidth: 160 }}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.nickname}(@{u.username})</option>
            ))}
          </select>
          <select name="channel" defaultValue="ALL">
            <option value="ALL">全部渠道</option>
            <option value="MAIL">仅邮件</option>
            <option value="WECOM">仅企业微信</option>
          </select>
          <button type="submit" className="btn primary">试发送</button>
        </form>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          发送时点：每天 <b>09:00</b> 和 <b>16:00</b>（worker 的 digest 任务）。
          内容口径：项目（进行中/有延期/风险预报/待修问题）· 待办（延期+近7天+进行中）· 纪念日（近30天，含还剩多少天）。
        </p>
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          配了群机器人时企微只发一条（发进群，不按人重复）；邮件仍按人各发一份。发送失败会留在发送记录里，
          由 notify-retry 每 10 分钟退避重发（1min → 5min → 25min）。
        </p>
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          另有一路 <b>每 10 分钟</b> 的「待办提醒」，发的是待办应用里各人自己设的提醒时点（默认提前 3 天 09:00）。
          发不出去时依次检查：接收人是否开启渠道并填了企微 userid / 邮箱（<Link href="/notify/channels" className="site-link">通知渠道</Link>）→
          企业微信应用「可信 IP」是否包含本机出口 IP → SMTP 是否可达。
        </p>
      </section>

      <div className="tabs">
        {FILTERS.map((item) => (
          <Link
            key={item.key}
            href={item.key === "all" ? "/notify" : `/notify?status=${item.key}`}
            className={current === item.key ? "tab active" : "tab"}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card muted" style={{ fontSize: 13 }}>
          还没有发送记录。
        </div>
      ) : (
        <section className="card">
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>接收人</th>
                  <th>渠道</th>
                  <th>标题</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{when(row.createdAt)}</td>
                    <td>{row.user.nickname}</td>
                    <td>{CHANNEL_LABEL[row.channel]}</td>
                    <td>
                      <div>{row.title}</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {row.content.length > 80 ? `${row.content.slice(0, 80)}…` : row.content}
                      </div>
                      {row.lastError ? (
                        <div style={{ color: "var(--coral)", fontSize: 12, marginTop: 2 }}>{row.lastError}</div>
                      ) : null}
                    </td>
                    <td>{STATUS_LABEL[row.status]}{row.retryCount > 0 ? ` · 重试 ${row.retryCount}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
