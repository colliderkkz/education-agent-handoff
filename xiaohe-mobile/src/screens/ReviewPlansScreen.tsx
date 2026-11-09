import { useRef, useState } from 'react';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { Alert, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Badge, Button, Card } from '../components/ui';
import { Chip, errorMessage, learningStyles as ls, LoadingPanel, Notice } from '../components/learning/LearnUI';
import { fullDateTime, dueDescription, reviewAvailability } from '../components/learning/reviewTime';
import { useDeviceNow } from '../components/learning/useDeviceNow';
import { useLearning } from '../context/LearningContext';
import { effectiveReviewSource } from '../components/learning/evidenceView';
import type { ReviewPlan } from '../local/types';
import { styles } from '../theme';

export default function ReviewPlansScreen() {
  const { knowledge, paperId, status } = useLocalSearchParams<{ knowledge?: string; paperId?: string; status?: string }>();
  const { state, error, act, reload, busy } = useLearning();
  const now = useDeviceNow();
  const [filter, setFilter] = useState<'active' | 'completed' | 'all'>(status === 'all' ? 'all' : status === 'completed' ? 'completed' : 'active');
  const [count, setCount] = useState<1 | 2>(2);
  const [starting, setStarting] = useState<string | null>(null), [failure, setFailure] = useState(''), [reloading, setReloading] = useState(false);
  const operation = useRef(false);
  const disablePrevention = usePreventRemove(!!starting, () => Alert.alert('正在准备复查', '请稍等本次操作保存完成。重复开始会回到同一份复查卷。'));
  const back = () => {
    if (operation.current) { Alert.alert('正在准备复查', '请等待本次操作完成。'); return; }
    if (router.canGoBack()) router.back(); else router.replace('/practice');
  };
  if (!state) return <Screen title="间隔新题复查" onBack={back}><LoadingPanel error={error} retry={() => { void reload().catch(() => {}); }} /></Screen>;
  const allPlans = state.mastery?.reviewPlans || [];
  const scope = allPlans.filter(plan => (!knowledge || plan.knowledgeId === knowledge) && (!paperId || plan.sourcePaperId === paperId));
  const plans = scope.filter(plan => filter === 'all' || (filter === 'completed' ? plan.status === 'completed' : plan.status !== 'completed')).map(plan => {
    const pending = plan.status === 'scheduled' && !plan.paperId;
    const availability = pending ? reviewAvailability(state, plan) : { at: null, error: null };
    const timestamp = Date.parse(pending ? availability.at || '' : plan.dueAt);
    const due = pending && !!availability.at && now >= timestamp;
    return { plan, pending, availability, due, timestamp: Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER,
      rank: plan.status === 'completed' ? 3 : !pending ? 1 : due ? 0 : 2 };
  }).sort((a, b) => a.rank - b.rank || a.timestamp - b.timestamp);
  const start = async (plan: ReviewPlan) => {
    if (operation.current) return;
    if (!plan.paperId) {
      const source = effectiveReviewSource(state, plan);
      if (!source.valid) { setFailure(source.reason); return; }
      const available = reviewAvailability(state, plan);
      if (!available.at) { setFailure(available.error || '暂时无法确认可开始时间，请重读本机计划。'); return; }
      if (Date.now() < Date.parse(available.at)) { setFailure(`这份计划还未到期，按当前规则需等到 ${fullDateTime(available.at)}。`); return; }
    }
    operation.current = true; setStarting(plan.id); setFailure('');
    try {
      const result = await act('review.start', { planId: plan.id, count });
      const id = result.result?.id;
      if (!id) throw new Error('复查回复中缺少试卷编号，请重读计划，已保存的计划不会删除。');
      setStarting(null); disablePrevention();
      const saved = result.state.papers.find(paper => paper.id === id);
      router.push(saved?.status === 'completed' ? { pathname: '/report/[id]', params: { id } } : { pathname: saved?.status === 'in_progress' ? '/practice/[paperId]' : '/paper/[paperId]', params: { paperId: id } });
    } catch (cause) { setFailure(errorMessage(cause)); }
    finally { operation.current = false; setStarting(null); }
  };
  const reread = async () => {
    setReloading(true);
    try { await reload(); setFailure(''); } catch (cause) { setFailure(errorMessage(cause)); } finally { setReloading(false); }
  };
  const locked = !!starting || busy || reloading;
  return <Screen title="间隔新题复查" onBack={back}>
    <View><Text style={styles.eyebrow}>本机试用 · 间隔后再试</Text><Text style={styles.title}>隔几天，{ '\n' }用新题看看。</Text><Text style={styles.subtitle}>复查计划来自真实提交。到期后再开始，等待本身不会增加星级。</Text></View>
    <Notice text={`本次按计划准备 ${count} 道未见的迁移题。题库不足时会说明原因，计划仍保留；可减少题量，不会重复已见题。提示和讲解照常记录。`} />
    <Card style={ls.section}><Text style={ls.label}>新复查的题量</Text><View style={ls.wrap}>{([1, 2] as const).map(value => <Chip key={value} text={`${value} 题`} selected={count === value} disabled={locked} onPress={() => setCount(value)} />)}</View><Text style={styles.caption}>即使只做 1 题，也按当前五星规则的累计条件评定，完成不保证升星。已开始的复查保持原题量。</Text></Card>
    <View style={ls.wrap}><Chip text="全部知识点" selected={!knowledge} disabled={locked} onPress={() => router.setParams({ knowledge: undefined })} />{state.knowledge.map(item => <Chip key={item.id} text={item.name} selected={knowledge === item.id} disabled={locked} onPress={() => router.setParams({ knowledge: item.id })} />)}</View>
    {paperId && <Card style={ls.section}><Text style={styles.body}>当前只看来源于「{state.papers.find(paper => paper.id === paperId)?.title || '这份原卷'}」的计划。</Text><Button label="查看所有来源的计划" secondary disabled={locked} onPress={() => router.setParams({ paperId: undefined })} /></Card>}
    <View style={ls.wrap}><Chip text={`未完成 ${scope.filter(plan => plan.status !== 'completed').length}`} selected={filter === 'active'} disabled={locked} onPress={() => setFilter('active')} /><Chip text={`已完成 ${scope.filter(plan => plan.status === 'completed').length}`} selected={filter === 'completed'} disabled={locked} onPress={() => setFilter('completed')} /><Chip text="全部" selected={filter === 'all'} disabled={locked} onPress={() => setFilter('all')} /></View>
    {!!(failure || error) && <View style={ls.section}><Notice text={failure || error!} error /><Text style={styles.caption}>缺少合适新题时不会凑旧题，也不会删除待复查计划。若保存结果不明确，请先重读再继续。</Text><Button label={reloading ? '正在重读…' : '重读本机计划'} secondary disabled={locked} onPress={() => { void reread(); }} /></View>}
    {plans.map(({ plan, pending, availability, due }) => {
      const source = state.papers.find(paper => paper.id === plan.sourcePaperId), reviewPaper = state.papers.find(paper => paper.id === plan.paperId);
      const sourceAttempt = state.attempts.find(attempt => attempt.id === plan.sourceAttemptId);
      const effectiveSource = effectiveReviewSource(state, plan);
      const knowledgeName = state.knowledge.find(item => item.id === plan.knowledgeId)?.name || plan.knowledgeId;
      const rule = state.mastery?.rules.find(item => item.id === plan.ruleId);
      const reportId = plan.attemptId || plan.paperId;
      const delayed = !!availability.at && Date.parse(availability.at) > Date.parse(plan.dueAt);
      return <Card key={plan.id} style={ls.section}><Badge>{plan.status === 'completed' ? '已完成' : !pending ? '进行中' : !effectiveSource.valid ? '来源待核对' : availability.error ? '时间待确认' : due ? '可开始' : '待到期'}</Badge><Text style={styles.sectionTitle}>{knowledgeName}</Text><Text style={styles.body}>{plan.reason}</Text><Text style={ls.label}>原计划到期：{fullDateTime(plan.dueAt)}</Text><Text style={styles.caption}>原计划间隔 {plan.delayDays} 天 · {rule ? `${rule.name} v${rule.version}` : '保留的计划规则'}</Text>
        {pending && (availability.at ? <><Text style={ls.label}>实际可开始时间：{fullDateTime(availability.at)}</Text>{delayed && <Notice text={`当前规则要求等到 ${fullDateTime(availability.at)}，原计划日期与规则记录保留。`} />}<Text style={styles.body}>{dueDescription(availability.at, now)}</Text></> : <Notice text={availability.error || '到期时间待确认，请重读本机计划。'} error />)}
        <View style={ls.rule} /><Text style={ls.label}>来源：{source?.title || '原始试卷'}{source ? ` · 第 ${source.version} 版` : ''}</Text><Text style={styles.caption}>原作答提交：{fullDateTime(sourceAttempt?.submittedAt)}</Text><Text selectable style={styles.caption}>原作答编号：{plan.sourceAttemptId}</Text><Button label="查看来源报告" secondary disabled={locked} onPress={() => router.push({ pathname: '/report/[id]', params: { id: plan.sourceAttemptId } })} />
        {!effectiveSource.valid && <Notice text={`当前有效来源需核对：${effectiveSource.reason} 原始计划与已开始的试卷保留，核对不会重置间隔时间。`} />}
        {pending && <Button label={!effectiveSource.valid ? '来源核对后再开始' : starting === plan.id ? '正在准备新题…' : availability.error ? '重读后确认开始时间' : due ? `按计划开始复查 · ${count} 题` : '到期后可开始'} disabled={locked || !due || !effectiveSource.valid} onPress={() => { void start(plan); }} />}
        {!pending && plan.status !== 'completed' && (reviewPaper ? <Button label={reviewPaper.status === 'completed' ? '查看复查报告' : reviewPaper.status === 'in_progress' ? '继续复查草稿' : '查看复查试卷'} disabled={locked} onPress={() => router.push(reviewPaper.status === 'completed' ? { pathname: '/report/[id]', params: { id: reviewPaper.id } } : { pathname: reviewPaper.status === 'in_progress' ? '/practice/[paperId]' : '/paper/[paperId]', params: { paperId: reviewPaper.id } })} /> : <Notice text="计划已开始，关联试卷暂时无法读取。请重读本机计划后再继续，不会另造一份复查。" />)}
        {plan.status === 'completed' && <><Text style={styles.caption}>完成时间：{fullDateTime(plan.completedAt)}</Text>{reportId ? <Button label="查看完成报告" disabled={locked} onPress={() => router.push({ pathname: '/report/[id]', params: { id: reportId } })} /> : <Notice text="报告引用暂时不可用，请重读本机记录。" />}</>}
      </Card>;
    })}
    {!plans.length && <Card style={ls.section}><Text style={styles.sectionTitle}>{scope.length ? '这个分类暂时没有计划' : '还没有对应的复查计划'}</Text><Text style={styles.body}>{scope.length ? '可以切换上方分类查看其他计划。' : '完成练习后，符合当前规则的提交会生成计划。这里不添加演示任务。'}</Text><Button label="去准备练习" secondary disabled={locked} onPress={() => router.navigate('/practice')} /></Card>}
    <Button label={reloading ? '正在重读…' : '刷新本机计划'} secondary disabled={locked} onPress={() => { void reread(); }} /><Text style={styles.caption}>倒计时按设备当前时间显示，回到前台时刷新；开始前会再次核对到期时间。</Text>
  </Screen>;
}
