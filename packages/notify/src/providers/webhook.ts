/**
 * 企业微信群机器人 Webhook。
 * 文档：https://developer.work.weixin.qq.com/document/path/91770
 *
 * 与应用消息的区别：只要一个 webhook key，不需要 CorpID/Secret/AgentId，
 * 也不校验出口 IP 和可信域名，本地开发、动态公网 IP 都能直接用。
 * 代价是没有「指定接收人」的概念——发到哪个群，群成员就都能看到。
 *
 * key 的来源（见 ../settings.ts）：门户「通知渠道」页存到 setting 表的值优先，
 * 没有才回退环境变量 WECOM_WEBHOOK。部署时两个都能用——
 * 推荐走界面配，一次填写长期有效；环境变量是容器兜底。
 */

import { splitByBytes } from "../split";

/**
 * 企微群机器人 markdown.content 的上限是 4096 **字节**。
 * 留一点余量：企微按 UTF-8 字节算，中文一个字 3 字节，
 * 卡在 4096 正上方容易因为多一个字符整条被拒。
 */
const MAX_MARKDOWN_BYTES = 3800;

/** 从完整 webhook 地址里抠出 key，也接受直接粘贴 key */
export function webhookKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("key")?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * 发一条 markdown。内容超长时按字节拆成多条依次发出 ——
 * 整条被截掉意味着汇总里的项目/待办全丢了，拆开发反而看得全。
 *
 * 返回实际发出的条数。
 */
export async function sendWecomWebhook(raw: string, markdown: string): Promise<number> {
  // raw 可能是完整地址或纯 key，这里统一归一化，避免调用方传完整地址
  // 导致 key=整个URL 被二次编码（会报 93000 invalid webhook url）
  const key = webhookKey(raw);
  if (!key) throw new Error("未配置群机器人 webhook");
  const url = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`;

  const parts = splitByBytes(markdown, MAX_MARKDOWN_BYTES);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    // 拆出来的后续段落加个序号，免得群里看成分了好几条互不相干的消息
    const content = parts.length > 1 ? `${part}\n\n> （第 ${i + 1}/${parts.length} 段）` : part;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { content } }),
    });
    const json = (await res.json()) as { errcode?: number; errmsg?: string };
    if (json.errcode !== 0) {
      throw new Error(
        `企微群机器人发送失败: ${json.errcode} ${json.errmsg ?? ""}${
          parts.length > 1 ? `（第 ${i + 1}/${parts.length} 段）` : ""
        }`,
      );
    }
  }
  return parts.length;
}

/** 连通性测试：发一条极短消息，用户能在群里直接看到 */
export async function testWecomWebhook(raw: string): Promise<{ ok: boolean; message: string }> {
  const key = webhookKey(raw);
  if (!key) return { ok: false, message: "请先填写群机器人 Webhook 地址" };
  try {
    await sendWecomWebhook(key, `**连接测试**\n来自 nas-platform 的通知通道自检，看到这条说明 webhook 可用。`);
    return { ok: true, message: "已发送测试消息，请到群里确认" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
