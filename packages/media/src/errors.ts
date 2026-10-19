/** 图床与图库的统一错误。带 HTTP 状态码，调用方按需映射成自己的错误类型。 */
export class MediaError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "MediaError";
    this.status = status;
  }
}
