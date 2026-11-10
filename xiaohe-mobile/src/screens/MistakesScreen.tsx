import { useRef, useState } from 'react';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { Alert, Text, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { companionQuestionLink } from '../components/learning/companionLink';
import { effectiveMistakes, evidenceAuthorityLabel, evidenceLink } from '../components/learning/evidenceView';
import { Badge, Button, Card } from '../components/ui';
import { Chip, dateLabel, errorMessage, knowledgeNames, learningStyles as ls, LoadingPanel, Notice } from '../components/learning/LearnUI';
import { mistakeCauseLabel, mistakeCauses, practiceScopeForCause, type MistakeCause } from '../local/shared/mistake-causes.ts';
import { useLearning } from '../context/LearningContext';
import { styles } from '../theme';

export default function MistakesScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state, error: loadError, reload, act, busy } = useLearning();
  const [filter, setFilter] = useState(id ? 'all' : 'pending');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const openingRef = useRef(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [leaving, setLeaving] = useState(false);
  const hasDraft = Object.values(answers).some(value => value.length > 0);
  usePreventRemove((hasDraft || !!saving || !!opening) && !leaving, ({ repeat }) => {
    if (saving || opening) { Alert.alert('正在保存这次操作', '请稍等完成后再返回。'); return; }
    Alert.alert('订正答案还未保存', '尚未确认的订正只保留在当前页面，返回后会丢失。', [{ text: '继续订正', style: 'cancel' }, { text: '放弃草稿并返回', style: 'destructive', onPress: () => { setLeaving(true); repeat(); } }]);
  });
  const back = () => router.canGoBack() ? router.back() : router.replace('/practice');
  if (!state) return <Screen title="错题与订正" onBack={back}><LoadingPanel error={loadError} retry={() => { void reload().catch(() => {}); }} /></Screen>;
  const reveal = async (mistakeId: string) => {
    if (openingRef.current || saving) return;
    if (expanded === mistakeId) { setExpanded(null); return; }
    const mistake = effectiveMistakes(state, { includeInactive: true }).find(m => m.id === mistakeId);
    const evidence = state.evidence.find(e => e.id === mistake?.evidenceId);
    if (!evidence) { setError('未找到这道题的原始练习记录，暂时不能打开解析。'); return; }
    openingRef.current = true; setOpening(mistakeId); setError('');
    try { await act('paper.question.expose', { paperId: evidence.paperId, questionId: evidence.questionId }); setExpanded(mistakeId); }
    catch (e) { setError(errorMessage(e)); }
    finally { openingRef.current = false; setOpening(null); }
  };
  const correct = async (mistakeId: string) => {
    if (saving || !answers[mistakeId]?.trim()) return;
    if (!effectiveMistakes(state).some(item => item.id === mistakeId && item.active)) { setError('这条错题的原作答已删除或不再有效，当前未保存文字只能复制，不能写回。'); return; }
    setSaving(mistakeId); setError(''); setNotice('');
    try { await act('mistake.correct', { id: mistakeId, answer: answers[mistakeId] }); setAnswers(previous => { const next = { ...previous }; delete next[mistakeId]; return next; }); setNotice('订正已保存，第一次作答和星级保持不变。'); setFilter('all'); }
    catch (e) { setError(errorMessage(e)); }
    finally { setSaving(null); }
  };
  const recoverRecords = async () => {
    if (openingRef.current || saving) return;
    openingRef.current = true; setOpening('reload');
    try { await reload(); setError(''); setNotice('本机记录已重读，当前订正输入仍保留。未打开的解析仍需再次点击。'); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { openingRef.current = false; setOpening(null); }
  };
  /** 标记错因：错在哪由学生自己说，系统不替他猜。 */
  const tagCause = async (mistakeId: string, cause: string) => {
    if (busy || saving) return;
    setSaving(mistakeId); setError(''); setNotice('');
    try { await act('mistake.tag', { id: mistakeId, cause }); setNotice('错因已记下，可以按这组错因再练几道。'); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(null); }
  };
  /** 按一组错因再练几道：错因 → 知识点 → 直接出卷。 */
  const practiceByCause = async (cause: string) => {
    if (busy || saving) return;
    const scope = practiceScopeForCause(mistakes, state.knowledge, cause as MistakeCause);
    if (!scope.knowledgeIds.length) return;
    setSaving('cause'); setError(''); setNotice('');
    try {
      const result = await act('paper.create', { count: scope.count, knowledgeIds: scope.knowledgeIds, difficulty: '不限', kind: 'practice' });
      if (result.result?.id) router.push({ pathname: '/paper/[paperId]', params: { paperId: result.result.id } });
      else setNotice('这份练习已经准备好了，在「练习」页查看。');
    }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(null); }
  };
  const mistakes = effectiveMistakes(state, { includeInactive: true });
  const pending = mistakes.filter(m => m.active && !m.correctedAt).length;
  const corrected = mistakes.filter(m => m.active && !!m.correctedAt).length;
  const list = mistakes.filter(m => filter === 'all' || (filter === 'pending' ? m.active && !m.correctedAt : m.active && !!m.correctedAt)).sort((a, b) => Number(b.id === id) - Number(a.id === id));
  // 按错因分组：标过错因的错题聚成一组，每组能直接出「同错因」练习。
  const causeGroups = mistakeCauses.map(cause => ({ cause, items: mistakes.filter(m => m.cause === cause.id) })).filter(group => group.items.length > 0);
  return <Screen title="错题与订正" onBack={back}><View><Text style={styles.eyebrow}>本机试用 · 留住想明白的过程</Text><Text style={styles.title}>把小困难，{ '\n' }变成新收获。</Text><Text style={styles.subtitle}>{pending} 道待订正 · {corrected} 道已学习订正</Text></View>
    <Notice text="学习订正保留原始答案，历史删除另行确认。订正不会直接增加星级。打开讲解只记录这道题的帮助曝光，并同步同题族的未完成练习。" />
    <View style={ls.wrap}>{[['pending', '待订正'], ['corrected', '已订正'], ['all', '全部']].map(([value, label]) => <Chip key={value} text={label} selected={filter === value} onPress={() => setFilter(value)} />)}</View>
    {causeGroups.length > 0 && <Card style={ls.section}><Text style={styles.sectionTitle}>按错因看</Text><Text style={styles.caption}>同一类错反复出现，才值得单独练一组。错因由你自己标，系统不替你猜。</Text>{causeGroups.map(group => <View key={group.cause.id} style={ls.section}><Text style={styles.body}>{group.cause.label} · {group.cause.hint} · {group.items.length} 道</Text><Button label={`按这组错因练 ${Math.min(6, Math.max(3, group.items.length))} 道`} secondary disabled={busy || !!saving} onPress={() => { void practiceByCause(group.cause.id); }} /></View>)}</Card>}
    {!!error && <View style={ls.section}><Notice text={error} error /><Button label={opening === 'reload' ? '正在重读…' : '重读记录，保留当前订正输入'} secondary disabled={!!saving || !!opening} onPress={() => { void recoverRecords(); }} /></View>}{!!notice && <Notice text={notice} />}
    {Object.entries(answers).filter(([key, value]) => value && !mistakes.some(item => item.id === key && item.active)).map(([key, value]) => <Card key={key} style={ls.section}><Text style={styles.sectionTitle}>原记录已删除或不再属于错题</Text><Text style={styles.caption}>这段订正尚未保存，仅留在本页供复制，不能重新写入。</Text><Text selectable style={styles.body}>{value}</Text><Button label="放弃这段未保存订正" secondary disabled={!!saving || !!opening} onPress={() => Alert.alert('放弃本页输入？', '只清除这段尚未保存的文字，不会恢复已删除作答。', [{ text: '留下复制', style: 'cancel' }, { text: '确认放弃', onPress: () => setAnswers(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== key))) }])} /></Card>)}
    {list.map(m => <Card key={m.id} style={ls.section}><Badge>{!m.active ? '核对后已不属于当前错题' : m.correctedAt ? '已学习订正' : '待学习订正'}</Badge><Text style={styles.caption}>{knowledgeNames[m.knowledgeId]} · {m.question.difficulty}</Text><Text style={ls.question}>{m.question.text}</Text><View style={ls.wrap}><Text style={styles.caption}>错因</Text>{mistakeCauses.map(cause => <Chip key={cause.id} text={cause.label} selected={m.cause === cause.id} disabled={busy || !!saving} onPress={() => { void tagCause(m.id, cause.id); }} />)}</View>{m.cause && <Text style={styles.caption}>已记录：{mistakeCauseLabel(m.cause)}</Text>}<Text style={styles.body}>原始答案：{m.originalAnswer || '未作答'}</Text>{m.effectiveEvidence.decisionId && <><Text style={styles.body}>当前记录答案：{m.currentAnswer || '未作答'}</Text><Text style={styles.caption}>{evidenceAuthorityLabel(m.effectiveEvidence.authority)}</Text></>}<Button label="申请更正 / 查看核对记录" secondary disabled={hasDraft || !!saving || !!opening} onPress={() => router.push(evidenceLink(m.evidenceId))} />{m.correctedAt && <Text style={styles.body}>订正后的答案：{m.correctedAnswer}</Text>}<Button label="带这道题问小禾" secondary disabled={!!saving || !!opening} onPress={() => { const evidence = state.evidence.find(item => item.id === m.evidenceId); if (!evidence) { setError('没有找到原始试卷，不能猜测题目版本。'); return; } router.push(companionQuestionLink(m.question, evidence.paperId)); }} /><Button label={opening === m.id ? '正在记录…' : expanded === m.id ? '收起这道题' : '打开讲解与订正'} secondary disabled={!!saving || !!opening} onPress={() => { void reveal(m.id); }} />{expanded === m.id && <View style={ls.section}><View style={ls.rule} /><Text style={ls.label}>一起理一理思路</Text><Text style={styles.body}>{m.question.hint}</Text>{m.question.steps.map((step, i) => <Text style={styles.body} key={i}>{i + 1}. {step}</Text>)}<Text style={ls.label}>参考答案：{m.question.answer} {m.question.unit}</Text>{!m.active ? <Notice text="这条记录已不属于当前错题，不能追加学习订正。" /> : m.correctedAt ? <Notice text={`${dateLabel(m.correctedAt)} 已保存订正。原始作答仍保留。`} /> : <><Text style={ls.label}>现在，我的答案是</Text><TextInput accessibilityLabel="订正后的答案" value={answers[m.id] || ''} onChangeText={value => { setAnswers(previous => ({ ...previous, [m.id]: value })); setError(''); setNotice(''); }} editable={!saving && !opening} maxLength={300} placeholder="写下你现在的答案" placeholderTextColor="#87937D" style={ls.input} /><Button label={saving === m.id ? '正在保存…' : '确认并保存订正'} disabled={busy || !!saving || !!opening || !answers[m.id]?.trim()} onPress={() => { void correct(m.id); }} /></>}<Button label="准备同类新题" secondary disabled={hasDraft || !!saving || !!opening} onPress={() => router.navigate({ pathname: '/practice', params: { knowledge: m.knowledgeId, configure: String(Date.now()) } })} />{hasDraft && <Text style={styles.caption}>请先保存当前订正，再准备新题。</Text>}</View>}</Card>)}
    {list.length === 0 && <Card style={ls.section}><Text style={styles.sectionTitle}>{filter === 'pending' ? '暂时没有待订正的题' : '这个分类还没有记录'}</Text><Text style={styles.body}>完成练习后，需要再想一想的题目会保存在这里。</Text><Button label="去练习" secondary disabled={hasDraft || !!opening} onPress={() => router.navigate('/practice')} /></Card>}
  </Screen>;
}
