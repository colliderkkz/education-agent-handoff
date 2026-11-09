import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { colors, styles } from '../theme';
import { Icon, type IconName } from './Icon';
export function Button({ label, onPress, secondary = false, disabled = false, icon = 'arrow' }: { label: string; onPress?: () => void; secondary?: boolean; disabled?: boolean; icon?: IconName }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.secondary, disabled && s.disabled, pressed && !disabled && s.pressed]}><Text style={[s.buttonText, secondary && s.secondaryText, disabled && s.disabledText]}>{label}</Text><Icon name={icon} size={17} color={disabled ? '#A3B09B' : secondary ? colors.primary : colors.white} /></Pressable>;
}
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) { return <View style={[styles.card, style]}>{children}</View>; }
export function Badge({ children }: { children: string }) { return <View style={s.badge}><Text style={s.badgeText}>{children}</Text></View>; }
export function EmptyState({ title, text, icon = 'leaf', onConnect, action = '连接学习服务' }: { title: string; text: string; icon?: IconName; onConnect?: () => void; action?: string }) {
  return <Card style={s.empty}><View style={s.emptyIcon}><Icon name={icon} size={31} /></View><Text style={s.emptyTitle}>{title}</Text><Text style={s.emptyText}>{text}</Text>{onConnect && <Button label={action} onPress={onConnect} />}</Card>;
}
export function InfoNote({ text }: { text: string }) { return <View style={s.note}><Icon name="lock" size={17} color="#8DA176" /><Text style={s.noteText}>{text}</Text></View>; }
const s = StyleSheet.create({
  button: { minHeight: 48, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 }, buttonText: { fontSize: 14, fontWeight: '600', color: colors.white, lineHeight: 21 }, secondary: { backgroundColor: '#F2F8ED', borderWidth: 1, borderColor: '#DFEAD6' }, secondaryText: { color: colors.primary }, disabled: { backgroundColor: '#EDF1E8', borderColor: '#E1E7DA', borderWidth: 1 }, disabledText: { color: '#A3B09B' }, pressed: { opacity: .8 },
  badge: { borderRadius: 7, backgroundColor: '#EEF4E9', paddingHorizontal: 9, paddingVertical: 5, alignSelf: 'flex-start' }, badgeText: { color: '#8B9E7E', fontSize: 10, lineHeight: 15, fontWeight: '500' },
  empty: { alignItems: 'center', gap: 14, paddingVertical: 31 }, emptyIcon: { width: 64, height: 64, borderRadius: 21, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 2 }, emptyTitle: { color: colors.ink, fontSize: 18, lineHeight: 27, fontWeight: '600', textAlign: 'center' }, emptyText: { color: colors.muted, fontSize: 13, lineHeight: 23, textAlign: 'center', marginBottom: 5, maxWidth: 320 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#F0F4E7', borderRadius: 13, padding: 17 }, noteText: { flex: 1, fontSize: 11, color: '#8D9C7B', lineHeight: 20 },
});
