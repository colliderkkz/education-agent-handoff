import { StyleSheet } from 'react-native';
export const colors = { background: '#F7FAF5', surface: '#FFFFFF', ink: '#294B3A', primary: '#2D865E', primaryLight: '#EAF4E7', muted: '#667863', border: '#E5ECE1', yellow: '#F5EACF', peach: '#FBF1E5', lavender: '#F0EEF7', white: '#FFFFFF', error: '#A04E3B' };
export const styles = StyleSheet.create({
  page: { paddingHorizontal: 22, paddingTop: 25, paddingBottom: 30, gap: 23, maxWidth: 640, width: '100%', alignSelf: 'center' },
  eyebrow: { fontSize: 10, letterSpacing: 1.5, fontWeight: '600', color: colors.muted, marginBottom: 10 },
  title: { fontSize: 28, lineHeight: 40, letterSpacing: -.7, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: 14, lineHeight: 24, color: colors.muted, marginTop: 8 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '600', lineHeight: 25 },
  card: { borderRadius: 19, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 22 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 24 },
  caption: { color: colors.muted, fontSize: 11, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
export type Tab = 'home' | 'knowledge' | 'camera' | 'practice' | 'profile';
