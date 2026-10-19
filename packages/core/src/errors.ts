/**
 * 带 HTTP 状态码的业务错误。各应用的 Route Handler / Server Action 抛出它，
 * 由统一的错误处理转成响应，避免每个接口都写一遍 try/catch 映射状态码。
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** 任意异常 → 响应体与状态码。刻意不回显堆栈，只回可读信息 */
export function toErrorResponse(err: unknown): { message: string; status: number } {
  if (err instanceof HttpError) return { message: err.message, status: err.status };
  const message = err instanceof Error ? err.message : String(err);
  // Prisma 的唯一约束冲突在业务上几乎都等价于「已经存在」，直接透出太晦涩
  if (message.includes("Unique constraint")) return { message: "记录已存在", status: 409 };
  console.error("[http] 未预期的错误：", err);
  return { message: "服务器内部错误", status: 500 };
}
