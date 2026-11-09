import { effectiveEvidence, effectiveHelpLabel, evidenceAuthorityLabel, evidenceLink } from './evidenceView';
import { useState } from 'react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import type { MasteryAssessment, WorkspaceState } from '../../local/types';
import { styles } from '../../theme';
import { Badge, Button, Card } from '../ui';
import { Chip, learningStyles as ls, Notice } from './LearnUI';
import { fullDateTime } from './reviewTime';

export function assessmentLabel(assessment: Pick<MasteryAssessment, 'state' | 'afterStars' | 'legacy'>): string {
  if (assessment.state === 'unlearned') return '尚未学习';
  if (assessment.afterStars === null || assessment.state === 'insufficient') return '待评估';
  return assessment.legacy ? `旧版试用 ${assessment.afterStars} / 3 星` : `${assessment.afterStars} / 5 星`;
}
export function AssessmentConditions({ assessment }: { assessment: MasteryAssessment }) {
  return <View style={ls.section}>{assessment.conditions.map(condition => {
    const value = (number: number) => condition.key === 'accuracy' ? `${Math.round(number * 100)}%` : String(number);
    const lowerHelpPath = !condition.met && (condition.key === 'explanation' && (assessment.afterStars ?? 0) > 1 || condition.key === 'hint' && (assessment.afterStars ?? 0) > 2);
    const status = lowerHelpPath ? '本次无需采用的低星条件' : condition.key === 'downgrade' ? condition.met ? '达到稳定性复核条件' : '未触发稳定性复核' : condition.met ? '已满足' : '尚缺';
    return <View key={condition.key} style={{ gap: 4 }}><Text style={ls.label}>{status} · {condition.label}</Text><Text style={styles.caption}>当前依据值 {value(condition.actual)} · 规则要求 {value(condition.required)}</Text></View>;
  })}{assessment.gaps.length > 0 && <View style={{ gap: 5 }}><Text style={ls.label}>尚未满足的规则条件</Text><Text style={styles.caption}>各等级分别判断，不要求为了补齐低星条件而主动查看帮助。</Text>{assessment.gaps.map((gap, i) => <Text key={`${i}:${gap}`} style={styles.body}>· {gap}</Text>)}</View>}{assessment.legacy && !assessment.conditions.length && <Text style={styles.caption}>旧版未保存详细条件，这里不补推当时的判断。</Text>}</View>;
}
function EvidenceDetails({ assessment, state }: { assessment: MasteryAssessment; state: WorkspaceState }) {
  const [filter, setFilter] = useState<'adopted' | 'excluded'>('adopted');
  const [limit, setLimit] = useState(10);
  const rows = filter === 'adopted' ? assessment.adoptedEvidenceIds.map(evidenceId => ({ evidenceId, reason: '本次评定采用的原始作答依据' })) : assessment.excludedEvidence;
  return <View style={ls.section}><View style={ls.wrap}><Chip text={`采用 ${assessment.adoptedEvidenceIds.length}`} selected={filter === 'adopted'} onPress={() => { setFilter('adopted'); setLimit(10); }} /><Chip text={`排除 ${assessment.excludedEvidence.length}`} selected={filter === 'excluded'} onPress={() => { setFilter('excluded'); setLimit(10); }} /></View>{rows.length === 0 && <Text style={styles.body}>{assessment.legacy ? '旧版没有保存这一类逐题引用，不补造历史依据。' : '本次评定没有这一类依据。'}</Text>}{rows.slice(0, limit).map((row, i) => {
    const evidence = effectiveEvidence(state, assessment.evidenceAsOfRevision ?? 0).find(item => item.id === row.evidenceId);
    const paper = state.papers.find(item => item.id === evidence?.paperId);
    return <View key={`${row.evidenceId}:${i}`} style={ls.section}><View style={ls.rule} /><Text style={ls.label}>{filter === 'adopted' ? '采用依据' : '排除依据'} {i + 1}</Text>{evidence ? <><Text style={styles.body}>{evidence.questionText}</Text><Text style={styles.caption}>{fullDateTime(evidence.createdAt)} · {effectiveHelpLabel(evidence)} · {evidence.correct ? '答对' : '未答对'}</Text><Text selectable style={styles.body}>本次评定采用时的作答：{evidence.answer || '未作答'}</Text>{evidence.decisionId && <Text style={styles.caption}>{evidenceAuthorityLabel(evidence.authority)} · 本次评定时的证据版本</Text>}<Text style={styles.caption}>{paper?.title || '原始试卷'} · 题目 v{evidence.questionVersion}{evidence.provenance === 'paper' ? ' · 纸面自述未核实' : ''}</Text></> : <Text style={styles.body}>这条历史依据暂时无法读取，引用仍保留。</Text>}<Notice text={row.reason} />{!!evidence?.reason && <Text style={styles.caption}>原记录说明：{evidence.reason}</Text>}<Text selectable style={styles.caption}>依据编号：{row.evidenceId}</Text>{evidence && <Button label="核对这条证据 / 查看当前记录" secondary onPress={() => router.push(evidenceLink(evidence.id))} />}{evidence && <Button label="查看来源报告（含当前有效结果）" secondary onPress={() => router.push({ pathname: '/report/[id]', params: { id: evidence.attemptId } })} />}</View>;
  })}{rows.length > limit && <Button label={`继续查看其余 ${rows.length - limit} 条依据`} secondary onPress={() => setLimit(value => value + 10)} />}</View>;
}
function HistoryEntry({ assessment, state }: { assessment: MasteryAssessment; state: WorkspaceState }) {
  const [expanded, setExpanded] = useState(false);
  const names = { migration: '旧版结果留档', submission: '作答提交后评定', reevaluate: '按当前规则重评', 'rule-switch': '规则切换后评定', 'evidence-correction': '证据更正后重新评定', 'history-deletion': '历史删除后重新评定' };
  return <Card style={ls.section}><Badge>{assessment.legacy ? '保留的旧版 pilot 历史' : names[assessment.trigger]}</Badge><Text style={styles.sectionTitle}>{assessmentLabel(assessment)}</Text><Text style={styles.caption}>{assessment.trigger === 'migration' ? '迁移留档时间' : '评定时间'}：{fullDateTime(assessment.createdAt)}</Text><Text style={styles.caption}>原结果 {assessment.beforeStars === null ? '未评星' : `${assessment.beforeStars} 星`} → 本次 {assessmentLabel(assessment)}</Text><Text style={styles.body}>{assessment.reason}</Text><Text style={styles.caption}>规则版本：{assessment.ruleVersion}</Text><Button label={expanded ? '收起本次条件与逐题依据' : `查看条件与依据 · 采用 ${assessment.adoptedEvidenceIds.length} / 排除 ${assessment.excludedEvidence.length}`} secondary onPress={() => setExpanded(value => !value)} />{expanded && <><AssessmentConditions assessment={assessment} /><EvidenceDetails assessment={assessment} state={state} /></>}{assessment.attemptId && <Button label="查看触发这次评定的报告" secondary onPress={() => router.push({ pathname: '/report/[id]', params: { id: assessment.attemptId! } })} />}</Card>;
}
export function MasteryHistory({ assessments, state }: { assessments: MasteryAssessment[]; state: WorkspaceState }) {
  const [limit, setLimit] = useState(5);
  const knowledgeId = assessments[0]?.knowledgeId;
  const deleted = (state.historyDeletion?.assessments || []).filter(item => !knowledgeId || item.knowledgeId === knowledgeId);
  return <View style={ls.section}><Text style={styles.sectionTitle}>评定时间线 · {assessments.length} 次</Text><Text style={styles.caption}>每次评定保留当时的结果、规则和逐题依据。重新评估和证据更正只追加记录，旧版 pilot 结果仍可回看。这里展示当时的证据版本。本人删除相关学习历史后，相应旧评定正文会移除，只保留无正文的删除凭据。</Text>{deleted.length > 0 && <Notice text={`已有 ${deleted.length} 条${knowledgeId ? '本知识点' : '档案内'}旧评定随学习历史删除，原结果和依据正文不再展示。当前判断按剩余证据重算。`} />}{assessments.length ? assessments.slice(0, limit).map(assessment => <HistoryEntry key={assessment.id} assessment={assessment} state={state} />) : <Text style={styles.body}>还没有评定记录。原始作答不会因此被改写。</Text>}{assessments.length > limit && <Button label={`查看更早的 ${assessments.length - limit} 次评定`} secondary onPress={() => setLimit(value => value + 5)} />}</View>;
}
