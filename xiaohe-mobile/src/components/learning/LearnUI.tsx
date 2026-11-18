import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, styles } from '../../theme';
import { Button, Card } from '../ui';
import type { HelpLevel, KnowledgeId } from '../../local/types';

export const knowledgeNames: Partial<Record<KnowledgeId, string>> = { division: '估商与检验', geometry: '周长与面积', multiplication: '乘法与运算' };
export const helpNames: Record<HelpLevel, string> = { independent: '独立作答', hint: '使用提示', explanation: '看过讲解', unknown: '帮助情况待确认' };
export function dateLabel(value?: string) { if (!value) return '尚未提交'; const d = new Date(value); return `${d.getMonth() + 1}月${d.getDate()}日`; }
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作未完成，请重试。'; }
export function LoadingPanel({ error, retry }: { error?: string | null; retry: () => void }) {
  return <Card style={{ gap: 16, alignItems: 'center' }}>{error ? <><Text style={styles.sectionTitle}>暂时无法读取本机记录</Text><Text style={styles.body}>{error}</Text><Button label="重新读取" onPress={retry} /></> : <><ActivityIndicator color={colors.primary} /><Text style={styles.body}>正在打开本机学习空间…</Text></>}</Card>;
}
export function Notice({ text, error = false }: { text: string; error?: boolean }) { return <View style={[s.notice, error && s.errorNotice]}><Text accessibilityLiveRegion="polite" style={[s.noticeText, error && { color: colors.error }]}>{text}</Text></View>; }
export function Chip({ text, selected = false, disabled = false, onPress }: { text: string; selected?: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.chip, selected && s.chipSelected, disabled && { opacity: .45 }, pressed && { opacity: .75 }]}><Text style={[s.chipText, selected && { color: colors.primary }]}>{text}</Text></Pressable>;
}
export function Stat({ label, value }: { label: string; value: number | string }) { return <View style={s.stat}><Text style={s.statValue}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>; }
export const learningStyles = StyleSheet.create({
  input: { minHeight: 51, borderWidth: 1, borderColor: '#D5E2D0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: colors.ink, backgroundColor: '#FCFDF9', fontSize: 16, lineHeight: 24 },
  textArea: { minHeight: 118, textAlignVertical: 'top' },
  question: { fontSize: 19, lineHeight: 31, color: colors.ink, fontWeight: '600' },
  label: { fontSize: 14, color: colors.ink, lineHeight: 24, fontWeight: '600' },
  wrap: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  rule: { height: 1, backgroundColor: colors.border },
  section: { gap: 13 },
});
const s = StyleSheet.create({ notice: { backgroundColor: colors.primaryLight, borderRadius: 13, padding: 16 }, noticeText: { color: colors.primary, fontSize: 12, lineHeight: 21 }, errorNotice: { backgroundColor: '#FBEEE8' }, chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 12, minHeight: 44, justifyContent: 'center' }, chipSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, chipText: { fontSize: 13, lineHeight: 20, color: colors.muted }, stat: { flex: 1, minWidth: 65, gap: 5, alignItems: 'center', paddingVertical: 8 }, statValue: { fontSize: 27, lineHeight: 35, fontWeight: '600', color: colors.primary }, statLabel: { fontSize: 11, color: colors.muted, textAlign: 'center', lineHeight: 19 } });
