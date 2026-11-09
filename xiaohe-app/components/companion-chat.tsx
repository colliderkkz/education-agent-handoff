"use client";
import { learningDraftStillAvailable } from "@/lib/learning-cache-cleanup";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, BookOpen, ChevronRight, HandHeart, History, Leaf, Lightbulb, MessageCircle, Plus, Save, Settings2, ShieldCheck, Sprout, Trash2, X } from "lucide-react";
import type { AppProps, ChatEntryContext } from "@/lib/ui-types";
import type { ChatIntent, ChatMessage, CompanionDeletePreview, WorkspaceState } from "@/lib/types";
import { chatDraftStorageKey, chatDraftKeysToPrune, recoverChatDraft, type ChatDraftCache, type PendingChatRequest } from "@/lib/chat-draft-cache";
import { ApiError } from "@/lib/client";
import "./companion-tools.css";

type Thread = NonNullable<WorkspaceState["companion"]>["threads"][number];
type PendingRequest = PendingChatRequest;
type DraftCache = ChatDraftCache;
const intents: { intent: Exclude<ChatIntent, "note">; label: string; icon: typeof BookOpen }[] = [{ intent: "hint", label: "先给一点提示", icon: Lightbulb }, { intent: "explanation", label: "查看完整讲解", icon: BookOpen }, { intent: "alternative", label: "查看其他方法", icon: Leaf }];
const time = (value: string) => new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const title = (thread: Thread) => thread.context.source === "general" ? "不带题目的学习记录" : thread.context.source === "legacy" ? "旧版会话 · 版本未知" : "questionText" in thread.context ? thread.context.questionText : "会话";
const storageKey = chatDraftStorageKey;
function readCache(state: WorkspaceState, id: string): DraftCache | null {
  try { return recoverChatDraft(state, id, typeof window !== "undefined" ? localStorage.getItem(storageKey(state, id)) : null); } catch { return null; }
}
function removeCache(key: string) { try { localStorage.removeItem(key); } catch { /* A failed cleanup never changes server records. */ } }
export function chatSendPayload(threadId: string, intent: ChatIntent, text: string, requestId: string, expectedDraftRevision?: number): Record<string, unknown> {
  if (!["note", "hint", "explanation", "alternative"].includes(intent)) throw new Error("请选择明确的消息用途。");
  if (intent === "note" && !text.trim()) throw new Error("请先写下想记录的问题。");
  return { threadId, intent, text, requestId, ...(expectedDraftRevision === undefined ? {} : { expectedDraftRevision }) };
}

export function CompanionContextCard({ thread }: { thread: Thread }) {
  const context = thread.context;
  if (context.source === "legacy") return <div className="chat-context-card is-legacy"><History size={19} /><div><strong>旧版消息 · 题目版本未知</strong><p>保留原有文字，不猜测题库来源或版本。请重新选择明确的题目后查看提示与讲解。</p></div></div>;
  if (context.source === "general") return <div className="chat-context-card"><MessageCircle size={19} /><div><strong>这次不带题目</strong><p>普通消息只记录问题，不会检索或显示题目答案。选择具体题目后，可主动查看已保存的提示和讲解。</p></div></div>;
  if (!("questionId" in context)) return null;
  return <div className="chat-context-card"><BookOpen size={19} /><div><span className="eyebrow">{context.source === "paper" ? "原卷冻结题目" : "题库冻结题目"} · v{context.questionVersion}</span><strong>{context.questionText}</strong><p>题号 {context.questionId}{context.source === "paper" ? ` · 原卷 ${context.paperId}` : ""}</p><small>本会话固定引用这个版本；题库之后更新不会替换本次讲解。</small></div></div>;
}
export function CompanionMessageList({ messages, name }: { messages: ChatMessage[]; name: string }) {
  return <>{messages.map(message => <article key={message.id} className={`chat-message ${message.role}`}><span className="chat-avatar">{message.role === "assistant" ? <Sprout size={19} /> : name.slice(0, 1)}</span><div><span>{message.role === "assistant" ? message.intent === "note" ? "小禾 · 学习记录" : "小禾 · 题库讲解" : name} · {time(message.createdAt)}</span><p>{message.text || (message.role === "user" && message.intent !== "note" ? `主动请求：${intents.find(item => item.intent === message.intent)?.label ?? "题库帮助"}` : "")}</p>{message.preferenceUsed && <small className="chat-message-source">表达偏好：{message.preferenceUsed.value === "compact" ? "简洁说明" : "分步说明"} · 来源：本人设置</small>}</div></article>)}</>;
}

