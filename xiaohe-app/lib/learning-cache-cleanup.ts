import type { WorkspaceState } from "./types";
import { chatDraftKeysToPrune } from "./chat-draft-cache.ts";

const scope = (state: WorkspaceState) => JSON.stringify([state.access?.workspaceId || state.actor.id, state.actor.id]);
const visibility = new Map<string, { revision: number; threads: Set<string>; closedPapers: Set<string> }>();

export function learningCacheKeysToPrune(state: WorkspaceState, keys: string[]): string[] {
  const workspace = state.access?.workspaceId || state.actor.id;
  const closed = new Set([
    ...state.attempts.filter(attempt => attempt.status === "submitted").map(attempt => attempt.paperId),
    ...(state.historyDeletion?.evidence ?? []).map(item => item.paperId),
  ]);
  const practice = new Set([...closed].map(id => `xiaohe-draft-${workspace}-${state.actor.id}-${id}`));
  return [...new Set([...chatDraftKeysToPrune(state, keys), ...keys.filter(key => practice.has(key))])];
}

/** Confirm visibility before React unmount callbacks or delayed save responses run. */
export function rememberLearningVisibility(state: WorkspaceState): void {
  const key = scope(state), previous = visibility.get(key);
  if (previous && previous.revision > state.revision) return;
  visibility.set(key, {
    revision: state.revision,
    threads: new Set(state.companion?.threads.filter(thread => thread.ownerId === state.actor.id).map(thread => thread.id)),
    closedPapers: new Set([...state.attempts.filter(attempt => attempt.status === "submitted").map(attempt => attempt.paperId), ...(state.historyDeletion?.evidence ?? []).map(item => item.paperId)]),
  });
}

export function learningDraftStillAvailable(state: WorkspaceState, kind: "thread" | "paper", id: string): boolean {
  const current = visibility.get(scope(state));
  if (kind === "thread") return current ? current.threads.has(id) : Boolean(state.companion?.threads.some(thread => thread.id === id && thread.ownerId === state.actor.id));
  return current ? !current.closedPapers.has(id) : !state.attempts.some(attempt => attempt.paperId === id && attempt.status === "submitted");
}

export function pruneLearningCaches(state: WorkspaceState): void {
  if ((visibility.get(scope(state))?.revision ?? -1) > state.revision) return;
  rememberLearningVisibility(state);
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => key !== null);
    learningCacheKeysToPrune(state, keys).forEach(key => localStorage.removeItem(key));
  } catch { /* Storage can be disabled; domain tombstones still forbid resurrection. */ }
}
