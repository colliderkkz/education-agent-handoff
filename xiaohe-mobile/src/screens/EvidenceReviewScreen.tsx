import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { Alert, Text, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Badge, Button, Card } from '../components/ui';
import { errorMessage, helpNames, knowledgeNames, learningStyles as ls, LoadingPanel, Notice } from '../components/learning/LearnUI';
import { EvidenceSource } from '../components/learning/EvidenceSource';
import { EvidenceReviewForm } from '../components/learning/EvidenceReviewForm';
import { EvidenceImpact } from '../components/learning/EvidenceImpact';
import { createEvidenceInput, evidenceInputKey, evidenceInputPatch, findSavedDecision, findSavedProposal, inputFromProposal, validateEvidenceInput } from '../components/learning/evidenceReviewInput';
import { effectiveEvidence, effectiveHelpLabel, evidenceAuthorityLabel } from '../components/learning/evidenceView';
import { fullDateTime } from '../components/learning/reviewTime';
import { useLearning } from '../context/LearningContext';
import { historyLink, historyRequestWasDeleted, isDeletedEvidence } from '../features/history-deletion-ui';
import type { Evidence, EvidencePreview, EvidenceProposal, WorkspaceState } from '../local/types';
import { styles } from '../theme';

const back = () => router.canGoBack() ? router.back() : router.replace('/memory');
type PendingWrite = { kind: 'proposal' | 'decision'; requestId: string; payload: Record<string, unknown> };
const requestId = (kind: string, id: string) => `evidence-${kind}:${id}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

export default function EvidenceReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, error, reload } = useLearning();
  const found = state?.evidence.find(item => item.id === id);
  const [cached, setCached] = useState(found);
  if (found && found !== cached) setCached(found);
  if (!state) return <Screen title="核对作答证据" onBack={back}><LoadingPanel error={error} retry={() => { void reload().catch(() => {}); }} /></Screen>;
  const original = found || (cached?.id === id ? cached : undefined);
  if (!original && isDeletedEvidence(state, id)) return <Screen title="作答证据已删除" onBack={back}><Notice text="这条作答及关联更正记录已经删除，不能继续核对或恢复。教学题目和空白原卷仍保留。" /><Button label="管理其他历史作答" secondary onPress={() => router.push(historyLink())} /></Screen>;
  if (!original) return <Screen title="核对作答证据" onBack={back}><Notice text="暂时没有读到这条原始证据，请重读后再试。已有记录不会因此清除。" /><Button label="重读本机记录" secondary onPress={() => { void reload().catch(() => {}); }} /></Screen>;
  return <EvidenceReview key={original.id} original={original} initialState={state} />;
}

function EvidenceReview({ original, initialState }: { original: Evidence; initialState: WorkspaceState }) {
  const { state: liveState, act, reload, busy } = useLearning();
  const state = liveState || initialState;
  const current = effectiveEvidence(state).find(item => item.id === original.id);
  const removed = isDeletedEvidence(state, original.id);
  const [input, setInput] = useState(() => createEvidenceInput(current || original));
  const [savedKey, setSavedKey] = useState(() => evidenceInputKey(createEvidenceInput(current || original)));
  const [sourceRevision, setSourceRevision] = useState(state.revision);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<EvidencePreview | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const pendingRef = useRef<PendingWrite | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const lock = useRef(false);
  const [failure, setFailure] = useState(''), [notice, setNotice] = useState('');
  const [leaving, setLeaving] = useState(false);
  const removalHandled = useRef(false);
  const proposals = (state.evidenceReviews?.proposals || []).filter(item => item.evidenceId === original.id).slice().reverse();
  const decisions = state.evidenceReviews?.decisions || [];
  const selected = proposals.find(item => item.id === selectedId);
  const dirty = evidenceInputKey(input) !== savedKey;
  const unsavedDecision = Object.entries(decisionReasons).some(([proposalId, reason]) => !decisions.some(item => item.proposalId === proposalId) && reason !== proposals.find(item => item.id === proposalId)?.reason);
  const stale = sourceRevision !== state.revision;
  const locked = !!operation || busy || !!pending || removed;
  useEffect(() => {
    if (!removed || removalHandled.current) return;
    removalHandled.current = true;
    void Promise.resolve().then(() => {
      const write = pendingRef.current;
      if (write && historyRequestWasDeleted(state, write.requestId)) { setInput(createEvidenceInput({ ...original, answer: '' })); setSavedKey(evidenceInputKey(createEvidenceInput({ ...original, answer: '' }))); }
      if (write?.kind === 'decision' && historyRequestWasDeleted(state, write.requestId)) setDecisionReasons(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== write.payload.proposalId)));
      pendingRef.current = null; setPending(null); setPreview(null); setDecisionReason('');
    });
  }, [removed, state, original]);
  usePreventRemove((!!operation || (!removed && !!pending) || dirty || unsavedDecision) && !leaving, ({ repeat }) => {
    if (removed && !lock.current) { Alert.alert('原作答已经删除', '只有尚未保存的页面输入可供复制，不能写回。离开会放弃这些未保存输入。', [{ text: '留下复制', style: 'cancel' }, { text: '离开页面', onPress: () => { setLeaving(true); repeat(); } }]); return; }
    if (lock.current || pendingRef.current) { Alert.alert('请先确认本次保存结果', '正在写入或保存结果尚不明确。请重读记录，当前输入会保留。'); return; }
    Alert.alert('这份申请尚未保存', '已保存的申请会在重启后保留。当前页面修改尚未保存，可以留下核对，或明确放弃这次输入。', [{ text: '留下保存', style: 'cancel' }, { text: '放弃未保存输入', style: 'destructive', onPress: () => { setLeaving(true); repeat(); } }]);
  });
  const run = async (name: string, task: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setOperation(name); setFailure(''); setNotice('');
    try { await task(); } catch (cause) { setFailure(errorMessage(cause)); }
    finally { lock.current = false; setOperation(null); }
  };
  const setPendingWrite = (write: PendingWrite | null) => { pendingRef.current = write; setPending(write); };
  const claim = (snapshot: WorkspaceState, write: PendingWrite): boolean => {
    if (write.kind === 'proposal') {
      const saved = findSavedProposal(snapshot.evidenceReviews?.proposals || [], original.id, write.requestId, snapshot.actor.id);
      if (!saved) return false;
      setSelectedId(saved.id); setDecisionReason(saved.reason); setSavedKey(evidenceInputKey(inputFromProposal(saved, original))); setInput(inputFromProposal(saved, original)); setEditing(false);
      setNotice('申请已保存在本机，尚未改变结果。可以稍后回来核对影响。');
    } else {
      const saved = findSavedDecision(snapshot.evidenceReviews?.decisions || [], original.id, write.requestId, snapshot.actor.id);
      if (!saved) return false;
      setDecisionReasons(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== saved.proposalId)));
      setPreview(null); setNotice(saved.outcome === 'accept' ? '本机核对已保存。当前报告使用有效结果，原始提交和旧评定仍保留。此决定未经教师复核。' : '已保存不采用这份申请的决定，原始记录和申请仍保留。');
    }
    setSourceRevision(snapshot.revision); setPendingWrite(null); return true;
  };
  const sendWrite = async (write: PendingWrite) => {
    if (removed) throw new Error('原作答已删除，不能重新保存关联申请或决定。');
    setPendingWrite(write);
    const result = await act(write.kind === 'proposal' ? 'evidence.propose' : 'local.evidence.confirm', write.payload);
    if (!claim(result.state, write)) throw new Error('保存回复尚未找到对应记录，请先重读本机记录。输入和申请仍保留。');
  };
  const saveProposal = () => run('save', async () => {
    if (pendingRef.current) { await sendWrite(pendingRef.current); return; }
    const issue = validateEvidenceInput(input); if (issue) throw new Error(issue);
    if (stale) throw new Error('本机记录发生变化，请重读并保留当前输入，再核对保存。');
    const key = requestId('proposal', original.id);
    await sendWrite({ kind: 'proposal', requestId: key, payload: { evidenceId: original.id, patch: evidenceInputPatch(input), reason: input.reason.trim(), uploadIds: [...input.uploadIds], sourceRevision, requestId: key } });
  });
  const recover = () => run('reload', async () => {
    const latest = await reload(); setPreview(null);
    const write = pendingRef.current;
    if (write && claim(latest, write)) return;
    // A successful authoritative reload without this id proves that this request was not persisted.
    setPendingWrite(null); setSourceRevision(latest.revision);
    setNotice('已重读本机记录，当前输入和所选申请都保留。请重新核对影响后再确认。');
  });
  const showPreview = (proposal: EvidenceProposal, outcome: 'accept' | 'reject') => run('preview', async () => {
    if (pendingRef.current || dirty) throw new Error('请先保存或取消当前未保存输入。');
    setSelectedId(proposal.id); setPreview(null); setDecisionReason(decisionReasons[proposal.id] ?? proposal.reason);
    const result = await act('evidence.preview', { proposalId: proposal.id, outcome });
    const next = result.result?.preview as EvidencePreview | undefined;
    if (!next || next.proposalId !== proposal.id) throw new Error('未取得完整影响预览，请重读后再试。');
    setPreview(next);
  });
  const confirm = () => run('confirm', async () => {
    if (pendingRef.current) { await sendWrite(pendingRef.current); return; }
    if (!preview || preview.sourceRevision !== state.revision) throw new Error('这份影响预览已经过期，请重新预览。');
    if (!decisionReason.trim()) throw new Error('请保留或填写本次核对决定的原因。');
    const key = requestId('decision', preview.proposalId);
    await sendWrite({ kind: 'decision', requestId: key, payload: { proposalId: preview.proposalId, outcome: preview.outcome, sourceRevision: preview.sourceRevision, digest: preview.digest, reason: decisionReason.trim(), requestId: key } });
  });
  const startInput = (proposal?: EvidenceProposal) => {
    if (lock.current || pendingRef.current) return;
    const next = proposal ? inputFromProposal(proposal, original) : createEvidenceInput(current || original);
    setInput(next); setSavedKey(evidenceInputKey(createEvidenceInput(current || original))); setSourceRevision(state.revision); setEditing(true); setPreview(null); setSelectedId(null); setFailure(''); setNotice('');
  };
  if (removed) {
    const saved = JSON.parse(savedKey) as { patch: { answer?: string }; reason: string };
    const persisted = !!pending && historyRequestWasDeleted(state, pending.requestId);
    const retainedAnswer = !persisted && input.changeAnswer && input.answer !== saved.patch.answer ? input.answer : '';
    const retainedReason = !persisted && input.reason.trim() !== saved.reason ? input.reason : '';
    return <Screen title="作答证据已删除" onBack={back}><Notice text="这条原作答及关联更正记录已经删除。已保存的旧内容不再展示；未保存的输入仅供复制，不能重新写入。" />{!!retainedAnswer && <><Text style={ls.label}>尚未保存的答案输入</Text><Text selectable style={styles.body}>{retainedAnswer}</Text></>}{!!retainedReason && <><Text style={ls.label}>尚未保存的原因</Text><Text selectable style={styles.body}>{retainedReason}</Text></>}{!persisted && Object.entries(decisionReasons).map(([id, text]) => <View key={id}><Text style={ls.label}>尚未保存的核对说明</Text><Text selectable style={styles.body}>{text}</Text></View>)}<Button label="查看保留的原卷报告" secondary onPress={() => router.push({ pathname: '/report/[id]', params: { id: original.paperId } })} /></Screen>;
  }
  return <Screen title="核对作答证据" onBack={back}>
    <View><Text style={styles.eyebrow}>留住原记录 · 说明更正依据</Text><Text style={styles.title}>把记录，{ '\n' }核对清楚。</Text><Text style={styles.subtitle}>本人申请与教师复核分开。本机没有在线复核服务，申请不会发送给老师。</Text></View>
    <EvidenceSource evidence={original} state={state} />
    <Button label="查看删除这条历史作答的影响" secondary disabled={locked || dirty || unsavedDecision} onPress={() => router.push(historyLink({ evidenceId: original.id }))} />
    {current && <Card style={ls.section}><Badge>{evidenceAuthorityLabel(current.authority)}</Badge><Text style={styles.sectionTitle}>当前有效结果</Text><Text selectable style={styles.body}>答案：{current.answer || '未填写'}</Text><Text style={styles.body}>{current.valid ? current.correct ? '回答正确' : '未答对' : '已标记无效，不纳入当前统计'} · {effectiveHelpLabel(current)}</Text><Text style={styles.caption}>{knowledgeNames[current.knowledgeId]}{current.masteryBlockedReason ? ` · ${current.masteryBlockedReason}` : ''}</Text><Button label="查看这份试卷的当前报告" secondary disabled={locked || dirty} onPress={() => router.push({ pathname: '/report/[id]', params: { id: original.attemptId } })} /></Card>}
    {!!failure && <Notice text={failure} error />}{!!notice && <Notice text={notice} />}
    {!!pending && <Notice text="本次保存结果尚未确认，输入已锁定以防重试串到另一份内容。请重读认领已保存记录，或原样重试；不会重复创建。" />}
    <Button label={operation === 'reload' ? '正在重读…' : '重读本机记录，保留当前输入'} secondary disabled={!!operation || busy} onPress={() => { void recover(); }} />
    {pending && <Button label="原样重试本次保存" disabled={!!operation || busy} onPress={() => { void run('retry', () => sendWrite(pending)); }} />}
    {!editing && <Button label="填写新的更正申请" disabled={locked} onPress={() => startInput()} />}
    {editing && <><EvidenceReviewForm input={input} state={state} disabled={locked} onChange={next => { if (!lock.current && !pendingRef.current) { setInput(next); setPreview(null); } }} />{stale && <Notice text="本机记录已有变化。请先重读，当前输入会保留，之后才能保存申请。" />}<Text style={styles.caption}>填写中内容尚未持久化；点击“保存申请”后，下次打开可以继续核对。</Text><Button label={operation === 'save' ? '正在保存申请…' : '保存本人更正申请'} disabled={locked || stale || !!validateEvidenceInput(input)} onPress={() => { void saveProposal(); }} /><Button label="取消这次未保存输入" secondary disabled={locked} onPress={() => Alert.alert('取消这次输入？', '已保存的申请、决定和原始作答会保留。仅放弃当前页面未保存的字段。', [{ text: '继续填写', style: 'cancel' }, { text: '取消输入', onPress: () => { const next = createEvidenceInput(current || original); setInput(next); setSavedKey(evidenceInputKey(next)); setEditing(false); } }])} /></>}
    {preview && selected && <><EvidenceImpact preview={preview} /><Text style={ls.label}>本次核对决定的原因</Text><TextInput accessibilityLabel="本机核对决定原因" style={[ls.input, ls.textArea]} value={decisionReason} onChangeText={value => { if (!lock.current && !pendingRef.current) { setDecisionReason(value); setDecisionReasons(previous => ({ ...previous, [preview.proposalId]: value })); } }} editable={!locked} multiline maxLength={1000} />{preview.sourceRevision !== state.revision && <Notice text="记录已经变化，这份预览不可确认。请重新查看这份申请的影响。" />}<Button label={operation === 'confirm' ? '正在保存决定…' : preview.outcome === 'accept' ? '确认应用本机核对（未经教师复核）' : '确认不采用这份申请'} disabled={locked || preview.sourceRevision !== state.revision || !decisionReason.trim()} onPress={() => { void confirm(); }} /></>}
    <View style={ls.section}><Text style={styles.sectionTitle}>申请与核对历史 · {proposals.length} 份</Text><Text style={styles.caption}>申请保存后不会自动改变结果。每份申请只决定一次；需要补充时另建申请，旧记录仍可回看。</Text>
      {proposals.map(proposal => { const decision = decisions.find(item => item.proposalId === proposal.id); return <Card key={proposal.id} style={ls.section}><Badge>{decision ? decision.outcome === 'accept' ? '已采用 · 本机核对' : '未采用 · 原结果保留' : '已保存 · 待核对影响'}</Badge><Text style={styles.caption}>{fullDateTime(proposal.createdAt)} · {proposal.delivery === 'local-only' ? '只在本机，尚未发送' : '已保存的空间申请'}</Text><Text selectable style={styles.body}>{proposal.reason}</Text>{proposal.patch.answer !== undefined && <Text selectable style={styles.body}>申请原答案改为：{proposal.patch.answer || '未填写'}</Text>}{proposal.patch.help && <Text style={styles.body}>申请帮助标记：{proposal.patch.help === 'independent' ? '本人称独立（未核实）' : helpNames[proposal.patch.help]}</Text>}{proposal.patch.knowledgeId && <Text style={styles.body}>申请知识点：{knowledgeNames[proposal.patch.knowledgeId]}</Text>}{proposal.patch.invalidated !== undefined && <Text style={styles.body}>申请{proposal.patch.invalidated ? '标记无效' : '恢复有效'}</Text>}<Text style={styles.caption}>关联 {proposal.uploadIds.length} 张原稿</Text>
        {decision ? <><Text style={ls.label}>{evidenceAuthorityLabel(decision.authority)} · {fullDateTime(decision.createdAt)}</Text><Text selectable style={styles.body}>决定原因：{decision.reason}</Text><Button label="以这份内容另填新申请" secondary disabled={locked || dirty} onPress={() => startInput(proposal)} /></> : <><Button label="查看采用后的影响" disabled={locked || dirty} onPress={() => { void showPreview(proposal, 'accept'); }} /><Button label="查看不采用的影响" secondary disabled={locked || dirty} onPress={() => { void showPreview(proposal, 'reject'); }} /></>}
      </Card>; })}
      {!proposals.length && <Text style={styles.body}>这条证据还没有更正申请。原始记录始终保留。</Text>}
    </View>
  </Screen>;
}
