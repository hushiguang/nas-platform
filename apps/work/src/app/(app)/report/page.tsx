import Link from "next/link";
import { requireAppAccess } from "@/auth";
import { renderWeeklyReportMarkdown, weeklyReport, type ReportLine } from "@/server";
import { ReportExportBar } from "./export-bar";

export const dynamic = "force-dynamic";

function Lines({ title, lines, empty }: { title: string; lines: ReportLine[]; empty: string }) {
  return (
    <div>
      <h3>{title}</h3>
      {lines.length === 0 ? (
        <p className="muted report-empty">{empty}</p>
      ) : (
        <ul className="report-lines">
          {lines.map((line) => (
            <li key={line.id}>
              <Link href={`/p/${line.id}`}>{line.name}</Link>
              {line.people ? <span>（{line.people}）</span> : null}
              {line.detail ? <span>：{line.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { user, access } = await requireAppAccess();
  const { week } = await searchParams;
  const report = await weeklyReport(access, user.id, week);
  const markdown = renderWeeklyReportMarkdown(report);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">按项目现在的阶段、跟进人和进度来写</span>
          <h1>{report.title}</h1>
        </div>
        <ReportExportBar markdown={markdown} week={report.from} title={report.title} />
      </div>

      <div className="report-switch">
        <Link className="btn ghost" href={report.prevHref}>
          上一周
        </Link>
        <span className="badge soft">{report.weekLabel}</span>
        <span className="report-range">{report.rangeText}</span>
        {report.nextHref ? (
          <Link className="btn ghost" href={report.nextHref}>
            下一周
          </Link>
        ) : (
          <span className="btn ghost" style={{ opacity: 0.45, pointerEvents: "none" }}>
            下一周
          </span>
        )}
      </div>

      <div className="report-doc">
        <h2>关键情况概括</h2>
        <h3>高风险进展</h3>
        {report.risks.length === 0 ? (
          <p className="muted report-empty">无</p>
        ) : (
          <div className="table-scroll">
            <table className="data report">
              <thead>
                <tr>
                  <th>项目</th>
                  <th>风险级别</th>
                  <th>情况说明</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {report.risks.map((risk) => (
                  <tr key={risk.id}>
                    <td>
                      <Link href={`/p/${risk.id}`}>{risk.name}</Link>
                    </td>
                    <td>{risk.level}</td>
                    <td>{risk.detail}</td>
                    <td>{risk.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2>项目进展</h2>
        <h3>阶段一览</h3>
        <div className="table-scroll">
          <table className="data report phases">
            <thead>
              <tr>
                <th>项目阶段</th>
                <th>数量</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {report.phases.map((item) => (
                <tr key={item.key}>
                  <td>{item.label}</td>
                  <td>{item.count}</td>
                  <td>{item.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Lines title="本周完成项目" lines={report.done} empty="本周暂无完成项目" />
        <Lines title="待上线项目" lines={report.launching} empty="无" />
        <Lines title="研发跟进中项目" lines={report.active} empty="无" />
        <Lines title="等待测试资源" lines={report.waitTest} empty="无" />
        <Lines title="研发待排期项目" lines={report.unscheduled} empty="无" />
        <Lines title="新增项目" lines={report.created} empty="本周暂无新增项目" />

        <h2>下周风险预报</h2>
        {report.forecast.length === 0 ? (
          <p className="muted report-empty">无</p>
        ) : (
          <div className="table-scroll">
            <table className="data report">
              <thead>
                <tr>
                  <th>方向</th>
                  <th>情况描述</th>
                  <th>提报人</th>
                  <th>提报日期</th>
                </tr>
              </thead>
              <tbody>
                {report.forecast.map((row) => (
                  <tr key={row.direction}>
                    <td style={{ whiteSpace: "nowrap" }}>{row.direction}</td>
                    <td>{row.detail}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{row.owner}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{row.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
