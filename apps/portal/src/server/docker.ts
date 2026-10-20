import { existsSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";

/** 只允许看这些服务，避免把用户输入拼进 Docker 路径 */
export const DOCKER_SERVICES = [
  "gateway",
  "portal",
  "bill",
  "anniversary",
  "work",
  "pregnancy",
  "travel",
  "worker",
  "postgres",
] as const;

export type DockerService = (typeof DOCKER_SERVICES)[number];

export interface DockerLogResult {
  ok: boolean;
  service: DockerService;
  message?: string;
  text: string;
}

interface DockerContainer {
  Id: string;
  Names?: string[];
  State?: string;
  Created?: number;
  Labels?: Record<string, string>;
}

function socketPath(): string | null {
  const candidates = [
    process.env.DOCKER_SOCKET,
    "/var/run/docker.sock",
    `${homedir()}/.docker/run/docker.sock`,
  ].filter((item): item is string => Boolean(item));
  return candidates.find((item) => existsSync(item)) ?? null;
}

function dockerGet(sock: string, path: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: sock, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk as Buffer));
      res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(8000, () => req.destroy(new Error("读取 Docker 超时")));
    req.on("error", reject);
    req.end();
  });
}

/** Docker 日志是 8 字节帧头加正文。不是这种格式时按普通文本返回。 */
function demux(buf: Buffer): string {
  const parts: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const stream = buf[offset];
    const size = buf.readUInt32BE(offset + 4);
    if ((stream !== 0 && stream !== 1 && stream !== 2) || offset + 8 + size > buf.length) {
      return offset === 0 ? buf.toString("utf8") : parts.join("");
    }
    parts.push(buf.subarray(offset + 8, offset + 8 + size).toString("utf8"));
    offset += 8 + size;
  }
  return parts.length > 0 ? parts.join("") : buf.toString("utf8");
}

function nameMatches(name: string, service: string): boolean {
  const bare = name.replace(/^\//, "");
  // 兼容三种命名：
  //   - compose 默认       <项目>-<服务>-<序号>   → 含 -<服务>-
  //   - container_name 指定 nas-platform-<服务>   → 以 -<服务> 结尾
  //   - 裸服务名           <服务>
  return (
    bare === service ||
    bare.endsWith(`-${service}`) ||
    bare.endsWith(`_${service}`) ||
    bare.includes(`-${service}-`) ||
    bare.includes(`_${service}_`)
  );
}

function pickContainer(rows: DockerContainer[], service: string): DockerContainer | undefined {
  const candidates = rows.filter(
    (row) =>
      row.Labels?.["com.docker.compose.service"] === service ||
      (row.Names || []).some((name) => nameMatches(name, service)),
  );
  // 停掉的旧容器也会出现在 all=1 列表里，优先取运行中的、再取最新的
  return candidates.sort((a, b) => {
    const running = Number(b.State === "running") - Number(a.State === "running");
    if (running !== 0) return running;
    return (b.Created ?? 0) - (a.Created ?? 0);
  })[0];
}

export function isDockerService(value: string): value is DockerService {
  return (DOCKER_SERVICES as readonly string[]).includes(value);
}

/** 读一个服务最近的容器日志。读不到 Docker 时返回说明，不抛错。 */
export async function readDockerLogs(service: DockerService, tail = 300): Promise<DockerLogResult> {
  const sock = socketPath();
  if (!sock) {
    return {
      ok: false,
      service,
      text: "",
      message: "读不到 Docker。本机需要 Docker 正在运行；部署时把套接字挂进门户容器。",
    };
  }
  try {
    const listed = await dockerGet(sock, "/containers/json?all=1");
    if (listed.status !== 200) {
      return { ok: false, service, text: "", message: `Docker 返回 ${listed.status}` };
    }
    const rows = JSON.parse(listed.body.toString("utf8")) as DockerContainer[];
    const container = pickContainer(rows, service);
    if (!container) {
      const seen = rows
        .slice(0, 12)
        .map((row) => (row.Names?.[0] ?? row.Id.slice(0, 12)).replace(/^\//, ""))
        .join("、");
      return {
        ok: false,
        service,
        text: "",
        message: `没有找到 ${service} 容器。门户按容器名（如 nas-platform-${service}）或 compose 服务标签匹配；当前看到的容器：${seen || "（无）"}`,
      };
    }
    const logs = await dockerGet(
      sock,
      `/containers/${encodeURIComponent(container.Id)}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`,
    );
    if (logs.status !== 200) {
      return { ok: false, service, text: "", message: `读取日志失败（${logs.status}）` };
    }
    const text = demux(logs.body).trim();
    return {
      ok: true,
      service,
      text: text || "这个容器还没有日志。",
      message: container.State ? `状态：${container.State}` : undefined,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    const message =
      code === "EACCES"
        ? "没有权限读 Docker 套接字（EACCES）：门户容器里的用户不在 docker 组。" +
          "在 .env 里设置 DOCKER_GID=宿主机 `stat -c '%g' /var/run/docker.sock` 的值，" +
          "然后 docker compose up -d --force-recreate portal。"
        : code === "ENOENT"
          ? "Docker 套接字不存在：检查 .env 的 DOCKER_SOCKET 是否指向宿主机上真实存在的路径。"
          : code === "ECONNREFUSED" || code === "EPIPE"
            ? "连不上 Docker 守护进程：宿主机 Docker 可能没运行。"
            : err instanceof Error
              ? err.message
              : "读取 Docker 失败";
    return { ok: false, service, text: "", message };
  }
}
