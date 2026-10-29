import { prisma } from "@nas/db";
import { appBaseUrl, dayDiff, zonedDate } from "@nas/core";
import { sendMail } from "./providers/mail";
import { sendWecomAppMessage } from "./providers/wecom";
import { sendWecomWebhook } from "./providers/webhook";
import { wecomWebhook } from "./settings";

function cfgString(config: unknown, key: string): string | undefined {
  if (!config || typeof config !== "object" || Array.isArray(config)) return undefined;
  const v = (config as Record<string, unknown>)[key];
  return typeof v === "string" && v ? v : undefined;
}

function fmt(d: Date | null | undefined): string {
  if (!d) return "—";
  try {
    return zonedDate(d);
  } catch {
    return String(d).slice(0, 10);
  }
}

export interface DigestRow {
  kind: string;
  title: string;
  due: string;
  owner: string;
  status: string;
  /** 点这条能打开的页面（工作台项目页 / 纪念日详情页 / 待办应用） */
  href?: string;
  /** 纪念日专用：距离下一次还有多少天（0 = 就是今天） */
  days?: number;
  /** 工作台行专用：项目名（表格里单独占一格，链接也挂在这格上） */
  project?: string;
  /** 工作台行专用：项目当前阶段（商务/研发/SIT/UAT/准备上线/已上线） */
  phase?: string;
  /** 工作台行专用：未关闭问题总数 / 其中的缺陷数 */
  issues?: number;
  bugs?: number;
}

/** 下一次周年日期（公历按月日推算，农历近似按公历处理） */
function nextOccurrence(month: number, day: number, now = new Date()): Date {
  const y = now.getFullYear();
  let d = new Date(y, month - 1, day);
  if (d.getTime() < new Date(y, now.getMonth(), now.getDate()).getTime()) d = new Date(y + 1, month - 1, day);
  return d;
}

const PHASE_LABEL: Record<string, string> = {
  BUSINESS: "商务阶段",
  PREPARE: "项目准备阶段",
  DEV: "研发节点",
  SIT: "SIT测试",
  UAT: "UAT",
  PRELAUNCH: "准备上线",
  LIVE: "上线阶段",
};

/** 阶段推进顺序。报告里的项目表按它倒序排（上线 → 准备上线 → UAT → SIT → 研发 → 商务） */
const PHASE_ORDER = ["BUSINESS", "PREPARE", "DEV", "SIT", "UAT", "PRELAUNCH", "LIVE"];

