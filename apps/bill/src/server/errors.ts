/**
 * 账单模块的统一错误。
 *
 * 带上 HTTP 状态码，路由层直接映射即可 —— 不用在每个 catch 里再判断一次。
 * 旧实现是 `Object.assign(new Error(msg), { status })`，这里换成真正的子类，
 * 好处是 instanceof 判断可用，且 status 有类型。
 */
export class BillError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BillError";
    this.status = status;
  }
}

/** 把任意异常转成 { message, status }，供 Route Handler 统一返回 */
export function toErrorResponse(err: unknown): { message: string; status: number } {
  if (err instanceof BillError) return { message: err.message, status: err.status };
  if (err instanceof Error) return { message: err.message, status: 500 };
  return { message: "服务器开小差了", status: 500 };
}
