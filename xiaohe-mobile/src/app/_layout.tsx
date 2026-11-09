import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LearningProvider } from '../context/LearningContext';
import { colors } from '../theme';

export default function RootLayout() {
  return <SafeAreaProvider><LearningProvider>
    <StatusBar style="dark" />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="(tabs)" />
    </Stack>
  </LearningProvider></SafeAreaProvider>;
}
