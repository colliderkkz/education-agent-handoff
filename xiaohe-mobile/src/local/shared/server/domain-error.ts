// Generated from xiaohe-app/lib/server/domain-error.ts; SHA-256: 7cbb67f9409d153313dead5db0f7959361e8dbb6821a07f38a3352cbdf33ae8c
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
