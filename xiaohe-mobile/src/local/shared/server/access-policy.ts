// Generated from xiaohe-app/lib/server/access-policy.ts; SHA-256: e0a83cf7afa2027d7f91cfad347045ea18e486662d86b6b360c8d7f0ababffbd
// Run node scripts/sync-local-domain.mjs; do not edit the generated body.
import { cloneData as structuredClone } from '../../clone.ts';
import type { Answer, AuditEvent, HelpLevel, Question, Role, WorkspaceState } from "../types";
import { DomainError } from "./domain-error.ts";
import { contentCatalog } from "./content.ts";
import { projectCompanion } from "./companion.ts";
import { projectEvidenceReviews } from "./evidence.ts";
import { projectRecognition } from "./recognition.ts";

const roles = new Set<string>(["owner", "student", "parent", "teacher", "editor", "reviewer"]);
const studentActions = new Set([
  "profile.update", "paper.create", "paper.replace", "paper.resume", "paper.expose", "paper.question.expose", "mastery.reevaluate", "review.start",
  "paper.return.save", "paper.return.submit",
  "mistake.correct", "help.create", "chat.send", "single.match", "single.explain", "homework.confirm",
  "chat.open", "chat.draft.save", "chat.delete.preview", "chat.delete", "memory.preference.set", "memory.preference.delete",
  "evidence.propose", "evidence.preview", "local.evidence.confirm", "history.delete.preview", "history.delete.confirm",
  "recognition.open", "recognition.run.save", "recognition.entry.save", "recognition.match", "recognition.submit",
]);
const roleActions: Partial<Record<Role, Set<string>>> = {
  editor: new Set(["question.create", "question.update", "question.submit", "rule.create", "rule.update", "rule.preview", "rule.submit", "content.export"]),
  reviewer: new Set(["question.review", "question.publish", "question.disable", "rule.preview", "rule.review", "content.export"]),
  teacher: new Set(["help.receive", "help.reply", "evidence.preview", "evidence.review"]),
};
const isStudentAction = (action: string) => studentActions.has(action) || action.startsWith("attempt.");

/** Authorize against the role resolved by the server, never a request-body role. */
export function assertActionAllowed(role: Role, action: string): void {
  if (!roles.has(role)) throw new DomainError("当前身份无有效工作区权限", 403);
  if (role === "owner") return; // Unknown actions are still rejected by the domain dispatcher.
  if (role === "student" && isStudentAction(action)) return;
  if (roleActions[role]?.has(action)) return;
  throw new DomainError("当前身份没有执行此操作的权限", 403);
}

type Exposure = 0 | 1 | 2;
const exposureRank = (level: HelpLevel | undefined): Exposure => level === "explanation" ? 2 : level === "hint" ? 1 : 0;

/** Only a structured, explicit exposure event grants access to stored teaching content. */
function familyExposures(events: AuditEvent[]): Map<string, Exposure> {
  const levels = new Map<string, Exposure>();
  for (const event of events) {
    if (event.action !== "learning.exposure") continue;
    try {
      const record = JSON.parse(event.detail) as { level?: unknown; familyIds?: unknown };
      if (!record || (record.level !== "hint" && record.level !== "explanation") || !Array.isArray(record.familyIds)) continue;
      const level = exposureRank(record.level);
      for (const familyId of record.familyIds) {
        if (typeof familyId === "string" && familyId) levels.set(familyId, Math.max(levels.get(familyId) || 0, level) as Exposure);
      }
    } catch { /* Human-readable or malformed logs never establish permission. */ }
  }
  return levels;
}

/** A whitelist avoids leaking internal review notes, identities, and future internal fields. */
function learningQuestion(question: Question, exposure: Exposure): Question {
  return {
    id: question.id, familyId: question.familyId, version: question.version,
    text: question.text, unit: question.unit, knowledgeId: question.knowledgeId,
    difficulty: question.difficulty, source: question.source, sourceScope: "",
    prerequisites: [...question.prerequisites], status: question.status,
    createdAt: question.createdAt, authorId: "",
    answer: exposure === 2 ? question.answer : "",
    hint: exposure >= 1 ? question.hint : "",
    steps: exposure === 2 ? [...question.steps] : [],
    alternative: exposure === 2 ? question.alternative : "",
    ...(question.taskType ? { taskType: question.taskType } : {}), ...(question.contextId ? { contextId: question.contextId } : {}),
  };
}

function draftAnswer(answer: Answer): Answer {
  // A persisted draft is not an entitlement to a pre-submission grading result.
  return { ...answer, correct: null };
}

/**
 * Return only the data necessary for this role, without mutating the full stored state.
 * A workspace is one learner's dossier; membership authorization and the single-active-
 * student invariant are enforced by the store before this projection is called.
 */