export async function collectDigest(userId: number) {
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86400_000);
  const in30 = new Date(now.getTime() + 30 * 86400_000);
  const today = zonedDate(now);
  const workBase = appBaseUrl("work");
  const todoBase = appBaseUrl("todo");
  const anniBase = appBaseUrl("anniversary");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("用户不存在");

  // 待办：进行中 + 全部延期 + 近7天到期。
  // 工作台自己收的项目待办不进来 —— 它们就是风险预报 / 待修问题的副本，
  // 报告里已经有那两张表，再列一遍等于同一件事发两次。
  const todos = await prisma.todo.findMany({
    where: {
      ownerId: userId,
      status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
      source: { not: "WORK" },
      OR: [{ status: { in: ["OVERDUE", "IN_PROGRESS"] } }, { dueTime: { lte: in7 } }, { dueTime: null }],
    },
    orderBy: [{ dueTime: "asc" }, { id: "asc" }],
    take: 500,
  });

  // 项目：进行中全部。风险预报和待修问题都从当前阶段的结束日、未关闭问题算起
  const prows = await prisma.workProject.findMany({
    where: { status: { in: ["RUNNING", "PREPARING", "PAUSED"] } },
    include: {
      phases: true,
      issues: { where: { status: { in: ["OPEN", "RESOLVING"] } }, orderBy: { updatedAt: "desc" } },
    },
    take: 200,
  });
  let delayedProjects = 0;
  const projectRows: DigestRow[] = [];
  const riskRows: DigestRow[] = [];
  const issueRows: DigestRow[] = [];

  for (const p of prows) {
    const href = workBase ? `${workBase}/p/${p.id}` : undefined;
    const phaseText = PHASE_LABEL[p.phase] ?? p.phase;
    if (p.phases.some((phase) => phase.enabled && phase.endDate && fmt(phase.endDate) < today)) {
      delayedProjects += 1;
    }
    projectRows.push({
      kind: "项目",
      title: p.name,
      due: p.launchDate ? fmt(new Date(p.launchDate)) : p.endDate ? fmt(new Date(p.endDate)) : "—",
      owner: "",
      status: p.status === "RUNNING" ? "进行中" : p.status === "PAUSED" ? "暂停" : "筹备中",
      href,
      project: p.name,
      phase: phaseText,
      issues: p.issues.length,
    });

    // 风险预报：只看当前阶段的结束日，已上线和没排期的都不算
    if (p.status !== "DONE" && p.phase !== "LIVE") {
      const phase = p.phases.find((item) => item.kind === p.phase);
      const end = phase?.enabled ? fmt(phase.endDate) : "";
      if (end) {
        const days = dayDiff(end, today);
        if (days <= 7) {
          riskRows.push({
            kind: "风险预报",
            title: `${p.name} · ${PHASE_LABEL[p.phase] ?? p.phase}${days < 0 ? `逾期 ${-days} 天` : days === 0 ? "今天结束" : `${days} 天后结束`}`,
            due: end,
            owner: "",
            status: days < 0 ? "已延期" : days === 0 ? "今天" : "临近",
            href,
            project: p.name,
            phase: phaseText,
          });
        }
      }
    }
    // 待修问题：按项目聚合成一条，避免刷屏
    if (p.status !== "DONE" && p.issues.length > 0) {
      const bugCount = p.issues.filter((i) => i.kind !== "IMPROVEMENT").length;
      issueRows.push({
        kind: "待修问题",
        title: `${p.name} · 待修问题 ${p.issues.length} 个${bugCount ? `（缺陷 ${bugCount}）` : ""}`,
        due: fmt(p.issues[0].updatedAt),
        owner: "",
        status: `${p.issues.filter((i) => i.status === "OPEN").length} 个未处理`,
        href,
        project: p.name,
        issues: p.issues.length,
        bugs: bugCount,
      });
    }
  }
  // 项目表按当前阶段倒序：上线最上面，准备上线 → UAT → SIT → 研发 → 商务依次往下。
  // 同阶段维持查询顺序（id 升序），避免每次报告里同一阶段的顺序乱跳。
  const phaseRank = new Map(PHASE_ORDER.map((key, i) => [PHASE_LABEL[key] ?? key, i]));
  projectRows.sort(
    (a, b) => (phaseRank.get(b.phase ?? "") ?? -1) - (phaseRank.get(a.phase ?? "") ?? -1),
  );
  riskRows.sort((a, b) => (a.due < b.due ? -1 : 1));

  // 纪念日：近30天内到来的（按月日推算下一次）
  const anniversaries = await prisma.anniversary.findMany({ take: 500 });
  const anniRows: DigestRow[] = [];
  for (const a of anniversaries) {
    const d = new Date(a.date);
    const next = nextOccurrence(d.getMonth() + 1, d.getDate(), now);
    if (next <= in30) {
      const left = dayDiff(fmt(next), today);
      anniRows.push({
        kind: "纪念日",
        title: a.name,
        due: fmt(next),
        owner: "",
        status: left <= 1 ? "临近" : "",
        href: anniBase ? `${anniBase}/a/${a.id}` : undefined,
        days: left,
      });
    }
  }
  anniRows.sort((x, y) => (x.due < y.due ? -1 : 1));

  const todoRows: DigestRow[] = todos.map((t) => ({
    kind: "待办",
    title: t.title,
    due: t.dueTime ? fmt(new Date(t.dueTime)) : "无截止",
    owner: "",
    status: t.status === "OVERDUE" ? "延期" : t.status === "IN_PROGRESS" ? "进行中" : "待办",
    href: todoBase ? `${todoBase}/?focus=${t.id}` : undefined,
  }));

  return {
    user,
    todos: todoRows,
    projects: {
      running: prows.filter((p) => p.status === "RUNNING").length,
      delayed: delayedProjects,
      risks: riskRows,
      issues: issueRows,
      rows: projectRows,
    },
    anniversaries: anniRows,
    now,
  };
}

