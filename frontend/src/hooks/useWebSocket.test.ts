import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWebSocket } from './useWebSocket';

// Minimal fake WebSocket that lets tests drive open/close/message events.
class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0; // CONNECTING
  onopen: ((e?: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  sent: string[] = [];
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    // Real browsers fire close asynchronously; the race we're testing depends
    // on that delay. Do NOT fire it synchronously here.
  }
  fireOpen() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  fireMessage(data: string) {
    this.onmessage?.({ data });
  }
  fireClose() {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code: 1000, reason: '' });
  }
}

describe('useWebSocket', () => {
  const originalWS = globalThis.WebSocket;
  beforeEach(() => {
    FakeSocket.instances = [];
    // Replace WebSocket constructor + static fields used by the hook.
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
      FakeSocket as unknown as typeof WebSocket;
  });
  afterEach(() => {
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWS;
  });

  it('does not drop into queue when a replaced socket closes after reconnect', () => {
    // Regression: when url/token change, a new socket is created while the
    // previous one is still closing. The old socket's delayed `onclose`
    // used to nullify `wsRef.current`, causing every subsequent `send` to
    // fall through to the pending-command queue forever — the user sees
    // "nothing happens" when clicking Open on the WelcomeScreen.
    const onEvent = vi.fn();
    const { result, rerender } = renderHook(
      ({ url, token }) => useWebSocket({ url, token, onEvent }),
      { initialProps: { url: 'ws://old/ws', token: 'old-token' } },
    );

    // First socket created. Simulate stale URL: don't open it yet.
    expect(FakeSocket.instances).toHaveLength(1);
    const oldWs = FakeSocket.instances[0];

    // URL+token change (Tauri detectAndConnect resolves real port).
    act(() => {
      rerender({ url: 'ws://new/ws', token: 'new-token' });
    });

    // New socket created. Old one is closing but onclose hasn't fired yet.
    expect(FakeSocket.instances).toHaveLength(2);
    const newWs = FakeSocket.instances[1];

    // New socket authenticates successfully.
    act(() => {
      newWs.fireOpen();
      newWs.fireMessage(JSON.stringify({ type: 'AuthSuccess' }));
    });
    expect(result.current.status).toBe('connected');

    // Now the OLD socket finally closes (network finished tearing it down).
    // Before the fix this nullified wsRef.current and set status=disconnected.
    act(() => {
      oldWs.fireClose();
    });

    // Status must stay 'connected' — the old socket is a zombie.
    expect(result.current.status).toBe('connected');

    // And `send` must reach the new socket, not the pending-command queue.
    act(() => {
      result.current.send({ type: 'StartSession', project_root: '/tmp' });
    });
    expect(newWs.sent).toContainEqual(
      JSON.stringify({ type: 'StartSession', project_root: '/tmp' }),
    );
  });

  it('sends commands immediately when socket is open', () => {
    const onEvent = vi.fn();
    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://daemon/ws', token: 't', onEvent }),
    );
    const ws = FakeSocket.instances[0];
    act(() => {
      ws.fireOpen();
      ws.fireMessage(JSON.stringify({ type: 'AuthSuccess' }));
    });
    act(() => {
      result.current.send({ type: 'Ping' });
    });
    expect(ws.sent).toContainEqual(JSON.stringify({ type: 'Ping' }));
  });
});