export function projectWorkspace(source: WorkspaceState, role: Role): WorkspaceState {
  if (!roles.has(role)) throw new DomainError("当前身份无有效工作区权限", 403);
  const state = structuredClone(source);
  projectCompanion(state, role);
  projectEvidenceReviews(state, role);
  projectRecognition(state, role);
  if (role === "owner") return state;

  // Full archive teaching content is restricted to editorial roles. Student,
  // parent and teacher receive only current-bank metadata and pointer-only batches.
  if (state.content && role !== "editor" && role !== "reviewer") {
    state.content.catalog = contentCatalog(source);
    state.content.versions = [];
  }

  if (role === "editor" || role === "reviewer") {
    state.profile = { ...state.profile, name: "学习档案（身份隐藏）", school: "" };
    state.knowledge = state.knowledge.map(knowledge => ({ ...knowledge, stars: null, evidenceIds: [], reason: "", assessmentId: undefined, assessmentState: undefined }));
    state.papers = []; state.attempts = []; state.evidence = []; state.mistakes = [];
    state.uploads = []; state.helpRequests = []; state.messages = [];
    if (state.paperReturns) state.paperReturns = [];
    delete state.historyDeletion;
    if (state.mastery) { state.mastery.assessments = []; state.mastery.reviewPlans = []; state.mastery.previews = state.mastery.previews.map(p => ({ ...p, changes: [], learnerVisible: false })); }
    state.events = state.events.filter(event => event.action.startsWith("question.") || event.action.startsWith("rule.") || event.action.startsWith("content."));
    state.capabilities = { ocr: false, ai: false, speech: false, storage: false };
    return state;
  }

  const submittedAttempts = state.attempts.filter(attempt => attempt.status === "submitted" && state.papers.some(paper => paper.id === attempt.paperId));
  const submittedById = new Map(submittedAttempts.map(attempt => [attempt.id, attempt]));
  const submittedPaperIds = new Set(submittedAttempts.map(attempt => attempt.paperId));
  // An orphan/draft record must not leak answers through a report or mistake shortcut.
  state.evidence = state.evidence.filter(entry => submittedById.get(entry.attemptId)?.paperId === entry.paperId);
  const evidenceIds = new Set(state.evidence.map(entry => entry.id));
  if (state.mastery) {
    state.mastery.previews = [];
    state.mastery.rules = state.mastery.rules.filter(r => r.status === "published" || r.status === "disabled").map(r => {
      const visible = { ...r, authorId: "" };
      delete visible.reviewerId; delete visible.reviewNote;
      return visible;
    });
    state.mastery.assessments = state.mastery.assessments.map(a => ({ ...a, adoptedEvidenceIds: a.adoptedEvidenceIds.filter(id => evidenceIds.has(id)), excludedEvidence: a.excludedEvidence.filter(e => evidenceIds.has(e.evidenceId)) }));
  }
  state.mistakes = state.mistakes.filter(mistake => evidenceIds.has(mistake.evidenceId)).map(mistake => ({ ...mistake, question: learningQuestion(mistake.question, 2) }));
  state.knowledge = state.knowledge.map(knowledge => ({ ...knowledge, evidenceIds: knowledge.evidenceIds.filter(id => evidenceIds.has(id)) }));

  if (role === "parent" || role === "teacher") {
    state.questions = [];
    state.papers = state.papers.filter(paper => submittedPaperIds.has(paper.id)).map(paper => ({ ...paper, questions: paper.questions.map(question => learningQuestion(question, 2)) }));
    state.attempts = submittedAttempts;
    state.uploads = []; state.messages = []; state.events = [];
    if (state.historyDeletion) {
      state.historyDeletion.fileTasks = []; state.historyDeletion.requests = [];
      state.historyDeletion.operations = state.historyDeletion.operations.map(o => ({ ...o, actorId: "", requestId: "", digest: "", deletedThreadIds: [], deletedHelpRequestIds: [], removedProposalIds: [], removedDecisionIds: [], deletedUploadIds: [] }));
    }
    if (state.paperReturns) state.paperReturns = [];
    if (role === "parent") state.helpRequests = [];
    state.capabilities = { ocr: false, ai: false, speech: false, storage: false };
    return state;
  }

  const exposureByFamily = familyExposures(source.events);
  for (const fact of source.historyDeletion?.qualificationFacts ?? []) exposureByFamily.set(fact.familyId, Math.max(exposureByFamily.get(fact.familyId) || 0, exposureRank(fact.help)) as Exposure);
  // A bank item is discoverable only after independent approval and publication.
  state.questions = state.questions.filter(question => question.status === "published" && Boolean(question.reviewerId) && question.reviewerId !== question.authorId)
    .map(question => learningQuestion(question, exposureByFamily.get(question.familyId) || 0));
  state.papers = state.papers.map(paper => {
    const attempts = state.attempts.filter(attempt => attempt.paperId === paper.id);
    return {
      ...paper,
      questions: paper.questions.map(question => {
        let level: Exposure = exposureByFamily.get(question.familyId) || 0;
        if (submittedPaperIds.has(paper.id)) level = 2;
        else for (const attempt of attempts) level = Math.max(level, exposureRank(attempt.answers.find(answer => answer.questionId === question.id)?.help)) as Exposure;
        return learningQuestion(question, level);
      }),
    };
  });
  state.attempts = state.attempts.map(attempt => attempt.status === "submitted" ? attempt : ({ ...attempt, answers: attempt.answers.map(draftAnswer), correctCount: 0, independentCount: 0 }));
  state.events = state.events.filter(event => isStudentAction(event.action) || event.action === "learning.exposure" || event.action === "help.receive" || event.action === "help.reply")
    .map(event => ({ ...event, actorId: event.actorId === state.actor.id ? event.actorId : "" }));
  return state;
}
