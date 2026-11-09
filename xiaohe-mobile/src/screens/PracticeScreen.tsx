import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Badge, Button, Card } from '../components/ui';
import { Chip, dateLabel, errorMessage, learningStyles as ls, LoadingPanel, Notice } from '../components/learning/LearnUI';
import { useLearning } from '../context/LearningContext';
import type { KnowledgeId, WorkspaceState } from '../local/types';
import { styles } from '../theme';

export default function PracticeScreen() {
  const learning = useLearning();
  const { knowledge, configure } = useLocalSearchParams<{ knowledge?: string; configure?: string }>();
  if (!learning.state) return <Screen><LoadingPanel error={learning.error} retry={() => { void learning.reload().catch(() => {}); }} /></Screen>;
  return <PaperList key={`${knowledge || 'all'}:${configure || ''}`} state={learning.state} act={learning.act} busy={learning.busy} scoped={knowledge} />;
}
function PaperList({ state, act, busy, scoped }: { state: WorkspaceState; act: ReturnType<typeof useLearning>['act']; busy: boolean; scoped?: string }) {
  const defaults = scoped && state.knowledge.some(k => k.id === scoped && k.learningState === 'current') ? [scoped as KnowledgeId] : state.knowledge.filter(k => k.learningState === 'current').map(k => k.id);
  const [selected, setSelected] = useState<KnowledgeId[]>(defaults);
  const [count, setCount] = useState(3);
  const [difficulty, setDifficulty] = useState('综合');
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const create = async () => {
    if (creating || !selected.length) return;
    setCreating(true); setError('');
    try { const result = await act('paper.create', { count, knowledgeIds: selected, difficulty, kind: 'practice' }); if (result.result?.id) router.push({ pathname: '/paper/[paperId]', params: { paperId: result.result.id } }); } catch (e) { setError(errorMessage(e)); } finally { setCreating(false); }
  };
  const papers = state.papers.filter(p => filter === 'all' || (filter === 'completed' ? p.status === 'completed' : p.status !== 'completed'));
  return <Screen><View><Text style={styles.eyebrow}>本机试用 · 练习</Text><Text style={styles.title}>每一步，都算数。</Text><Text style={styles.subtitle}>挑选一个小目标，给思考留一点时间。</Text></View>
    <Card style={ls.section}><Text style={styles.sectionTitle}>准备一份练习</Text><Text style={ls.label}>这次想练什么？</Text><View style={ls.wrap}>{state.knowledge.map(k => <Chip key={k.id} text={`${k.name}${k.learningState === 'upcoming' ? ' · 未学' : ''}`} selected={selected.includes(k.id)} disabled={k.learningState !== 'current' || creating} onPress={() => { setError(''); setSelected(previous => previous.includes(k.id) ? previous.filter(id => id !== k.id) : [...previous, k.id]); }} />)}</View>
      <Text style={ls.label}>题量</Text><View style={ls.wrap}>{[3, 6, 9].map(n => <Chip key={n} text={`${n} 题`} selected={count === n} onPress={() => setCount(n)} />)}</View>
      <Text style={ls.label}>难度</Text><View style={ls.wrap}>{['综合', '基础', '巩固', '挑战'].map(value => <Chip key={value} text={value} selected={difficulty === value} onPress={() => setDifficulty(value)} />)}</View>
      <Text style={styles.caption}>这里准备知识点巩固练习。间隔新题复查需从已生成的复查计划开始。</Text><Button label="查看复查计划" secondary disabled={creating} onPress={() => router.push('/review-plans')} />
      <Text style={styles.caption}>本机样题共 {state.questions.length} 道；会排除已看帮助和近 14 天试卷题族。题量不足时会说明原因。</Text>{!!error && <Notice text={error} error />}<Button label={creating ? '正在准备…' : `确认范围，生成 ${count} 题`} disabled={busy || creating || !selected.length} onPress={() => { void create(); }} />
    </Card>
    <View style={ls.section}><Text style={styles.sectionTitle}>我的练习 · {state.papers.length} 份</Text><View style={ls.wrap}>{[['all', '全部'], ['pending', '待完成'], ['completed', '已完成']].map(([value, label]) => <Chip key={value} text={label} selected={filter === value} onPress={() => setFilter(value)} />)}</View>{papers.map(p => <Card key={p.id} style={ls.section}><Badge>{p.status === 'completed' ? '已完成' : p.status === 'in_progress' ? '草稿已保存' : '待开始'}</Badge><Text style={styles.sectionTitle}>{p.title}</Text><Text style={styles.body}>{p.questions.length} 题 · 约 {p.estimatedMinutes} 分钟 · v{p.version}</Text><Text style={styles.caption}>{dateLabel(p.createdAt)} 创建{p.parentId ? ' · 换题后另存' : ''}</Text><Button label={p.status === 'completed' ? '查看练习报告' : p.status === 'in_progress' ? '继续练习' : '预览与开始'} secondary onPress={() => router.push(p.status === 'completed' ? { pathname: '/report/[id]', params: { id: p.id } } : { pathname: p.status === 'in_progress' ? '/practice/[paperId]' : '/paper/[paperId]', params: { paperId: p.id } })} /></Card>)}{papers.length === 0 && <Card><Text style={styles.body}>{state.papers.length ? '这个分类暂时没有练习。' : '第一份练习从上面的选择开始。还没有历史作答记录。'}</Text></Card>}</View>
    <Button label="查看我的错题与订正" secondary onPress={() => router.push('/mistakes')} />
  </Screen>;
}
