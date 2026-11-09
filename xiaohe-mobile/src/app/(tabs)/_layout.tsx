import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../../components/Icon';
import { colors } from '../../theme';

const tabs: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: '首页', icon: 'home' },
  { name: 'knowledge', title: '知识', icon: 'book' },
  { name: 'camera', title: '拍照', icon: 'camera' },
  { name: 'practice', title: '练习', icon: 'paper' },
  { name: 'profile', title: '我的', icon: 'person' },
];
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return <Tabs screenOptions={{
    headerShown: false, tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: '#7C8D76',
    tabBarHideOnKeyboard: true, tabBarLabelPosition: 'below-icon',
    tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 65 + Math.max(insets.bottom, 8), paddingTop: 9, paddingBottom: Math.max(insets.bottom, 8), elevation: 0 },
    tabBarLabelStyle: { fontSize: 11, lineHeight: 17, fontWeight: '500', marginTop: 2 },
  }}>{tabs.map(tab => <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title, tabBarAccessibilityLabel: tab.title, tabBarIcon: ({ color }) => <Icon name={tab.icon} color={color} size={23} /> }} />)}</Tabs>;
}
