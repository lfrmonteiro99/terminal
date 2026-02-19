import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppCommand, AppEvent } from '../types/protocol';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected';

interface UseWebSocketOptions {
  url: string;
  token: string;
  onEvent: (event: AppEvent) => void;
}

export function useWebSocket({ url, token, onEvent }: UseWebSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (!url) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    console.log('[WS] Connecting to', url);
    setStatus('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] Connected, sending auth');
      setStatus('authenticating');
      ws.send(JSON.stringify({ type: 'Auth', token }));
    };

    ws.onmessage = (event) => {
      console.log('[WS] Received:', event.data);
      try {
        const data: AppEvent = JSON.parse(event.data);

        if (data.type === 'AuthSuccess') {
          setStatus('connected');
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
      console.log('[WS] Closed:', ev.code, ev.reason);
      setStatus('disconnected');
      wsRef.current = null;
      // Auto-reconnect after 3s (only if url is valid)
      if (url) setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
      ws.close();
    };
  }, [url, token]);

  const send = useCallback((command: AppCommand) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(command));
    }
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  return { status, send, connect, disconnect };
}
