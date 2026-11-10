import { useRef, useState } from 'react';
import { router, usePreventRemove } from 'expo-router';
import { Alert, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Badge, Button, Card } from '../components/ui';
import { Chip, errorMessage, learningStyles as ls, LoadingPanel, Notice } from '../components/learning/LearnUI';
import { assessmentLabel, AssessmentConditions, MasteryHistory } from '../components/learning/MasteryHistory';
import { MasteryLegend, masteryLevelNames } from '../components/learning/MasteryLegend';
import { stageLabel, stageOptions, stageOf } from '../components/learning/stage';
import { useLearning } from '../context/LearningContext';
import { effectiveEvidence, evidenceLink } from '../components/learning/evidenceView';
import type { KnowledgeId } from '../local/types';
import { styles } from '../theme';

export default function KnowledgeScreen() {
  const { state, error, reload, act, busy, stage, setStage } = useLearning();
  const [expanded, setExpanded] = useState<string | null>(null), [reassessing, setReassessing] = useState<KnowledgeId | null>(null);
  const [actionError, setActionError] = useState(''), [notice, setNotice] = useState('');
  const operation = useRef(false);
  usePreventRemove(!!reassessing, () => Alert.alert('正在保存评定', '请稍等本次评定保存完成。旧记录会保留。'));
  if (!state) return <Screen><LoadingPanel error={error} retry={() => { void reload().catch(() => {}); }} /></Screen>;
  const activeRule = state.mastery?.rules.find(rule => rule.id === state.mastery?.activeRuleId);
  const currentEvidence = effectiveEvidence(state);
  const reassess = async (knowledgeId: KnowledgeId) => {
    if (operation.current) return;
    operation.current = true; setReassessing(knowledgeId); setActionError(''); setNotice('');
    try { await act('mastery.reevaluate', { knowledgeId }); setExpanded(knowledgeId); setNotice('已按当前规则追加评定。原始作答和旧版评定仍保留。'); }
    catch (cause) { setActionError(errorMessage(cause)); }
    finally { operation.current = false; setReassessing(null); }
  };
  const visible = state.knowledge.filter(item => stageOf(item.id) === stage);
  return <Screen><View><Text style={styles.eyebrow}>本机试用 · 知识地图</Text><Text style={styles.title}>理解多少，{ '\n' }依据说得清。</Text><Text style={styles.subtitle}>{stageLabel(stage)} · {state.profile.course}</Text></View>
    <View style={ls.wrap}>{stageOptions.map(option => <Chip key={option.id} text={option.label} selected={stage === option.id} onPress={() => setStage(option.id)} />)}</View>
    {visible.length === 0 && <Notice text={`本机还没有${stageLabel(stage)}的知识点。可以先在「内容包」里导入对应内容包，再回到这里练习。`} />}
    <MasteryLegend />
    {activeRule ? <Notice text={`当前启用：${activeRule.name} · v${activeRule.version}。规则处于试用、教学验证尚未完成；达到星级只表示满足该版本的记录条件。`} /> : <Notice text="当前规则尚未准备完成，已有作答与历史结果仍保留。可以重读本机记录后再评估。" />}
    {!!(actionError || error) && <View style={ls.section}><Notice text={actionError || error!} error /><Button label="重读本机记录" secondary disabled={busy || !!reassessing} onPress={() => { void reload().then(() => setActionError('')).catch(cause => setActionError(errorMessage(cause))); }} /></View>}{!!notice && <Notice text={notice} />}
    {visible.map(item => {
      const history = (state.mastery?.assessments || []).filter(assessment => assessment.knowledgeId === item.id).reverse();
      const current = history.find(assessment => assessment.id === item.assessmentId) || history[0];
      const evidence = currentEvidence.filter(record => record.knowledgeId === item.id);
      const title = current ? assessmentLabel(current) : item.learningState === 'upcoming' ? '尚未学习' : item.stars === null ? '待评估' : `保留的历史结果：${item.stars} 星`;
      return <Card key={item.id} style={ls.section}><Badge>{item.learningState === 'current' ? '正在学习' : '尚未学习'}</Badge><Text style={styles.sectionTitle}>{item.name}</Text><Text style={styles.body}>{item.description}</Text><Text style={styles.title}>{title}</Text>{current && !current.legacy && current.afterStars !== null && current.afterStars > 0 && <Text style={ls.label}>{masteryLevelNames[current.afterStars - 1]}</Text>}<Notice text={current?.reason || item.reason} /><Text style={styles.caption}>本次依据规则：{current?.ruleVersion || item.ruleVersion}{current?.legacy ? ' · 旧版 pilot 结果原样保留' : ' · 试用验证未完成'}</Text>
        {current && <AssessmentConditions assessment={current} />}
        <Text style={styles.caption}>当前归属此知识点的有效证据 {evidence.filter(record => record.valid).length} 条。已核对证据按统一结果参与当前评定；原始提交与旧评定仍按当时版本保留。</Text>
        <Button label={`练一练${item.learningState === 'upcoming' ? '（尚未学习）' : ''}`} disabled={item.learningState !== 'current' || busy || !!reassessing} onPress={() => router.navigate({ pathname: '/practice', params: { knowledge: item.id, configure: String(Date.now()) } })} />
        <Button label="查看这个知识点的复查计划" secondary disabled={!!reassessing} onPress={() => router.push({ pathname: '/review-plans', params: { knowledge: item.id } })} />
        {current?.legacy && <Text style={styles.caption}>旧版三星规则与当前五星规则不同。重评会更新当前结果，可能变为待评估或不同星级；旧版历史原样保留。</Text>}
        <Button label={reassessing === item.id ? '正在保存新的评定…' : '按当前规则重新评估'} secondary disabled={busy || !!reassessing || !activeRule} onPress={() => { void reassess(item.id); }} />
        <Button label={expanded === item.id ? '收起评定历史' : `查看 ${history.length} 次评定与逐题依据`} secondary disabled={!!reassessing} onPress={() => setExpanded(expanded === item.id ? null : item.id)} />{expanded === item.id && <><Text style={ls.label}>最近的当前证据</Text>{evidence.slice(-3).reverse().map(record => <View key={record.id} style={ls.section}><Text style={styles.body}>{record.questionText}</Text><Button label="申请更正 / 核对这条证据" secondary disabled={!!reassessing} onPress={() => router.push(evidenceLink(record.id))} /></View>)}<MasteryHistory assessments={history} state={state} /></>}
      </Card>;
    })}
    <Button label="查看全部复查计划" secondary disabled={!!reassessing} onPress={() => router.push('/review-plans')} />
  </Screen>;
}
