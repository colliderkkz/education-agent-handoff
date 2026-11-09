import { effectiveMistakes, realEvidence } from '../components/learning/evidenceView';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Badge, Button, Card, InfoNote } from '../components/ui';
import { useLearning } from '../context/LearningContext';
import { historyLink } from '../features/history-deletion-ui';
import { colors, styles } from '../theme';

export default function ProfileScreen() {
  const { state, loading, error, busy, act, reload } = useLearning();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const operation = useRef(false);
  const disabled = busy || loading || saving || reloading;

  async function saveName() {
    if (disabled || operation.current) return;
    if (!name.trim()) { setSaveError('给自己取一个喜欢的昵称吧。'); return; }
    operation.current = true; setSaving(true); setSaveError(''); setNotice('');
    try {
      await act('profile.update', { profile: { name: name.trim() } });
      setEditing(false); setNotice('昵称已保存在这台手机。');
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : '暂时没能保存，昵称还在，可以再试一次。'); }
    finally { operation.current = false; setSaving(false); }
  }

  async function reloadRecords() {
    if (disabled || operation.current) return;
    operation.current = true; setReloading(true); setNotice('');
    try {
      await reload();
      setSaveError('');
      setNotice(editing ? '本机记录已重新读取。正在编辑的昵称还在，可以再次保存。' : '本机学习记录已重新读取。');
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : '暂时无法重新读取，正在编辑的昵称会保留。'); }
    finally { operation.current = false; setReloading(false); }
  }

  if (loading && !state) return <Screen><Card style={{ gap: 15, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /><Text style={styles.body}>正在打开你的本机学习档案…</Text></Card></Screen>;
  if (!state) return <Screen><Text style={styles.title}>我的学习空间</Text><Card style={{ gap: 16 }}><Text style={styles.body}>{saveError || error || '学习档案暂时没有打开，原有记录不会被重置。'}</Text><Button label={reloading ? '正在重新读取…' : '重新读取档案'} disabled={disabled} onPress={() => { void reloadRecords(); }} /></Card></Screen>;
  const attempts = state.attempts.filter(attempt => attempt.status === 'submitted' && !attempt.id.startsWith('demo-'));
  const evidence = realEvidence(state);
  const evidenceIds = new Set(evidence.map(item => item.id));
  const pendingMistakes = effectiveMistakes(state).filter(item => !item.correctedAt && evidenceIds.has(item.evidenceId));
  const independent = evidence.filter(item => item.valid && item.correct && item.help === 'independent').length;
  const draftCount = state.attempts.filter(item => item.status === 'draft').length;

  return <Screen>
    <View><Text style={styles.eyebrow}>属于你的成长</Text><Text style={styles.title}>我的学习空间</Text><Text style={styles.subtitle}>每一份认真，都留在这台手机里。</Text></View>
    <Card style={{ gap: 18 }}>
      <View style={styles.row}><View style={s.avatar}><Icon name="person" size={30} /></View><View style={{ flex: 1, gap: 7 }}><Text style={s.name}>{state.profile.name || '小禾同学'}</Text><Badge>本机学习 · 无需登录</Badge></View></View>
      <View style={s.course}><Text style={s.courseName}>{state.profile.grade} · {state.profile.course}</Text><Text style={styles.caption}>{state.profile.semester} · {state.profile.textbook}</Text></View>
      {editing ? <View style={{ gap: 12 }}><Text style={s.label}>你希望小禾怎样称呼你？</Text><TextInput style={s.input} accessibilityLabel="学习昵称" value={name} onChangeText={setName} editable={!disabled} maxLength={30} placeholder="输入昵称，不需要真实姓名" placeholderTextColor="#8C9A85" autoCapitalize="none" returnKeyType="done" onSubmitEditing={() => { void saveName(); }} /><Button label={saving ? '正在保存…' : '保存昵称'} icon="check" disabled={disabled || !name.trim()} onPress={() => { void saveName(); }} /><Button label="取消修改" secondary disabled={disabled} onPress={() => { setEditing(false); setSaveError(''); }} /></View> : <Pressable accessibilityRole="button" accessibilityLabel="修改学习昵称" disabled={disabled} onPress={() => { setName(state.profile.name); setEditing(true); setNotice(''); }} style={s.editLink}><Text style={s.linkText}>修改昵称</Text><Icon name="arrow" size={16} /></Pressable>}
      {(saveError || error) ? <View style={{ gap: 12 }}><Text accessibilityRole="alert" style={s.error}>{saveError || error}</Text><Text style={styles.caption}>可以先重新读取已保存的记录。正在编辑的昵称会保留。</Text><Button label={reloading ? '正在重新读取…' : '重新读取本机记录'} secondary disabled={disabled} onPress={() => { void reloadRecords(); }} /></View> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={s.success}>{notice}</Text> : null}
    </Card>
    <View style={{ gap: 13 }}><Text style={styles.sectionTitle}>一点点积累</Text><View style={s.metrics}>{[{ value: attempts.length, label: '完成练习' }, { value: independent, label: '独立答对' }, { value: pendingMistakes.length, label: '等待订正' }].map(item => <View style={s.metric} key={item.label}><Text style={s.metricValue}>{item.value}</Text><Text style={s.metricLabel}>{item.label}</Text></View>)}</View><Text style={styles.caption}>这里按当前有效结果统计，原始提交仍保留。独立答对标签不等于新增独立掌握证据；本机核对未经教师复核。</Text></View>
    <Card style={{ gap: 16 }}><View style={styles.row}><View style={s.rowIcon}><Icon name="paper" size={23} /></View><View style={{ flex: 1, gap: 5 }}><Text style={s.rowTitle}>我的练习记录</Text><Text style={styles.caption}>{draftCount ? `${draftCount} 份练习还可以接着做` : '生成一份练习，按自己的节奏开始'}</Text></View></View><Button label={draftCount ? '继续我的练习' : '去练一练'} onPress={() => router.push('/(tabs)/practice')} /></Card>
    <View style={{ gap: 13 }}><Text style={styles.sectionTitle}>本机保存，安心学习</Text><Card style={{ gap: 17 }}><View style={s.detailRow}><Text style={s.detailLabel}>学习档案</Text><Text style={s.detailValue}>保存在本机</Text></View><View style={s.detailRow}><Text style={s.detailLabel}>拍题图片</Text><Text style={s.detailValue}>{state.uploads.length} 张已保存</Text></View><View style={s.detailRow}><Text style={s.detailLabel}>适用内容</Text><Text style={s.detailValue}>四年级数学样题</Text></View><Text style={styles.body}>退出后再打开，已保存的记录仍会保留。图片和学习记录不会由小禾自动上传，也不会自动分享给其他人。</Text></Card></View>
    <View style={{ gap: 13 }}><Text style={styles.sectionTitle}>现在可以这样用</Text><Card style={{ gap: 15 }}><View style={styles.row}><Icon name="check" size={19} /><Text style={[styles.body, { flex: 1 }]}>选题练习、分步提示、错题订正和查看学习证据。</Text></View><View style={styles.row}><Icon name="check" size={19} /><Text style={[styles.body, { flex: 1 }]}>拍照或选取图片，手工输入题干，与本机题库逐题核对。</Text></View><Text style={styles.caption}>当前不会自动识别图片，也没有联网 AI、跨设备同步或老师在线回复。讲解来自已准备的教学样题。</Text></Card></View>
    <Card style={{ gap: 15 }}><Text style={styles.sectionTitle}>我的学习记忆</Text><Text style={styles.body}>分清本人设置与作答证据，查看来源，修改讲解偏好，管理私人对话。</Text><Button label="查看学习记忆与本人偏好" secondary disabled={disabled || editing} onPress={() => router.push('/memory')} /><Button label="继续我的学伴对话" secondary disabled={disabled || editing} onPress={() => router.push('/chat')} /><Button label="管理与删除历史作答" secondary disabled={disabled || editing} onPress={() => router.push(historyLink())} /></Card>
    <Card style={{ gap: 15 }}><Text style={styles.sectionTitle}>题库内容包</Text><Text style={styles.body}>从本机文件预览新增、更新与停用内容，确认后再应用。已有试卷和学习记录保留。</Text><Button label="管理本机题库内容包" secondary disabled={disabled} onPress={() => router.push('/content-packs')} /></Card>
    <InfoNote text="请妥善保留这台手机的应用数据。卸载 App 或清除应用数据可能丢失本机记录，当前还没有云端备份。" />
    <Text style={s.version}>小禾学伴 · 本机学习试用版</Text>
  </Screen>;
}
const s = StyleSheet.create({
  avatar: { width: 63, height: 63, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }, name: { fontSize: 21, lineHeight: 30, color: colors.ink, fontWeight: '600' }, course: { gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 17 }, courseName: { fontSize: 14, lineHeight: 22, color: colors.ink, fontWeight: '500' }, label: { fontSize: 13, color: colors.ink, lineHeight: 22 }, input: { borderWidth: 1, borderColor: '#D9E6D3', borderRadius: 12, padding: 14, backgroundColor: '#FBFDF8', fontSize: 15, lineHeight: 23, color: colors.ink, minHeight: 49 }, editLink: { flexDirection: 'row', gap: 9, alignItems: 'center', minHeight: 40, alignSelf: 'flex-start', paddingVertical: 7 }, linkText: { color: colors.primary, fontSize: 13, fontWeight: '500' }, metrics: { flexDirection: 'row', gap: 10 }, metric: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 16, alignItems: 'center', paddingVertical: 21, gap: 7 }, metricValue: { fontSize: 27, color: colors.primary, fontWeight: '600', fontVariant: ['tabular-nums'] }, metricLabel: { fontSize: 11, color: colors.muted }, rowIcon: { padding: 12, backgroundColor: colors.primaryLight, borderRadius: 15 }, rowTitle: { fontSize: 15, lineHeight: 23, color: colors.ink, fontWeight: '600' }, detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 15 }, detailLabel: { color: colors.muted, fontSize: 13 }, detailValue: { color: colors.ink, fontSize: 13, flexShrink: 1, textAlign: 'right' }, error: { color: colors.error, fontSize: 12, lineHeight: 21 }, success: { color: colors.primary, fontSize: 12, lineHeight: 21 }, version: { fontSize: 11, color: colors.muted, textAlign: 'center', paddingVertical: 10 },
});
