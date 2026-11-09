import type { WorkspaceState } from "../types";
import { historyDeletedUpload } from "../history-deletion.ts";

/** A storage index alone never grants access: workspace registration is current authority. */
export function availableUpload(state: WorkspaceState, uploadId: string): boolean {
  const upload = state.uploads.find(item => item.id === uploadId);
  if (!upload) return false;
  return !historyDeletedUpload(state, uploadId, upload.url);
}

export function availableReviewImage(state: WorkspaceState, proposalId: string, uploadId: string, actorId: string, role: string): boolean {
  const proposal = state.evidenceReviews?.proposals.find(item => item.id === proposalId);
  return Boolean(proposal && proposal.delivery === "workspace" && proposal.uploadIds.includes(uploadId)
    && availableUpload(state, uploadId) && (role !== "student" || proposal.requestedBy === actorId));
}