/** 企微 markdown 只认 [文字](链接) 这种行内链接，链接缺了就退化成纯文字 */
function link(row: { title: string; href?: string }): string {
  return row.href ? `[${row.title}](${row.href})` : row.title;
}

function blockquote(title: string, rows: Array<{ title: string; due?: string; status?: string; href?: string }>): string[] {
  if (rows.length === 0) return [];
  const lines = [`> ${title}`];
  for (const row of rows) lines.push(`> - ${link(row)}${row.due ? `｜${row.due}` : ""}`);
  return lines;
}

/**
 * 纪念日「还有 N 天」高亮：企微群机器人 markdown 认 `<font color="…">`。
 * 越临近越醒目 —— 今天/明天红色、当周橙色、其余绿色，加粗一律要有。
 */
function highlightDays(days: number): string {
  const text = days <= 0 ? "就是今天" : `还有 ${days} 天`;
  const color = days <= 1 ? "warning" : days <= 7 ? "comment" : "info";
  return `**<font color="${color}">${text}</font>**`;
}

function anniversaryLine(a: DigestRow): string {
  return `- ${link(a)}｜${a.due}｜${highlightDays(a.days ?? 999)}`;
}

function wecomMarkdown(d: Awaited<ReturnType<typeof collectDigest>>): string {
  const L: string[] = [`## 每日汇总 ${fmt(d.now)}`, ""];
  L.push(
    `**项目**：进行中 ${d.projects.running} · 有延期 ${d.projects.delayed} · 风险预报 ${d.projects.risks.length} · 待修问题项目 ${d.projects.issues.length}`,
  );
  L.push(
    ...blockquote("风险预报（阶段已逾期 / 7 天内结束）", d.projects.risks.slice(0, 10)),
    "",
    ...blockquote("项目中含待修问题", d.projects.issues.slice(0, 10)),
    "",
    `**待办** ${d.todos.length}（延期+近7天+进行中）：`,
  );
  L.push(...d.todos.slice(0, 15).map((t) => `- ${link(t)}${t.due ? `｜${t.due}` : ""}｜${t.status}`));
  if (d.todos.length > 15) L.push(`- …等共 ${d.todos.length} 条，详见邮件附件`);
  L.push("", `**纪念日（近30天）** ${d.anniversaries.length}：`);
  L.push(...d.anniversaries.slice(0, 20).map(anniversaryLine));
  return L.join("\n");
}

/**
 * 邮件正文按应用分三块：纪念日 / 待办 / 工作台。
 * 每块先给一行汇总，再跟自己的表 —— 原来所有类型塞进一张大表，
 * 状态列口径还不一样（项目是进行中/暂停，阶段是逾期/临近），看着容易串。
 */
