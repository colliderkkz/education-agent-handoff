import type { Evidence, EvidenceDecision, EvidencePatch, EvidenceProposal, HelpLevel, KnowledgeId } from '../../local/types';

export interface EvidenceReviewInput {
  changeAnswer: boolean; answer: string;
  changeHelp: boolean; help: HelpLevel;
  changeKnowledge: boolean; knowledgeId: KnowledgeId;
  changeValidity: boolean; invalidated: boolean;
  reason: string; uploadIds: string[];
}
export function createEvidenceInput(evidence: Evidence): EvidenceReviewInput {
  return { changeAnswer: false, answer: evidence.answer, changeHelp: false, help: evidence.help, changeKnowledge: false, knowledgeId: evidence.knowledgeId, changeValidity: false, invalidated: false, reason: '', uploadIds: [] };
}
export function evidenceInputPatch(input: EvidenceReviewInput): EvidencePatch {
  return { ...(input.changeAnswer ? { answer: input.answer } : {}), ...(input.changeHelp ? { help: input.help } : {}), ...(input.changeKnowledge ? { knowledgeId: input.knowledgeId } : {}), ...(input.changeValidity ? { invalidated: input.invalidated } : {}) };
}
export function validateEvidenceInput(input: EvidenceReviewInput): string | null {
  if (!Object.keys(evidenceInputPatch(input)).length) return '请明确选择需要核对的记录字段。';
  if (input.changeAnswer && input.answer.length > 300) return '原稿答案更正最多 300 字，请缩短后保存。';
  if (!input.reason.trim()) return '请写明依据和更正原因，区分原稿录入错误与后来学会后的新答案。';
  if (input.uploadIds.length > 10) return '每次申请最多关联 10 张原稿。';
  return null;
}
export const evidenceInputKey = (input: EvidenceReviewInput) => JSON.stringify({ patch: evidenceInputPatch(input), reason: input.reason.trim(), uploadIds: [...input.uploadIds].sort() });
export function inputFromProposal(proposal: EvidenceProposal, original: Evidence): EvidenceReviewInput {
  return { ...createEvidenceInput(original), changeAnswer: proposal.patch.answer !== undefined, answer: proposal.patch.answer ?? original.answer, changeHelp: proposal.patch.help !== undefined, help: proposal.patch.help ?? original.help, changeKnowledge: proposal.patch.knowledgeId !== undefined, knowledgeId: proposal.patch.knowledgeId ?? original.knowledgeId, changeValidity: proposal.patch.invalidated !== undefined, invalidated: proposal.patch.invalidated ?? false, reason: proposal.reason, uploadIds: [...proposal.uploadIds] };
}
/** Unknown write results can be claimed only by their exact stable request id. */
export function findSavedProposal(proposals: EvidenceProposal[], evidenceId: string, requestId: string, actorId: string): EvidenceProposal | undefined {
  return proposals.find(item => item.evidenceId === evidenceId && item.requestId === requestId && item.requestedBy === actorId);
}
export const findSavedDecision = (decisions: EvidenceDecision[], evidenceId: string, requestId: string, actorId: string) => decisions.find(item => item.evidenceId === evidenceId && item.requestId === requestId && item.actorId === actorId);
