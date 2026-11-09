// Generated from xiaohe-app/lib/access-types.ts; SHA-256: 37f7e5b4fb9b449f4a25bae6ec61ae224fed98883c992f1707d6793297b9b0d2
// Run node scripts/sync-local-domain.mjs; do not edit the generated body.
import type { Role } from "./types";

export interface AccessContext { workspaceId: string; ownerId: string; role: Role; }
export interface WorkspaceSummary { id: string; name: string; role: Role; }
export interface MemberSummary {
  id: string; userId: string; name: string; email: string; role: Exclude<Role, "owner">;
  status: "active" | "revoked"; createdAt: string; revokedAt?: string;
}
export interface InviteSummary {
  id: string; role: Exclude<Role, "owner">; email: string; label: string;
  status: "pending" | "accepted" | "revoked"; createdAt: string; expiresAt: string;
  acceptedAt?: string; revokedAt?: string;
}
export interface AccessOverview {
  current: WorkspaceSummary; workspaces: WorkspaceSummary[]; members: MemberSummary[]; invites: InviteSummary[];
}
export interface AccessApiResult {
  overview: AccessOverview;
  result?: { id?: string; message: string; token?: string };
}