function mailHtml(d: Awaited<ReturnType<typeof collectDigest>>): string {
  const cell = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const anchor = (row: { project?: string; title: string; href?: string }) => {
    const text = cell(row.project ?? row.title);
    return row.href ? `<a href="${row.href}">${text}</a>` : text;
  };
  const table = (headers: string[], rows: string[][]) =>
    rows.length === 0
      ? `<p>无</p>`
      : `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
<thead><tr>${headers.map((h) => `<th align="left">${h}</th>`).join("")}</tr></thead>
<tbody>${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
</table>`;

  const anniversaryRows = d.anniversaries.map((a) => [
    anchor(a),
    cell(a.due),
    a.days != null ? `<b>${a.days <= 0 ? "就是今天" : `还有 ${a.days} 天`}</b>` : "—",
  ]);
  const todoRows = d.todos.map((t) => [anchor(t), cell(t.due), cell(t.status)]);
  const projectRows = d.projects.rows.map((p) => [
    anchor(p),
    cell(p.phase ?? "—"),
    cell(p.due),
    p.issues ? `${p.issues} 个` : "—",
  ]);
  const riskRows = d.projects.risks.map((r) => [
    anchor(r),
    cell(r.phase ?? "—"),
    cell(r.due),
    cell(r.status),
  ]);
  const issueRows = d.projects.issues.map((r) => [
    anchor(r),
    `${r.issues ?? 0} 个${r.bugs ? `（缺陷 ${r.bugs}）` : ""}`,
    cell(r.due),
    cell(r.status),
  ]);

  const overdue = d.todos.filter((t) => t.status === "延期").length;
  const doing = d.todos.filter((t) => t.status === "进行中").length;
  const pending = d.todos.length - overdue - doing;

  return `<h2>每日汇总 ${fmt(d.now)}</h2>
<h3>纪念日：近 30 天 ${d.anniversaries.length} 个</h3>
${table(["纪念日", "日期", "倒计时"], anniversaryRows)}
<h3>待办：${d.todos.length} 条（延期 ${overdue} · 进行中 ${doing} · 待办 ${pending}）</h3>
${table(["待办", "截止", "状态"], todoRows)}
<h3>工作台：项目 ${d.projects.rows.length} 个（进行中 ${d.projects.running} · 有延期 ${d.projects.delayed}）· 风险预报 ${d.projects.risks.length} · 待修问题 ${d.projects.issues.length}</h3>
<p><b>项目（当前阶段）</b></p>
${table(["项目", "当前阶段", "计划上线 / 结束", "待修问题"], projectRows)}
<p><b>风险预报（阶段已逾期 / 7 天内结束）</b></p>
${table(["项目", "当前阶段", "阶段结束", "状态"], riskRows)}
<p><b>待修问题</b></p>
${table(["项目", "待修问题", "最近更新", "状态"], issueRows)}
<p>明细见附件 Excel。</p>`;
}

/**
 * exceljs 是 CJS 包：tsx / Next 下 `import("exceljs")` 拿到的是带 default 的包装，
 * 直接解构 `{ Workbook }` 会得到 undefined，attachments 就静默退化成 CSV。
 * 两种形态都认一下，拿不到才让上层走 CSV 兜底。
 */
async function workbookCtor(): Promise<typeof import("exceljs").Workbook> {
  const mod = (await import("exceljs")) as unknown as {
    Workbook?: typeof import("exceljs").Workbook;
    default?: { Workbook?: typeof import("exceljs").Workbook };
  };
  const ctor = mod.Workbook ?? mod.default?.Workbook;
  if (!ctor) throw new Error("exceljs 不可用：Workbook 缺失");
  return ctor;
}

