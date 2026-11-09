import type { ChatIntent, WorkspaceState } from "./types";

export type PendingChatRequest = { requestId: string; intent: ChatIntent; text: string; expectedDraftRevision: number };
export type ChatDraftCache = { text: string; intent: ChatIntent; request?: PendingChatRequest };
const intents = ["note", "hint", "explanation", "alternative"];

export function chatDraftStorageKey(state: WorkspaceState, threadId: string): string {
  return `xiaohe-chat-draft:${JSON.stringify([state.access?.workspaceId || state.actor.id, state.actor.id, threadId])}`;
}

/** Only prune this confirmed viewer/workspace's keys, never another user's cache. */
export function chatDraftKeysToPrune(state: WorkspaceState, keys: string[]): string[] {
  const prefix = "xiaohe-chat-draft:", workspaceId = state.access?.workspaceId || state.actor.id;
  const visible = new Set(["owner", "student"].includes(state.actor.role) ? state.companion?.threads.filter(thread => thread.ownerId === state.actor.id).map(thread => thread.id) : []);
  return keys.filter(key => {
    if (!key.startsWith(prefix)) return false;
    try { const scope = JSON.parse(key.slice(prefix.length)); return Array.isArray(scope) && scope.length === 3 && scope[0] === workspaceId && scope[1] === state.actor.id && typeof scope[2] === "string" && !visible.has(scope[2]); } catch { return false; }
  });
}

/** A cached body is never authoritative: only an existing, currently visible,
 * personally owned thread may recover it. Deleted or other-user threads fail closed. */
export function recoverChatDraft(state: WorkspaceState, threadId: string, raw: string | null): ChatDraftCache | null {
  if (!raw || !["owner", "student"].includes(state.actor.role) || !state.companion?.threads.some(thread => thread.id === threadId && thread.ownerId === state.actor.id)) return null;
  try {
    const value = JSON.parse(raw) as ChatDraftCache;
    if (!value || typeof value.text !== "string" || value.text.length > 2000 || !intents.includes(value.intent)) return null;
    if (value.request) {
      const request = value.request;
      if (!request || typeof request.requestId !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(request.requestId) || typeof request.text !== "string" || request.text.length > 2000 || !intents.includes(request.intent) || !Number.isSafeInteger(request.expectedDraftRevision) || request.expectedDraftRevision < 0) return null;
      const acknowledged = state.messages.some(message => message.threadId === threadId && message.requestId === request.requestId && message.role === "assistant");
      if (acknowledged) {
        if (request.intent === "note" && value.text.trim() === request.text.trim()) return null;
        return { text: value.text, intent: value.intent };
      }
    }
    return value;
  } catch { return null; }
}
