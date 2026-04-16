import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { resolveDaemonWsUrl } from './resolveDaemonWsUrl';

describe('resolveDaemonWsUrl', () => {
  const origConfig = window.__TERMINAL_CONFIG__;
  const origDaemon = window.__TERMINAL_DAEMON_INFO__;

  beforeEach(() => {
    delete window.__TERMINAL_CONFIG__;
    delete window.__TERMINAL_DAEMON_INFO__;
  });

  afterEach(() => {
    window.__TERMINAL_CONFIG__ = origConfig;
    window.__TERMINAL_DAEMON_INFO__ = origDaemon;
  });

  it('defaults to same-origin /ws', () => {
    const url = resolveDaemonWsUrl();
    expect(url).toMatch(/^ws:\/\/.+\/ws$/);
  });

  it('honours runtime override', () => {
    window.__TERMINAL_CONFIG__ = { wsUrl: 'ws://override.example/ws' };
    expect(resolveDaemonWsUrl()).toBe('ws://override.example/ws');
  });

  it('honours Tauri-provided port', () => {
    window.__TERMINAL_DAEMON_INFO__ = { port: 9999 };
    expect(resolveDaemonWsUrl()).toBe('ws://127.0.0.1:9999/ws');
  });

  it('prefers Tauri info over runtime config', () => {
    window.__TERMINAL_CONFIG__ = { wsUrl: 'ws://runtime/ws' };
    window.__TERMINAL_DAEMON_INFO__ = { wsUrl: 'ws://tauri/ws' };
    expect(resolveDaemonWsUrl()).toBe('ws://tauri/ws');
  });
});
