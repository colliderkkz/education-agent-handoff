import { effectiveMistakes, effectiveReviewPlanCounts, realEvidence } from '../components/learning/evidenceView';
import { router } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Badge, Button, Card } from '../components/ui';
import { LoadingPanel, Stat } from '../components/learning/LearnUI';
import { stageLabel, stageOptions, stageOf, subjectsOfStage } from '../components/learning/stage';
import { useLearning } from '../context/LearningContext';
import { colors, styles } from '../theme';
import type { StageId } from '../local/shared/types';

export default function HomeScreen() {
  const { state, error, reload, stage, setStage } = useLearning();
  if (!state) return <Screen><LoadingPanel error={error} retry={() => { void reload().catch(() => {}); }} /></Screen>;
  const unfinished = state.papers.find(p => p.status === 'in_progress');
  const completed = state.attempts.filter(a => a.status === 'submitted').length;
  const pending = effectiveMistakes(state).filter(m => !m.correctedAt).length;
  const reviewCount = effectiveReviewPlanCounts(state);
  const mistakes = effectiveMistakes(state, { includeInactive: true });
  // 三条学段线：小学、上海初中、上海高中 —— 导入上海内容包后，这里才会出现初中和高中。
  const stageLines = stageOptions.map(option => {
    const points = state.knowledge.filter(item => stageOf(item.id) === option.id);
    const ids = points.map(item => item.id);
    const subjects = subjectsOfStage(ids);
    return {
      ...option,
      points: points.length,
      unlocked: points.filter(item => item.learningState === 'current').length,
      pending: mistakes.filter(item => item.active && !item.correctedAt && ids.includes(item.knowledgeId)).length,
      subjects: subjects.length ? subjects.join(' / ') : '还没有内容',
    };
  });
  const openStage = (next: StageId) => { setStage(next); router.navigate('/knowledge'); };
  return <Screen>
    <View><Text style={styles.eyebrow}>小小好奇 · 慢慢生长</Text><Text style={styles.title}>{state.profile.name}，{ '\n' }今天也一起进步。</Text><Text style={styles.subtitle}>把每个小问题，变成看得见的成长。</Text></View>
    <View style={s.hero}><View style={s.heroText}><Badge>本机试用 · 无需登录</Badge><Text style={s.heroTitle}>你好，我是小禾。</Text><Text style={s.heroBody}>不着急知道答案，{ '\n' }先一起想一想。</Text></View><Image source={require('../../assets/xiaohe-companion.png')} style={s.companion} resizeMode="contain" accessibilityLabel="小禾和陪伴学习的绿芽伙伴" /><Text style={s.heroFooter}>陪你理解每一步</Text></View>
    <Card style={{ gap: 14 }}><Text style={styles.sectionTitle}>{unfinished ? '接着上次的思路' : '今天，练一点就很好。'}</Text><Text style={styles.body}>{unfinished ? `${unfinished.title} · ${unfinished.questions.length} 道题，草稿已保存在本机。` : '从下面选一个学段，挑知识点，认真写下一次思考。'}</Text><Button label={unfinished ? '继续练习' : '准备我的练习'} onPress={() => unfinished ? router.push({ pathname: '/practice/[paperId]', params: { paperId: unfinished.id } }) : router.navigate('/practice')} /></Card>
    <View style={{ gap: 13 }}><Text style={styles.sectionTitle}>我的学段</Text><Text style={styles.caption}>小学、初中、高中分开练习 —— 一张卷子只能包含同一学段。点一行切换。</Text>
      {stageLines.map(line => <Pressable key={line.id} accessibilityRole="button" accessibilityLabel={`${line.label}，${line.unlocked} 个知识点，待订正 ${line.pending} 道`} onPress={() => openStage(line.id)} style={({ pressed }) => [s.stage, stage === line.id && s.stageActive, pressed && { opacity: .78 }]}>
        <View style={{ flex: 1, gap: 4 }}><Text style={s.stageTitle}>{line.label}{stage === line.id ? ' · 当前' : ''}</Text><Text style={s.stageSubjects}>{line.subjects}</Text><Text style={s.stageMeta}>{line.points} 个知识点 · 已加入学习 {line.unlocked} 个 · 待订正 {line.pending} 道</Text></View>
        <Icon name="arrow" size={18} color={colors.primary} />
      </Pressable>)}
    </View>
    <Card style={{ gap: 13 }}><Text style={styles.sectionTitle}>有个问题想记下来？</Text><Text style={styles.body}>从一道题接着理思路，或先记下自己的想法。提示与讲解由你明确选择。</Text><Button label="和小禾一起理思路" secondary onPress={() => router.push('/chat')} /></Card>
    <Card style={{ flexDirection: 'row', paddingHorizontal: 10 }}><Stat value={completed} label="已完成练习" /><Stat value={realEvidence(state).length} label="作答记录" /><Stat value={pending} label="待订正" /></Card>
    <Card style={{ gap: 13 }}><Text style={styles.sectionTitle}>留一点间隔，再试新题</Text><Text style={styles.body}>{reviewCount.readyOrWaiting} 项待复查计划{reviewCount.blocked ? `，另有 ${reviewCount.blocked} 项来源待核对` : ''}。看看什么时候可以再用新题试一试。</Text><Button label="查看复查计划" secondary onPress={() => router.push('/review-plans')} /></Card>
    <View style={{ gap: 13 }}><Text style={styles.sectionTitle}>照顾每一步成长</Text><View style={s.features}><Feature icon="book" title="知识地图" text={`${stageLabel(stage)} · 看看作答依据`} color={colors.primaryLight} onPress={() => router.navigate('/knowledge')} /><Feature icon="paper" title="错题订正" text="再想明白一点" color={colors.peach} onPress={() => router.push('/mistakes')} /><Feature icon="person" title="学习档案" text="我的本机记录" color={colors.lavender} onPress={() => router.navigate('/profile')} /></View></View>
    <Button label="真题考情与出处索引" secondary onPress={() => router.push('/exam')} />
    <Text style={s.footer}>当前本机有 {state.questions.length} 道题。记录只保存在这台设备，{ '\n' }用于体验学习流程，不作为正式学业评价。</Text>
  </Screen>;
}
function Feature({ icon, title, text, color, onPress }: { icon: IconName; title: string; text: string; color: string; onPress: () => void }) { return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}，${text}`} style={({ pressed }) => [s.feature, { backgroundColor: color }, pressed && { opacity: .75 }]}><Icon name={icon} size={26} /><Text style={s.featureTitle}>{title}</Text><Text style={s.featureText}>{text}</Text></Pressable>; }
const s = StyleSheet.create({
  hero: { backgroundColor: '#EAF2E2', borderRadius: 23, minHeight: 322, padding: 22, overflow: 'hidden' }, heroText: { zIndex: 1, gap: 9 }, heroTitle: { color: colors.ink, fontSize: 20, fontWeight: '600', lineHeight: 29, marginTop: 4 }, heroBody: { color: colors.muted, fontSize: 13, lineHeight: 23 }, companion: { width: 235, height: 235, alignSelf: 'flex-end', marginTop: -46, marginRight: -20, marginBottom: -6 }, heroFooter: { position: 'absolute', left: 23, bottom: 20, fontSize: 10, color: '#667F55' },
  features: { flexDirection: 'row', gap: 9 }, feature: { flex: 1, paddingHorizontal: 7, paddingVertical: 20, borderRadius: 17, gap: 8, alignItems: 'center', minHeight: 128 }, featureTitle: { color: colors.ink, fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 3 }, featureText: { color: colors.muted, fontSize: 10, lineHeight: 17, textAlign: 'center' },
  stage: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 15, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.surface }, stageActive: { borderColor: '#8FBFA3', backgroundColor: '#EEF6F1' }, stageTitle: { color: colors.ink, fontSize: 15, fontWeight: '600' }, stageSubjects: { color: colors.muted, fontSize: 12 }, stageMeta: { color: colors.muted, fontSize: 11 },
  footer: { textAlign: 'center', fontSize: 11, lineHeight: 20, color: colors.muted, paddingVertical: 6 },
});
