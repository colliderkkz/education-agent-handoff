import { realEvidence, effectiveHelpLabel, evidenceAuthorityLabel, evidenceLink } from '../components/learning/evidenceView';
import { useRef, useState } from 'react';
import { router, usePreventRemove } from 'expo-router';
import { Alert, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Badge, Button, Card, InfoNote } from '../components/ui';
import { Chip, errorMessage, helpNames, knowledgeNames, learningStyles as ls, LoadingPanel, Notice } from '../components/learning/LearnUI';
import { fullDateTime } from '../components/learning/reviewTime';
import { companionQuestionLink } from '../components/learning/companionLink';
import { useLearning } from '../context/LearningContext';
import { historyLink } from '../features/history-deletion-ui';
import type { LearningPreference } from '../local/types';
import { styles } from '../theme';

const back = () => router.canGoBack() ? router.back() : router.replace('/profile');
const preferenceNames = { stepwise: '分步骤，慢慢看', compact: '先看简洁要点' };
export default function MemoryScreen() {
  const { state, error: loadError, reload, act } = useLearning();
  const [choice, setChoice] = useState<LearningPreference['value'] | null>(null);
  const [sourceRevision, setSourceRevision] = useState<number | null>(null);
  const [deletePreview, setDeletePreview] = useState<{ revision: number; preference: LearningPreference } | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [showAllSummaries, setShowAllSummaries] = useState(false);
  const [leaving, setLeaving] = useState(false);
  usePreventRemove((!!operation || choice !== null) && !leaving, ({ repeat }) => {
    if (lock.current) { Alert.alert('正在保存本机记录', '请等本次操作完成后再返回。'); return; }
    Alert.alert('讲解偏好还没有保存', '当前选择仍在页面中，可以留下保存，或放弃这次修改后返回。', [{ text: '留下保存', style: 'cancel' }, { text: '放弃修改并返回', onPress: () => { setLeaving(true); repeat(); } }]);
  });
  const run = async (label: string, work: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setOperation(label); setError(''); setNotice('');
    try { await work(); } catch (cause) { setError(errorMessage(cause)); }
    finally { lock.current = false; setOperation(null); }
  };
  if (!state) return <Screen title="我的学习记忆" onBack={back}><LoadingPanel error={loadError} retry={() => { void reload().catch(() => {}); }} /></Screen>;
  const preference = state.companion?.preferences.find(item => item.key === 'presentation');
  const evidence = realEvidence(state).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rows = showAll ? evidence : evidence.slice(0, 6);
  const changed = sourceRevision !== null && sourceRevision !== state.revision;
  const refresh = () => run('reload', async () => {
    const latest = await reload(); setSourceRevision(latest.revision); setDeletePreview(null);
    setNotice(choice ? '已重读本机记录，保留了你的选择。请核对当前偏好后再确认保存。' : '已重新读取本机学习记忆。');
  });
  return <Screen title="我的学习记忆" onBack={back}>
    <View><Text style={styles.eyebrow}>来源看得见 · 选择由自己</Text><Text style={styles.title}>小禾记住了什么？</Text><Text style={styles.subtitle}>本人设置、课程范围和作答事实，分别看清楚。</Text></View>
    <InfoNote text="对话不会自动变成能力或性格标签。这里不记录“懒惰、粗心”等推断。所有内容只在这台设备保存。" />
    {!!error && <Notice text={error} error />}{!!notice && <Notice text={notice} />}
    <Card style={ls.section}><Badge>本人档案</Badge><Text style={styles.sectionTitle}>{state.profile.name}</Text><Text style={styles.body}>称呼可以在“我的”中修改，不需要填写真实姓名。</Text><Text style={styles.caption}>来源：本机学习档案。早期档案未记录字段更新时间，这里不推测填写时间。</Text><Button label="打开我的档案" secondary disabled={!!operation || choice !== null} onPress={() => router.navigate('/profile')} /></Card>
    <Card style={ls.section}><Badge>课程设置</Badge><Text style={styles.sectionTitle}>{state.profile.grade} · {state.profile.course}</Text><Text style={styles.body}>{state.profile.semester} · {state.profile.textbook}</Text><Text style={styles.caption}>来源：当前本机课程配置。试用内容范围是四年级数学样题；这不是根据对话推断的能力。</Text></Card>
    <Card style={ls.section}><Badge>由本人明确选择</Badge><Text style={styles.sectionTitle}>我希望怎样看讲解</Text><Text style={styles.body}>{preference ? `当前：${preferenceNames[preference.value]}` : '暂未设置，使用题库默认讲解。'}</Text>{preference && <Text style={styles.caption}>来源：本人设置 · 最近修改 {fullDateTime(preference.updatedAt)}</Text>}<Text style={styles.caption}>只调整题库回应的呈现方式，不代表学习能力，也不会推断或改变你的性格。已经保存的回应保持原样。</Text>
      <View style={ls.wrap}>{(Object.keys(preferenceNames) as LearningPreference['value'][]).map(value => <Chip key={value} text={preferenceNames[value]} selected={(choice ?? preference?.value) === value} disabled={!!operation} onPress={() => { if (lock.current) return; setChoice(value); setSourceRevision(state.revision); setDeletePreview(null); setError(''); }} />)}</View>
      {choice !== null && <><Text style={styles.body}>准备设置为：{preferenceNames[choice]}</Text>{changed && <Notice text="本机记录已经变化。请重读保留选择，再核对保存。" />}<Button label={operation === 'save' ? '正在保存…' : '确认这是我的讲解偏好'} disabled={!!operation || changed} onPress={() => { void run('save', async () => { await act('memory.preference.set', { key: 'presentation', value: choice, sourceRevision }); setChoice(null); setSourceRevision(null); setNotice('讲解偏好已保存。之后的题库回应会按你的选择呈现。'); }); }} /><Button label="取消这次修改" secondary disabled={!!operation} onPress={() => { setChoice(null); setSourceRevision(null); }} /></>}
      {preference && choice === null && <Button label="查看删除这个偏好的影响" secondary disabled={!!operation} onPress={() => setDeletePreview({ revision: state.revision, preference: { ...preference } })} />}
      {deletePreview && <View style={ls.section}><View style={ls.rule} /><Text style={styles.sectionTitle}>将删除“{preferenceNames[deletePreview.preference.value]}”偏好</Text><Text style={styles.body}>以后采用题库默认呈现。历史回应中已使用该偏好的记录、原始作答、帮助事实和报告仍保留。</Text>{deletePreview.revision !== state.revision && <Notice text="记录已有变化，请重新查看删除影响。" />}<Button label="确认删除这个讲解偏好" secondary disabled={!!operation || deletePreview.revision !== state.revision} onPress={() => { void run('delete', async () => { await act('memory.preference.delete', { key: 'presentation', sourceRevision: deletePreview.revision }); setDeletePreview(null); setNotice('本人讲解偏好已删除，今后使用题库默认呈现。'); }); }} /><Button label="保留这个偏好" secondary disabled={!!operation} onPress={() => setDeletePreview(null)} /></View>}
    </Card>
    <Button label={operation === 'reload' ? '正在重读…' : '重读本机记录，保留当前选择'} secondary disabled={!!operation} onPress={() => { void refresh(); }} />
    <Card style={ls.section}><Badge>由原始作答证据得来</Badge><Text style={styles.sectionTitle}>每一条表现，都有来处</Text><Text style={styles.body}>共 {evidence.length} 条作答证据。正确与帮助程度分开记录，单次错误不代表固定能力；星级依据见知识点页。</Text><Button label="查看知识点的评定依据" secondary disabled={!!operation || choice !== null} onPress={() => router.navigate('/knowledge')} /></Card>
    {rows.map(item => {
      const paper = state.papers.find(record => record.id === item.paperId);
      const question = paper?.questions.find(record => record.id === item.questionId);
      return <Card key={item.id} style={ls.section}><Badge>{`${knowledgeNames[item.knowledgeId]} · ${!item.valid ? '已标记无效' : item.correct ? '回答正确' : '需要再理解'}`}</Badge><Text style={styles.body}>{item.questionText}</Text><Text selectable style={styles.body}>原始答案：{item.original.answer || '未填写'}</Text><Text style={styles.caption}>原始帮助：{helpNames[item.original.help]} · {fullDateTime(item.createdAt)}</Text>{item.decisionId && <><Text selectable style={styles.body}>当前答案：{item.answer || '未填写'} · {effectiveHelpLabel(item)}</Text><Text style={styles.caption}>{evidenceAuthorityLabel(item.authority)}{item.masteryBlockedReason ? ` · ${item.masteryBlockedReason}` : ''}</Text></>}<Text style={styles.caption}>来源：{paper?.title || '已保存的原始作答'} · 题目 v{item.questionVersion}</Text>{!!item.reason && <Text style={styles.caption}>{item.reason}</Text>}<Button label="申请更正 / 查看核对记录" secondary disabled={!!operation || choice !== null} onPress={() => router.push(evidenceLink(item.id))} /><Button label="查看来源报告" secondary disabled={!!operation || choice !== null} onPress={() => router.push({ pathname: '/report/[id]', params: { id: item.paperId } })} />{question && <Button label="带这道题问小禾" secondary disabled={!!operation || choice !== null} onPress={() => router.push(companionQuestionLink(question, item.paperId))} />}</Card>;
    })}
    {!evidence.length && <Notice text="还没有作答证据。完成练习后，来源时间、题目版本与帮助情况会出现在这里。" />}
    {evidence.length > 6 && <Button label={showAll ? '收起较早证据' : `查看全部 ${evidence.length} 条证据`} secondary disabled={!!operation} onPress={() => setShowAll(!showAll)} />}
    <Card style={ls.section}><Badge>本人单独保存</Badge><Text style={styles.sectionTitle}>求助摘要</Text><Text style={styles.caption}>与私人对话分开保存。删除会话会保留这些明确另存的摘要；当前没有在线教师收件服务。</Text>{(showAllSummaries ? state.helpRequests : state.helpRequests.slice(0, 5)).map(item => <View key={item.id} style={ls.section}><View style={ls.rule} /><Badge>{item.delivery === 'local-only' ? '本机保存 · 尚未发送' : '历史摘要 · 收件状态需核实'}</Badge><Text style={styles.body}>{item.topic}</Text><Text selectable style={styles.body}>{item.summary}</Text><Text style={styles.caption}>{fullDateTime(item.createdAt)}</Text>{item.context && (item.context.source === 'paper' || item.context.source === 'bank') && <><Text style={styles.caption}>题目 v{item.context.questionVersion} · {item.context.questionText}</Text>{item.context.source === 'paper' && item.context.paperId && <Button label="查看摘要的原试卷" secondary disabled={!!operation || choice !== null} onPress={() => { if (item.context && 'paperId' in item.context && item.context.paperId) router.push({ pathname: '/paper/[paperId]', params: { paperId: item.context.paperId } }); }} />}</>}</View>)}{!state.helpRequests.length && <Text style={styles.body}>还没有单独保存的求助摘要。</Text>}{state.helpRequests.length > 5 && <Button label={showAllSummaries ? '收起较早摘要' : `查看全部 ${state.helpRequests.length} 份摘要`} secondary disabled={!!operation} onPress={() => setShowAllSummaries(!showAllSummaries)} />}</Card>
    <Card style={ls.section}><Text style={styles.sectionTitle}>更正与删除的边界</Text><Text style={styles.body}>昵称和本人讲解偏好可以修改；对话可在会话页查看影响后删除。错题订正会追加新答案，保留第一次作答。</Text><Text style={styles.caption}>本人更正申请与本机核对保留原始提交，未经教师复核。删除历史作答则会移除所选原答案、过程及关联记录，并更新报告与评定。标记无效不是删除。请先查看影响，原稿照片需要另行选择。</Text><Button label="管理与删除历史作答" secondary disabled={!!operation || choice !== null} onPress={() => router.push(historyLink())} /><Button label="管理我的对话" secondary disabled={!!operation || choice !== null} onPress={() => router.push('/chat')} /></Card>
  </Screen>;
}
