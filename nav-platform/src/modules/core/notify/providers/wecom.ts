/**
 * 企业微信「应用消息」渠道。
 * 文档：https://developer.work.weixin.qq.com/document/path/90236
 * 依赖环境变量：WECOM_CORP_ID / WECOM_CORP_SECRET / WECOM_AGENT_ID
 */

// access_token 有效期 7200s，进程内缓存，提前 60s 过期
let cached: { token: string; expiresAt: number } | null = null;

interface WecomEnv {
  corpId: string;
  corpSecret: string;
  agentId: number;
}

function wecomEnv(): WecomEnv {
  const corpId = process.env.WECOM_CORP_ID;
  const corpSecret = process.env.WECOM_CORP_SECRET;
  const agentId = Number(process.env.WECOM_AGENT_ID);
  if (!corpId || !corpSecret || !Number.isFinite(agentId) || agentId <= 0) {
    throw new Error("企微未配置：缺少 WECOM_CORP_ID / WECOM_CORP_SECRET / WECOM_AGENT_ID");
  }
  return { corpId, corpSecret, agentId };
}

async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const { corpId, corpSecret } = wecomEnv();
  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`,
  );
  const json = (await res.json()) as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number };
  if (json.errcode || !json.access_token) {
    throw new Error(`企微 access_token 获取失败: ${json.errcode} ${json.errmsg ?? ""}`);
  }
  cached = {
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
  const { agentId } = wecomEnv();
  const token = await getAccessToken();
  const body = {
    touser: toUser,
    msgtype: "text",
    agentid: agentId,
    text: { content: `${title}\n${content}` },
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
    throw new Error(`企微消息发送失败: ${json.errcode} ${json.errmsg ?? ""}`);
  }
}

/** 配置自检：管理页「测试发送」与管理端连通性检查用 */
export function wecomConfigured(): boolean {
  try {
    wecomEnv();
    return true;
  } catch {
    return false;
  }
}
