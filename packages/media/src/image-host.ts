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

/** 回源地址白名单校验 */
export function isAllowedImageUrl(value: unknown): boolean {
  try {
    const parsed = new URL(String(value));
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
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
