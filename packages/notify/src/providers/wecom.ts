/**
 * 企业微信「应用消息」渠道。
 * 文档：https://developer.work.weixin.qq.com/document/path/90236
 *
 * 三件套（CorpID / Secret / AgentId）来自门户界面配置，见 ../settings.ts；
 * 界面没配时回退环境变量 WECOM_CORP_ID / WECOM_CORP_SECRET / WECOM_AGENT_ID。
 * 每个用户的接收人 userid 走 NotifyChannel.config.toUser 或 User.wecomId。
 */

import { splitByBytes } from "../split";
import { wecomConfig } from "../settings";

/**
 * 应用消息 text.content 的上限是 2048 **字节**。
 * 每日汇总很容易超过（中文一个字 3 字节），超了整条发不出去。
 * 这里按字节拆成多条依次发，宁可多发几条也别把整份汇总丢掉。
 */
const MAX_TEXT_BYTES = 1900;

// access_token 有效期 7200s，进程内缓存，提前 60s 过期。
// 改了配置要立即生效，所以按 corpId+secret 分桶，换了配置自然重新取 token。
let cached: { key: string; token: string; expiresAt: number } | null = null;

interface WecomEnv {
  corpId: string;
  corpSecret: string;
  agentId: number;
}

async function wecomEnv(bypassCache = false): Promise<WecomEnv> {
  const cfg = await wecomConfig(bypassCache);
  if (!cfg.ok) {
    const missing = [
      !cfg.corpId ? "企业ID(CorpID)" : "",
      !cfg.corpSecret ? "应用Secret" : "",
      !Number.isFinite(cfg.agentId) || cfg.agentId <= 0 ? "应用AgentId" : "",
    ].filter(Boolean);
    throw new Error(`企微未配置：缺少${missing.join("、")}，请在门户「通知渠道」页填写`);
  }
  return { corpId: cfg.corpId, corpSecret: cfg.corpSecret, agentId: cfg.agentId };
}

async function getAccessToken(): Promise<string> {
  const { corpId, corpSecret } = await wecomEnv();
  const key = `${corpId}:${corpSecret}`;
  if (cached && cached.key === key && cached.expiresAt > Date.now()) return cached.token;
  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`,
  );
  const json = (await res.json()) as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number };
  if (json.errcode || !json.access_token) {
    throw new Error(`企微 access_token 获取失败: ${json.errcode} ${json.errmsg ?? ""}`);
  }
  cached = {
    key,
    token: json.access_token,
    expiresAt: Date.now() + Math.max((json.expires_in ?? 7200) - 60, 60) * 1000,
  };
  return cached.token;
}

export interface WecomPayload {
  /** 企微成员 userid，多个用 | 分隔 */
  toUser: string;
  title: string;
  content: string;
}

export async function sendWecomAppMessage({ toUser, title, content }: WecomPayload): Promise<void> {
  const { agentId } = await wecomEnv();
  const token = await getAccessToken();
  const full = `${title}\n${content}`;
  // 超长就按字节拆成多条发，企微对 text.content 也只认 2048 字节
  const parts = splitByBytes(full, MAX_TEXT_BYTES);
  for (let i = 0; i < parts.length; i += 1) {
    const body = {
      touser: toUser,
      msgtype: "text",
      agentid: agentId,
      text: { content: parts[i] },
      safe: 0,
      duplicate_check_interval: 600, // 10 分钟内重复内容自动去重（企微侧兜底）
    };
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { errcode?: number; errmsg?: string };
    if (json.errcode !== 0) {
      // token 过期/失效：清缓存，交给重试机制重来一次
      if (json.errcode === 42001 || json.errcode === 40014) cached = null;
      throw new Error(
        `企微消息发送失败: ${json.errcode} ${json.errmsg ?? ""}${
          parts.length > 1 ? `（第 ${i + 1}/${parts.length} 段）` : ""
        }`,
      );
    }
  }
}

/**
 * 连通性测试：只换 access_token，不发消息。
 * 报 40013/40125 就是 CorpID 或 Secret 填错（最常见），60020/60011 多半是
 * 出口 IP 不在应用「可信 IP」里。
 */
export async function testWecomConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    await getAccessToken();
    return { ok: true, message: "连接正常，access_token 获取成功" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** 配置自检：管理页展示用。走一次实际配置（库 + env）判断是否齐全 */
export async function wecomConfigured(): Promise<boolean> {
  return (await wecomConfig(true)).ok;
}
