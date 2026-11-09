import { useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { Screen } from '../components/Screen';
import { Badge, Button, Card } from '../components/ui';
import { Icon } from '../components/Icon';
import { Chip, errorMessage, learningStyles as ls, LoadingPanel, Notice } from '../components/learning/LearnUI';
import { PaperReturnPhotos } from '../components/learning/PaperReturnPhotos';
import { usePaperReturnDraft } from '../components/learning/usePaperReturnDraft';
import type { ReturnConflict } from '../components/learning/paperReturnDraft';
import { useLearning } from '../context/LearningContext';
import type { HelpLevel, Paper, WorkspaceState } from '../local/types';
import { colors, styles } from '../theme';

const back = () => router.canGoBack() ? router.back() : router.replace('/practice');
const claimedLabels: Record<HelpLevel, string> = { unknown: '不确定', independent: '自述独立完成', hint: '用过提示', explanation: '看过讲解或答案' };
const fieldLabels = { value: '原答案', working: '过程', claimedHelp: '帮助自述', confirmed: '题号与原答案核对', unitConfirmed: '单位核对', uploadIds: '关联照片' };
function Check({ label, checked, disabled, onPress }: { label: string; checked: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primaryLight : colors.surface, opacity: disabled ? .55 : 1 }}><View style={{ width: 22, height: 22, borderWidth: 1.5, borderRadius: 6, borderColor: colors.primary, backgroundColor: checked ? colors.primary : colors.surface, alignItems: 'center', justifyContent: 'center' }}>{checked && <Icon name="check" color={colors.white} size={17} />}</View><Text style={[styles.body, { flex: 1, color: colors.ink }]}>{label}</Text></Pressable>;
}
export default function PaperReturnScreen() {
  const { paperId } = useLocalSearchParams<{ paperId: string }>();
  const learning = useLearning();
  if (!learning.state) return <Screen title="纸面作答回传" onBack={back}><LoadingPanel error={learning.error} retry={() => { void learning.reload().catch(() => {}); }} /></Screen>;
  const paper = learning.state.papers.find(item => item.id === paperId);
  if (!paper) return <Screen title="纸面作答回传" onBack={back}><Notice text="没有找到这份本机试卷。请从练习预览重新进入。" /></Screen>;
  return <PaperReturnForm key={paper.id} paper={paper} state={learning.state} />;
}
function PaperReturnForm({ paper, state }: { paper: Paper; state: WorkspaceState }) {
  const { act, reload, error: storageError } = useLearning();
  const draft = usePaperReturnDraft(paper, state, act);
  const [step, setStep] = useState<'photos' | 'answers' | 'review'>(draft.content.uploadIds.length ? 'answers' : 'photos');
  const [index, setIndex] = useState(0), [operation, setOperation] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false), [photoPending, setPhotoPending] = useState(false), [leaving, setLeaving] = useState(false);
  const operationRef = useRef(false);
  const removedQuestions = new Set(state.historyDeletion?.evidence.filter(item => item.paperId === paper.id).map(item => item.questionId));
  const submitted = draft.blocked || state.attempts.some(item => item.paperId === paper.id && item.status === 'submitted');
  const locked = !!operation || photoBusy || draft.recovering || submitted || draft.conflicts.length > 0;
  const recover = async () => {
    if (operationRef.current || photoBusy) return;
    operationRef.current = true; setOperation('recover'); setError(''); Keyboard.dismiss();
    try { await draft.recover(reload); setNotice('本机记录已重读，当前输入仍保留。若出现不同版本，请选择后重新核对各题。'); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { operationRef.current = false; setOperation(''); }
  };
  const disablePrevention = usePreventRemove((draft.dirty || draft.saving || !!operation || photoBusy || photoPending) && !leaving, ({ repeat }) => {
    if (operationRef.current || photoBusy || draft.recovering) { Alert.alert('正在保存纸面记录', '请等待当前操作完成后再离开。'); return; }
    if (photoPending) { Alert.alert('还有照片未完成关联', '请先重试保存待关联照片。当前文字草稿会保留，已取得的本机图片不会被删除。'); return; }
    if (submitted) { Alert.alert('保留当前页面输入', '原始提交不会改变。你可以留在本页复制尚未保存的文字，或明确放弃本页输入后返回。', [{ text: '留下查看', style: 'cancel' }, { text: '放弃本页输入并返回', style: 'destructive', onPress: () => { setLeaving(true); repeat(); } }]); return; }
    if (draft.error || draft.conflicts.length) { Alert.alert('纸面草稿尚未保存', '请先重读并处理不同版本，当前页面文字不会被清除。', [{ text: '留下处理', style: 'cancel' }, { text: '重读保留输入', onPress: () => { void recover(); } }]); return; }
    Alert.alert('保存后再返回', '草稿保存成功后，下次可继续核对。', [{ text: '继续核对', style: 'cancel' }, { text: '保存并返回', onPress: () => {
      operationRef.current = true; setOperation('save');
      void draft.save().then(() => { setLeaving(true); repeat(); }).catch(cause => setError(errorMessage(cause))).finally(() => { operationRef.current = false; setOperation(''); });
    } }]);
  });
  const persist = async () => {
    setError('');
    try { await draft.save(); setNotice('纸面草稿已保存在本机，可以关闭后继续。'); }
    catch (cause) { setError(errorMessage(cause)); }
  };
  const changePhoto = async (id: string, add: boolean) => {
    const current = draft.snapshot().uploadIds;
    const next = add ? [...new Set([...current, id])] : current.filter(item => item !== id);
    if (next.length > 10) throw new Error('每份试卷最多关联 10 张照片。');
    draft.setPhotos(next); await draft.save();
  };
  const submit = async (replaceOnlineDraft: boolean) => {
    if (operationRef.current || photoBusy) return;
    operationRef.current = true; setOperation('submit'); setError(''); Keyboard.dismiss();
    try {
      const saved = await draft.save();
      await act('paper.return.submit', { id: saved.id, expectedRevision: saved.revision, submissionKey: `paper-return:${saved.id}`, replaceOnlineDraft });
      setLeaving(true); disablePrevention(); router.replace({ pathname: '/report/[id]', params: { id: paper.id } });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { operationRef.current = false; setOperation(''); }
  };
  const entries = draft.content.entries, confirmed = entries.filter(item => item.confirmed && item.unitConfirmed).length;
  const hasSavedDraft = state.paperReturns?.some(item => item.paperId === paper.id);
  const canSubmit = draft.content.uploadIds.length > 0 && confirmed === paper.questions.length;
  const online = state.attempts.find(item => item.paperId === paper.id && item.status === 'draft');
  const hasOnlineText = online?.answers.some(item => item.value.trim() || item.working.trim());
  const confirmSubmit = () => Alert.alert('确认提交这份纸面作答？', `${paper.title} · 第 ${paper.version} 版，共 ${entries.length} 题。${entries.some(item => !item.value.trim()) ? `其中 ${entries.filter(item => !item.value.trim()).length} 题原答案为空，将按未答记录。` : ''}提交后保留原始答案与帮助记录，不能覆盖。帮助自述不能作为独立新题加星。`, [
    { text: '再检查', style: 'cancel' },
    { text: '确认纸面记录', onPress: () => hasOnlineText ? Alert.alert('这份卷已有在线草稿', '纸面答案将成为本卷正式提交。已有在线答案、过程及帮助记录会完整归档，仍可查看，不会静默删除。是否确认按纸面作答提交？', [{ text: '保留在线草稿，暂不提交', style: 'cancel' }, { text: '归档在线草稿并提交', onPress: () => { void submit(true); } }]) : void submit(false) },
  ]);
  const showConflictValue = (conflict: ReturnConflict, side: 'local' | 'remote') => {
    const value = conflict[side];
    if (Array.isArray(value)) return value.length ? value.map(id => state.uploads.find(item => item.id === id)?.name || id).join('、') : '未关联照片';
    if (typeof value === 'boolean') return value ? '已核对' : '未核对';
    return conflict.field === 'claimedHelp' ? claimedLabels[value as HelpLevel] : value || '（空白）';
  };
  if (submitted) return <Screen title="纸面作答记录" onBack={back}><Text style={styles.title}>{paper.title}</Text><Notice text="这份试卷已经提交，原始作答不能覆盖。当前页面文字保留如下，可长按复制。" />{entries.map(entry => <Card key={entry.questionId} style={ls.section}><Text style={ls.label}>第 {paper.questionIds.indexOf(entry.questionId) + 1} 题 · {removedQuestions.has(entry.questionId) ? '作答已删除' : '当前页面输入'}</Text>{removedQuestions.has(entry.questionId) ? <><Text style={styles.caption}>已保存的正文已清除。下方仅保留尚未保存的本页文字供复制，不能写回。</Text>{!!entry.value && <Text selectable style={styles.body}>{entry.value}</Text>}{!!entry.working && <Text selectable style={styles.body}>{entry.working}</Text>}</> : <><Text selectable style={styles.body}>{entry.value || '未填写答案'}</Text><Text selectable style={styles.body}>{entry.working || '未填写过程'}</Text></>}</Card>)}<Button label="查看已提交报告" onPress={() => {
    const open = () => { setLeaving(true); disablePrevention(); router.replace({ pathname: '/report/[id]', params: { id: paper.id } }); };
    if (draft.dirty) Alert.alert('离开当前页面？', '尚未保存的页面文字不会覆盖已提交记录，可先复制后再离开。', [{ text: '留下查看', style: 'cancel' }, { text: '查看报告', onPress: open }]); else open();
  }} /></Screen>;
  const question = paper.questions[index], entry = entries[index];
  return <Screen title="纸面作答回传" onBack={back} scrollKey={`${step}:${question.id}`}>
    <View><Text style={styles.eyebrow}>本机试用 · 人工核对原作</Text><Text style={styles.title}>{paper.title}</Text><Text style={styles.subtitle}>第 {paper.version} 版 · {paper.questions.length} 题 · 按本卷题序录入</Text><Text selectable style={styles.caption}>卷号：{paper.id}</Text><Text accessibilityLiveRegion="polite" style={styles.caption}>{draft.error || error ? '保存需要处理，请保留页面输入' : draft.saving || draft.dirty ? '纸面草稿保存中…' : hasSavedDraft ? '纸面草稿已保存在本机' : '添加照片或开始填写后，会保存纸面草稿'}</Text></View>
    <View style={ls.wrap}>{(['photos', 'answers', 'review'] as const).map((value, i) => <Chip key={value} text={['1 照片', '2 逐题核对', '3 提交检查'][i]} selected={step === value} disabled={!!operation || photoBusy || photoPending || draft.recovering} onPress={() => { Keyboard.dismiss(); setStep(value); }} />)}</View>
    {!!(error || draft.error || storageError) && <View style={ls.section}><Notice text={error || draft.error || storageError!} error /><Button label={draft.recovering ? '正在重读…' : '重读本机记录，保留页面输入'} secondary disabled={!!operation || photoBusy} onPress={() => { void recover(); }} /></View>}{!!notice && <Notice text={notice} />}
    {draft.conflicts.map(conflict => <Card key={conflict.key} style={ls.section}><Text style={ls.label}>{conflict.questionId ? `第 ${paper.questionIds.indexOf(conflict.questionId) + 1} 题 · ` : ''}{fieldLabels[conflict.field]}有不同版本</Text><Text style={styles.caption}>当前页面</Text><Text selectable style={styles.body}>{showConflictValue(conflict, 'local')}</Text><Text style={styles.caption}>本机已保存</Text><Text selectable style={styles.body}>{showConflictValue(conflict, 'remote')}</Text><Button label="保留当前页面内容" disabled={!!operation || photoBusy} onPress={() => draft.resolveConflict(conflict.key, 'local')} /><Button label="采用本机已保存内容" secondary disabled={!!operation || photoBusy} onPress={() => draft.resolveConflict(conflict.key, 'remote')} /></Card>)}
    {step === 'photos' && <><PaperReturnPhotos paperId={paper.id} selectedIds={draft.content.uploadIds} disabled={!!operation || draft.recovering || draft.conflicts.length > 0} beforePick={draft.save} onChange={changePhoto} onBusy={setPhotoBusy} onPending={setPhotoPending} /><Button label="照片已清楚，开始逐题核对" disabled={locked || photoPending || !draft.content.uploadIds.length} onPress={() => setStep('answers')} /></>}
    {step === 'answers' && <>
      <View style={ls.wrap}>{entries.map((item, i) => <Chip key={item.questionId} text={`${i + 1}${item.confirmed && item.unitConfirmed ? ' 已核对' : ''}`} selected={index === i} disabled={locked} onPress={() => { Keyboard.dismiss(); setIndex(i); }} />)}</View>
      <Card style={ls.section}><Badge>{`第 ${index + 1} / ${paper.questions.length} 题 · 题目 v${question.version}`}</Badge><Text style={ls.question}>{question.text}</Text><Text style={styles.caption}>请按原纸面填写，未作答可留空。未确认的草稿不会被判错。</Text><Text style={ls.label}>纸上的原答案{question.unit ? `（${question.unit}）` : ''}</Text><TextInput accessibilityLabel={`第 ${index + 1} 题纸面原答案`} style={ls.input} value={entry.value} maxLength={300} autoCorrect={false} editable={!locked} placeholder="原纸上写了什么，就填写什么" onChangeText={value => draft.update(entry.questionId, 'value', value)} /><Text style={ls.label}>纸上的原始过程</Text><TextInput accessibilityLabel={`第 ${index + 1} 题纸面原始过程`} style={[ls.input, ls.textArea]} multiline maxLength={3000} value={entry.working} editable={!locked} placeholder="照原纸面录入算式和思路，可留空" onChangeText={value => draft.update(entry.questionId, 'working', value)} /><Text style={ls.label}>完成这道题时用过什么帮助？</Text><View style={ls.wrap}>{(['unknown', 'independent', 'hint', 'explanation'] as const).map(level => <Chip key={level} text={claimedLabels[level]} selected={entry.claimedHelp === level} disabled={locked} onPress={() => draft.update(entry.questionId, 'claimedHelp', level)} />)}</View><Text style={styles.caption}>这是你的回忆。实际帮助记录会保留；自述独立未核实，不增加独立星级。</Text><Check label={`已核对第 ${index + 1} 题题号、数字、原答案及帮助自述`} checked={entry.confirmed} disabled={locked} onPress={() => draft.update(entry.questionId, 'confirmed', !entry.confirmed)} /><Check label={question.unit ? `已核对单位：${question.unit}` : '已核对：本题无需另填单位'} checked={entry.unitConfirmed} disabled={locked} onPress={() => draft.update(entry.questionId, 'unitConfirmed', !entry.unitConfirmed)} /></Card>
      {index > 0 && <Button label="上一题" secondary disabled={locked} onPress={() => { Keyboard.dismiss(); setIndex(index - 1); }} />}<Button label={index < entries.length - 1 ? '下一题' : '查看提交检查'} disabled={locked} onPress={() => { Keyboard.dismiss(); if (index < entries.length - 1) setIndex(index + 1); else setStep('review'); }} />
    </>}
    {step === 'review' && <><Card style={ls.section}><Text style={styles.sectionTitle}>3 · 检查本次回传</Text><Text style={styles.body}>已关联 {draft.content.uploadIds.length} 张照片，已核对 {confirmed} / {entries.length} 题。</Text>{entries.map((item, i) => <View key={item.questionId} style={ls.section}><Text style={ls.label}>第 {i + 1} 题 · {item.confirmed && item.unitConfirmed ? '已核对' : '待核对'}</Text><Text selectable style={styles.body}>{item.value || '空白（确认后按未答记录）'} · {claimedLabels[item.claimedHelp]}</Text><Button label={`回到第 ${i + 1} 题`} secondary disabled={locked} onPress={() => { setIndex(i); setStep('answers'); }} /></View>)}</Card><Notice text="提交前不计对错。提交后保留原始纸面作答，订正另行记录；原有帮助曝光不会被自述覆盖。" />{hasOnlineText && <Notice text="本卷已有在线草稿。提交纸面记录时会再次确认，并完整归档在线答案和过程。" />}<Button label={operation === 'submit' ? '正在提交纸面记录…' : '确认并提交纸面作答'} disabled={locked || draft.saving || !canSubmit} onPress={confirmSubmit} />{!canSubmit && <Text style={styles.caption}>至少关联一张照片，并完成每题的两项核对后才能提交。</Text>}</>}
    <Button label={draft.saving ? '正在保存纸面草稿…' : '保存纸面草稿'} secondary disabled={locked || draft.saving} onPress={() => { void persist(); }} /><Text style={styles.caption}>照片和草稿仅存在本机，重启后可从本卷的“纸面作答回传”继续。</Text>
  </Screen>;
}
