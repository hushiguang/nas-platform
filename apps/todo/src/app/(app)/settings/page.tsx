import { SiteLink } from "@nas/ui";
import { portalUrl } from "@nas/core";
import { requireUser } from "@/auth";

/**
 * 设置页：待办应用只管记事，通知的渠道与接收人统一在门户配置。
 * 这里不再重复做一份，只做跳转，避免两边配置打架。
 */
export default async function SettingsPage() {
  await requireUser();
  const portalBase = portalUrl();

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">提醒去哪了</span>
          <h1>设置</h1>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <b>通知渠道与接收人</b>
          <span className="badge soft">门户统一管理</span>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          所有应用的待办提醒都汇总到门户统一发送：门户的「待办管理」聚合全站待办，
          「通知渠道」里配每个人的邮箱 / 企微与开关。这里只管把事情记下来，不再单独配置。
        </p>
        {portalBase ? (
          <p style={{ marginTop: 10 }}>
            <SiteLink href={`${portalBase}/notify/channels`} className="btn">
              去门户配置通知 →
            </SiteLink>
          </p>
        ) : (
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            未配置门户地址，请联系管理员。
          </p>
        )}
      </section>
    </div>
  );
}
