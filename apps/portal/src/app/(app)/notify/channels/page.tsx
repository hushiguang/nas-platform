import Link from "next/link";
import { prisma } from "@nas/db";
import {
  digestTimes,
  mailConfig,
  MAIL_SETTING_KEYS,
  QQ_MAIL_HOST,
  QQ_MAIL_PORT,
  storedSettings,
  wecomConfig,
  WECOM_SETTING_KEYS,
} from "@nas/notify";
import { requireUser } from "@/auth";
import { DigestTimesForm } from "../digest-times-form";
import {
  resetDigestTimes,
  saveAndTestMail,
  saveDigestTimes,
  saveMailSettings,
  saveWecomAppSettings,
  saveWecomWebhook,
  testMailSettings,
  testWecomSettings,
} from "../settings-actions";

/**
 * 通知渠道配置（仅管理员）。
 *
 * 两层：上面是企业微信「应用」三件套（CorpID / Secret / AgentId，全站共用一份），
 * 下面是每个用户的接收人（企微 userid / 邮箱）与启用开关。
 * 汇总与发送统一收口在门户，各应用不再单独配置渠道。
 */
export default async function NotifyChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    return <div className="card muted">仅管理员可查看通知渠道</div>;
  }
  const { error, ok } = await searchParams;

  const [users, wecom, mail, stored, times] = await Promise.all([
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      orderBy: { id: "asc" },
      include: { notifyChannels: true },
    }),
    // 界面配置的优先，取不到才用环境变量。fromDb 用来在页面上标注来源
    wecomConfig(),
    mailConfig(),
    storedSettings(),
    // 每日汇总的发送时点：页面配置 > DIGEST_TIMES 环境变量 > 默认 08:10 / 16:00
    digestTimes(true),
  ]);
  const webhook = stored[WECOM_SETTING_KEYS.webhook] || process.env.WECOM_WEBHOOK || "";

  const badge = (on: boolean) =>
    on ? (
      <span className="badge" style={{ background: "var(--wash-mint)", color: "var(--mint-ink)" }}>
        开启
      </span>
    ) : (
      <span className="badge soft">关闭</span>
    );

  const envTag = (fromDb: boolean, hasEnv: boolean) => {
    if (fromDb) return <span className="badge soft">本机配置</span>;
    return hasEnv ? <span className="badge soft">环境变量</span> : null;
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">通知 · 统一配置</span>
          <h1>通知渠道</h1>
        </div>
        <Link href="/notify" className="btn ghost">
          发送记录 →
        </Link>
      </div>

      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        所有应用的待办提醒都汇总到门户统一发送。这里管「用什么应用发、发给谁」，各应用（含待办）不再单独配置。
      </p>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
      {ok && <div className="notice ok" style={{ marginBottom: 14 }}>{ok}</div>}

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h2>每日汇总发送时间</h2>
          <span className="badge soft">当前 {times.join(" / ")}</span>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          每日汇总（待办 / 项目 / 纪念日 / 账单，邮件 + 企微群）在这些时点各推一次。
          可以加多个时间点；改完约 15 秒内生效，不用重启 worker。
        </p>
        <DigestTimesForm times={times} action={saveDigestTimes} reset={resetDigestTimes} />
      </section>

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h2>群机器人（推荐本地用）</h2>
          {webhook ? <span className="badge">已配置</span> : <span className="badge soft">未配置</span>}
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          只要一个 webhook 地址，不用应用三件套，也不受出口 IP / 可信域名限制，本地开发直接可用。
          它的优先级高于应用消息：配了地址，「企微」通道就改走群机器人。
          在企微「群聊 → … → 群机器人 → 添加 → 新创建一个」拿到地址。
        </p>
        <form action={saveWecomWebhook} style={{ display: "grid", gap: 12, maxWidth: 640 }}>
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 96 }}>Webhook</span>
            <input
              name="wecomWebhook"
              defaultValue={webhook}
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"
              autoComplete="off"
              className="field"
              style={{ flex: 1 }}
            />
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="submit" className="btn">
              保存并测试
            </button>
            <span className="muted" style={{ fontSize: 12 }}>保存后会立刻往群里发一条测试消息</span>
          </div>
        </form>
      </section>

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h2>企业微信应用</h2>
          {wecom.ok ? <span className="badge">已配置</span> : <span className="badge soft">未配置，发送会失败</span>}
        </div>

        {!wecom.ok && (
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            企业微信发消息需要应用身份，三项缺一不可。企微后台「我的企业 → 企业信息」拿企业ID（CorpID），
            「应用管理 → 自建应用」拿 Secret 和 AgentId；再把服务器出口 IP 加进该应用的「可信 IP」。
          </p>
        )}

        <form action={saveWecomAppSettings} style={{ display: "grid", gap: 12, maxWidth: 640 }}>
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 96 }}>企业ID</span>
            <input
              name="wecomCorpId"
              defaultValue={wecom.corpId}
              placeholder="wwxxxxxxxxxxxxxxxx"
              autoComplete="off"
              className="field"
              style={{ flex: 1 }}
            />
            {envTag(wecom.fromDb.corpId, !!process.env.WECOM_CORP_ID)}
          </label>
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 96 }}>应用Secret</span>
            <input
              name="wecomCorpSecret"
              defaultValue={wecom.corpSecret}
              placeholder="自建应用的 Secret"
              autoComplete="off"
              className="field"
              style={{ flex: 1 }}
            />
            {envTag(wecom.fromDb.corpSecret, !!process.env.WECOM_CORP_SECRET)}
          </label>
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 96 }}>应用AgentId</span>
            <input
              name="wecomAgentId"
              defaultValue={Number.isFinite(wecom.agentId) ? String(wecom.agentId) : ""}
              placeholder="纯数字，如 1000002"
              inputMode="numeric"
              className="field"
              style={{ flex: 1 }}
            />
            {envTag(wecom.fromDb.agentId, !!process.env.WECOM_AGENT_ID)}
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="submit" className="btn">
              保存
            </button>
            <button type="submit" formAction={testWecomSettings} className="btn ghost">
              测试连接
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              三项都留空则改回环境变量；「测试连接」只换 access_token，不会真发消息。
            </span>
          </div>
        </form>
      </section>

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h2>邮件 · QQ 邮箱（授权码）</h2>
          {mail.ok ? <span className="badge">已配置</span> : <span className="badge soft">未配置，邮件会失败</span>}
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          QQ 邮箱用「邮箱账号 + 授权码」发信：登录 QQ 邮箱 → 设置 → 账号 → 开启「POP3/SMTP 服务」→
          生成<b>授权码</b>，把授权码填到下面（不是 QQ 密码）。服务器默认 <b>{QQ_MAIL_HOST}:{QQ_MAIL_PORT}</b>（SSL），
          一般不用改；发件人会强制用同一个账号（QQ 的要求），所以「发件人」留空即可。
          <br />
          每日汇总、待办提醒都会走这里发信；每个用户的收件邮箱在页面下方「接收人」里配置。
        </p>

        <form action={saveMailSettings} style={{ display: "grid", gap: 12, maxWidth: 640 }}>
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 96 }}>发信邮箱</span>
            <input
              name="mailUser"
              defaultValue={mail.user}
              placeholder="yourname@qq.com"
              autoComplete="off"
              className="field"
              style={{ flex: 1 }}
            />
            {envTag(mail.fromDb.user, !!process.env.SMTP_USER)}
          </label>
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 96 }}>授权码</span>
            <input
              name="mailPass"
              defaultValue={mail.pass}
              placeholder="16 位授权码（不是 QQ 密码）"
              autoComplete="off"
              className="field"
              style={{ flex: 1 }}
            />
            {envTag(mail.fromDb.pass, !!process.env.SMTP_PASS)}
          </label>
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 96 }}>发件人</span>
            <input
              name="mailFrom"
              defaultValue={stored[MAIL_SETTING_KEYS.from] || process.env.MAIL_FROM || ""}
              placeholder="留空 = 与发信邮箱一致"
              autoComplete="off"
              className="field"
              style={{ flex: 1 }}
            />
            {envTag(mail.fromDb.from, !!process.env.MAIL_FROM)}
          </label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span style={{ width: 96 }}>服务器</span>
              <input
                name="mailHost"
                defaultValue={stored[MAIL_SETTING_KEYS.host] ?? ""}
                placeholder={mail.qq ? QQ_MAIL_HOST : "smtp.qq.com"}
                autoComplete="off"
                className="field"
                style={{ width: 200 }}
              />
            </label>
            <label className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span>端口</span>
              <input
                name="mailPort"
                defaultValue={stored[MAIL_SETTING_KEYS.port] ?? ""}
                placeholder={mail.qq ? String(QQ_MAIL_PORT) : "465"}
                inputMode="numeric"
                className="field"
                style={{ width: 90 }}
              />
            </label>
            <label className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span>加密</span>
              <select
                name="mailSecure"
                defaultValue={stored[MAIL_SETTING_KEYS.secure] ?? "true"}
                style={{ minWidth: 130 }}
              >
                <option value="true">SSL（465）</option>
                <option value="false">STARTTLS（587）</option>
              </select>
            </label>
          </div>
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 96 }}>测试收件人</span>
            <input
              name="mailTestTo"
              placeholder="留空 = 发到上面的发信邮箱"
              autoComplete="off"
              className="field"
              style={{ flex: 1 }}
            />
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" className="btn">
              保存并校验
            </button>
            <button type="submit" formAction={saveAndTestMail} className="btn primary">
              保存并发送测试邮件
            </button>
            <button type="submit" formAction={testMailSettings} className="btn ghost">
              测试当前配置
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              全部留空 = 清空，改用环境变量 SMTP_*
            </span>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>接收人</h2>
          <span className="muted" style={{ fontSize: 13 }}>{users.length} 人</span>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>用户</th>
                <th>接收人</th>
                <th>企微</th>
                <th>邮件</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const wecomCh = u.notifyChannels.find((c) => c.type === "WECOM");
                const mail = u.notifyChannels.find((c) => c.type === "MAIL");
                return (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{u.nickname}</div>
                      <div className="muted" style={{ fontSize: 12 }}>@{u.username}</div>
                    </td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      <div>{u.email || "邮箱未填"}</div>
                      <div>企微 {u.wecomId || "未填"}</div>
                    </td>
                    <td>{badge(Boolean(wecomCh?.enabled))}</td>
                    <td>{badge(Boolean(mail?.enabled))}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/admin/users/${u.id}`} className="btn ghost sm">
                        配置
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
