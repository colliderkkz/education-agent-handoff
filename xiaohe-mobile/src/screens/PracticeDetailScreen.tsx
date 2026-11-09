import { useRef, useState } from 'react';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { Alert, Keyboard, Text, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { companionQuestionLink } from '../components/learning/companionLink';
import { Badge, Button, Card } from '../components/ui';
import { Chip, errorMessage, helpNames, knowledgeNames, learningStyles as ls, LoadingPanel, Notice } from '../components/learning/LearnUI';
import { usePracticeDraft } from '../components/learning/usePracticeDraft';
import { useLearning } from '../context/LearningContext';
import { deletedForAttempt } from '../features/history-deletion-ui';
import type { Attempt, Paper } from '../local/types';
import { styles } from '../theme';

const back = () => router.canGoBack() ? router.back() : router.replace('/practice');
export default function PracticeDetailScreen({ mode }: { mode: 'preview' | 'work' }) {
  const { paperId } = useLocalSearchParams<{ paperId: string }>();
  const learning = useLearning();
  if (!learning.state) return <Screen title="我的练习" onBack={back}><LoadingPanel error={learning.error} retry={() => { void learning.reload().catch(() => {}); }} /></Screen>;
  const paper = learning.state.papers.find(p => p.id === paperId);
  if (!paper) return <Screen title="我的练习" onBack={back}><Notice text="没有找到这份本机练习。" /><Button label="返回练习列表" onPress={() => router.replace('/practice')} /></Screen>;
  const attempt = learning.state.attempts.find(a => a.paperId === paper.id);
  return mode === 'preview' || !attempt ? <PaperPreview key={paper.id} paper={paper} /> : <PracticeForm key={paper.id} paper={paper} attempt={attempt} />;
}
function PaperPreview({ paper }: { paper: Paper }) {
  const { act, busy } = useLearning();
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const operation = useRef(false);
  const [error, setError] = useState('');
  const disablePrevention = usePreventRemove(working, () => { Alert.alert('正在保存练习', '请等待这次操作完成后再返回。'); });
  const safeBack = () => { if (operation.current) Alert.alert('正在保存练习', '请等待这次操作完成后再返回。'); else back(); };
  const run = async (action: 'paper.replace' | 'paper.resume') => {
    if (operation.current) return;
    operation.current = true;
    setWorking(true); setError('');
    try {
      const result = await act(action, { paperId: paper.id, ...(action === 'paper.replace' ? { questionId: replaceId } : {}) });
      const id = result.result?.id || paper.id;
      setWorking(false); disablePrevention();
      router.replace({ pathname: action === 'paper.replace' ? '/paper/[paperId]' : '/practice/[paperId]', params: { paperId: id } });
    } catch (e) { setError(errorMessage(e)); } finally { operation.current = false; setWorking(false); }
  };
  return <Screen title="练习预览" onBack={safeBack}><View><Text style={styles.eyebrow}>本机试用 · 已保存题目版本</Text><Text style={styles.title}>{paper.title}</Text><Text style={styles.subtitle}>{paper.questions.length} 题 · 约 {paper.estimatedMinutes} 分钟 · 第 {paper.version} 版</Text></View>
    <Notice text={paper.reason} />{!!error && <Notice text={error} error />}
    {paper.kind === 'review' && <Notice text={paper.reviewPlanId ? '复查卷按计划固定题目与题序，不能换题另存。可以保留草稿，按自己的节奏完成。' : '这是保留的旧版复查卷。可以继续完成，但缺少来源计划快照，不作为当前规则的间隔迁移依据。'} />}
    {paper.questions.map((q, i) => <Card key={q.id} style={ls.section}><Badge>{`第 ${i + 1} 题 · ${knowledgeNames[q.knowledgeId]} · ${q.difficulty}`}</Badge><Text style={ls.question}>{q.text}</Text><Text style={styles.caption}>来源：{q.source} · 题目 v{q.version}</Text>{paper.status === 'ready' && paper.kind !== 'review' && <Button label={replaceId === q.id ? '取消换题' : '换一道同类题'} secondary disabled={working || busy} onPress={() => setReplaceId(replaceId === q.id ? null : q.id)} />}{replaceId === q.id && <><Text style={styles.body}>确认后另存一份新练习，原卷与记录仍保留。</Text><Button label={working ? '正在换题…' : '确认换题并另存'} disabled={working || busy} onPress={() => { void run('paper.replace'); }} /></>}</Card>)}
    <Text style={styles.caption}>预览不显示答案。先留一点时间给自己思考。</Text><Button label={paper.status === 'completed' ? '查看报告' : working ? '正在打开…' : paper.status === 'in_progress' ? '继续练习' : '开始练习'} disabled={working || busy} onPress={() => paper.status === 'completed' ? router.replace({ pathname: '/report/[id]', params: { id: paper.id } }) : void run('paper.resume')} />
    <Button label="导出与打印 PDF" secondary disabled={working || busy} onPress={() => router.push({ pathname: '/paper-export/[paperId]', params: { paperId: paper.id } })} />
    {paper.status !== 'completed' && <Button label="纸面作答回传" secondary disabled={working || busy} onPress={() => router.push({ pathname: '/paper-return/[paperId]', params: { paperId: paper.id } })} />}
    {paper.parentId && <Button label="查看换题前的版本" secondary disabled={working || busy} onPress={() => router.push({ pathname: '/paper/[paperId]', params: { paperId: paper.parentId! } })} />}
  </Screen>;
}
function PracticeForm({ paper, attempt }: { paper: Paper; attempt: Attempt }) {
  const { act, reload, state } = useLearning();
  const deleted = state ? deletedForAttempt(state, attempt.id).map(item => item.questionId) : [];
  const draft = usePracticeDraft(paper.id, paper.questions.map(q => { const a = attempt.answers.find(answer => answer.questionId === q.id); return { questionId: q.id, value: a?.value || '', working: a?.working || '' }; }), act, { revision: state?.revision ?? 0, status: attempt.status, deletedQuestionIds: deleted });
  const [index, setIndex] = useState(0);
  const [operation, setOperation] = useState<'help' | 'submit' | 'leave' | 'recover' | null>(null);
  const operationRef = useRef(false);
  const [error, setError] = useState('');
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [leaving, setLeaving] = useState(false);
  const recover = async () => {
    if (operationRef.current) return;
    operationRef.current = true; setOperation('recover'); setError(''); setRecoveryNotice(''); Keyboard.dismiss();
    try {
      const result = await draft.recover(reload);
      setRecoveryNotice(result.submitted ? '重读发现这份练习已经提交。当前页面输入仍保留，但不能覆盖原始提交。' : '已重新读取本机记录，并保留当前输入。如有冲突，请逐项选择后保存。');
    } catch (e) { setError(errorMessage(e)); }
    finally { operationRef.current = false; setOperation(null); }
  };
  const submitted = attempt.status === 'submitted' || draft.remoteSubmitted;
  const disablePrevention = usePreventRemove((draft.dirty || draft.saving || draft.recovering || operation !== null) && !leaving, ({ repeat }) => {
    if (operationRef.current) { Alert.alert('正在保存这次操作', '请稍等完成后再返回。'); return; }
    if (submitted) {
      Alert.alert('这份练习已经提交', '当前页面还保留着未保存的输入。可以留下查看或复制，也可以放弃页面草稿后返回。已提交的原始记录不会改变。', [{ text: '留下查看', style: 'cancel' }, { text: '放弃页面草稿并返回', style: 'destructive', onPress: () => { setLeaving(true); repeat(); } }]);
      return;
    }
    if (draft.conflicts.length) { Alert.alert('草稿有不同版本', '请先在页面中逐项选择要保留的答案或思路，再保存后返回。当前输入仍保留。'); return; }
    if (draft.saveError) {
      Alert.alert('草稿尚未保存', '可以重读本机记录后再保存。重读会保留当前输入，出现不同版本时由你选择。', [{ text: '留在页面', style: 'cancel' }, { text: '重读并保留输入', onPress: () => { void recover(); } }]);
      return;
    }
    Alert.alert('还有内容正在保存', '保存成功后再离开，下次可以接着写。', [
      { text: '继续作答', style: 'cancel' },
      { text: '保存并返回', onPress: () => {
        operationRef.current = true; setOperation('leave');
        void draft.save().then(() => { setLeaving(true); repeat(); }).catch(e => setError(errorMessage(e))).finally(() => { operationRef.current = false; setOperation(null); });
      } },
    ]);
  });
  const question = paper.questions[index];
  const answer = draft.answers.find(a => a.questionId === question.id)!;
  const help = attempt.answers.find(a => a.questionId === question.id)?.help || 'independent';
  const filled = draft.answers.filter(a => a.value.trim()).length;
  const inputLocked = operation !== null || draft.recovering || draft.conflicts.length > 0;
  const requestHelp = async (level: 'hint' | 'explanation') => {
    if (operationRef.current) return;
    operationRef.current = true; setOperation('help'); setError(''); Keyboard.dismiss();
    try { await draft.save(); await act('attempt.help', { paperId: paper.id, questionId: question.id, level }); }
    catch (e) { setError(errorMessage(e)); }
    finally { operationRef.current = false; setOperation(null); }
  };
  const submit = async () => {
    if (operationRef.current) return;
    operationRef.current = true; setOperation('submit'); setError(''); Keyboard.dismiss();
    try {
      await draft.save();
      await act('attempt.submit', { paperId: paper.id, answers: draft.snapshot(), submissionKey: paper.id });
      setLeaving(true); disablePrevention();
      router.replace({ pathname: '/report/[id]', params: { id: paper.id } });
    } catch (e) { setError(errorMessage(e)); }
    finally { operationRef.current = false; setOperation(null); }
  };
  const confirmSubmit = () => Alert.alert('保存这次思考', `已填写 ${filled}/${paper.questions.length} 题。提交后原始作答与帮助记录会保留，需要订正的题目会进入错题集。`, [{ text: '再检查一下', style: 'cancel' }, { text: '确认提交', onPress: () => { void submit(); } }]);
  if (submitted) {
    const openReport = () => { setLeaving(true); disablePrevention(); router.replace({ pathname: '/report/[id]', params: { id: paper.id } }); };
    return <Screen title="这份练习已经提交" onBack={back}>
      <Notice text={recoveryNotice || '已提交的原始作答不可覆盖。当前页面输入仍显示在下面，可长按复制后再离开。'} />
      {paper.questions.map((q, i) => { const local = draft.answers.find(a => a.questionId === q.id); const saved = attempt.answers.find(a => a.questionId === q.id); if (deleted.includes(q.id)) return <Card key={q.id} style={ls.section}><Text style={ls.label}>第 {i + 1} 题 · 作答已删除</Text><Text style={styles.caption}>已保存的答案与过程已清除，不能写回。若下方还有文字，仅为尚未保存的本页输入，可长按复制。</Text>{!!local?.value && <Text selectable style={styles.body}>{local.value}</Text>}{!!local?.working && <Text selectable style={styles.body}>{local.working}</Text>}</Card>; return <Card key={q.id} style={ls.section}><Text style={ls.label}>第 {i + 1} 题 · 当前页面输入</Text><Text selectable style={styles.body}>{local?.value || '未填写答案'}</Text><Text selectable style={styles.body}>{local?.working || '未填写过程'}</Text><Text style={ls.label}>已经提交的答案</Text><Text selectable style={styles.body}>{saved?.value || '未填写'}</Text></Card>; })}
      <Button label="查看已提交报告" onPress={() => draft.dirty ? Alert.alert('离开当前页面草稿？', '未保存的页面输入将不再保留，已提交记录不会改变。', [{ text: '留下查看', style: 'cancel' }, { text: '查看报告', onPress: openReport }]) : openReport()} />
    </Screen>;
  }
  return <Screen title="我的练习" onBack={back} scrollKey={question.id}>
    <View><Text style={styles.eyebrow}>本机试用 · {paper.title}</Text><Text style={styles.title}>第 {index + 1} / {paper.questions.length} 题</Text><Text accessibilityLiveRegion="polite" style={styles.subtitle}>{draft.saveError ? '草稿保存失败，请重试后再离开' : draft.saving || draft.dirty ? '正在保存到本机…' : '草稿已保存在本机'}</Text></View>
    {paper.kind === 'review' && !paper.reviewPlanId && <Notice text="旧版复查草稿仍可继续；缺少来源计划快照，不作为当前规则的间隔迁移依据。" />}
    <View style={ls.wrap}>{paper.questions.map((q, i) => <Chip key={q.id} text={`${i + 1}${draft.answers.find(a => a.questionId === q.id)?.value.trim() ? ' · 已填' : ''}`} selected={index === i} disabled={operation !== null} onPress={() => { Keyboard.dismiss(); setIndex(i); }} />)}</View>
    {!!(error || draft.saveError) && <View style={ls.section}><Notice text={error || draft.saveError} error /><Button label={draft.recovering ? '正在重读…' : '重读本机记录，保留当前输入'} secondary disabled={operation !== null || draft.recovering} onPress={() => { void recover(); }} /></View>}
    {!!recoveryNotice && <Notice text={recoveryNotice} />}
    {draft.conflicts.map(conflict => <Card key={`${conflict.questionId}-${conflict.field}`} style={ls.section}><Text style={ls.label}>第 {paper.questionIds.indexOf(conflict.questionId) + 1} 题 · {conflict.field === 'value' ? '答案' : '思路'}出现不同版本</Text><Text style={styles.caption}>当前页面输入</Text><Text selectable style={styles.body}>{conflict.local || '（空白）'}</Text><Text style={styles.caption}>本机已保存内容</Text><Text selectable style={styles.body}>{conflict.remote || '（空白）'}</Text><Button label="保留当前页面输入" disabled={operation !== null} onPress={() => draft.resolveConflict(conflict.questionId, conflict.field, 'local')} /><Button label="采用本机已保存内容" secondary disabled={operation !== null} onPress={() => draft.resolveConflict(conflict.questionId, conflict.field, 'remote')} /></Card>)}
    <Card style={{ gap: 17 }}><Badge>{`${knowledgeNames[question.knowledgeId]} · ${question.difficulty}`}</Badge><Text style={ls.question}>{question.text}</Text><Text style={styles.caption}>当前记录：{helpNames[help]}</Text><View style={{ gap: 7 }}><Text style={ls.label}>我的答案{question.unit ? `（${question.unit}）` : ''}</Text><TextInput accessibilityLabel={`第 ${index + 1} 题答案`} value={answer.value} onChangeText={value => draft.update(question.id, 'value', value)} editable={!inputLocked} maxLength={300} placeholder="写下你的答案" placeholderTextColor="#87937D" autoCorrect={false} autoComplete="off" style={ls.input} /></View><View style={{ gap: 7 }}><Text style={ls.label}>我的思考过程</Text><TextInput accessibilityLabel={`第 ${index + 1} 题思考过程`} value={answer.working} onChangeText={value => draft.update(question.id, 'working', value)} editable={!inputLocked} maxLength={3000} multiline placeholder="列式、检验，或者你自己的想法…" placeholderTextColor="#87937D" style={[ls.input, ls.textArea]} /></View>
      <Button label="保存草稿，带这道题问小禾" secondary disabled={inputLocked || draft.saving} onPress={() => {
        if (operationRef.current) return;
        operationRef.current = true; setOperation('leave'); setError(''); Keyboard.dismiss();
        void draft.save().then(() => { router.push(companionQuestionLink(question, paper.id)); }).catch(cause => setError(errorMessage(cause))).finally(() => { operationRef.current = false; setOperation(null); });
      }} />
      <Text style={styles.caption}>卡住时可以借一点力量。提示和讲解会分别记录。</Text><Button label={operation === 'help' ? '正在记录帮助…' : '给我一点提示'} secondary disabled={inputLocked || help === 'hint' || help === 'explanation'} onPress={() => { void requestHelp('hint'); }} /><Button label="查看完整讲解（会记录）" secondary disabled={inputLocked || help === 'explanation'} onPress={() => { void requestHelp('explanation'); }} />
      {(help === 'hint' || help === 'explanation') && <View style={{ gap: 10 }}><View style={ls.rule} /><Text style={styles.sectionTitle}>{help === 'explanation' ? '一起理清思路' : '给你一个小提示'}</Text><Text style={styles.body}>{question.hint}</Text>{help === 'explanation' && <>{question.steps.map((step, i) => <Text key={i} style={styles.body}>{i + 1}. {step}</Text>)}<Text style={styles.sectionTitle}>参考答案：{question.answer} {question.unit}</Text>{!!question.alternative && <Text style={styles.body}>另一种想法：{question.alternative}</Text>}</>}<Text style={styles.caption}>帮助记录已保存在本机，本题不再计作独立新题证据。</Text></View>}
    </Card>
    <View style={{ gap: 10 }}>{index > 0 && <Button label="上一题" secondary disabled={operation !== null} onPress={() => { Keyboard.dismiss(); setIndex(index - 1); }} />}{index < paper.questions.length - 1 && <Button label="下一题" disabled={operation !== null} onPress={() => { Keyboard.dismiss(); setIndex(index + 1); }} />}<Button label={draft.saving ? '正在保存…' : '保存草稿'} secondary disabled={inputLocked || draft.saving} onPress={() => { void draft.save().catch(() => {}); }} /></View>
    <Card style={ls.section}><Text style={styles.sectionTitle}>已填写 {filled} / {paper.questions.length} 题</Text><Text style={styles.body}>{filled < paper.questions.length ? '还有答案没有填写，可以用上方题号回去看看。' : '可以再检查一下答案和单位，然后提交这次练习。'}</Text><Button label={operation === 'submit' ? '正在提交…' : '检查并提交'} disabled={inputLocked || filled < paper.questions.length} onPress={confirmSubmit} /></Card>
    <Button label="保存在线草稿，录入纸面作答" secondary disabled={inputLocked || draft.saving} onPress={() => {
      if (operationRef.current) return;
      operationRef.current = true; setOperation('leave'); Keyboard.dismiss();
      void draft.save().then(() => { setLeaving(true); disablePrevention(); router.replace({ pathname: '/paper-return/[paperId]', params: { paperId: paper.id } }); }).catch(cause => setError(errorMessage(cause))).finally(() => { operationRef.current = false; setOperation(null); });
    }} />
  </Screen>;
}
