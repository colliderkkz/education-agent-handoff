import { useRef, useState } from 'react';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { Alert, Image, Pressable, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Badge, Button, Card } from '../components/ui';
import { errorMessage, helpNames, knowledgeNames, learningStyles as ls, LoadingPanel, Notice } from '../components/learning/LearnUI';
import { fullDateTime } from '../components/learning/reviewTime';
import { useLearning } from '../context/LearningContext';
import { findHistoryOperation, historyCandidates, historyConfirmPayload, historyPreviewCurrent, historySelection, initialHistorySelection } from '../features/history-deletion-ui';
import { localPhotoUri } from '../features/local-photo';
import type { HistoryDeletionOperation, HistoryDeletionPreview, WorkspaceState } from '../local/types';
import { colors, styles } from '../theme';

const back = () => router.canGoBack() ? router.back() : router.replace('/memory');
type PendingDeletion = { requestId: string; payload: ReturnType<typeof historyConfirmPayload> };
function Check({ label, checked, disabled, onPress }: { label: string; checked: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ minHeight: 48, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primaryLight : colors.surface, opacity: disabled ? .55 : 1 }}><Text style={styles.body}>{checked ? '已选择 · ' : '选择 · '}{label}</Text></Pressable>;
}

export default function HistoryDeletionScreen() {
  const params = useLocalSearchParams<{ evidenceId?: string; paperId?: string }>();
  const { state, error, reload } = useLearning();
  if (!state) return <Screen title="管理历史作答" onBack={back}><LoadingPanel error={error} retry={() => { void reload().catch(() => {}); }} /></Screen>;
  return <HistoryDeletion initialState={state} evidenceId={params.evidenceId} paperId={params.paperId} />;
}

