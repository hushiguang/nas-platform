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
import net from "node:net";
import type { LookupFunction } from "node:net";
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
 * 没单独配白名单时，默认放行 IMAGE_HOST_URL 的主机；配了回源改写
 * （IMAGE_HOST_FETCH_BASE）时，也放行改写后的主机 —— 图床可能按请求
 * Host 返回地址，上传走内网 IP 时存下来的就是 IP，不放行会读不出来。
 */
const ALLOWED_HOSTS = new Set(
  [imageHostConfig.url, imageHostConfig.fetchBase, ...imageHostConfig.allowHosts]
    .map(hostOf)
    .filter(Boolean),
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

/**
 * 把请求地址改写成「容器能走通」的回源地址。
 *
 * 对外域名（常见于经 Lucky/反代暴露的 image.<root>）可能只有 AAAA 记录，
 * 而 Docker 默认桥接网络没有 IPv6。只替换协议/主机/端口，路径和查询保持
 * 不变，这样白名单仍然是按原域名判断，图床返回的 URL 也照旧存。
 */
function outboundUrl(raw: string | URL): URL {
  const target = typeof raw === "string" ? new URL(raw) : new URL(raw.toString());
  const base = imageHostConfig.fetchBase.trim();
  if (!base) return target;
  const rewrite = new URL(/^https?:\/\//i.test(base) ? base : `https://${base}`);
  target.protocol = rewrite.protocol;
  target.hostname = rewrite.hostname;
  target.port = rewrite.port;
  return target;
}

/**
 * 上传走内网地址时，图床可能按请求 Host 返回 http://192.168.x.x:15622/...
 * 这种地址。存库前统一改回 IMAGE_HOST_URL 的协议/主机/端口，库里的地址
 * 就始终是对外域名；以后换回源方式也不用迁移老数据。
 */
function publicizeUrl(value: string): string {
  if (!value || !imageHostConfig.fetchBase.trim()) return value;
  try {
    const parsed = new URL(value);
    const publicUrl = new URL(imageHostConfig.url);
    parsed.protocol = publicUrl.protocol;
    parsed.hostname = publicUrl.hostname;
    parsed.port = publicUrl.port;
    return parsed.toString();
  } catch {
    return value;
  }
}

/**
 * 把域名的 DNS 查询固定到某个 IPv4，但 URL 的 Host / TLS SNI 保持不变。
 *
 * 直接用 IP 访问反向代理（fetchBase）时，Lucky 之类按域名分流的反代会
 * 匹配不到站点。这个 lookup 只改「连到哪」，不改 Host，反代仍能按
 * image.<root> 路由。和 fetchBase 二选一。
 */
function fixedLookup(address: string): LookupFunction {
  return ((
    _hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ) => {
    if (options && typeof options === "object" && options.all) {
      callback(null, [{ address, family: 4 }]);
    } else {
      callback(null, address, 4);
    }
  }) as unknown as LookupFunction;
}

/** 网络层的失败给一句能照着排查的话，别只剩「取不到这张图」 */function netError(err: unknown, target: URL): MediaError {
  const code = (err as NodeJS.ErrnoException)?.code ?? "";
  const host = target.hostname;
  if (code === "ENETUNREACH" || code === "EADDRNOTAVAIL") {
    return new MediaError(
      `连不上图床 ${host}（${code}）：容器网络没有 IPv6，而该域名可能只有 AAAA 记录。` +
        "给 image 子域加一条指向 NAS 局域网 IPv4 的 A 记录，或配 IMAGE_HOST_FETCH_IP 指到 NAS 的 IPv4",
      502,
    );
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new MediaError(`图床域名 ${host} 解析失败（${code}），检查容器 DNS`, 502);
  }
  if (code === "ETIMEDOUT" || code === "ECONNREFUSED") {
    return new MediaError(`连不上图床 ${host}（${code}），检查地址/端口是否可达`, 502);
  }
  return new MediaError(`连不上图床 ${host}：${err instanceof Error ? err.message : String(err)}`, 502);
}

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
    const requestOptions: https.RequestOptions = { rejectUnauthorized: false, ...options };
    // 固定解析到指定 IPv4，且只在没配 fetchBase（直接改写地址）时生效。
    // Host / SNI 仍是 URL 里的域名，反代可以正常按域名分流。
    const ip = imageHostConfig.fetchIp.trim();
    if (ip && !imageHostConfig.fetchBase.trim() && net.isIPv4(ip)) {
      requestOptions.lookup = fixedLookup(ip);
    }
    // 图床用自签证书，只在这里放过校验
    const req = lib.request(url, requestOptions, (res) => {
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

  const target = outboundUrl(imageHostConfig.url);
  let res: RawResponse;
  try {
    res = await rawRequest(
      target,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": payload.length,
        },
      },
      payload,
    );
  } catch (err) {
    console.error(`[media] 上传图床失败 ${target.host}:`, err);
    throw netError(err, target);
  }

  let data: { result?: string; url?: string; thumb?: string; del?: string; srcName?: string; message?: string };
  try {
    data = JSON.parse(res.body.toString("utf8"));
  } catch {
    throw new MediaError("图床返回看不懂", 502);
  }
  if (data.result !== "success" || !data.url) throw new MediaError(data.message || "上传失败", 502);
  return {
    url: publicizeUrl(data.url),
    thumb: publicizeUrl(data.thumb || data.url),
    del: data.del ? publicizeUrl(data.del) : "",
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
  const target = outboundUrl(url);
  let res: RawResponse;
  try {
    res = await rawRequest(target, { method: "GET" });
  } catch (err) {
    console.error(`[media] 回源图片失败 ${target.host}:`, err);
    throw netError(err, target);
  }
  if (res.status !== 200) throw new MediaError("取不到这张图", 502);
  const contentType = res.headers["content-type"];
  return {
    body: res.body,
    contentType: typeof contentType === "string" ? contentType : "image/*",
  };
}
