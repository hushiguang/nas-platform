export class WorkError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "WorkError";
    this.status = status;
  }
}