function HistoryDeletion({ initialState, evidenceId, paperId }: { initialState: WorkspaceState; evidenceId?: string; paperId?: string }) {
  const { state: live, act, reload, busy } = useLearning();
  const state = live || initialState;
  const [selection, setSelection] = useState(() => initialHistorySelection(initialState, evidenceId, paperId));
  const [preview, setPreview] = useState<HistoryDeletionPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState<PendingDeletion | null>(null);
  const pendingRef = useRef<PendingDeletion | null>(null);
  const lock = useRef(false);
  const [operation, setOperation] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const rows = historyCandidates(state);
  const selected = new Set(selection.evidenceIds);
  const current = historyPreviewCurrent(preview, selection, state.revision);
  const locked = !!operation || busy || !!pending;
  const receipt = state.historyDeletion?.operations.find(item => item.id === receiptId && item.actorId === state.actor.id);
  usePreventRemove(!!operation || !!pending, () => { Alert.alert('请先确认本次操作结果', '正在保存或删除结果尚未确认。请在本页重读，确认结果后再离开。'); });

  const run = async (name: string, task: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setOperation(name); setError(''); setNotice('');
    try { await task(); } catch (cause) { setError(errorMessage(cause)); }
    finally { lock.current = false; setOperation(''); }
  };
  const claim = (snapshot: WorkspaceState, requestId: string) => {
    const saved = findHistoryOperation(snapshot, requestId);
    if (!saved) return false;
    pendingRef.current = null; setPending(null); setPreview(null); setAcknowledged(false);
    setSelection(historySelection([])); setReceiptId(saved.id);
    setNotice('所选作答已从当前学习档案删除。下方分别显示关联记录和本机照片的处理结果。');
    return true;
  };
  const send = async (request: PendingDeletion) => {
    pendingRef.current = request; setPending(request);
    const result = await act('history.delete.confirm', request.payload);
    if (!claim(result.state, request.requestId)) throw new Error('尚未确认这次删除结果。请先重读本机记录，或原样重试本次请求。');
  };
  const refresh = () => run('reload', async () => {
    const latest = await reload();
    const request = pendingRef.current;
    if (request && claim(latest, request.requestId)) return;
    pendingRef.current = null; setPending(null); setPreview(null); setAcknowledged(false);
    const existing = new Set(historyCandidates(latest).map(item => item.id));
    const retained = selection.evidenceIds.filter(id => existing.has(id));
    setSelection(historySelection(retained, selection.uploadIds.filter(id => latest.uploads.some(item => item.id === id))));
    setNotice(retained.length !== selection.evidenceIds.length ? '已重读。部分所选作答已被删除，剩余选择保留，请重新查看影响。' : '已重读，当前选择保留。请重新预览后再确认删除。');
  });
  const inspect = () => run('preview', async () => {
    if (pendingRef.current) return;
    if (!selection.evidenceIds.length) throw new Error('先选择至少一条已提交作答。');
    const result = await act('history.delete.preview', { ...historySelection(selection.evidenceIds, selection.uploadIds) });
    const impact = result.result?.preview as HistoryDeletionPreview | undefined;
    if (!impact?.digest || !Array.isArray(impact.photos) || !Array.isArray(impact.reports)) throw new Error('没有取得完整删除影响，请重读后重试。');
    setPreview(impact); setSelection(historySelection(impact.selection.evidenceIds, impact.selection.uploadIds)); setAcknowledged(false); setReceiptId(null);
  });
  const confirm = () => run('confirm', async () => {
    if (pendingRef.current) { await send(pendingRef.current); return; }
    const requestId = `history-delete:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;
    const payload = historyConfirmPayload(preview, selection, state.revision, requestId, acknowledged);
    await send({ requestId, payload });
  });
  const toggle = (id: string) => {
    if (lock.current || pendingRef.current) return;
    setSelection(historySelection(selected.has(id) ? selection.evidenceIds.filter(value => value !== id) : [...selection.evidenceIds, id]));
    setPreview(null); setAcknowledged(false); setReceiptId(null);
  };
  return <Screen title="管理历史作答" onBack={back}>
    <View><Text style={styles.eyebrow}>本人本机管理 · 删除前看清影响</Text><Text style={styles.title}>由你决定，{ '\n' }留下哪些记录。</Text><Text style={styles.subtitle}>逐条选择已提交作答。查看报告和关联内容的变化后，再确认删除。</Text></View>
    <Notice text="删除会移除所选原答案、思考过程及关联个人记录，不能从应用恢复。教学题目、空白原卷与题面/解析 PDF 会保留，未选作答继续保留。删除不同于错题订正或标记无效。" />
    {!!error && <Notice text={error} error />}{!!notice && <Notice text={notice} />}
    {pending && <Notice text="这次删除结果尚待确认，当前选择已锁定。请重读认领已完成的操作，或原样重试；不会重复删除其他记录。" />}
    <Button label={operation === 'reload' ? '正在重读…' : '重读本机记录，保留选择'} secondary disabled={!!operation || busy} onPress={() => { void refresh(); }} />
    {pending && <Button label="原样重试这次删除" secondary disabled={!!operation || busy} onPress={() => { void run('retry', () => send(pending)); }} />}
    {receipt && <DeletionReceipt receipt={receipt} state={state} locked={locked} retry={() => { void run('files', async () => { await act('history.files.retry'); setNotice('已重新检查本机照片清理结果。'); }); }} />}
    {!receipt && <>
      <Card style={ls.section}><Text style={styles.sectionTitle}>1 · 选择已提交作答</Text><Text style={styles.body}>已选择 {selection.evidenceIds.length} / {rows.length} 条。照片需要在影响预览中另外选择。</Text><Button label={rows.length > 0 && selected.size === rows.length ? '取消全选' : `全选当前 ${rows.length} 条作答`} secondary disabled={locked || !rows.length} onPress={() => { if (lock.current || pendingRef.current) return; setSelection(historySelection(selected.size === rows.length ? [] : rows.map(item => item.id))); setPreview(null); setAcknowledged(false); }} /></Card>
      {(showAll ? rows : [...rows.filter(item => selected.has(item.id)), ...rows.filter(item => !selected.has(item.id))].slice(0, Math.max(12, selected.size))).map(item => { const paper = state.papers.find(record => record.id === item.paperId); const number = paper?.questionIds.indexOf(item.questionId); return <Card key={item.id} style={ls.section}><Check label={`${paper?.title || '原始作答'} · 第 ${(number ?? -1) + 1} 题`} checked={selected.has(item.id)} disabled={locked} onPress={() => toggle(item.id)} /><Text style={styles.body}>{item.questionText}</Text><Text selectable style={styles.body}>原始答案：{item.answer || '未填写'}</Text><Text style={styles.caption}>{knowledgeNames[item.knowledgeId]} · {helpNames[item.help]} · {fullDateTime(item.createdAt)} · 题目 v{item.questionVersion}</Text></Card>; })}
      {!rows.length && <Notice text="当前没有可选择的已提交作答。未完成草稿不会出现在本页，也不会被这次管理操作删除。" />}
      {rows.length > 12 && <Button label={showAll ? '收起较早作答' : `显示全部 ${rows.length} 条作答`} secondary disabled={locked} onPress={() => setShowAll(!showAll)} />}
      <Button label={operation === 'preview' ? '正在核对关联记录…' : preview ? '重新预览所选记录的影响' : '查看删除影响'} disabled={locked || !selection.evidenceIds.length} onPress={() => { void inspect(); }} />
    </>}
    {preview && <>
      <Card style={ls.section}><Text style={styles.sectionTitle}>2 · 这次会改变什么</Text><Text style={styles.body}>删除 {preview.evidenceCount} 条作答、{preview.mistakeCount} 条关联错题，以及 {preview.proposalCount} 份更正申请和 {preview.decisionCount} 份核对决定。</Text>{preview.reports.map(report => <View key={report.attemptId} style={ls.section}><Text style={ls.label}>{state.papers.find(item => item.id === report.paperId)?.title || '来源报告'}</Text><Text style={styles.body}>移除 {report.selectedCount} 条作答，保留 {report.remainingCount} 条。当前答对数由 {report.beforeCorrect} 变为 {report.afterCorrect}；所选题不再计入报告分母，提交时间与已提交状态保留。</Text></View>)}<Text style={styles.body}>清除本人关联题目会话 {preview.threadCount} 段、文字 {preview.messageCount} 条、已存草稿 {preview.draftCount} 份；同时删除 {preview.helpRequestCount} 份关联求助摘要{preview.sharedHelpRequestCount ? `（其中 ${preview.sharedHelpRequestCount} 份曾在空间共享）` : ''}。</Text>{preview.retainedOtherThreadCount > 0 && <Text style={styles.caption}>其他人的 {preview.retainedOtherThreadCount} 段私人会话不在本人删除范围内，本页不显示其内容。</Text>}<Text style={styles.body}>同时清除 {preview.auditEventCount} 条可能包含所选内容的操作记录、{preview.rulePreviewCount} 份相关规则评定预览。</Text><Text style={styles.body}>涉及 {preview.assessmentCount} 条历史评定：原有含证据的评定正文将移除，保留无答案的删除说明；当前知识点将按剩余证据重新评定。</Text>{preview.knowledge.map(item => <View key={item.knowledgeId}><Text style={ls.label}>{knowledgeNames[item.knowledgeId]}：{item.beforeStars === null ? '待评估' : `${item.beforeStars} 星`} → {item.afterStars === null ? '待评估' : `${item.afterStars} 星`}</Text><Text style={styles.caption}>{item.reason}</Text></View>)}{preview.reviewPlans.map(item => <Text key={item.planId} style={styles.body}>{knowledgeNames[item.knowledgeId]}复查计划：{item.sourceWillBeUnavailable ? '来源将不足，尚未开始的计划将不能开始；已有复查卷保留' : '仍有来源记录，保留计划'}。</Text>)}</Card>
      <Card style={ls.section}><Text style={styles.sectionTitle}>本机原稿照片 · 另行选择</Text><Text style={styles.caption}>列表包含本机已登记照片，不自动认定它属于所选题目，请自行对照选择。只有主动勾选且没有其他保留记录引用的应用内副本才会删除。共享原稿可能仍包含这道题的答案，请查看保留原因；手机相册原件不会删除。</Text>{preview.photos.map(photo => { const upload = state.uploads.find(item => item.id === photo.uploadId); const checked = selection.uploadIds.includes(photo.uploadId); return <View key={photo.uploadId} style={ls.section}>{upload && <Image accessibilityLabel={`本机原稿：${photo.name}`} source={{ uri: localPhotoUri(upload.url) }} resizeMode="contain" style={{ height: 160, width: '100%', borderRadius: 10, backgroundColor: colors.background }} />}<Check label={`申请同时删除本机照片：${photo.name}`} checked={checked} disabled={locked} onPress={() => { if (lock.current || pendingRef.current) return; setSelection(historySelection(selection.evidenceIds, checked ? selection.uploadIds.filter(id => id !== photo.uploadId) : [...selection.uploadIds, photo.uploadId])); setAcknowledged(false); }} /><Text style={styles.body}>{!current ? '照片选择或记录已变化，请重新预览确认处理结果。' : !checked ? '未选择，照片会保留。' : photo.retainedReferenceCount > 0 ? `仍有 ${photo.retainedReferenceCount} 处保留引用；本次将保留这张照片。` : photo.willDelete ? '本次将删除应用内照片副本。' : '本次将保留这张照片，请查看下方原因。'}</Text>{current && <Text style={styles.caption}>{photo.reason}</Text>}</View>; })}{!preview.photos.length && <Text style={styles.body}>本机没有已登记照片。</Text>}</Card>
      {preview.warnings.map((warning, index) => <Notice key={index} text={warning} />)}
      <Notice text="教学题目、空白原卷和已有题面/解析 PDF 不含本次原答案，将继续保留。已经看到题目、使用过帮助的最少事实仍会保留，删除不会把旧题恢复为独立新题。应用无法删除已分享的外部副本、系统备份或保证存储介质的历史数据被擦除。" />
      {!current && <Notice text="记录或照片选择已有变化。这份预览不可确认，请重新预览；当前选择仍保留。" />}
      {!current && <Button label="重新核对本次删除影响" secondary disabled={locked} onPress={() => { void inspect(); }} />}
      <Card style={ls.section}><Text style={styles.sectionTitle}>3 · 确认删除</Text><Check label="我已核对报告变化、关联记录与照片保留范围，了解应用内无法恢复" checked={acknowledged} disabled={locked || !current} onPress={() => { if (!lock.current && !pendingRef.current) setAcknowledged(!acknowledged); }} /><Button label={operation === 'confirm' ? '正在删除所选作答…' : `确认删除这 ${preview.evidenceCount} 条历史作答`} disabled={locked || !current || !acknowledged} onPress={() => { void confirm(); }} /><Button label="返回选择，暂不删除" secondary disabled={locked} onPress={() => { setPreview(null); setAcknowledged(false); }} /></Card>
    </>}
    {receipt && <Button label="继续管理其他历史作答" secondary disabled={locked} onPress={() => { setReceiptId(null); setNotice(''); }} />}
    {!!state.historyDeletion?.operations.length && <Card style={ls.section}><Text style={styles.sectionTitle}>已完成的删除</Text><Text style={styles.caption}>这里只保存无作答正文的操作说明，可查看尚待清理的本机文件。</Text>{state.historyDeletion.operations.filter(item => item.actorId === state.actor.id).slice().reverse().map(item => <Button key={item.id} label={`${fullDateTime(item.createdAt)} · ${item.evidenceIds.length} 条作答`} secondary disabled={locked} onPress={() => { setReceiptId(item.id); setPreview(null); setAcknowledged(false); }} />)}</Card>}
  </Screen>;
}

function DeletionReceipt({ receipt, state, locked, retry }: { receipt: HistoryDeletionOperation; state: WorkspaceState; locked: boolean; retry: () => void }) {
  const files = state.historyDeletion?.fileTasks.filter(item => item.operationId === receipt.id) || [];
  const pending = files.filter(item => item.status === 'pending').length;
  return <Card style={ls.section}><Badge>历史作答已删除</Badge><Text style={styles.sectionTitle}>本次处理结果</Text><Text style={styles.body}>已删除 {receipt.evidenceIds.length} 条作答；关联 {receipt.deletedThreadIds.length} 段本人题目会话、{receipt.deletedHelpRequestIds.length} 份求助摘要、{receipt.removedProposalIds.length} 份更正申请、{receipt.removedDecisionIds.length} 份核对决定已清除。</Text><Text style={styles.body}>{receipt.redactedAssessmentIds.length} 条相关历史评定已移除正文，当前结果依据剩余作答更新。原卷和提交时间仍保留。</Text><Text style={styles.body}>本机照片：{files.length - pending} 张已完成清理{pending ? `，${pending} 张仍待清理` : ''}。未选择或仍有其他引用的照片保留。</Text>{pending > 0 && <><Notice text="学习记录已经删除，照片清理尚未全部完成。下次打开会继续处理，也可以现在重试；不会因此恢复已删除作答。" /><Button label="重试清理本机照片" secondary disabled={locked} onPress={retry} /></>}<Text style={styles.caption}>{fullDateTime(receipt.createdAt)} · 删除不可从应用恢复。这里不保存被删答案或对话正文。</Text></Card>;
}
