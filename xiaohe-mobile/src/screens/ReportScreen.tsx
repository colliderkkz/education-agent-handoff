import { useRef, useState } from 'react';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { Alert, Image, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { companionQuestionLink } from '../components/learning/companionLink';
import { effectiveAttempt, effectiveEvidence, effectiveHelpLabel, effectiveMistakes, effectiveReportCounts, evidenceAuthorityLabel, evidenceLink } from '../components/learning/evidenceView';
import { Badge, Button, Card } from '../components/ui';
import { dateLabel, errorMessage, helpNames, knowledgeNames, learningStyles as ls, LoadingPanel, Notice, Stat } from '../components/learning/LearnUI';
import { useLearning } from '../context/LearningContext';
import { localPhotoUri } from '../features/local-photo';
import { deletedForAttempt, historyLink } from '../features/history-deletion-ui';
import { styles } from '../theme';

export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, error, reload, act } = useLearning();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState('');
  const openingRef = useRef(false);
  usePreventRemove(!!opening, () => { Alert.alert('正在记录解析查看', '请稍等保存完成后再返回。'); });
  const back = () => router.canGoBack() ? router.back() : router.replace('/practice');
  if (!state) return <Screen title="学习报告" onBack={back}><LoadingPanel error={error} retry={() => { void reload().catch(() => {}); }} /></Screen>;
  const originalAttempt = state.attempts.find(a => a.status === 'submitted' && (a.id === id || a.paperId === id));
  const attempt = originalAttempt && effectiveAttempt(state, originalAttempt.id);
  const paper = state.papers.find(p => p.id === attempt?.paperId);
  if (!attempt || !paper) return <Screen title="学习报告" onBack={back}><Notice text="这份练习尚未提交，暂时没有报告。" /><Button label="查看我的练习" onPress={() => router.replace('/practice')} /></Screen>;
  const paperReturn = state.paperReturns?.find(record => record.status === 'submitted' && record.attemptId === attempt.id && record.paperId === paper.id);
  const reviewPlan = state.mastery?.reviewPlans.find(plan => plan.id === paper.reviewPlanId);
  const { correct, independent, hint, explanation, unknown, needsCorrection, valid, invalidated } = effectiveReportCounts(attempt);
  const allDeleted = attempt.retainedCount === 0 && attempt.deletedCount > 0;
  const deleted = deletedForAttempt(state, attempt.id);
  const deletedQuestions = new Set(deleted.map(item => item.questionId));
  const evidenceRows = effectiveEvidence(state);
  const mistakes = effectiveMistakes(state);
  const reviewed = attempt.answers.some(answer => !!answer.decisionId);
  const reveal = async (questionId: string) => {
    if (openingRef.current) return;
    if (expanded === questionId) { setExpanded(null); return; }
    openingRef.current = true; setOpening(questionId); setOpenError('');
    try { await act('paper.question.expose', { paperId: paper.id, questionId }); setExpanded(questionId); }
    catch (e) { setOpenError(errorMessage(e)); }
    finally { openingRef.current = false; setOpening(null); }
  };
  const recoverExposure = async () => {
    if (openingRef.current) return;
    openingRef.current = true; setOpening('reload');
    try { await reload(); setOpenError(''); }
    catch (cause) { setOpenError(errorMessage(cause)); }
    finally { openingRef.current = false; setOpening(null); }
  };
  return <Screen title={valid > 0 ? '这次练习的收获' : '原卷与记录状态'} onBack={back}><View><Text style={styles.eyebrow}>本机试用 · 已提交 · 原卷保留</Text><Text style={styles.title}>{valid > 0 ? '每次认真思考，\n都有收获。' : '查看原卷，\n了解记录状态。'}</Text><Text style={styles.subtitle}>{paper.title} · {dateLabel(attempt.submittedAt)} · 原卷 {paper.questions.length} 题</Text></View>
    {deleted.length > 0 && <Notice text={`本次有 ${deleted.length} 条作答已删除，不再计入答对数或报告分母，也不会当成未答错题。${attempt.answers.length ? `剩余 ${attempt.answers.length} 条作答继续显示。` : '本次个人作答已全部删除，提交时间与教学原卷仍保留。'}原先完整成绩不再展示。`} />}
    <Card style={{ gap: 13 }}>{valid > 0 ? <><Stat value={`${correct} / ${valid}`} label="当前有效题中答对" /><Text style={styles.body}>{correct === valid ? '把这次思路记下来，下次再用新题试一试。' : '看见哪里还不清楚，就找到了下一步。'}</Text></> : <><Text style={styles.sectionTitle}>{allDeleted ? '作答已全部删除' : '暂无有效统计'}</Text><Text style={styles.body}>{allDeleted ? '当前无可统计作答。教学题面和删除说明继续保留。' : '当前没有可纳入统计的有效作答，不显示成绩或帮助分类结果。保留的原始记录仍可查看。'}</Text></>}<Text style={styles.caption}>原卷共 {paper.questions.length} 题{invalidated ? `，其中 ${invalidated} 条已标记无效，不计入当前分母` : ''}。正确与帮助程度分别统计；本机样题结果不作为正式学业评价。</Text></Card>
    {valid > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}><Stat value={independent} label="独立答对" /><Stat value={hint} label="提示后答对" /><Stat value={explanation} label="讲解后答对" /><Stat value={needsCorrection} label="首次仍未答对" /></View>}
    {reviewed && !deleted.length && <Card style={ls.section}><Badge>原始提交结果仍保留</Badge><Text style={styles.body}>原始答对 {attempt.originalCorrectCount} / {paper.questions.length}；原始独立答对 {originalAttempt!.answers.filter(answer => answer.correct && answer.help === 'independent').length} 题。</Text><Text style={styles.caption}>上方按当前有效结果统计。本人本机核对未经教师复核，不会凭自述新增独立掌握证据；后续学习订正不会改写首次结果。</Text></Card>}
    {unknown > 0 && <Notice text={`${unknown} 道题的独立完成程度无法确认，未计入独立完成证据。`} />}
    {paperReturn && <Card style={ls.section}><Badge>纸面作答 · 人工核对</Badge><Text style={styles.body}>原卷第 {paperReturn.paperVersion} 版 · {paperReturn.entries.length} 题 · {paperReturn.uploadIds.length} 张原稿</Text><Text style={styles.caption}>纸面自述与 App 内已记录的帮助分别保留。自述独立不等于已核实独立，本次纸面记录不增加独立新题星级。</Text>
      {paperReturn.entries.filter(entry => !deletedQuestions.has(entry.questionId)).map(entry => <View key={entry.questionId}><Text style={ls.label}>第 {paper.questionIds.indexOf(entry.questionId) + 1} 题 · 自述{entry.claimedHelp === 'independent' ? '独立完成（未核实）' : helpNames[entry.claimedHelp]}</Text><Text style={styles.body}>纸面原答案：{entry.value || '原稿留空'}</Text><Text style={styles.caption}>题号、答案与单位已人工确认；最终帮助记录：{helpNames[attempt.answers.find(answer => answer.questionId === entry.questionId)?.help || 'unknown']}</Text></View>)}
      {paperReturn.uploadIds.map(uploadId => { const upload = state.uploads.find(item => item.id === uploadId); return upload ? <View key={uploadId} style={{ gap: 6 }}><Image accessibilityLabel={`纸面原稿：${upload.name}`} source={{ uri: localPhotoUri(upload.url) }} resizeMode="contain" style={{ width: '100%', height: 210, backgroundColor: '#F3F6EE', borderRadius: 12 }} /><Text style={styles.caption}>{upload.name}</Text></View> : <Notice key={uploadId} text="这张原稿暂时无法读取；已提交的原始答案仍保留。" />; })}
      {paperReturn.onlineDraftSnapshot && <View style={ls.section}><Text style={styles.sectionTitle}>提交前保留的在线草稿</Text><Text style={styles.caption}>这是切换为纸面提交前保留的在线输入，不参与本次纸面判分；已删除作答的对应草稿不再展示。</Text>{paperReturn.onlineDraftSnapshot.answers.filter(answer => !deletedQuestions.has(answer.questionId)).map(answer => <View key={answer.questionId}><Text selectable style={styles.body}>第 {paper.questionIds.indexOf(answer.questionId) + 1} 题：{answer.value || '未填写答案'}</Text>{!!answer.working && <Text selectable style={styles.body}>{answer.working}</Text>}<Text style={styles.caption}>{helpNames[answer.help]}</Text></View>)}</View>}
    </Card>}
    <Text style={styles.caption}>展开解析只记录这道题的帮助曝光，并同步同题族的未完成练习。已提交的原始作答与成绩不变。</Text>
    {!!openError && <View style={ls.section}><Notice text={openError} error /><Button label={opening === 'reload' ? '正在重读…' : '重读本机记录后再试'} secondary disabled={!!opening} onPress={() => { void recoverExposure(); }} /><Text style={styles.caption}>重读不会自动打开目标题解析，请重读成功后再次点击。</Text></View>}
    <View style={ls.section}><Text style={styles.sectionTitle}>把每道题看清楚</Text>{paper.questions.map((q, index) => {
      const answer = attempt.answers.find(a => a.questionId === q.id);
      const evidence = evidenceRows.find(e => e.attemptId === attempt.id && e.questionId === q.id);
      const mistake = mistakes.find(m => m.evidenceId === evidence?.id);
      const open = expanded === q.id;
      const removed = deletedQuestions.has(q.id);
      return <Card key={q.id} style={ls.section}><Badge>{`第 ${index + 1} 题 · ${removed ? '作答已删除' : answer?.valid === false ? '已标记无效' : answer?.correct ? '回答正确' : '首次未答对'}`}</Badge><Text style={ls.question}>{q.text}</Text>{removed ? <Notice text="本题个人作答与过程已删除，不计对错。教学题目仍保留，可以查看题库解析。" /> : <Text style={styles.body}>当前记录答案：{answer?.value || '未填写'}</Text>}<Text style={styles.caption}>{knowledgeNames[answer?.knowledgeId || q.knowledgeId]} · {removed ? '已删除 · 不计入报告' : answer ? effectiveHelpLabel(answer) : '未作答'}</Text>{answer?.decisionId && <><Text style={styles.caption}>{evidenceAuthorityLabel(answer.authority)}</Text><Text selectable style={styles.body}>原始答案：{answer.original.value || '未填写'} · {answer.original.correct ? '原判答对' : '原判未答对'} · {helpNames[answer.original.help]}</Text></>}{evidence && <Button label="申请更正 / 查看核对记录" secondary disabled={!!opening} onPress={() => router.push(evidenceLink(evidence.id))} />}<Button label="带这道题问小禾" secondary disabled={!!opening} onPress={() => router.push(companionQuestionLink(q, paper.id))} /><Button label={opening === q.id ? '正在记录…' : open ? '收起过程与解析' : '查看过程与解析'} secondary disabled={!!opening} onPress={() => { void reveal(q.id); }} />{open && <View style={ls.section}><View style={ls.rule} />{!removed && <><Text style={ls.label}>原始思考过程</Text><Text style={styles.body}>{answer?.working || '这次没有填写过程，下次可以把想法也记下来。'}</Text></>}<Text style={ls.label}>参考答案：{q.answer} {q.unit}</Text>{q.steps.map((step, i) => <Text key={i} style={styles.body}>{i + 1}. {step}</Text>)}{!!evidence?.reason && <Notice text={evidence.reason} />}<Text style={styles.caption}>来源：{q.source} · 题目 v{q.version} · 试卷 v{paper.version}</Text>{mistake && <Button label={mistake.correctedAt ? '查看订正记录' : '去订正这道题'} disabled={!!opening} onPress={() => router.push({ pathname: '/mistakes', params: { id: mistake.id } })} />}</View>}</Card>;
    })}</View>
    <Button label="管理本报告的历史作答" secondary disabled={!!opening || !evidenceRows.some(item => item.attemptId === attempt.id)} onPress={() => router.push(historyLink({ paperId: paper.id }))} />
    <Button label={reviewPlan ? '查看这次复查的来源计划' : '查看这次作答的复查计划'} secondary disabled={!!opening} onPress={() => router.push({ pathname: '/review-plans', params: { paperId: reviewPlan?.sourcePaperId || paper.id, ...(reviewPlan ? { knowledge: reviewPlan.knowledgeId, status: 'all' } : {}) } })} /><Button label="导出与打印这份试卷" secondary disabled={!!opening} onPress={() => router.push({ pathname: '/paper-export/[paperId]', params: { paperId: paper.id } })} /><Button label="整理我的错题" disabled={!!opening} onPress={() => router.push('/mistakes')} /><Button label="查看知识点与依据" secondary disabled={!!opening} onPress={() => router.navigate('/knowledge')} /><Button label="准备下一份练习" secondary disabled={!!opening} onPress={() => router.navigate('/practice')} />
  </Screen>;
}
