import { useEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, styles } from '../theme';
import { Icon } from './Icon';

export function Screen({ children, title, onBack, scrollKey }: { children: ReactNode; title?: string; onBack?: () => void; scrollKey?: string | number }) {
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    if (scrollKey === undefined) return;
    let frame = 0;
    const resetScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false }));
    };
    // Reset after the new question renders, then once more after keyboard resizing.
    // Listen only for this transition, so later keyboard dismissals do not jump the page.
    let hideSubscription: ReturnType<typeof Keyboard.addListener> | undefined;
    if (Keyboard.isVisible()) hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      resetScroll(); hideSubscription?.remove(); hideSubscription = undefined;
    });
    resetScroll();
    return () => { cancelAnimationFrame(frame); hideSubscription?.remove(); };
  }, [scrollKey]);
  return <SafeAreaView style={s.safe} edges={onBack ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right']}>
    <View style={s.header}>
      {onBack ? <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="返回上一页" style={s.back}><View style={{ transform: [{ rotate: '180deg' }] }}><Icon name="arrow" size={21} /></View></Pressable> : <View style={s.brandIcon}><Icon name="leaf" size={22} /></View>}
      <Text style={s.brand}>{title || '小禾学伴'}</Text>
      {!onBack && <Text style={s.development}>开发版</Text>}
    </View>
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView ref={scrollRef} style={s.flex} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 },
  header: { minHeight: 58, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  brand: { fontSize: 18, fontWeight: '700', color: colors.ink, letterSpacing: .6, flex: 1 }, brandIcon: { marginRight: 1 },
  development: { color: colors.muted, fontSize: 10, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 6 },
  back: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -14 },
});
