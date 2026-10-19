export class TravelError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TravelError";
    this.status = status;
  }
}
