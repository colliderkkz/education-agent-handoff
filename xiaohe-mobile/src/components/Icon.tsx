import { StyleSheet, View, type ColorValue } from 'react-native';
import { colors } from '../theme';
export type IconName = 'home' | 'book' | 'camera' | 'paper' | 'person' | 'leaf' | 'arrow' | 'lock' | 'check';
export function Icon({ name, color = colors.primary, size = 24 }: { name: IconName; color?: ColorValue; size?: number }) {
  const stroke = { borderColor: color };
  const fill = { backgroundColor: color };
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 24, height: 24, transform: [{ scale: size / 24 }] }}>
    {name === 'leaf' && <><View style={[s.stem, fill]} /><View style={[s.leaf, s.leafLeft, fill]} /><View style={[s.leaf, s.leafRight, fill]} /></>}
    {name === 'home' && <><View style={[s.roof, stroke]} /><View style={[s.house, stroke]} /><View style={[s.door, stroke]} /></>}
    {name === 'book' && <><View style={[s.book, stroke]} /><View style={[s.bookMiddle, fill]} /><View style={[s.bookLine, fill]} /></>}
    {name === 'camera' && <><View style={[s.camera, stroke]} /><View style={[s.lens, stroke]} /><View style={[s.cameraTop, stroke]} /></>}
    {name === 'paper' && <><View style={[s.paper, stroke]} />{[8, 12, 16].map(top => <View key={top} style={[s.paperLine, fill, { top }]} />)}</>}
    {name === 'person' && <><View style={[s.personHead, stroke]} /><View style={[s.personBody, stroke]} /></>}
    {name === 'arrow' && <><View style={[s.arrowLine, fill]} /><View style={[s.arrowHead, stroke]} /></>}
    {name === 'lock' && <><View style={[s.lockTop, stroke]} /><View style={[s.lockBody, stroke]} /><View style={[s.lockDot, fill]} /></>}
    {name === 'check' && <View style={[s.check, stroke]} />}
  </View></View>;
}
const s = StyleSheet.create({
  stem: { width: 2, height: 15, borderRadius: 2, position: 'absolute', top: 8, left: 11 }, leaf: { width: 11, height: 7, borderTopLeftRadius: 9, borderBottomRightRadius: 9, position: 'absolute' }, leafLeft: { top: 6, left: 1, transform: [{ rotate: '40deg' }] }, leafRight: { top: 2, left: 11, transform: [{ rotate: '-25deg' }] },
  roof: { position: 'absolute', width: 14, height: 14, left: 5, top: 3, borderLeftWidth: 1.8, borderTopWidth: 1.8, transform: [{ rotate: '45deg' }], borderTopLeftRadius: 2 }, house: { position: 'absolute', left: 5, top: 10, width: 14, height: 11, borderBottomWidth: 1.8, borderLeftWidth: 1.8, borderRightWidth: 1.8, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }, door: { position: 'absolute', left: 10, top: 15, width: 4, height: 6, borderWidth: 1.5 },
  book: { position: 'absolute', left: 2, top: 4, width: 20, height: 16, borderWidth: 1.7, borderRadius: 3 }, bookMiddle: { position: 'absolute', left: 11, top: 4, width: 1.5, height: 16 }, bookLine: { position: 'absolute', left: 5, top: 9, width: 4, height: 1.5 },
  camera: { position: 'absolute', left: 2, top: 7, width: 20, height: 14, borderWidth: 1.8, borderRadius: 4 }, lens: { position: 'absolute', left: 8, top: 10, width: 8, height: 8, borderWidth: 1.8, borderRadius: 5 }, cameraTop: { position: 'absolute', left: 8, top: 3, width: 8, height: 5, borderTopWidth: 1.8, borderLeftWidth: 1.8, borderRightWidth: 1.8, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  paper: { position: 'absolute', left: 5, top: 2, width: 15, height: 20, borderWidth: 1.8, borderRadius: 3 }, paperLine: { position: 'absolute', left: 9, width: 7, height: 1.5, borderRadius: 1 },
  personHead: { position: 'absolute', left: 8, top: 2, width: 8, height: 8, borderWidth: 1.8, borderRadius: 5 }, personBody: { position: 'absolute', left: 3, top: 13, width: 18, height: 9, borderWidth: 1.8, borderTopLeftRadius: 10, borderTopRightRadius: 10, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  arrowLine: { position: 'absolute', left: 4, top: 11, width: 15, height: 1.8 }, arrowHead: { position: 'absolute', left: 11, top: 6, width: 11, height: 11, borderTopWidth: 1.8, borderRightWidth: 1.8, transform: [{ rotate: '45deg' }] },
  lockTop: { position: 'absolute', top: 2, left: 7, width: 10, height: 10, borderWidth: 1.8, borderRadius: 7 }, lockBody: { position: 'absolute', top: 10, left: 4, width: 16, height: 12, borderWidth: 1.8, borderRadius: 3 }, lockDot: { position: 'absolute', top: 14, left: 11, width: 2, height: 4, borderRadius: 1 },
  check: { position: 'absolute', left: 6, top: 4, width: 8, height: 14, borderBottomWidth: 2, borderRightWidth: 2, transform: [{ rotate: '45deg' }] },
});
