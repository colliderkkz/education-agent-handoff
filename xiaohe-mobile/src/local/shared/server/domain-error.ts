// Generated from xiaohe-app/lib/server/domain-error.ts; SHA-256: 92fedbc35d7ca5b8c81cb5bbb385975cdde933e75771b8c74837fae135484c66
// Run node scripts/sync-local-domain.mjs; do not edit the generated body.
/** Safe domain failures can be returned to authenticated clients. */
export class DomainError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "DomainError";
    this.status = status;
  }
}
