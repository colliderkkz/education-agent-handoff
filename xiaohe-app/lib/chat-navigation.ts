import type { ChatEntryContext } from "./ui-types";

/** Route values identify a frozen context; no question content or answers enter the URL. */
export function readChatEntryContext(params: URLSearchParams): ChatEntryContext | undefined {
  const source = params.get("chatSource");
  if (source === null) return undefined;
  if (source === "general") return { source };
  const questionId = params.get("questionId"), rawVersion = params.get("questionVersion");
  const questionVersion = Number(rawVersion);
  if ((source !== "bank" && source !== "paper") || !questionId || questionId.length > 150 || !rawVersion || !/^[1-9]\d*$/.test(rawVersion) || !Number.isSafeInteger(questionVersion)) throw new Error("这条学伴入口缺少明确的题目版本，请返回原题重新打开。");
  if (source === "bank") return { source, questionId, questionVersion };
  const paperId = params.get("paperId");
  if (!paperId || paperId.length > 150) throw new Error("这条学伴入口缺少原卷编号，请返回原卷重新打开。");
  return { source, paperId, questionId, questionVersion };
}

export function writeChatEntryContext(params: URLSearchParams, context: ChatEntryContext): void {
  params.set("chatSource", context.source);
  if (context.source === "general") return;
  params.set("questionId", context.questionId);
  params.set("questionVersion", String(context.questionVersion));
  if (context.source === "paper") params.set("paperId", context.paperId);
}
