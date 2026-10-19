import Link from "next/link";
import { prisma } from "@nas/db";
import { zonedDate, zonedTime } from "@nas/core";
import { requireUser } from "@/auth";
import { DOCKER_SERVICES, isDockerService, readDockerLogs } from "@/server/docker";

const APPS = [
  { key: "all", label: "全部" },
  { key: "portal", label: "门户" },
  { key: "bill", label: "账单" },
  { key: "anniversary", label: "纪念日" },
  { key: "work", label: "工作" },
  { key: "pregnancy", label: "孕期" },
  { key: "travel", label: "旅行" },
  { key: "docker", label: "Docker" },
] as const;

const APP_LABEL: Record<string, string> = {
  portal: "门户",
  bill: "账单",
  anniversary: "纪念日",
  work: "工作",
  pregnancy: "孕期",
  travel: "旅行",
};

const SERVICE_LABEL: Record<string, string> = {
  gateway: "网关",
  portal: "门户",
  bill: "账单",
  anniversary: "纪念日",
  work: "工作",
  pregnancy: "孕期",
  travel: "旅行",
  worker: "定时任务",
  postgres: "数据库",
};

function when(date: Date): string {
  return `${zonedDate(date)} ${zonedTime(date)}`;
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ app?: string; service?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    return <div className="card muted">仅管理员可查看日志</div>;
  }

  const { app = "all", service = "portal" } = await searchParams;
  const current = APPS.some((item) => item.key === app) ? app : "all";
  const dockerService = isDockerService(service) ? service : "portal";

  const rows =
    current === "docker"
      ? []
      : await prisma.auditLog.findMany({
          where: current === "all" ? {} : { app: current },
          orderBy: { createdAt: "desc" },
          take: 200,
        });
  const docker = current === "docker" ? await readDockerLogs(dockerService) : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">运维</span>
          <h1>日志管理</h1>
        </div>
        {current !== "docker" ? <span className="badge soft">最近 {rows.length} 条</span> : null}
      </div>

      <div className="tabs">
        {APPS.map((item) => (
          <Link
            key={item.key}
            href={item.key === "all" ? "/logs" : `/logs?app=${item.key}`}
            className={current === item.key ? "tab active" : "tab"}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {current === "docker" ? (
        <>
          <div className="tabs">
            {DOCKER_SERVICES.map((name) => (
              <Link
                key={name}
                href={`/logs?app=docker&service=${name}`}
                className={dockerService === name ? "tab active" : "tab"}
              >
                {SERVICE_LABEL[name]}
              </Link>
            ))}
          </div>
          {docker?.message ? (
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              {docker.message}
            </p>
          ) : null}
          <pre className="log-view">{docker?.ok ? docker.text : docker?.message}</pre>
        </>
      ) : rows.length === 0 ? (
        <div className="card muted" style={{ fontSize: 13 }}>
          还没有操作日志。在各应用里保存或删除之后，会记在这里。
        </div>
      ) : (
        <section className="card">
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>应用</th>
                  <th>操作人</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{when(row.createdAt)}</td>
                    <td>{APP_LABEL[row.app] || row.app}</td>
                    <td>{row.actorName || (row.actorId ? `用户 #${row.actorId}` : "系统")}</td>
                    <td>{row.summary}</td>
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