export async function buildDigestExcel(d: Awaited<ReturnType<typeof collectDigest>>): Promise<{ filename: string; content: Buffer; contentType: string }> {
  const all = [...d.projects.rows, ...d.projects.risks, ...d.projects.issues, ...d.todos, ...d.anniversaries];
  /** 项目行的「状态」换成当前阶段，和邮件里「项目（当前阶段）」那张表口径一致 */
  const statusOf = (r: DigestRow) => (r.kind === "项目" && r.phase ? r.phase : r.status);
  try {
    const wb = new (await workbookCtor())();
    const ws = wb.addWorksheet("汇总");
    ws.columns = [
      { header: "类型", key: "kind", width: 12 },
      { header: "标题", key: "title", width: 46 },
      { header: "时间", key: "due", width: 16 },
      { header: "状态 / 阶段", key: "status", width: 16 },
    ];
    for (const r of all) {
      const due = r.kind === "纪念日" && r.days != null ? `${r.due} · 还有 ${r.days} 天` : r.due;
      ws.addRow({ ...r, due, status: statusOf(r) });
    }
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return { filename: `digest-${fmt(d.now)}.xlsx`, content: buf, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  } catch {
    const csv = `类型,标题,时间,状态/阶段\n${all
      .map((r) => [r.kind, `"${r.title.replace(/"/g, '""')}"`, r.due, statusOf(r)].join(","))
      .join("\n")}`;
    return { filename: `digest-${fmt(d.now)}.csv`, content: Buffer.from("\ufeff" + csv), contentType: "text/csv" };
  }
}

export async function sendDigest(
  userId: number,
  opts?: { channels?: ("MAIL" | "WECOM")[]; skipWecom?: boolean },
) {
  const d = await collectDigest(userId);
  const explicit = opts?.channels?.length ? opts.channels : null;
  const enabled: ("MAIL" | "WECOM")[] = explicit
    ? [...explicit]
    : ((await prisma.notifyChannel.findMany({ where: { userId, enabled: true } })).map((c) => c.type) as (
        | "MAIL"
        | "WECOM"
      )[]);
  // 群机器人是**全站**配置，不能跟着某个人的「启用企业微信」开关一起被掐掉 ——
  // 那个开关的本意是「给这个人发应用消息」。配了 webhook 就说明群汇总要发，
  // 否则所有人的渠道都关着时，每天早上的群消息会一声不响地消失。
  if (!explicit && !enabled.includes("WECOM") && (await wecomWebhook())) enabled.push("WECOM");
  // 群机器人是「一份报告发一个群」，定时任务里只让第一个用户真正发企微，
  // 其余人跳过，避免同一份汇总在群里刷屏。
  const channels = enabled.filter((type) => !(type === "WECOM" && opts?.skipWecom));
  const result: Record<string, string> = {};
  const date = fmt(d.now);

  if (channels.includes("MAIL")) {
    try {
      const to = cfgString((await prisma.notifyChannel.findFirst({ where: { userId, type: "MAIL" } }))?.config, "to") ?? d.user.email;
      if (!to) throw new Error("未配置收件邮箱");
      const file = await buildDigestExcel(d);
      await sendMail({
        to,
        subject: `【每日汇总】${date} 待办${d.todos.length} 项目${d.projects.running} 纪念日${d.anniversaries.length}`,
        html: mailHtml(d),
        attachments: [{ filename: file.filename, content: file.content, contentType: file.contentType }],
      });
      await prisma.notifyLog.create({ data: { userId, channel: "MAIL", title: `每日汇总 ${date}`, content: `待办${d.todos.length} 项目${d.projects.running} 纪念日${d.anniversaries.length}` } });
      result.MAIL = `已发往 ${to}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.MAIL = `失败：${msg}`;
      // 失败也要落库，否则「发送记录」页看不到任何痕迹，无法定位
      await prisma.notifyLog.create({
        data: {
          userId,
          channel: "MAIL",
          title: `每日汇总 ${date}`,
          content: `待办${d.todos.length} 项目${d.projects.running} 纪念日${d.anniversaries.length}`,
          status: "FAILED",
          lastError: msg,
        },
      });
    }
  }
  if (channels.includes("WECOM")) {
    const body = wecomMarkdown(d);
    try {
      // 有群机器人 webhook 就直发到群。body 已经是带跳转链接的标准 markdown，
      // 不要求接收人 userid，也不走应用消息通道。
      // 走 webhook 时先记一条 PENDING 的 notifyLog 再发送 —— 发送成功才置 SENT，
      // 失败就留在 PENDING（带 nextRetryAt），交给 notify-retry 退避重发，
      // 这样群消息也享受「失败重试」。
      const hook = await wecomWebhook();
      if (hook) {
        const log = await prisma.notifyLog.create({
          data: {
            userId,
            channel: "WECOM",
            title: `每日汇总 ${date}`,
            content: body,
            status: "PENDING",
          },
        });
        try {
          await sendWecomWebhook(hook, body);
          await prisma.notifyLog.update({
            where: { id: log.id },
            data: { status: "SENT", sentAt: new Date(), lastError: null },
          });
          result.WECOM = "已发往群机器人";
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await prisma.notifyLog.update({
            where: { id: log.id },
            data: {
              retryCount: 1,
              lastError: message,
              nextRetryAt: new Date(Date.now() + 60_000),
            },
          });
          throw err;
        }
      } else {
        const ch = await prisma.notifyChannel.findFirst({ where: { userId, type: "WECOM" } });
        const toUser = cfgString(ch?.config, "toUser") ?? d.user.wecomId;
        if (!toUser) throw new Error("未配置企微 userid");
        await sendWecomAppMessage({ toUser, title: `每日汇总 ${date}`, content: body });
        await prisma.notifyLog.create({ data: { userId, channel: "WECOM", title: `每日汇总 ${date}`, content: body.slice(0, 500) } });
        result.WECOM = `已发往 ${toUser}`;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.WECOM = `失败（10 分钟后重试）：${msg}`;
    }
  }
  return result;
}
