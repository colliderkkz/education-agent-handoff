import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

/** Re-read the clock instead of counting ticks, including after a foreground return. */
export function useDeviceNow() {
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(useCallback(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, 1000);
    const listener = AppState.addEventListener('change', status => { if (status === 'active') refresh(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, []));
  return now;
}
