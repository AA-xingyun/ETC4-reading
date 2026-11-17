import { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerateArgs, GenerateResponse } from '../api/generateReading';
import { generateReading } from '../api/generateReading';

export type GenStatus = 'idle' | 'running' | 'done' | 'error';

export interface GenState {
  status: GenStatus;
  progress: number;
  response?: GenerateResponse;
  error?: string;
  code?: string;
}

export function useGenerateReading() {
  const [state, setState] = useState<GenState>({ status: 'idle', progress: 0 });
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);

  const stopTimer = () => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  };

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    stopTimer();
    setState({ status: 'idle', progress: 0 });
  }, []);

  const start = useCallback(async (args: GenerateArgs) => {
    stopTimer();
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setState({ status: 'running', progress: 4 });
    // 服务端没有流式进度，这里用时间估算，完成时跳到 100%
    timer.current = window.setInterval(() => {
      setState((s) => (s.status === 'running' ? { ...s, progress: Math.min(92, s.progress + 3) } : s));
    }, 900);
    try {
      const res = await generateReading({ ...args, signal: ctrl.signal });
      stopTimer();
      if (res.ok) setState({ status: 'done', progress: 100, response: res });
      else setState({ status: 'error', progress: 100, response: res, error: (res.errors ?? ['生成失败']).join('\n'), code: res.code });
    } catch (err) {
      stopTimer();
      if ((err as Error).name === 'AbortError') return;
      setState({ status: 'error', progress: 100, error: (err as Error).message });
    } finally {
      controller.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopTimer();
    setState({ status: 'idle', progress: 0 });
  }, []);

  useEffect(() => () => {
    stopTimer();
    controller.current?.abort();
  }, []);

  return { state, start, cancel, reset };
}
