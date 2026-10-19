export class AnniversaryError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AnniversaryError";
    this.status = status;
  }
}
