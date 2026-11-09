/** Safe domain failures can be returned to authenticated clients. */
export class DomainError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "DomainError";
    this.status = status;
  }
}