export default function CompanionChat(props: AppProps) {
  const { state, mutate, navigate, selectedId, chatContext, chatEntryError, busy } = props;
  const threads = [...(state.companion?.threads ?? [])].filter(thread => thread.ownerId === state.actor.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [fallbackId, setFallbackId] = useState(!chatContext ? threads[0]?.id : undefined);
  const activeId = selectedId ?? fallbackId;
  const [bankId, setBankId] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [preview, setPreview] = useState<CompanionDeletePreview | null>(null);
  const [deleteRequest, setDeleteRequest] = useState("");
  const flush = useRef<() => Promise<boolean>>(async () => true);
  const registerFlush = useCallback((callback: () => Promise<boolean>) => { flush.current = callback; }, []);
  const inFlight = useRef(false);
  const requested = useRef("");
  const active = threads.find(thread => thread.id === activeId);
  const locked = busy || Boolean(pending) || Boolean(preview);
  const requestKey = chatContext ? JSON.stringify(chatContext) : "";
  useEffect(() => {
    try { const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => key !== null); chatDraftKeysToPrune(state, keys).forEach(removeCache); } catch { /* The current confirmed projection still prevents recovery of inaccessible text. */ }
  }, [state]);
  const open = useCallback(async (context: ChatEntryContext) => {
    if (inFlight.current || busy || !["owner", "student"].includes(state.actor.role)) return;
    inFlight.current = true; setError(""); setFeedback("");
    try {
      if (!await flush.current()) { setError("当前草稿尚未保存，请先重试保存，再切换会话。"); return; }
      setPending("open"); const result = await mutate("chat.open", { context });
      if (!result || typeof result.result?.id !== "string") { setError("会话未能打开，请重试。没有改为其他题目版本。"); return; }
      setFallbackId(result.result.id); navigate("chat", result.result.id);
    } catch (error) { setError(error instanceof Error ? error.message : "会话未能打开，请重试。"); }
    finally { setPending(""); inFlight.current = false; }
  }, [busy, mutate, navigate, state.actor.role, setError, setFeedback, setPending]);
  useEffect(() => {
    if (!chatContext || busy || requested.current === requestKey) return;
    requested.current = requestKey; void open(chatContext);
  }, [chatContext, requestKey, busy, open]);
  const selectThread = async (id: string) => { if (locked || inFlight.current || id === activeId) return; if (!await flush.current()) { setError("当前草稿尚未保存，请先重试，输入会保留。"); return; } setError(""); setFallbackId(id); navigate("chat", id); };
  const deletionPreview = async () => {
    if (!active || busy || inFlight.current) return; inFlight.current = true; setError("");
    try { if (!await flush.current()) { setError("请先保存当前草稿，再核对删除范围。"); return; } setPending("preview"); const result = await mutate("chat.delete.preview", { threadId: active.id }); if (result?.result?.preview) { setPreview(result.result.preview as CompanionDeletePreview); setDeleteRequest(crypto.randomUUID()); } else setError("暂时无法核对删除范围，记录尚未删除。"); }
    catch (error) { setError(error instanceof Error ? error.message : "删除范围核对失败。"); }
    finally { setPending(""); inFlight.current = false; }
  };
  const deleteThread = async () => {
    if (!preview || busy || inFlight.current || preview.sourceRevision !== state.revision) return; inFlight.current = true; setPending("delete"); setError("");
    try { const result = await mutate("chat.delete", { threadId: preview.threadId, sourceRevision: preview.sourceRevision, digest: preview.digest, requestId: deleteRequest }); if (!result?.result?.deleted) { setError("删除结果尚未确认，请重试或重新核对范围。"); return; } removeCache(storageKey(state, preview.threadId)); flush.current = async () => true; setPreview(null); setFallbackId(undefined); navigate("chat"); setFeedback("会话、草稿和消息已删除；原始作答、帮助与题族曝光继续保留。"); }
    catch (error) { setError(error instanceof Error ? error.message : "删除未完成。"); }
    finally { setPending(""); inFlight.current = false; }
  };
  if (state.actor.role !== "owner" && state.actor.role !== "student") return <div className="card empty-state"><ShieldCheck /><h2>私人学习会话仅供本人查看</h2><p>请返回当前授权范围内的学习报告。</p></div>;
  return <div className="tools-page companion-page"><div className="page-heading"><div><p className="eyebrow">不用着急，我们一起想</p><h1>和小禾一起理思路</h1><p className="muted">题库讲解 · 非生成式 AI。普通消息只记录问题，提示与讲解由你主动选择。</p></div><span className="badge"><ShieldCheck size={15} />私人会话默认不分享</span></div>
    {(error || chatEntryError) && <div className="notice chat-error" role="alert"><span>{error || chatEntryError}</span>{chatContext && <button className="btn btn-secondary" disabled={locked} onClick={() => open(chatContext)}>重试打开指定题目</button>}</div>}{feedback && <p className="notice" role="status">{feedback}</p>}
    <div className="chat-layout"><section className="card chat-main"><header className="chat-header"><span className="brand-mark"><Sprout size={24} /></span><div><strong>小禾</strong><small>仅使用明确版本的题库提示与教学解法</small></div>{active && <button className="btn btn-ghost chat-delete" disabled={locked} onClick={deletionPreview}><Trash2 size={16} />删除会话</button>}</header>
      {active && !chatContext && !chatEntryError ? <ChatThreadPane key={storageKey(state, active.id)} {...props} thread={active} blocked={Boolean(preview) || Boolean(pending)} registerFlush={registerFlush} /> : <div className="chat-welcome chat-no-session"><span className="chat-leaf"><Leaf size={38} /></span><h2>{pending === "open" ? "正在打开明确版本…" : selectedId || chatEntryError ? "没有打开这份会话" : "从一个问题开始"}</h2><p>{selectedId ? "会话可能已删除，或不属于当前账号。不会按同名题号猜测原版本。" : "可继续以前的会话，或选一道题。\n也可以先记录学习中遇到的问题。"}</p><button className="btn btn-primary" disabled={locked} onClick={() => open({ source: "general" })}><Plus size={16} />打开不带题目的会话</button></div>}
    </section><aside className="chat-aside"><section className="card"><span className="eyebrow"><BookOpen size={15} />带上一道题</span><label className="field">当前已发布题库<select aria-label="选择新的题库会话" className="select" value={bankId} disabled={locked} onChange={event => setBankId(event.target.value)}><option value="">请选择题目</option>{state.questions.filter(question => question.status === "published").map(question => <option value={question.id} key={question.id}>{question.text} · v{question.version}</option>)}</select></label><button className="btn btn-secondary" disabled={locked || !bankId} onClick={() => { const question = state.questions.find(item => item.id === bankId); if (question) void open({ source: "bank", questionId: question.id, questionVersion: question.version }); }}>打开这个题目版本<ChevronRight size={15} /></button><p className="muted">讨论已保存试卷，请从原卷练习或报告进入，以保留当时的题目版本。</p><button className="btn btn-ghost" disabled={locked} onClick={() => open({ source: "general" })}><Plus size={15} />不带题目，记录问题</button></section>
      <section className="card chat-thread-list"><h3><History size={17} />继续我的会话</h3>{threads.map(thread => <button className={activeId === thread.id ? "is-active" : ""} disabled={locked} key={thread.id} onClick={() => selectThread(thread.id)}><strong>{title(thread)}</strong><small>{time(thread.updatedAt)}{thread.draft.text ? " · 有草稿" : ""}</small></button>)}{!threads.length && <p className="muted">还没有会话。打开后，记录会保存到当前学习空间。</p>}</section>
      <CompanionPreferences state={state} mutate={mutate} busy={locked} />
      <CompanionHelpRequest {...props} thread={active} busy={locked} />{state.helpRequests.length > 0 && <section className="card help-history"><h3>我的求助</h3>{state.helpRequests.map(request => <div key={request.id}><span className="badge">{request.delivery === "local-only" ? "仅本机保存" : request.status === "replied" ? "已回复" : request.status === "received" ? "已接收" : "等待接收"}</span><p>{request.summary}</p>{request.reply && <div className="notice">回复：{request.reply}</div>}</div>)}</section>}
    </aside></div>
    {preview && <div className="chat-modal-backdrop"><section className="card chat-modal" role="dialog" aria-modal="true" aria-labelledby="chat-delete-heading"><button className="chat-modal-close btn btn-ghost" aria-label="取消删除" disabled={Boolean(pending)} onClick={() => setPreview(null)}><X size={18} /></button><Trash2 size={25} /><h2 id="chat-delete-heading">确认删除这份私人会话</h2><p>将删除 {preview.messageCount} 条消息{preview.hasDraft ? "和已保存的会话草稿" : "，没有已保存草稿"}。</p><div className="notice">{preview.retainedExposureCount} 条相关帮助/曝光记录继续保留。另有 {preview.retainedHelpRequestCount} 份单独保存或共享的求助摘要继续保留。原始作答、错题、星级依据不会删除，题族不会因此重新成为新题。</div><p className="muted">删除会话不会撤回已分享摘要。删除后不能恢复本会话。如需删除学习证据，请前往“我的学习空间 → 管理与删除历史”另行核对影响。</p>{preview.sourceRevision !== state.revision && <p className="error-text" role="alert">工作区已有变化，请重新核对删除范围。</p>}<div className="row"><button className="btn btn-secondary" disabled={Boolean(pending)} onClick={() => setPreview(null)}>保留会话</button>{preview.sourceRevision !== state.revision ? <button className="btn btn-primary" disabled={busy || Boolean(pending)} onClick={deletionPreview}>重新核对</button> : <button className="btn btn-primary" disabled={busy || Boolean(pending)} onClick={deleteThread}>{pending === "delete" ? "正在删除…" : "确认删除会话与消息"}</button>}</div></section></div>}
  </div>;
}

