import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppCommand, AppEvent } from '../types/protocol';
import { debug } from '../util/log';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected';

interface UseWebSocketOptions {
  url: string;
  token: string;
  onEvent: (event: AppEvent) => void;
}

const MAX_RETRY_COUNT = 20;
const MAX_QUEUE_SIZE = 256;

// Compute exponential backoff with jitter: starts at 1s, doubles to 30s max.
function backoffMs(retryCount: number): number {
  const base = Math.min(30_000, 1_000 * 2 ** retryCount);
  const jitter = Math.random() * 0.25 * base;
  return base + jitter;
}

export function useWebSocket({ url, token, onEvent }: UseWebSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending command queue for buffering while disconnected.
  const queueRef = useRef<AppCommand[]>([]);

  const drainQueue = useCallback((ws: WebSocket) => {
    while (queueRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
      const cmd = queueRef.current.shift()!;
      ws.send(JSON.stringify(cmd));
    }
  }, []);

  const connect = useCallback(() => {
    if (!url) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    debug('[WS] Connecting to', url);
    setStatus('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      debug('[WS] Connected, sending auth');
      setStatus('authenticating');
      ws.send(JSON.stringify({ type: 'Auth', token }));
    };

    ws.onmessage = (event) => {
      if (import.meta.env.DEV && !event.data.includes('TerminalOutput')) {
        debug('[WS] Received:', event.data);
      }
      try {
        const data: AppEvent = JSON.parse(event.data);

        if (data.type === 'AuthSuccess') {
          setStatus('connected');
          retryCountRef.current = 0;
          drainQueue(ws);
        } else if (data.type === 'AuthFailed') {
          setStatus('disconnected');
          ws.close();
          return;
        }

        onEventRef.current(data);
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    };

    ws.onclose = (ev) => {
      debug('[WS] Closed:', ev.code, ev.reason);
      setStatus('disconnected');
      wsRef.current = null;

      if (!url) return;
      if (retryCountRef.current >= MAX_RETRY_COUNT) {
        debug('[WS] Max retries reached, stopping auto-reconnect');
        return;
      }

      const delay = backoffMs(retryCountRef.current);
      retryCountRef.current += 1;
      debug(`[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${retryCountRef.current})`);
      retryTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
      ws.close();
    };
  }, [url, token, drainQueue]);

  const send = useCallback((command: AppCommand, opts: { queueable?: boolean } = {}) => {
    const { queueable = true } = opts;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(command));
      return;
    }
    if (queueable) {
      if (queueRef.current.length >= MAX_QUEUE_SIZE) {
        queueRef.current.shift(); // drop oldest
        debug('[WS] Queue overflow, dropped oldest command');
      }
      queueRef.current.push(command);
    } else {
      console.error('[WS] Command dropped (socket not open):', command.type);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = MAX_RETRY_COUNT; // prevent auto-reconnect
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  // Manual reconnect: reset retry counter and try immediately.
  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  return { status, send, connect, disconnect, reconnect };
}
