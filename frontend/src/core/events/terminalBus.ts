// Terminal event bus — in-memory pub/sub for high-frequency PTY events.
//
// TerminalOutput arrives at ~60Hz per active session. Routing it through
// React reducer state would invalidate the entire workspace subtree on each
// chunk. Instead we keep a small module-level subscriber set and let
// TerminalPane write directly to xterm.js.

import type { AppEvent } from '../../types/protocol';

export type TerminalEvent = Extract<
  AppEvent,
  { type: 'TerminalSessionCreated' | 'TerminalOutput' | 'TerminalSessionClosed' }
>;

type Handler = (event: TerminalEvent) => void;

const handlers = new Set<Handler>();

export function subscribeTerminalEvents(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function publishTerminalEvent(event: TerminalEvent): void {
  for (const h of handlers) {
    try {
      h(event);
    } catch (err) {
      console.error('[terminalBus] handler threw', err);
    }
  }
}

export function _resetForTests(): void {
  handlers.clear();
}
