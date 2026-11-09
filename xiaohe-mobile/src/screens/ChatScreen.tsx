import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { Alert, Keyboard, Text, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Badge, Button, Card, InfoNote } from '../components/ui';
import { Chip, errorMessage, knowledgeNames, learningStyles as ls, LoadingPanel, Notice } from '../components/learning/LearnUI';
import { chatRequestId, intentNames } from '../components/learning/chatDraft';
import { useChatDraft } from '../components/learning/useChatDraft';
import { fullDateTime } from '../components/learning/reviewTime';
import { useLearning } from '../context/LearningContext';
import { historyRequestWasDeleted } from '../features/history-deletion-ui';
import type { ChatIntent, ChatOpenContext, CompanionDeletePreview, CompanionThread } from '../local/types';
import { colors, styles } from '../theme';

const back = () => router.canGoBack() ? router.back() : router.replace('/');
function threadTitle(thread: CompanionThread) {
  return thread.context.source === 'paper' || thread.context.source === 'bank' ? thread.context.questionText : thread.context.source === 'legacy' ? '早期对话记录' : '我的问题与想法';
}
export default function ChatScreen() {
  const params = useLocalSearchParams<{ threadId?: string; source?: string; paperId?: string; questionId?: string; questionVersion?: string }>();
  const { state, error: loadError, reload, act } = useLearning();
  const [selected, setSelected] = useState<CompanionThread | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef(false);
  const attempted = useRef(false);
  usePreventRemove(opening, () => Alert.alert('正在打开本机对话', '请等记录保存完成后再返回。'));
  const open = async (context: ChatOpenContext) => {
    if (operation.current) return;
    operation.current = true; setOpening(true); setError('');
    try {
      const result = await act('chat.open', { context });
      const thread = result.state.companion?.threads.find(item => item.id === result.result?.id);
      if (!thread) throw new Error('没有读到对话记录，请重试。');
      setSelected(thread);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { operation.current = false; setOpening(false); }
  };
  const requestedContext = (): ChatOpenContext => {
    if (params.source === 'general') return { source: 'general' };
    const questionVersion = Number(params.questionVersion);
    if (!params.questionId || !Number.isSafeInteger(questionVersion) || questionVersion < 1) throw new Error('题目版本不完整，请返回原题后重新进入。');
    if (params.source === 'paper' && params.paperId) return { source: 'paper', paperId: params.paperId, questionId: params.questionId, questionVersion };
    if (params.source === 'bank') return { source: 'bank', questionId: params.questionId, questionVersion };
    throw new Error('没有找到这道题的来源，请返回原题后重新进入。');
  };
  useEffect(() => {
    if (!state || attempted.current) return;
    attempted.current = true;
    // Run once per route. Later state publications must not recreate deleted threads.
    void Promise.resolve().then(() => {
      if (params.threadId) {
        const thread = state.companion?.threads.find(item => item.id === params.threadId);
        if (thread) setSelected(thread); else setError('这段对话已删除或不存在。');
      } else if (params.source) {
        try { void open(requestedContext()); } catch (cause) { setError(errorMessage(cause)); }
      }
    });
    // The immutable initial route is deliberately opened once, not on global state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!state]);
  if (selected) return <ChatConversation key={selected.id} initialThread={selected} />;
  if (!state) return <Screen title="小禾学伴" onBack={back}><LoadingPanel error={loadError} retry={() => { void reload().catch(() => {}); }} /></Screen>;
  const threads = [...(state.companion?.threads || [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return <Screen title="和小禾一起理思路" onBack={back}>
    <View><Text style={styles.eyebrow}>本机学伴 · 题库讲解</Text><Text style={styles.title}>把卡住的地方，{ '\n' }慢慢说清楚。</Text><Text style={styles.subtitle}>写下问题，或从一道题带着上下文进入。</Text></View>
    <InfoNote text="这里会保存你的文字，并按明确选择展示题库提示或讲解。当前没有联网 AI，也不会自动发送给老师。" />
    {!!error && <Notice text={error} error />}
    {params.source && !opening && <Button label="重读本机记录后重试" secondary onPress={() => {
      if (operation.current) return; operation.current = true; setOpening(true);
      void reload().then(() => { operation.current = false; setOpening(false); return open(requestedContext()); }).catch(cause => { setError(errorMessage(cause)); operation.current = false; setOpening(false); });
    }} />}
    <Button label={opening ? '正在打开…' : '记下一个问题或想法'} disabled={opening} onPress={() => { void open({ source: 'general' }); }} />
    <Button label="查看学习记忆与讲解偏好" secondary disabled={opening} onPress={() => router.push('/memory')} />
    <Text style={styles.sectionTitle}>接着上次聊</Text>
    {threads.map(thread => <Card key={thread.id} style={ls.section}><Badge>{thread.context.source === 'paper' || thread.context.source === 'bank' ? `题目 v${thread.context.questionVersion}` : thread.context.source === 'legacy' ? '早期记录 · 题目版本不详' : '问题笔记'}</Badge><Text numberOfLines={3} style={styles.sectionTitle}>{threadTitle(thread)}</Text><Text style={styles.caption}>{fullDateTime(thread.updatedAt)} · {state.messages.filter(item => item.threadId === thread.id).length} 条记录{thread.draft.text || thread.draft.intent !== 'note' ? ' · 有草稿' : ''}</Text><Button label="继续这段对话" secondary disabled={opening} onPress={() => router.push({ pathname: '/chat', params: { threadId: thread.id } })} /></Card>)}
    {!threads.length && <Notice text="还没有对话。也可以从练习、拍题、报告或错题中的“带这道题问小禾”进入，保留准确的题目版本。" />}
  </Screen>;
}

type PendingSend = { threadId: string; text: string; intent: ChatIntent; requestId: string; expectedDraftRevision: number };
function ChatConversation({ initialThread }: { initialThread: CompanionThread }) {
  const { state, act, reload } = useLearning();
  const draft = useChatDraft(initialThread, act, state ? { exists: !!state.companion?.threads.some(item => item.id === initialThread.id), revision: state.revision } : undefined);
  const [operation, setOperation] = useState<string | null>(null);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  const pendingRef = useRef<PendingSend | null>(null);
  const [preview, setPreview] = useState<CompanionDeletePreview | null>(null);
  const [summary, setSummary] = useState('');
  const [summaryPreview, setSummaryPreview] = useState<{ topic: string; summary: string; requestId: string } | null>(null);
  const [pendingSummary, setPendingSummary] = useState<{ topic: string; summary: string; requestId: string } | null>(null);
  const pendingSummaryRef = useRef<typeof pendingSummary>(null);
  const [leaving, setLeaving] = useState(false);
  const context = initialThread.context;
  const hasQuestion = context.source === 'paper' || context.source === 'bank';
  const messages = state?.messages.filter(item => item.threadId === initialThread.id) || [];
  const locked = !!operation || !!pendingSend || !!pendingSummary || draft.deleted || draft.conflicts.length > 0;
  const removalHandled = useRef(false);
  useEffect(() => {
    if (!draft.deleted || removalHandled.current) return;
    removalHandled.current = true;
    void Promise.resolve().then(() => {
      const summaryRequest = pendingSummaryRef.current;
      if (summaryRequest && state && (historyRequestWasDeleted(state, summaryRequest.requestId) || state.helpRequests.some(item => item.requestId === summaryRequest.requestId && item.ownerId === state.actor.id))) setSummary('');
      pendingRef.current = null; setPendingSend(null); setPreview(null); pendingSummaryRef.current = null; setPendingSummary(null); setSummaryPreview(null);
    });
  }, [draft.deleted, state]);
  const run = async (label: string, work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setOperation(label); setError(''); setNotice(''); Keyboard.dismiss();
    try { await work(); } catch (cause) { setError(errorMessage(cause)); }
    finally { lock.current = false; setOperation(null); }
  };
  const disablePrevention = usePreventRemove((!!operation || draft.dirty || draft.saving || !!pendingSend || !!summary || !!pendingSummary) && !leaving, ({ repeat }) => {
    if (lock.current) { Alert.alert('正在保存本机记录', '请稍等这次操作完成。'); return; }
    if (draft.deleted) { Alert.alert('这段对话已删除', '当前未保存文字仅供复制，离开后不会重新保存。', [{ text: '留下复制', style: 'cancel' }, { text: '离开页面', onPress: () => { setLeaving(true); repeat(); } }]); return; }
    if (pendingRef.current) { Alert.alert('这次发送结果还需确认', '请先重读记录，确认是否已经保存。当前文字与选择都保留着。'); return; }
    if (pendingSummaryRef.current) { Alert.alert('摘要保存结果还需确认', '请先重读记录，确认这份摘要是否已经保存，避免重复。'); return; }
    if (summary) { Alert.alert('求助摘要还在整理中', '请先在页面预览并保存摘要，或明确取消本页摘要草稿。不会自动发送给老师。'); return; }
    if (draft.conflicts.length || draft.error) { Alert.alert('草稿还没有保存', '请先重读并选择要保留的内容，再保存后返回。'); return; }
    void run('save', async () => { await draft.save(); setLeaving(true); repeat(); });
  });
  const recover = () => run('reload', async () => {
    const request = pendingRef.current;
    const latest = await draft.recover(reload, request?.requestId);
    const sent = request && latest.messages.some(item => item.threadId === initialThread.id && item.requestId === request.requestId);
    const help = pendingSummaryRef.current;
    const savedSummary = help && latest.helpRequests.find(item => item.requestId === help.requestId && item.ownerId === latest.actor.id);
    if (savedSummary) { setSummary(''); setSummaryPreview(null); }
    pendingSummaryRef.current = null; setPendingSummary(null);
    pendingRef.current = null; setPendingSend(null);
    setPreview(null);
    setNotice(savedSummary ? '已确认求助摘要保存在本机，尚未发送。没有重复保存。' : sent ? '已确认上次发送保存成功，没有重复发送。' : '已重读本机记录。未发送的文字和选择仍保留，可以修改后再发；如有不同版本，请先选择。');
  });
  const send = () => run('send', async () => {
    if (draft.deleted) throw new Error('这段会话已经删除，旧请求不能重新发送。');
    let request = pendingRef.current;
    if (!request) {
      const saved = await draft.save();
      request = { threadId: initialThread.id, text: saved.text, intent: saved.intent, expectedDraftRevision: saved.revision, requestId: chatRequestId(initialThread.id, saved) };
      pendingRef.current = request; setPendingSend(request);
    }
    const result = await act('chat.send', request);
    const remote = result.state.companion?.threads.find(item => item.id === initialThread.id);
    if (!remote) throw new Error('暂时无法确认发送结果，请重读记录。');
    const retained = draft.reset(remote.draft); pendingRef.current = null; setPendingSend(null); setPreview(null);
    if (!retained) { setNotice('这段对话已经删除，未恢复旧文字。'); return; }
    setNotice(request.intent === 'note' ? '问题已记在本机，没有记录新的解题帮助。' : '帮助使用已记录；已提交的原始作答不会改变。');
  });
  const showDelete = () => run('preview', async () => {
    await draft.save();
    const result = await act('chat.delete.preview', { threadId: initialThread.id });
    const impact = result.result?.preview as CompanionDeletePreview | undefined;
    if (!impact || impact.threadId !== initialThread.id) throw new Error('没有取得删除影响，请重试。');
    setPreview(impact);
  });
  const deleteThread = () => run('delete', async () => {
    if (!preview || preview.sourceRevision !== state?.revision) throw new Error('记录发生了变化，请重新查看删除影响。');
    await act('chat.delete', { threadId: initialThread.id, sourceRevision: preview.sourceRevision, digest: preview.digest, requestId: `delete:${initialThread.id}:${preview.digest}` });
    setLeaving(true); disablePrevention(); router.replace('/chat');
  });
  const saveSummary = () => run('summary', async () => {
    if (draft.deleted) throw new Error('来源会话已经删除，当前摘要仅供复制，不能重新保存到该会话。');
    const pending = pendingSummaryRef.current || summaryPreview;
    if (!pending) return;
    pendingSummaryRef.current = pending; setPendingSummary(pending);
    await act('help.create', { topic: pending.topic, summary: pending.summary, threadId: initialThread.id, requestId: pending.requestId });
    pendingSummaryRef.current = null; setPendingSummary(null); setSummary(''); setSummaryPreview(null);
    setNotice('求助摘要已保存在本机，尚未发送给老师。私人对话没有附加到摘要。');
  });
  return <Screen title="和小禾一起理思路" onBack={back}>
    <Card style={ls.section}><Badge>{hasQuestion ? `固定题目 v${context.questionVersion}` : context.source === 'legacy' ? '早期对话 · 版本不详' : '我的问题笔记'}</Badge><Text style={styles.sectionTitle}>{threadTitle(initialThread)}</Text>{hasQuestion && <Text style={styles.caption}>{knowledgeNames[context.knowledgeId]} · {context.source === 'paper' ? '来自已保存的试卷版本' : '来自进入时的题库版本'}，题库更新不会替换这段对话的题目。</Text>}{context.source === 'legacy' && <Notice text="这些早期文字未记录准确题目版本，可以查看或继续记笔记。需要提示或讲解时，请从原题重新进入。" />}</Card>
    <InfoNote text="文字记录和题库讲解只保存在本机。普通文字不会被自动当作求答案，也不会据此推断你的性格。" />
    {messages.map(message => <Card key={message.id} style={{ gap: 9, backgroundColor: message.role === 'user' ? '#F0F6E9' : colors.surface }}><Text style={styles.eyebrow}>{message.role === 'user' ? '我' : '小禾 · 本机题库回应'}{message.intent ? ` · ${intentNames[message.intent]}` : ''}</Text><Text selectable style={styles.body}>{message.text}</Text><Text style={styles.caption}>{fullDateTime(message.createdAt)}{message.preferenceUsed ? ` · 按本人选择：${message.preferenceUsed.value === 'stepwise' ? '分步讲解' : '简洁讲解'}` : ''}</Text></Card>)}
    {!messages.length && <Notice text="可以先记下：我做到哪一步，哪里还不清楚。需要帮助时，再明确选择提示或讲解。" />}
    {!!(error || draft.error) && <Notice text={error || draft.error} error />}
    {!!notice && <Notice text={notice} />}
    {(error || draft.error || pendingSend || pendingSummary) && <Button label={operation === 'reload' ? '正在重读…' : '重读记录，保留当前输入'} secondary disabled={!!operation} onPress={() => { void recover(); }} />}
    {draft.conflicts.map(conflict => <Card key={conflict.field} style={ls.section}><Text style={styles.sectionTitle}>{conflict.field === 'text' ? '文字' : '帮助选项'}有不同版本</Text><Text style={styles.caption}>当前页面</Text><Text selectable style={styles.body}>{conflict.field === 'intent' ? intentNames[conflict.local as ChatIntent] : conflict.local || '（空白）'}</Text><Text style={styles.caption}>本机记录</Text><Text selectable style={styles.body}>{conflict.field === 'intent' ? intentNames[conflict.remote as ChatIntent] : conflict.remote || '（空白）'}</Text><Button label="保留当前页面内容" disabled={!!operation} onPress={() => { if (!lock.current) draft.choose(conflict.field, 'local'); }} /><Button label="采用本机记录" secondary disabled={!!operation} onPress={() => { if (!lock.current) draft.choose(conflict.field, 'remote'); }} /></Card>)}
    <Card style={ls.section}><Text style={styles.sectionTitle}>这次想怎么继续？</Text><View style={ls.wrap}>{(Object.keys(intentNames) as ChatIntent[]).map(intent => <Chip key={intent} text={intentNames[intent]} selected={draft.input.intent === intent} disabled={locked || (!hasQuestion && intent !== 'note')} onPress={() => { if (lock.current || pendingRef.current || pendingSummaryRef.current) return; setPreview(null); draft.update('intent', intent); }} />)}</View><Text style={styles.caption}>{draft.input.intent === 'note' ? '只保存你的文字和本机确认回应，不展示解法、不新增帮助记录。' : draft.input.intent === 'hint' ? '会记录“使用提示”，这道题不再作为独立新题依据。' : '会记录“看过讲解”，并同步同题族的未完成练习；原始提交不变。'}</Text>
      <TextInput accessibilityLabel="想对小禾说的话" value={draft.input.text} onChangeText={text => { if (lock.current || pendingRef.current || pendingSummaryRef.current) return; setPreview(null); draft.update('text', text); }} editable={!locked} maxLength={2000} multiline style={[ls.input, ls.textArea]} placeholder={hasQuestion ? '写下卡住的步骤或问题…' : '记下你的问题或想法…'} placeholderTextColor="#87937D" />
      <Text accessibilityLiveRegion="polite" style={styles.caption}>{draft.deleted ? '对话已删除，当前文字仅保留在页面' : draft.error ? '尚未保存成功' : draft.saving ? '正在保存草稿…' : draft.dirty ? '草稿尚未保存' : '草稿已保存在本机'}</Text>
      {draft.deleted ? <><Text selectable style={styles.body}>{draft.input.text}</Text><Button label="查看其他对话" secondary disabled={!!summary || !!pendingSummary} onPress={() => { setLeaving(true); disablePrevention(); router.replace('/chat'); }} /></> : <><Button label={operation === 'send' ? '正在保存回应…' : pendingSend ? '重试这次发送（不会重复）' : draft.input.intent === 'note' ? '记下这段话' : `确认${intentNames[draft.input.intent]}`} disabled={!!operation || !!pendingSummary || draft.conflicts.length > 0 || (!pendingSend && draft.input.intent === 'note' && !draft.input.text.trim())} onPress={() => { void send(); }} /><Button label="保存草稿" secondary disabled={locked || draft.saving} onPress={() => { void run('save', async () => { await draft.save(); setNotice('草稿已保存在本机，下次可以接着写。'); }); }} /></>}
    </Card>
    <Button label="学习记忆与本人讲解偏好" secondary disabled={locked || draft.saving || !!summary} onPress={() => { void run('save', async () => { await draft.save(); router.push('/memory'); }); }} />
    <Card style={ls.section}><Badge>真人帮助 · 先整理难点</Badge><Text style={styles.sectionTitle}>手工整理一份求助摘要</Text><Text style={styles.body}>写下希望真人帮忙的具体步骤。只保存下方预览的题目和摘要，不自动附加私人对话。</Text><TextInput accessibilityLabel="手工填写求助摘要" value={summary} onChangeText={text => { if (lock.current || pendingRef.current || pendingSummaryRef.current) return; setSummary(text); setSummaryPreview(null); setPreview(null); }} editable={!locked} multiline maxLength={2000} style={[ls.input, ls.textArea]} placeholder="例如：我会列式，但还不理解为什么要检验余数…" placeholderTextColor="#87937D" />{draft.deleted && !!summary && <><Text style={styles.caption}>来源会话已删除，以下未保存摘要仅供复制：</Text><Text selectable style={styles.body}>{summary}</Text></>}<Text style={styles.caption}>摘要草稿暂留本页。当前没有教师收件服务，保存也不代表已经发送或有人收到。</Text><Button label="预览题目与摘要" secondary disabled={locked || !summary.trim()} onPress={() => setSummaryPreview({ topic: hasQuestion ? `题目 v${context.questionVersion}：${context.questionText}`.slice(0, 120) : '我的学习问题', summary: summary.trim(), requestId: `help:${initialThread.id}:${state?.revision}` })} />
      {summaryPreview && <View style={ls.section}><View style={ls.rule} /><Text style={styles.sectionTitle}>本机保存预览</Text><Text style={styles.body}>{summaryPreview.topic}</Text>{hasQuestion && <><Text style={styles.body}>{context.questionText}</Text><Text style={styles.caption}>题目 v{context.questionVersion} · {context.source === 'paper' ? '原试卷来源' : '题库来源'}会随摘要保留。</Text></>}<Text selectable style={styles.body}>{summaryPreview.summary}</Text><Text style={styles.caption}>接收状态：尚未发送。仅包含以上题目及来源和摘要，没有整段对话、图片或其他学习记录。</Text><Button label={operation === 'summary' ? '正在保存摘要…' : pendingSummary ? '重试保存这份摘要（不会重复）' : '确认只把这份摘要保存到本机'} disabled={!!operation || !!pendingSend || draft.deleted || draft.conflicts.length > 0} onPress={() => { void saveSummary(); }} /></View>}
      {!!summary && <Button label="取消这份未保存的摘要" secondary disabled={!!operation || !!pendingSummary} onPress={() => Alert.alert('取消本页摘要草稿？', '这只清除当前未保存的摘要，私人对话和已保存摘要都保留。', [{ text: '继续整理', style: 'cancel' }, { text: '确认取消', onPress: () => { setSummary(''); setSummaryPreview(null); } }])} />}
    </Card>
    {!!state?.helpRequests.length && <Card style={ls.section}><Text style={styles.sectionTitle}>本人最近保存的求助摘要</Text>{state.helpRequests.slice(0, 5).map(item => <View key={item.id} style={ls.section}><Badge>{item.delivery === 'local-only' ? '仅本机保存 · 尚未发送' : '保留的历史摘要 · 收件状态需核实'}</Badge><Text style={styles.body}>{item.topic}</Text><Text selectable style={styles.body}>{item.summary}</Text>{item.context && (item.context.source === 'paper' || item.context.source === 'bank') && <Text style={styles.caption}>固定题目 v{item.context.questionVersion} · {item.context.source === 'paper' ? '原卷来源保留' : '题库来源保留'}</Text>}<Text style={styles.caption}>{fullDateTime(item.createdAt)}</Text></View>)}</Card>}
    {!draft.deleted && <Button label="查看删除这段对话的影响" secondary disabled={locked || draft.saving || !!summary} onPress={() => { void showDelete(); }} />}
    {preview && <Card style={ls.section}><Text style={styles.sectionTitle}>确认删除前，请看清影响</Text><Text style={styles.body}>将删除本段 {preview.messageCount} 条文字记录{preview.hasDraft ? '及已保存草稿' : ''}，从当前档案中移除。应用内不提供恢复入口。</Text><Text style={styles.body}>实际使用过帮助的事实仍保留（{preview.retainedExposureCount} 条相关曝光记录），不会恢复为独立作答。原始答案、报告和讲解偏好不会删除。另行保存的 {preview.retainedHelpRequestCount} 份求助摘要也会保留；它们与私人对话分开管理。这不代表擦除了系统备份或存储介质上的历史数据。</Text>{preview.sourceRevision !== state?.revision && <Notice text="记录已有变化，请重新查看删除影响后确认。" />}<Button label="确认删除本段文字与草稿" secondary disabled={locked || !!summary || preview.sourceRevision !== state?.revision} onPress={() => { void deleteThread(); }} /><Button label="保留这段对话" secondary disabled={!!operation} onPress={() => setPreview(null)} /></Card>}
  </Screen>;
}