function ChatThreadPane({ state, mutate, busy, thread, blocked, registerFlush }: AppProps & { thread: Thread; blocked: boolean; registerFlush: (flush: () => Promise<boolean>) => void }) {
  const key = storageKey(state, thread.id);
  const messages = state.messages.filter(message => message.threadId === thread.id);
  const [initial] = useState(() => readCache(state, thread.id));
  const [text, setText] = useState(thread.draft.text);
  const [recovery, setRecovery] = useState<DraftCache | null>(initial && initial.text !== thread.draft.text ? initial : null);
  const [retry, setRetry] = useState<PendingRequest | null>(initial?.request ?? null);
  const [status, setStatus] = useState("草稿已保存");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [conflict, setConflict] = useState(false);
  const revision = useRef(thread.draft.revision);
  const textRef = useRef(text);
  const dirty = useRef(false);
  const mounted = useRef(true);
  const sendLock = useRef(false);
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const retryRef = useRef<PendingRequest | null>(retry);
  const bottom = useRef<HTMLDivElement>(null);
  const cache = useCallback((value: string, request = retryRef.current) => { if (!learningDraftStillAvailable(state, "thread", thread.id)) { removeCache(key); return false; } try { localStorage.setItem(key, JSON.stringify({ text: value, intent: "note", ...(request ? { request } : {}) })); return true; } catch { return false; } }, [key, state, thread.id]);
  const save = useCallback(async function flushDraft(): Promise<boolean> {
    while (pendingSave.current) await pendingSave.current;
    if (!learningDraftStillAvailable(state, "thread", thread.id)) { dirty.current = false; removeCache(key); return false; }
    if (recovery || conflict) return false;
    if (!dirty.current) return true;
    const snapshot = textRef.current;
    const promise = (async () => {
      if (mounted.current) { setStatus("正在保存草稿…"); setSavingDraft(true); }
      try { const result = await mutate("chat.draft.save", { threadId: thread.id, text: snapshot, intent: "note", expectedDraftRevision: revision.current }); if (result) { const stored = result.state.companion?.threads.find(item => item.id === thread.id); if (!stored) return false; revision.current = stored.draft.revision; if (textRef.current === snapshot) { dirty.current = false; if (!retryRef.current) removeCache(key); if (mounted.current) setStatus("草稿已保存"); } return true; } }
      catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "草稿暂未保存。"); }
      if (mounted.current) { setStatus("尚未同步，输入已保留"); setError("草稿保存未确认；请重试。若另一处修改了草稿，请先选择要保留的内容。"); } return false;
    })();
    pendingSave.current = promise;
    let success = false; try { success = await promise; } finally { if (pendingSave.current === promise) pendingSave.current = null; if (mounted.current) setSavingDraft(false); }
    return success && dirty.current ? flushDraft() : success;
  }, [conflict, key, mutate, recovery, thread.id, state]);
  const saveRef = useRef(save); useEffect(() => { saveRef.current = save; registerFlush(save); }, [save, registerFlush]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; registerFlush(async () => true); if (dirty.current && !sendLock.current) void saveRef.current(); }; }, [registerFlush]);
  useEffect(() => { if (!dirty.current || recovery || conflict || blocked || sending) return; const timer = setTimeout(() => { void saveRef.current(); }, 700); return () => clearTimeout(timer); }, [text, recovery, conflict, blocked, sending]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages.length]);
  useEffect(() => {
    if (thread.draft.revision <= revision.current || pendingSave.current || sendLock.current) return;
    if (dirty.current) { setConflict(true); return; }
    revision.current = thread.draft.revision; textRef.current = thread.draft.text; setText(thread.draft.text);
  }, [thread.draft.revision, thread.draft.text, savingDraft, sending]);
  useEffect(() => {
    const request = retryRef.current;
    if (!request || sendLock.current || !messages.some(message => message.requestId === request.requestId && message.role === "assistant")) return;
    retryRef.current = null; setRetry(null); setError("");
    revision.current = thread.draft.revision;
    if (request.intent === "note" && textRef.current.trim() === request.text.trim()) { textRef.current = thread.draft.text; dirty.current = false; setText(thread.draft.text); }
    if (dirty.current) cache(textRef.current, null); else removeCache(key);
    setStatus("已确认上次请求保存成功");
  }, [messages, thread.draft.revision, thread.draft.text, cache, key]);
  const change = (value: string) => { if (sendLock.current || retryRef.current) return; textRef.current = value; dirty.current = true; setText(value); setStatus(cache(value) ? "输入保留在本机，等待同步" : "本机缓存不可用，请保持页面打开并保存"); };
  const chooseDraft = (local: boolean) => { revision.current = thread.draft.revision; setError(""); setConflict(false); if (local) { const value = recovery?.text ?? textRef.current; textRef.current = value; dirty.current = true; cache(value); setText(value); setStatus("已选择本机输入，请保存草稿"); } else { textRef.current = thread.draft.text; dirty.current = false; setText(thread.draft.text); if (!retryRef.current) removeCache(key); setStatus("已保留当前已保存草稿"); } setRecovery(null); };
  const send = async (intent: ChatIntent, repeat?: PendingRequest) => {
    if (sendLock.current || busy || blocked || recovery || conflict || (retryRef.current && !repeat)) return;
    sendLock.current = true; setSending(true); setError("");
    try {
      if (!await saveRef.current()) return;
      const request = repeat ?? { requestId: crypto.randomUUID(), intent, text: intent === "note" ? textRef.current : "", expectedDraftRevision: revision.current };
      retryRef.current = request; setRetry(request); cache(textRef.current, request);
      const result = await mutate("chat.send", chatSendPayload(thread.id, request.intent, request.text, request.requestId, request.expectedDraftRevision));
      if (!result) { setError("消息结果尚未确认；输入保留，请用下面的重试按钮确认同一次请求。"); return; }
      const stored = result.state.companion?.threads.find(item => item.id === thread.id);
      retryRef.current = null; setRetry(null);
      if (stored) revision.current = stored.draft.revision;
      if (request.intent === "note" && textRef.current.trim() === request.text.trim()) { textRef.current = stored?.draft.text ?? ""; dirty.current = false; setText(textRef.current); removeCache(key); }
      else if (!dirty.current) removeCache(key);
      setStatus("已保存");
    } catch (error) {
      // A confirmed rejection did not commit. Unknown transport/5xx results keep
      // the exact request ID until replay confirms the outcome.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) { retryRef.current = null; setRetry(null); cache(textRef.current, null); }
      setError(error instanceof Error ? error.message : "请求未完成，输入仍保留。");
    }
    finally { sendLock.current = false; setSending(false); }
  };
  const legacy = thread.context.source === "legacy";
  const hasQuestion = thread.context.source === "bank" || thread.context.source === "paper";
  return <><CompanionContextCard thread={thread} /><div className="chat-messages"><CompanionMessageList messages={messages} name={state.profile.name} />{!messages.length && <div className="chat-welcome"><MessageCircle size={30} /><p>可以先写下具体困惑。普通文字只记录问题，<br />不会因为出现“答案”“讲解”等词而自动展开解法。</p></div>}<div ref={bottom} /></div>
    {!legacy && <><div className="chat-intents">{intents.map(({ intent, label, icon: Icon }) => <button type="button" className="btn btn-secondary" key={intent} disabled={!hasQuestion || busy || blocked || sending || Boolean(recovery) || conflict || Boolean(retry)} onClick={() => send(intent)}><Icon size={15} />{label}</button>)}</div><p className="chat-footnote">{hasQuestion ? "提示与讲解会真实记录帮助使用；其他方法也按查看讲解记录。" : "当前没有题目，题库帮助按钮不可用。"}</p>
      {(recovery || conflict) && <div className="chat-draft-recovery" role="status"><strong>{conflict ? "另一处更新了已保存草稿" : "发现尚未同步的本机输入"}</strong><p>请选择保留哪一份，不会自动覆盖。</p><p>已保存：{thread.draft.text || "（空）"}</p><p>本机：{recovery?.text ?? text}</p><div className="row"><button className="btn btn-secondary" disabled={sending || blocked} onClick={() => chooseDraft(false)}>保留已保存草稿</button><button className="btn btn-primary" disabled={sending || blocked} onClick={() => chooseDraft(true)}>恢复本机输入</button></div></div>}
      {error && <p className="chat-inline-error" role="alert">{error}</p>}{retry && <button className="btn btn-secondary chat-retry" disabled={busy || blocked || sending || Boolean(recovery) || conflict} onClick={() => send(retry.intent, retry)}>重试上次{retry.intent === "note" ? "问题记录" : intents.find(item => item.intent === retry.intent)?.label}</button>}
      <form className="chat-compose" onSubmit={event => { event.preventDefault(); void send("note"); }}><label htmlFor={`chat-message-${thread.id}`} className="sr-only">记录学习问题</label><textarea id={`chat-message-${thread.id}`} placeholder="写下具体困惑；这里的文字只作为问题记录…" value={text} maxLength={2000} disabled={sending || blocked || Boolean(recovery) || conflict || Boolean(retry)} onChange={event => change(event.target.value)} onBlur={() => { if (!sendLock.current) void saveRef.current(); }} /><button className="btn btn-primary" disabled={busy || blocked || sending || !text.trim() || Boolean(recovery) || conflict || Boolean(retry)} aria-label="保存问题记录"><ArrowUp size={21} /></button></form><div className="chat-draft-status"><span role="status">{status}</span><button className="btn btn-ghost" disabled={busy || blocked || sending || Boolean(recovery) || conflict} onClick={() => saveRef.current()}><Save size={14} />保存草稿</button></div></>}
    {legacy && <p className="chat-footnote">旧消息只读保留。新会话会明确记录题目版本和帮助选择。</p>}
  </>;
}

