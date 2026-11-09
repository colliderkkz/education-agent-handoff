import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Image, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { Screen } from '../components/Screen';
import { Badge, Button, Card } from '../components/ui';
import { errorMessage, LoadingPanel, Notice } from '../components/learning/LearnUI';
import { useLearning } from '../context/LearningContext';
import { localPhotoUri } from '../features/local-photo';
import { getOcrAvailability } from '../features/native-ocr';
import { candidatePin, newRecognitionEditor, recognitionBody, recognitionEditor, recognitionReady, uncheckedRecognition, type RecognitionEditor } from '../features/recognition-review';
import type { RecognitionEntry, RecognitionMatch, RecognitionRun, WorkspaceState } from '../local/types';
import { colors, styles } from '../theme';

const identifier = () => `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
const back = () => router.canGoBack() ? router.back() : router.replace('/camera');
type Pending = { action: string; payload: Record<string, unknown>; requestId: string };
function Check({ label, checked, disabled, onPress }: { label: string; checked: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress} style={[s.check, checked && s.selected, disabled && { opacity: .6 }]}><Text style={styles.body}>{checked ? '✓ ' : '○ '}{label}</Text></Pressable>;
}

export default function PhotoRecognitionScreen() {
  const { uploadId } = useLocalSearchParams<{ uploadId: string }>();
  const { state, error, reload } = useLearning();
  if (!state) return <Screen title="识别与逐题核对" onBack={back}><LoadingPanel error={error} retry={() => { void reload().catch(() => {}); }} /></Screen>;
  return <RecognitionReview key={uploadId} initialState={state} uploadId={uploadId} />;
}

function RecognitionReview({ initialState, uploadId }: { initialState: WorkspaceState; uploadId: string }) {
  const { state: live, act, reload, busy } = useLearning();
  const state = live || initialState;
  const upload = state.uploads.find(item => item.id === uploadId);
  const capture = state.recognition?.captures.find(item => item.uploadId === uploadId);
  const runs = (state.recognition?.runs.filter(item => item.captureId === capture?.id) || []).reverse();
  const entries = state.recognition?.entries.filter(item => item.captureId === capture?.id) || [];
  const [runId, setRunId] = useState('');
  const run = runs.find(item => item.id === runId) || runs[0];
  const [lineIds, setLineIds] = useState<string[]>([]);
  const [editor, setEditor] = useState<RecognitionEditor | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const editorBase = useRef<RecognitionEditor | null>(null);
  const [matches, setMatches] = useState<{ text: string; candidates: RecognitionMatch[] } | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);
  const [acknowledgedRevision, setAcknowledgedRevision] = useState<number | null>(null);
  const [operation, setOperation] = useState(''), [failure, setFailure] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingAbsent, setPendingAbsent] = useState(false);
  const [reportId, setReportId] = useState('');
  const [sourceReady, setSourceReady] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null), [availabilityReason, setAvailabilityReason] = useState('');
  const lock = useRef(false);
  const savedEntry = entries.find(item => item.id === editor?.id);
  const dirty = !!editor && (!savedEntry || JSON.stringify(editor) !== JSON.stringify(recognitionEditor(savedEntry)));
  const bodyDirty = !!editor && (!savedEntry || recognitionBody(editor) !== recognitionBody(recognitionEditor(savedEntry)));
  const locked = busy || !!operation || !!pending;
  const redacted = !!capture?.redactedAt;
  const eligible = entries.filter(recognitionReady);
  const selected = eligible.filter(item => selectedEntries.includes(item.id));
  const candidates = matches && matches.text === editor?.stem ? matches.candidates : null;
  const pinnedSummary = editor?.candidate && savedEntry?.candidate?.contentDigest === editor.candidate.contentDigest ? savedEntry.candidateSummary : candidates?.find(item => item.contentDigest === editor?.candidate?.contentDigest);
  useEffect(() => {
    let active = true;
    getOcrAvailability().then(result => { if (active) { setAvailable(result.available); setAvailabilityReason(result.reason || ''); } }).catch(() => { if (active) { setAvailable(false); setAvailabilityReason('暂时无法检查设备识别能力，可以重新打开本页。'); } });
    return () => { active = false; };
  }, []);
  const hasPhoto = !!upload;
  const protectRemoval = hasPhoto && !redacted && (!!operation || !!pending || dirty);
  const showLeaveNotice = useCallback(() => {
    Alert.alert('先保存本页内容', pending ? '这次保存结果尚未确认，请重读或原样重试。' : operation || lock.current ? '操作仍在进行，请等待结果。' : '核对内容还没有保存。请先保存草稿，或点“放弃本页未保存修改”。');
  }, [operation, pending]);
  usePreventRemove(protectRemoval, showLeaveNotice);
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android') return;
    // A cold deep link can be the only route: no navigation removal event fires
    // before Android exits. Subscribe only while this screen is focused.
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!hasPhoto || redacted || (!protectRemoval && !lock.current)) return false;
      // Android normally consumes Back in the IME first. If it reaches JS while
      // the keyboard is still visible, only dismiss it; do not show a leave alert.
      if (Keyboard.isVisible()) { Keyboard.dismiss(); return true; }
      showLeaveNotice();
      return true;
    });
    return () => subscription.remove();
  }, [hasPhoto, redacted, protectRemoval, showLeaveNotice]));
  function adopt(snapshot: WorkspaceState, request: Pending) {
    const key = request.action === 'local.recognition.scan' ? `${request.requestId}:run` : request.requestId;
    const receipt = snapshot.recognition?.requests.find(item => item.requestId === key && item.ownerId === snapshot.actor.id);
    if (!receipt) return false;
    setPending(null); setPendingAbsent(false);
    if (receipt.status === 'deleted') { setEditor(null); setNotice('这次操作关联的识别内容已经删除，不会重新恢复。'); return true; }
    if (request.action === 'local.recognition.scan') {
      setRunId(receipt.resultId); setLineIds([]);
      const current = snapshot.recognition?.captures.find(item => item.id === receipt.captureId);
      // Scanning is allowed only while the editor is clean. Refresh that baseline
      // because this scan increments the same capture's optimistic revision.
      const saved = snapshot.recognition?.entries.find(item => item.id === editor?.id && item.status === 'draft');
      if (saved) { const next = recognitionEditor(saved); setEditor(next); editorBase.current = next; setEditorRevision(current?.revision || 0); }
      setNotice('机器文字已保存在本机。先选出同一道题的文字行，再对照原图核对。');
    }
    if (request.action === 'recognition.entry.save') {
      const item = snapshot.recognition?.entries.find(entry => entry.id === receipt.resultId);
      const current = snapshot.recognition?.captures.find(item => item.id === receipt.captureId);
      if (item) { const next = recognitionEditor(item); setEditor(next); editorBase.current = next; setEditorRevision(current?.revision || 0); }
      setNotice(item && recognitionReady(item) ? '这道题已核对，可以在下方选择入档。' : '草稿已保存；请逐项核对题干、原始答案、同题关系与单位。');
    }
    if (request.action === 'recognition.submit') { setReportId(receipt.resultId); setEditor(null); setSelectedEntries([]); setAcknowledgedRevision(null); setNotice('选中的核对题已入档，其余草稿仍保留。纸面作答的独立程度未核实。'); }
    return true;
  }
  async function task(name: string, fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setOperation(name); setFailure(''); setNotice('');
    try { await fn(); } catch (cause) { setFailure(errorMessage(cause)); }
    finally { lock.current = false; setOperation(''); }
  }
  async function send(request: Pending) {
    setPending(request); setPendingAbsent(false);
    const result = await act(request.action, request.payload);
    if (!adopt(result.state, request)) throw new Error('保存结果还未核实，请重读本机记录后再继续。');
  }
  function mutate(action: string, payload: Record<string, unknown>) {
    const requestId = identifier();
    void task(action, () => send({ action, requestId, payload: { ...payload, requestId } }));
  }
  function openEditor(entry: RecognitionEntry) { const next = recognitionEditor(entry); setEditor(next); editorBase.current = next; setEditorRevision(capture?.revision || 0); setMatches(null); }
  function change(patch: Partial<RecognitionEditor>) {
    if (lock.current || locked || redacted) return;
    setEditor(current => current ? { ...current, ...patch, checked: uncheckedRecognition() } : current);
    setAcknowledgedRevision(null);
  }
  function saveEditor() {
    if (!capture || !editor || redacted) return;
    mutate('recognition.entry.save', { captureId: capture.id, expectedRevision: editorRevision, entryId: editor.id, runId: editor.runId, sourceLineIds: editor.sourceLineIds, originalNumber: editor.originalNumber, stem: editor.stem, answer: editor.answer, working: editor.working, candidate: editor.candidate, checked: editor.checked });
  }
  if (!upload) return <Screen title="识别与逐题核对" onBack={back}><Notice text="这张应用内照片已删除或无法找到。识别不会运行，旧页面不会恢复已删除材料。" /><Button label="返回拍照" onPress={() => router.replace('/camera')} /></Screen>;
  return <Screen title="识别与逐题核对" onBack={back}>
    <View><Badge>设备识别 · 本机保存</Badge><Text style={[styles.title, { marginTop: 12 }]}>先看清，再确认。</Text><Text style={styles.subtitle}>图片识别可能漏字或看错数字。逐题对照原图，确认后才进入作业报告。</Text></View>
    {!!failure && <Notice text={failure} error />}{!!notice && <Notice text={notice} />}
    {editor && savedEntry?.status === 'submitted' && dirty && !redacted && <Card style={s.section}><Text style={styles.sectionTitle}>这道题已经入档</Text><Text style={styles.body}>本页尚未保存的修改不会覆盖已提交记录。可以先复制下面的文字，再放弃本页修改并查看报告。</Text><Text selectable style={styles.body}>{editor.stem}{'\n'}原始答案输入：{editor.answer}{'\n'}过程输入：{editor.working}</Text><Button label="放弃本页未保存修改并查看已提交记录" secondary disabled={!!operation || busy} onPress={() => { setEditor(null); editorBase.current = null; setPending(null); setPendingAbsent(false); setFailure(''); }} /></Card>}
    {pending && !redacted && <Card style={s.section}><Text style={styles.body}>本次结果尚未确认，输入仍保留。请重读或原样重试。</Text><Button label="重读并核对保存结果" secondary disabled={!!operation || busy} onPress={() => { void task('reload', async () => { const latest = await reload(); if (!adopt(latest, pending)) {
            const current = latest.recognition?.captures.find(item => item.id === capture?.id);
            const saved = latest.recognition?.entries.find(item => item.id === editor?.id);
            const unchanged = editorBase.current ? saved?.status === 'draft' && JSON.stringify(recognitionEditor(saved)) === JSON.stringify(editorBase.current) : !saved;
            if (pending.action === 'recognition.entry.save' && current && !current.redactedAt && editor && unchanged) {
              setPending(null); setPendingAbsent(false); setEditorRevision(current.revision);
              setNotice('已确认本次未保存，原草稿没有被别人修改。保留本页输入并更新修订，请再次保存。');
            } else { setPendingAbsent(true); setNotice('重读后尚无本次保存记录。可以原样重试，也可以放弃这次未保存操作。'); }
          } }); }} /><Button label="原样重试本次操作" disabled={!!operation || busy} onPress={() => { void task('retry', () => send(pending)); }} />{pendingAbsent && <Button label="放弃这次未保存操作" secondary disabled={!!operation || busy} onPress={() => { setPending(null); setPendingAbsent(false); setFailure(''); }} />}</Card>}
    <Card style={s.section}><Text style={styles.sectionTitle}>原图 · {upload.name}</Text><SourceImage uri={localPhotoUri(upload.url)} run={run?.redactedAt ? undefined : run} selectedIds={lineIds} onReady={setSourceReady} />
      <Text style={styles.caption}>原图保留。这里识别的是文字，手写、竖式和复杂公式仍须人工核对。</Text>
      {redacted ? <Notice text="该图的机器识别文字及未提交核对草稿已随历史作答删除。保留原图和未删除的已提交作答，不能重新扫描恢复旧文字。" /> : <><Button label={operation === 'local.recognition.scan' ? '正在设备上识别…' : runs.length ? '重新识别这张图' : '识别图片文字'} disabled={locked || dirty || available !== true} onPress={() => mutate('local.recognition.scan', { uploadId })} /><Text style={styles.caption}>{available === null ? '正在检查设备识别能力…' : available ? '识别在设备上执行，不需要登录或把原图发送给识别服务。每次识别结果分别保存。' : availabilityReason || '当前设备识别不可用，请继续使用拍题页的手工核对。'}</Text></>}
    </Card>
    {!redacted && run && <>
      <Card style={s.section}><Text style={styles.sectionTitle}>1 · 选出同一道题的文字行</Text><Text style={styles.caption}>{run.engine === 'mlkit-chinese' ? '设备中文识别' : '系统文字识别'} · {run.lines.length} 行 · 结果尚未核对</Text>
        {runs.length > 1 && runs.map((item, index) => <Button key={item.id} label={`${item.id === run.id ? '正在查看' : '查看'}识别记录 ${runs.length - index}`} secondary disabled={locked || dirty} onPress={() => { setRunId(item.id); setLineIds([]); }} />)}
        {!run.lines.length && <Notice text="没有识别到文字。可以补拍清晰图片，也可以手工建立核对草稿；这不会产生错题或成绩。" />}
        {run.lines.map((line, index) => <View key={line.id} style={{ gap: 4 }}><Check label={`${index + 1}. ${line.text}`} checked={lineIds.includes(line.id)} disabled={locked || dirty} onPress={() => setLineIds(current => current.includes(line.id) ? current.filter(id => id !== line.id) : [...current, line.id])} /><Text style={styles.caption}>{line.confidence === null ? '该引擎未提供可靠置信度，请对照原图。' : line.confidence < .7 ? '识别把握较低，重点核对数字和单位。' : '识别结果仍需核对。'}</Text></View>)}
        <Button label={lineIds.length ? `用选中的 ${lineIds.length} 行新建一题` : '手工新建一题核对草稿'} disabled={locked || dirty} onPress={() => { void task('draft', async () => { setEditor(newRecognitionEditor(identifier(), run.id, run.lines, lineIds)); editorBase.current = null; setEditorRevision(capture!.revision); setMatches(null); }); }} />
      </Card>
      {editor && savedEntry?.status !== 'submitted' && savedEntry?.status !== 'redacted' && <Card style={s.section}><Text style={styles.sectionTitle}>2 · 整理题目和纸上原始回答</Text><Text style={styles.caption}>机器原文不会随下面修改而覆盖。来源为选中的 {editor.sourceLineIds.length} 行；题号和原始答案请对照原图填写。</Text>
        <Field label="原题号" value={editor.originalNumber} maxLength={40} disabled={locked} onChange={originalNumber => change({ originalNumber })} />
        <Field label="核对后的题干" value={editor.stem} maxLength={2000} multiline disabled={locked} onChange={stem => { change({ stem, candidate: null }); setMatches(null); }} />
        <Field label="纸上原始答案" value={editor.answer} maxLength={300} disabled={locked} onChange={answer => change({ answer })} />
        <Field label="纸上原始过程（可留空）" value={editor.working} maxLength={3000} multiline disabled={locked} onChange={working => change({ working })} />
        <Button label="查找同题候选" secondary disabled={locked || !editor.stem.trim()} onPress={() => { void task('match', async () => { const text = editor.stem; const result = await act('recognition.match', { captureId: capture!.id, text }); if (!Array.isArray(result.result?.candidates)) throw new Error('未取得候选，请稍后重试。'); setMatches({ text, candidates: result.result.candidates as RecognitionMatch[] }); }); }} />
        {candidates && !candidates.length && <Notice text="题库里没有找到候选。请保留这道题的草稿，补拍或修改题干后继续；不会用相似题猜答案。" />}
        {candidates?.map(item => <Check key={`${item.questionId}:${item.questionVersion}`} label={`候选 v${item.questionVersion}：${item.text}（单位：${item.unit || '无'}）`} checked={editor.candidate?.questionId === item.questionId && editor.candidate.contentDigest === item.contentDigest} disabled={locked} onPress={() => change({ candidate: candidatePin(item) })} />)}
        {editor.candidate && <View style={s.entry}><Text style={styles.sectionTitle}>当前固定的候选题</Text><Text style={styles.body}>{pinnedSummary?.text || '请重新检索候选并核对完整题干。'}</Text><Text style={styles.caption}>单位：{pinnedSummary?.unit || '无'} · 固定版本 v{editor.candidate.questionVersion}</Text><Text style={styles.caption}>请核对条件、数字、问题及单位完全一致，不以相似题代替原题。</Text></View>}
        {editor.candidate && <Button label="取消候选，先保留未匹配草稿" secondary disabled={locked} onPress={() => change({ candidate: null })} />}
        <Button label={bodyDirty ? '保存核对草稿' : '保存核对状态'} disabled={locked || !dirty} onPress={saveEditor} />
        {!bodyDirty && savedEntry && <><Text style={styles.sectionTitle}>对照原图逐项确认</Text>{([['stem', '题干、条件和数字已核对'], ['answer', '这是纸上原本写的答案'], ['match', '候选与原图是同一道题'], ['unit', '题目和答案单位已核对']] as const).map(([key, label]) => <Check key={key} label={label} checked={editor.checked[key]} disabled={locked || !sourceReady || (key === 'match' && (!editor.candidate || !pinnedSummary))} onPress={() => { if (lock.current) return; setEditor(current => current ? { ...current, checked: { ...current.checked, [key]: !current.checked[key] } } : current); }} />)}<Text style={styles.caption}>修改题干、答案、过程或候选会清除核对标记，需要重新确认。</Text></>}
        {dirty && <Button label="放弃本页未保存修改" secondary disabled={locked} onPress={() => { setEditor(savedEntry ? recognitionEditor(savedEntry) : null); editorBase.current = savedEntry ? recognitionEditor(savedEntry) : null; setEditorRevision(capture!.revision); setMatches(null); }} />}
      </Card>}
    </>}
    {entries.length > 0 && <Card style={s.section}><Text style={styles.sectionTitle}>逐题核对档案</Text>{entries.map(item => <View key={item.id} style={s.entry}><Text style={styles.sectionTitle}>{item.originalNumber ? `原题 ${item.originalNumber}` : '未填原题号'} · {item.status === 'submitted' ? '已入档' : item.status === 'redacted' ? '正文已删除' : recognitionReady(item) ? '已核对，待入档' : '草稿，尚未入档'}</Text>{item.status !== 'redacted' && <><Text style={styles.body}>{item.stem}</Text><Text style={styles.caption}>原始答案：{item.answer || '未填写'}</Text></>}{item.status === 'draft' && !redacted && <Button label={`继续核对${item.originalNumber ? `第 ${item.originalNumber} 题` : '这道题'}`} secondary disabled={locked || dirty} onPress={() => openEditor(item)} />}{item.status === 'submitted' && item.paperId && <Button label="查看这次作业报告" secondary disabled={locked || dirty} onPress={() => router.push({ pathname: '/report/[id]', params: { id: item.paperId! } })} />}</View>)}</Card>}
    {!redacted && eligible.length > 0 && <Card style={s.section}><Text style={styles.sectionTitle}>3 · 选择本次入档的题目</Text>{eligible.map(item => <Check key={item.id} label={`${item.originalNumber ? `原题 ${item.originalNumber} · ` : ''}${item.stem}`} checked={selectedEntries.includes(item.id)} disabled={locked || dirty} onPress={() => { setSelectedEntries(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id]); setAcknowledgedRevision(null); }} />)}<Text style={styles.body}>本次只统计选中的 {selected.length} 题。其余未提交题目保留草稿；不清楚或未匹配的题不会算错。</Text><Check label="已再次核对所选原始答案；纸面帮助情况尚未核实" checked={acknowledgedRevision === capture?.revision} disabled={locked || dirty || !selected.length} onPress={() => setAcknowledgedRevision(acknowledgedRevision === capture?.revision ? null : capture!.revision)} /><Button label={`确认将 ${selected.length} 道核对题入档`} disabled={locked || dirty || !sourceReady || !selected.length || acknowledgedRevision !== capture?.revision} onPress={() => mutate('recognition.submit', { captureId: capture!.id, expectedRevision: capture!.revision, entryIds: selected.map(item => item.id) })} /></Card>}
    {reportId && <Button label="打开刚才的作业报告" disabled={locked || dirty} onPress={() => router.push({ pathname: '/report/[id]', params: { id: reportId } })} />}
  </Screen>;
}

function Field({ label, value, maxLength, disabled, multiline = false, onChange }: { label: string; value: string; maxLength: number; disabled: boolean; multiline?: boolean; onChange: (text: string) => void }) {
  return <View style={{ gap: 7 }}><Text style={styles.caption}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled} maxLength={maxLength} multiline={multiline} textAlignVertical="top" style={[s.input, multiline && { minHeight: 108 }]} /></View>;
}
function SourceImage({ uri, run, selectedIds, onReady }: { uri: string; run?: RecognitionRun; selectedIds: string[]; onReady: (ready: boolean) => void }) {
  const [failed, setFailed] = useState(false);
  return <View style={{ gap: 8 }}><View style={{ width: '100%', aspectRatio: run ? run.width / run.height : .8, maxHeight: run ? undefined : 420, backgroundColor: '#EFF3EA' }}><Image source={{ uri }} accessibilityLabel="逐题核对原始照片" resizeMode="contain" style={StyleSheet.absoluteFill} onError={() => { setFailed(true); onReady(false); }} onLoad={() => { setFailed(false); onReady(true); }} />{run?.lines.filter(line => selectedIds.includes(line.id)).map(line => <View key={line.id} pointerEvents="none" style={{ position: 'absolute', left: `${line.box.x * 100}%`, top: `${line.box.y * 100}%`, width: `${line.box.width * 100}%`, height: `${line.box.height * 100}%`, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: '#729B3B22' }} />)}</View>{failed && <Notice text="原图暂时无法显示。请先恢复图片，再核对文字；不要凭候选猜测原稿。" error />}</View>;
}
const s = StyleSheet.create({
  section: { gap: 14 }, check: { padding: 12, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10 }, selected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  input: { color: colors.ink, backgroundColor: '#FBFDF8', borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, fontSize: 15, lineHeight: 24, minHeight: 48 },
  entry: { paddingTop: 14, borderTopWidth: 1, borderColor: colors.border, gap: 10 },
});
