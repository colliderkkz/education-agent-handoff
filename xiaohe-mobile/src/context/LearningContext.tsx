import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getLocalEngine } from '../local/runtime';
import type { LearningSnapshot, LocalLearningEngine } from '../local/engine';
import type { ApiResult, WorkspaceState } from '../local/types';
import { cloneData } from '../local/clone';

interface LearningContextValue extends LearningSnapshot {
  act: (action: string, payload?: Record<string, unknown>) => Promise<ApiResult>;
  reload: () => Promise<WorkspaceState>;
}
const LearningContext = createContext<LearningContextValue | null>(null);

export function LearningProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<LearningSnapshot>({ state: null, loading: true, error: null, busy: false });
  const engineRef = useRef<LocalLearningEngine | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(false);
  const connect = useCallback(async () => {
    const engine = await getLocalEngine();
    if (mountedRef.current && engineRef.current !== engine) {
      unsubscribeRef.current?.(); engineRef.current = engine;
      unsubscribeRef.current = engine.subscribe(() => { if (mountedRef.current) setSnapshot(engine.getSnapshot()); });
      setSnapshot(engine.getSnapshot());
    }
    return engine;
  }, []);
  const reload = useCallback(async () => {
    try {
      const engine = await connect(); await engine.reload();
      const state = engine.getSnapshot().state;
      if (!state) throw new Error('本机数据尚未成功读取，请重试。');
      return cloneData(state);
    }
    catch (error) {
      if (mountedRef.current) setSnapshot(previous => ({ ...previous, loading: false, busy: false, error: error instanceof Error ? error.message : '无法打开本机存储，请重试。' }));
      throw error;
    }
  }, [connect]);
  const act = useCallback(async (action: string, payload?: Record<string, unknown>) => {
    const queuedPayload = cloneData(payload);
    const engine = await connect();
    return engine.act(action, queuedPayload);
  }, [connect]);
  useEffect(() => {
    mountedRef.current = true;
    void reload().catch(() => undefined);
    return () => { mountedRef.current = false; unsubscribeRef.current?.(); unsubscribeRef.current = null; engineRef.current = null; };
  }, [reload]);
  const value = useMemo(() => ({ ...snapshot, act, reload }), [snapshot, act, reload]);
  return <LearningContext.Provider value={value}>{children}</LearningContext.Provider>;
}

export function useLearning(): LearningContextValue {
  const value = useContext(LearningContext);
  if (!value) throw new Error('useLearning must be used within LearningProvider');
  return value;
}