export function CompanionPreferences({ state, mutate, busy }: Pick<AppProps, "state" | "mutate" | "busy">) {
  const preference = state.companion?.preferences.find(item => item.ownerId === state.actor.id && item.key === "presentation");
  const [value, setValue] = useState<"stepwise" | "compact">(preference?.value ?? "stepwise");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const save = async (remove = false) => { if (busy || pending) return; setPending(true); setFeedback(""); try { const result = await mutate(remove ? "memory.preference.delete" : "memory.preference.set", { key: "presentation", ...(!remove ? { value } : {}), sourceRevision: state.revision }); setFeedback(result ? remove ? "表达偏好已删除，不影响学习记录。" : "已保存你明确选择的表达偏好。" : "尚未保存，请重试；选择仍保留。"); } catch (error) { setFeedback(error instanceof Error ? error.message : "偏好保存失败。"); } finally { setPending(false); } };
  if (!["owner", "student"].includes(state.actor.role)) return null;
  return <section className="card chat-preferences"><h3><Settings2 size={17} />我的讲解偏好</h3><p>{preference ? `当前：${preference.value === "compact" ? "简洁说明" : "分步说明"} · 来源：本人设置 · ${time(preference.updatedAt)}` : "当前未设置，使用默认表达方式。"}</p><label className="field">我希望如何呈现<select className="select" value={value} disabled={busy || pending} onChange={event => setValue(event.target.value as typeof value)}><option value="stepwise">分步说明</option><option value="compact">简洁说明</option></select></label><p className="muted">只影响题库讲解的呈现，不推断能力、性格或情绪，也不改变题目答案和知识点星级。</p><div className="row"><button className="btn btn-secondary" disabled={busy || pending} onClick={() => save()}>保存我的选择</button>{preference && <button className="btn btn-ghost" disabled={busy || pending} onClick={() => save(true)}>删除偏好</button>}</div>{feedback && <p role="status">{feedback}</p>}</section>;
}

