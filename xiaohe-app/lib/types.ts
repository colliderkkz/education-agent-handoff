export type Role = "owner" | "editor" | "reviewer" | "student" | "parent" | "teacher";
export type HelpLevel = "independent" | "hint" | "explanation" | "unknown";
export type KnowledgeId = "division" | "geometry" | "multiplication";
export type QuestionStatus = "draft" | "review" | "approved" | "published" | "disabled";
export type TaskType = "basic" | "application" | "transfer";
export interface Question {
  id: string; familyId: string; version: number; text: string; answer: string;
  unit: string; knowledgeId: KnowledgeId; difficulty: "基础" | "巩固" | "挑战";
  source: string; sourceScope: string; steps: string[]; hint: string;
  alternative: string; prerequisites: string[]; status: QuestionStatus;
  authorId: string; reviewerId?: string; reviewNote?: string; createdAt: string;
  taskType?: TaskType; contextId?: string;
}
export interface Profile { name: string; grade: string; semester: string; course: string; textbook: string; school: string; }
export interface Knowledge {
  id: KnowledgeId; name: string; description: string; learningState: "current" | "upcoming";
  stars: number | null; evidenceIds: string[]; reason: string; ruleVersion: string;
  assessmentId?: string; assessmentState?: "unlearned" | "insufficient" | "assessed";
}
export interface Paper {
  id: string; title: string; version: number; parentId?: string; createdAt: string;
  questionIds: string[]; questions: Question[]; status: "ready" | "in_progress" | "completed";
  kind: "practice" | "review" | "whole"; reason: string; estimatedMinutes: number;
  reviewPlanId?: string;
}
export interface Answer { questionId: string; value: string; working: string; help: HelpLevel; correct: boolean | null; }
export interface Attempt {
  id: string; paperId: string; answers: Answer[]; status: "draft" | "submitted";
  startedAt: string; submittedAt?: string; independentCount: number; correctCount: number; submissionKey?: string;
}
/** Paper claims are self-report; they never establish independently verified learning evidence. */
export interface PaperReturnEntry {
  questionId: string; value: string; working: string; claimedHelp: HelpLevel;
  confirmed: boolean; unitConfirmed: boolean;
}
export interface PaperReturn {
  id: string; paperId: string; paperVersion: number; questionIds: string[]; revision: number;
  uploadIds: string[]; entries: PaperReturnEntry[]; status: "draft" | "submitted";
  createdAt: string; updatedAt: string; submittedAt?: string; attemptId?: string; submissionKey?: string;
  onlineDraftSnapshot?: Attempt;
}
export interface Evidence {
  id: string; knowledgeId: KnowledgeId; questionId: string; questionVersion: number;
  attemptId: string; paperId: string; questionText: string; answer: string; expected: string;
  help: HelpLevel; correct: boolean; createdAt: string; kind: "original" | "practice" | "review";
  familyId?: string; eligible?: boolean; reason?: string;
  taskType?: TaskType; contextId?: string; provenance?: "online" | "paper" | "demo"; reviewPlanId?: string;
}
export interface EvidencePatch { answer?: string; knowledgeId?: KnowledgeId; help?: HelpLevel; invalidated?: boolean; }
export interface EvidenceMaterial { id: string; name: string; url?: string; }
export interface EvidenceProposal {
  id: string; evidenceId: string; sourceDigest: string; baseDecisionId?: string;
  patch: EvidencePatch; reason: string; uploadIds: string[];
  requestedBy: string; createdAt: string; createdRevision: number;
  delivery: "local-only" | "workspace"; requestId: string; requestDigest: string;
  /** Derived projection only; never accepted from a request or raw persistence. */
  materials?: EvidenceMaterial[];
}
export interface EvidenceDecision {
  id: string; proposalId: string; evidenceId: string; priorDecisionId?: string;
  outcome: "accept" | "reject"; authority: "local-unverified" | "teacher-verified";
  actorId: string; reason: string; createdAt: string; appliedRevision: number;
  requestId: string; requestDigest: string;
}
export interface EvidenceReviewState { schemaVersion: 1; proposals: EvidenceProposal[]; decisions: EvidenceDecision[]; }
export interface EffectiveEvidence extends Evidence {
  original: Evidence; valid: boolean; authority: "original" | "local-unverified" | "teacher-verified";
  decisionId?: string; masteryBlockedReason?: string; unverifiedFields?: (keyof EvidencePatch)[];
}
export interface EffectiveAnswer extends Answer {
  original: Answer; evidenceId?: string; knowledgeId: KnowledgeId; valid: boolean;
  authority: EffectiveEvidence["authority"]; decisionId?: string;
}
export interface EffectiveAttempt extends Omit<Attempt, "answers"> {
  answers: EffectiveAnswer[]; independentCorrect: number; originalCorrectCount: number | null; originalIndependentCount: number | null; invalidatedCount: number; deletedCount: number; retainedCount: number;
}
export interface EffectiveMistake extends Mistake { currentAnswer: string; knowledgeId: KnowledgeId; active: boolean; effectiveEvidence: EffectiveEvidence; }
export interface EffectiveReviewSource { valid: boolean; reason: string; evidenceIds: string[]; }
export interface EvidencePreview {
  proposalId: string; evidenceId: string; sourceRevision: number; digest: string;
  outcome: "accept" | "reject"; authority: "local-unverified" | "teacher-verified";
  before: EffectiveEvidence; after: EffectiveEvidence;
  report: { attemptId: string; beforeCorrect: number; afterCorrect: number; beforeIndependent: number; afterIndependent: number; invalidatedCount: number };
  mistake: { beforeActive: boolean; afterActive: boolean };
  knowledge: { knowledgeId: KnowledgeId; beforeStars: number | null; afterStars: number | null; reason: string }[];
  reviewPlans: { planId: string; knowledgeId: KnowledgeId; beforeValid: boolean; afterValid: boolean; reason: string }[];
  warnings: string[];
}
export interface RuleParameters {
  star1Correct: number; star2Correct: number; star3BasicCorrect: number;
  star4ApplicationCorrect: number; star4Contexts: number; stableAttempts: number;
  stableAccuracy: number; star5TransferCorrect: number; reviewDelayDays: number;
  downgradeAfterAttempts: number; stabilityWindowAttempts: number;
}
export interface MasteryRule {
  id: string; version: number; revision: number; name: string; mode: "five-star" | "legacy-pilot";
  status: "draft" | "review" | "approved" | "published" | "disabled";
  validation: "unvalidated-trial"; authorId: string; reviewerId?: string; reviewNote?: string;
  createdAt: string; updatedAt: string; publishedAt?: string; parameters: RuleParameters;
}
export interface MasteryAssessment {
  id: string; knowledgeId: KnowledgeId; ruleId: string; ruleVersion: string; createdAt: string;
  trigger: "migration" | "submission" | "reevaluate" | "rule-switch" | "evidence-correction" | "history-deletion"; attemptId?: string;
  beforeStars: number | null; afterStars: number | null; state: "unlearned" | "insufficient" | "assessed";
  adoptedEvidenceIds: string[]; excludedEvidence: { evidenceId: string; reason: string }[];
  gaps: string[]; reason: string; conditions: { key: string; label: string; met: boolean; actual: number; required: number }[];
  legacy: boolean;
  /** Reserved for a later, separately audited evidence-correction workflow. */
  evidenceRevisionId?: string;
  /** Workspace revision and accepted-correction epoch used by this immutable assessment. */
  evidenceAsOfRevision?: number; evidenceEpoch?: number; historyDeletionId?: string;
}
export interface ReviewPlan {
  id: string; sourceAttemptId: string; sourcePaperId: string; knowledgeId: KnowledgeId;
  /** Present only for a new plan derived from an accepted evidence correction. */
  sourceRevision?: number;
  /** Source history was explicitly removed; the issued paper and later answers remain. */
  sourceHistoryDeletionId?: string;
  createdAt: string; dueAt: string; delayDays: number; ruleId: string;
  status: "scheduled" | "started" | "completed"; paperId?: string; attemptId?: string; completedAt?: string; reason: string;
}
export interface RulePreview {
  id: string; ruleId: string; ruleRevision: number; sourceRevision: number; createdAt: string;
  actorId: string; learnerVisible: boolean; issues: string[];
  changes: { knowledgeId: KnowledgeId; beforeStars: number | null; afterStars: number | null; reason: string }[];
}
export interface MasteryState {
  schemaVersion: 1; activeRuleId: string; rules: MasteryRule[]; assessments: MasteryAssessment[];
  reviewPlans: ReviewPlan[]; previews: RulePreview[];
}
export interface Mistake { id: string; question: Question; originalAnswer: string; correctedAnswer?: string; correctedAt?: string; evidenceId: string; }
export interface AuditEvent { id: string; action: string; label: string; actorId: string; createdAt: string; detail: string; }
export interface UploadItem { id: string; name: string; url: string; createdAt: string; status: "pending" | "confirmed"; purpose: "single" | "homework"; }
export interface RecognitionLine {
  id: string; text: string; confidence: number | null;
  /** Normalized coordinates in the oriented image, with a top-left origin. */
  box: { x: number; y: number; width: number; height: number };
}
export interface RecognitionCandidate { questionId: string; questionVersion: number; contentDigest: string; }
export interface RecognitionMatch extends RecognitionCandidate { text: string; unit: string; knowledgeId: KnowledgeId; }
export interface RecognitionCapture {
  id: string; ownerId: string; uploadId: string; imageDigest: string; revision: number;
  createdAt: string; updatedAt: string; redactedAt?: string; redactionOperationId?: string;
}
export interface RecognitionRun {
  id: string; captureId: string; imageDigest: string; engine: "mlkit-chinese" | "apple-vision";
  platform: "android" | "ios"; engineVersion: string; width: number; height: number;
  lines: RecognitionLine[]; createdAt: string; redactedAt?: string;
}
export interface RecognitionEntry {
  id: string; captureId: string; runId: string; sourceLineIds: string[];
  originalNumber: string; stem: string; answer: string; working: string;
  candidate: RecognitionCandidate | null;
  checked: { stem: boolean; answer: boolean; match: boolean; unit: boolean };
  status: "draft" | "submitted" | "redacted"; createdAt: string; updatedAt: string;
  /** Raw persistence only; learner projections remove the answer-bearing snapshot. */
  snapshot?: Question;
  /** Derived learner projection only; never accepted in raw persistence or an action. */
  candidateSummary?: { questionId: string; questionVersion: number; text: string; unit: string };
  paperId?: string; attemptId?: string; evidenceId?: string; submittedAt?: string;
  redactedAt?: string; redactionOperationId?: string;
}
export interface RecognitionRequest {
  ownerId: string; requestId: string; action: string; digest: string; captureId: string;
  resultId: string; status: "completed" | "deleted"; createdAt: string;
}
export interface RecognitionState {
  schemaVersion: 1; captures: RecognitionCapture[]; runs: RecognitionRun[];
  entries: RecognitionEntry[]; requests: RecognitionRequest[];
}
export interface HelpRequest {
  id: string; topic: string; summary: string; status: "waiting" | "received" | "replied"; reply?: string; createdAt: string;
  ownerId?: string; requestId?: string; requestDigest?: string; sourceThreadId?: string;
  context?: CompanionContext; delivery?: "local-only" | "workspace";
}
export type ChatIntent = "note" | "hint" | "explanation" | "alternative";
export type ChatOpenContext = { source: "general" } | { source: "bank"; questionId: string; questionVersion: number } | { source: "paper"; paperId: string; questionId: string; questionVersion: number };
export type CompanionContext = { source: "general" | "legacy" } | {
  source: "paper" | "bank"; paperId?: string; questionId: string; questionVersion: number;
  questionDigest: string; questionText: string; familyId: string; knowledgeId: KnowledgeId;
};
export interface LearningPreference {
  id: string; ownerId: string; key: "presentation"; value: "stepwise" | "compact";
  source: "self"; createdAt: string; updatedAt: string;
}
export type UsedLearningPreference = Pick<LearningPreference, "key" | "value" | "source">;
export interface ChatMessage {
  id: string; role: "user" | "assistant"; text: string; questionId?: string; createdAt: string;
  threadId?: string; requestId?: string; intent?: ChatIntent; preferenceUsed?: UsedLearningPreference;
}
export interface CompanionThread {
  id: string; ownerId: string; context: CompanionContext; createdAt: string; updatedAt: string;
  draft: { text: string; intent: ChatIntent; revision: number; updatedAt: string };
  /** Raw persistence only. The learner projection omits the entire snapshot. */
  snapshot?: Question;
}
/** Request fingerprints and deleted tombstones contain no conversation or draft body. */
export interface CompanionRequest {
  requestId: string; ownerId: string; threadId: string; action: "chat.send" | "chat.delete";
  digest: string; status: "completed" | "deleted"; createdAt: string; messageId?: string;
}
export interface CompanionState {
  schemaVersion: 1; threads: CompanionThread[]; preferences: LearningPreference[]; requests: CompanionRequest[];
}
export interface CompanionDeletePreview {
  threadId: string; sourceRevision: number; digest: string; messageCount: number;
  hasDraft: boolean; retainedExposureCount: number;
  retainedHelpRequestCount: number;
}
export interface ContentWithdrawal { questionId: string; familyId: string; version: number; }
export interface ContentPackage {
  schemaVersion: 1; kind: "xiaohe-content"; trust: "unsigned"; teachingValidation: "unvalidated-trial";
  packageId: string; publisherId: string; createdAt: string;
  courseScope: { grade: "四年级"; course: "数学" };
  items: Question[]; withdrawals: ContentWithdrawal[]; digest: string;
}
export interface ContentVersion {
  id: string; questionId: string; version: number; digest: string; question: Question;
  source: "baseline" | "paper" | "editorial" | "package"; sourceBatchId?: string;
}
export interface ContentPointer { versionId: string; status: QuestionStatus; }
export interface ContentBatch {
  id: string; packageId: string; digest: string; publisherId: string; appliedAt: string; appliedRevision: number;
  status: "applied" | "rolled-back"; rolledBackAt?: string; rolledBackRevision?: number; reason?: string;
  changes: { questionId: string; before: ContentPointer | null; after: ContentPointer | null }[];
}
export interface ContentCatalogEntry {
  questionId: string; familyId: string; version: number; knowledgeId: KnowledgeId;
  status: QuestionStatus; taskType?: TaskType; digest: string;
}
export interface ContentState {
  schemaVersion: 1; versions: ContentVersion[]; batches: ContentBatch[];
  /** Generated only for learner projections; never accepted as persisted state. */
  catalog?: ContentCatalogEntry[];
}
export interface ContentPreview {
  packageId: string; publisherId: string; createdAt: string; digest: string; sourceRevision: number;
  alreadyApplied: boolean; rolledBack: boolean; warnings: string[];
  counts: { added: number; updated: number; withdrawn: number; unchanged: number };
  changes: (ContentCatalogEntry & { action: "add" | "update" | "withdraw" | "unchanged"; previousVersion?: number })[];
}
export interface DeletedEvidenceDescriptor {
  id: string; operationId: string; evidenceId: string; attemptId: string; paperId: string;
  questionId: string; familyId: string; knowledgeId: KnowledgeId; createdAt: string; deletedAt: string;
}
export interface HistoryQualificationFact { familyId: string; seen: true; help: HelpLevel; }
export interface DeletedHistoryRequest { actorId: string; requestId: string; action: string; operationId: string; }
export interface DeletedAssessmentDescriptor { id: string; knowledgeId: KnowledgeId; createdAt: string; operationId: string; }
export interface HistoryFileTask {
  id: string; operationId: string; uploadId: string; status: "pending" | "complete";
  createdAt: string; completedAt?: string;
  /** Trusted registered URI, retained as file identity after cleanup. Never accept from input. */
  uploadUrl: string;
}
export interface HistoryDeletionOperation {
  id: string; actorId: string; requestId: string; digest: string; createdAt: string; appliedRevision: number;
  evidenceIds: string[]; knowledgeIds: KnowledgeId[]; deletedThreadIds: string[]; deletedHelpRequestIds: string[];
  removedProposalIds: string[]; removedDecisionIds: string[]; deletedUploadIds: string[];
  redactedAssessmentIds: string[]; affectedReviewPlanIds: string[];
  reviewPlanSources: { planId: string; sourceRevision?: number; createdAt: string }[];
}
export interface HistoryDeletionState {
  schemaVersion: 1; operations: HistoryDeletionOperation[]; evidence: DeletedEvidenceDescriptor[];
  qualificationFacts: HistoryQualificationFact[]; requests: DeletedHistoryRequest[];
  assessments: DeletedAssessmentDescriptor[]; fileTasks: HistoryFileTask[];
}
export interface HistoryDeletionSelection { evidenceIds: string[]; uploadIds: string[]; }
export interface HistoryDeletionPreview {
  recognition?: { captureIds: string[]; runCount: number; draftIds: string[] };
  sourceRevision: number; digest: string; selection: HistoryDeletionSelection;
  evidenceCount: number; mistakeCount: number; proposalCount: number; decisionCount: number;
  threadCount: number; messageCount: number; draftCount: number; helpRequestCount: number; sharedHelpRequestCount: number;
  assessmentCount: number; auditEventCount: number; rulePreviewCount: number;
  reports: { attemptId: string; paperId: string; selectedCount: number; remainingCount: number; beforeCorrect: number; afterCorrect: number }[];
  knowledge: { knowledgeId: KnowledgeId; beforeStars: number | null; afterStars: number | null; reason: string }[];
  reviewPlans: { planId: string; knowledgeId: KnowledgeId; sourceWillBeUnavailable: boolean }[];
  photos: { uploadId: string; name: string; selected: boolean; willDelete: boolean; retainedReferenceCount: number; reason: string }[];
  retainedOtherThreadCount: number; warnings: string[];
}
export interface WorkspaceState {
  access?: { workspaceId: string; ownerId: string; role: Role; workspaces: import("./access-types").WorkspaceSummary[] };
  revision: number; actor: { id: string; name: string; role: Role }; profile: Profile;
  questions: Question[]; papers: Paper[]; attempts: Attempt[]; knowledge: Knowledge[];
  evidence: Evidence[]; mistakes: Mistake[]; events: AuditEvent[]; uploads: UploadItem[];
  helpRequests: HelpRequest[]; messages: ChatMessage[];
  paperReturns?: PaperReturn[];
  mastery?: MasteryState;
  content?: ContentState;
  companion?: CompanionState;
  evidenceReviews?: EvidenceReviewState;
  historyDeletion?: HistoryDeletionState;
  recognition?: RecognitionState;
  capabilities: { ocr: boolean; ai: boolean; speech: boolean; storage: boolean };
}
export interface ApiResult { state: WorkspaceState; result?: { id?: string; message?: string; [key: string]: unknown }; }
