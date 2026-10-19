/**
 * 图床：EasyImages2.0（https://github.com/icret/EasyImages2.0）
 *
 * 上传走服务端转发，token 不落到前端；展示也走服务端代理 ——
 * 自建图床常用自签证书，浏览器直连会加载失败，代理一层最省心。
 *
 * 这里刻意用 node:http / node:https 而不是 fetch：只有原生请求能对单个请求
 * 关掉证书校验（`rejectUnauthorized: false`），而图床就是自签的。
 * 这个文件必须在 Node runtime 下跑，不能进 Edge。
 */
import http from "node:http";
import https from "node:https";
import { imageHostConfig } from "./config";
import { MediaError } from "./errors";

function hostOf(value: string | undefined): string {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * 图片代理只允许回源到图床，避免变成任意 URL 抓取（SSRF）。
 * 没单独配白名单时，默认放行 IMAGE_HOST_URL 的主机。
 */
const ALLOWED_HOSTS = new Set(
  [imageHostConfig.url, ...imageHostConfig.allowHosts].map(hostOf).filter(Boolean),
);

/**
 * 白名单为空时给出可读的原因，而不是让 isAllowedImageUrl 对所有地址一律 false。
 * 空集最常见的成因是 IMAGE_HOST_URL 漏配（compose 默认空串），但从返回值上
 * 和「URL 确实不在白名单里」完全看不出区别，排查只能靠猜。
 */
export function allowHostsDiagnostic(): string {
  if (ALLOWED_HOSTS.size) return `白名单：${[...ALLOWED_HOSTS].join(", ")}`;
  return "回源白名单为空：IMAGE_HOST_URL 与 IMAGE_HOST_ALLOW_HOSTS 都没配，" +
    "所有 /api/media/image 请求都会被拒（表现为图片全裂，但日志只有一句「这个地址不允许」）";
}

/** 图床是否已配置。没配就整块上传关闭，接口返回 501 */
export const imageHostConfigured = Boolean(imageHostConfig.token && imageHostConfig.url);

export interface ImageUploadInput {
  buffer?: Buffer | Uint8Array | null;
  mimetype?: string;
  filename?: string;
}

export interface ImageUploadResult {
  url: string;
  thumb: string;
  del: string;
  name: string;
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function rawRequest(url: URL, options: http.RequestOptions = {}, body: Buffer | null = null) {
  return new Promise<RawResponse>((resolve, reject) => {
    const lib = url.protocol === "http:" ? http : https;
    // 图床用自签证书，只在这里放过校验
    const req = lib.request(url, { rejectUnauthorized: false, ...options }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers as RawResponse["headers"],
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("图床超时")));
    if (body) req.write(body);
    req.end();
  });
}

/** 服务端转发上传，token 只出现在服务端与图床之间 */
export async function uploadImage(input: ImageUploadInput): Promise<ImageUploadResult> {
  if (!imageHostConfigured) throw new MediaError("图床还没配置", 501);
  const buffer = input.buffer ? Buffer.from(input.buffer) : null;
  if (!buffer?.length) throw new MediaError("没有选到图片");
  if (buffer.length > imageHostConfig.imageMaxBytes) {
    throw new MediaError(
      `图片太大了（最多 ${Math.round(imageHostConfig.imageMaxBytes / 1024 / 1024)}MB）`,
    );
  }

  const boundary = `----nasmedia${Date.now()}${Math.random().toString(16).slice(2)}`;
  const safeName =
    String(input.filename || "image")
      .replace(/[^\w.\-]/g, "_")
      .slice(-80) || "image";

  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="token"\r\n\r\n${imageHostConfig.token}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${safeName}"\r\n` +
        `Content-Type: ${input.mimetype || "application/octet-stream"}\r\n\r\n`,
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  const payload = Buffer.concat(parts);

  const res = await rawRequest(
    new URL(imageHostConfig.url),
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": payload.length,
      },
    },
    payload,
  );

  let data: { result?: string; url?: string; thumb?: string; del?: string; srcName?: string; message?: string };
  try {
    data = JSON.parse(res.body.toString("utf8"));
  } catch {
    throw new MediaError("图床返回看不懂", 502);
  }
  if (data.result !== "success" || !data.url) throw new MediaError(data.message || "上传失败", 502);
  return {
    url: data.url,
    thumb: data.thumb || data.url,
    del: data.del || "",
    name: data.srcName || safeName,
  };
}

/**
 * 回源地址白名单校验。
 *
 * 第二个返回值是拒绝原因，只在拒绝时有值 —— 空集（配置漏了）和
 * 「这个主机确实不在名单里」在布尔返回值上完全看不出区别，而这两者的
 * 排查方向完全相反，所以把原因一并带出去。
 */
export function isAllowedImageUrl(value: unknown): [boolean, string | null] {
  let parsed: URL;
  try {
    parsed = new URL(String(value));
  } catch {
    return [false, "地址格式不合法"];
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return [false, `只允许 http/https，收到 ${parsed.protocol}`];
  }
  if (!ALLOWED_HOSTS.size) {
    return [false, allowHostsDiagnostic()];
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    return [false, `${host} 不在回源白名单（${[...ALLOWED_HOSTS].join(", ")}）`];
  }
  return [true, null];
}

/** 代理取图：绕开自签证书，浏览器就能直接显示了 */
export async function fetchImage(url: string) {
  const res = await rawRequest(new URL(url), { method: "GET" });
  if (res.status !== 200) throw new MediaError("取不到这张图", 502);
  const contentType = res.headers["content-type"];
  return {
    body: res.body,
    contentType: typeof contentType === "string" ? contentType : "image/*",
  };
}