type HelpSummaryPreview = { threadId: string; requestId: string; topic: string; summary: string; context: Thread["context"] };
export function CompanionHelpPreview({ preview }: { preview: HelpSummaryPreview }) {
  return <div className="chat-help-preview"><strong>准备共享的内容</strong><p>{"questionId" in preview.context ? `${preview.context.source === "paper" ? "原卷" : "题库"}题目 v${preview.context.questionVersion}：${preview.context.questionText}` : "不附带题目版本"}</p><p className="chat-help-summary">{preview.summary}</p><small>共享给本工作区已授权教师；工作区所有者也可查看。只附带这份手写摘要与明确题目上下文，不附带私人会话全文、草稿或照片，不发送外部通知。</small></div>;
}
export function CompanionHelpRequest({ state, mutate, busy, thread }: Pick<AppProps, "state" | "mutate" | "busy"> & { thread?: Thread }) {
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState("");
  const [preview, setPreview] = useState<HelpSummaryPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [feedback, setFeedback] = useState("");
  const lock = useRef(false);
  const confirm = async () => {
    if (!preview || busy || lock.current) return;
    lock.current = true; setPending(true); setFeedback("");
    try {
      const result = await mutate("help.create", { threadId: preview.threadId, requestId: preview.requestId, topic: preview.topic, summary: preview.summary });
      if (!result?.result?.id) { setUncertain(true); setFeedback("保存结果尚未确认，摘要仍保留。请重试确认同一份摘要。"); return; }
      const request = result.state.helpRequests.find(item => item.id === result.result!.id);
      setSummary(""); setPreview(null); setUncertain(false); setExpanded(false);
      setFeedback(request?.delivery === "local-only" ? "摘要仅保存在本机，尚未送达教师。" : "摘要已保存在本工作区共享收件箱，未发送外部通知。");
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) { setPreview(null); setUncertain(false); }
      else setUncertain(true);
      setFeedback(error instanceof Error ? error.message : "保存未确认，摘要仍保留，请重试。");
    } finally { lock.current = false; setPending(false); }
  };
  if (!["owner", "student"].includes(state.actor.role)) return null;
  const allowedThread = thread?.ownerId === state.actor.id ? thread : undefined;
  return <section className="card help-card"><HandHeart size={25} /><h3>也可以找人帮帮忙</h3><p className="muted">先预览，再共享你亲自填写的摘要。已分享摘要单独保存，不会随会话删除。</p><button className="btn btn-secondary" disabled={busy || pending || !allowedThread} onClick={() => setExpanded(value => !value)}>{expanded ? "收起求助摘要" : "写下求助内容"}</button>{!allowedThread && <p className="muted">请先打开属于自己的会话。</p>}{expanded && <form onSubmit={event => { event.preventDefault(); if (busy || pending || !allowedThread || !summary.trim()) return; setFeedback(""); setPreview({ threadId: allowedThread.id, requestId: crypto.randomUUID(), topic: "questionText" in allowedThread.context ? allowedThread.context.questionText.slice(0, 120) : "学习求助", summary, context: structuredClone(allowedThread.context) }); }}><label className="field">准备分享的摘要<textarea className="textarea" value={summary} disabled={busy || pending || Boolean(preview)} onChange={event => setSummary(event.target.value)} placeholder="我想请老师帮我看看…" maxLength={1000} /></label>{preview ? <><CompanionHelpPreview preview={preview} /><div className="row"><button type="button" className="btn btn-secondary" disabled={busy || pending || uncertain} onClick={() => setPreview(null)}>返回修改</button><button type="button" className="btn btn-primary" disabled={busy || pending} onClick={confirm}>{pending ? "正在保存…" : uncertain ? "重试确认这份摘要" : "确认共享摘要"}</button></div></> : <button className="btn btn-primary" disabled={busy || pending || !allowedThread || !summary.trim()}>预览准备共享的摘要</button>}</form>}{feedback && <p role="status">{feedback}</p>}</section>;
}
