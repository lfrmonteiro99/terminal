// SshConnectDialog — modal form for entering SSH connection details (TERMINAL-051)

import { useEffect, useRef, useState } from 'react';

export interface SshConnectConfig {
  host: string;
  port: number;
  username: string;
  identity_file?: string;
}

interface SavedSshConnection extends SshConnectConfig {
  lastUsed: string;
}

const STORAGE_KEY = 'terminal:ssh-connections';

function loadSaved(): SavedSshConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedSshConnection[];
  } catch {
    return [];
  }
}

function saveSshConnection(cfg: SshConnectConfig) {
  const saved = loadSaved();
  // Dedup by host+port+username
  const filtered = saved.filter(
    c => !(c.host === cfg.host && c.port === cfg.port && c.username === cfg.username),
  );
  const entry: SavedSshConnection = { ...cfg, lastUsed: new Date().toISOString() };
  // Most recent first, keep at most 10
  const updated = [entry, ...filtered].slice(0, 10);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

interface SshConnectDialogProps {
  open: boolean;
  onClose: () => void;
  onConnect: (config: SshConnectConfig) => void;
}

export function SshConnectDialog({ open, onClose, onConnect }: SshConnectDialogProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [identityFile, setIdentityFile] = useState('');
  const [saved, setSaved] = useState<SavedSshConnection[]>([]);
  const hostRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSaved(loadSaved());
      setTimeout(() => hostRef.current?.focus(), 0);
    }
  }, [open]);

  const handleConnect = () => {
    const trimHost = host.trim();
    const trimUser = username.trim();
    if (!trimHost || !trimUser) return;
    const portNum = parseInt(port, 10) || 22;
    const cfg: SshConnectConfig = {
      host: trimHost,
      port: portNum,
      username: trimUser,
      identity_file: identityFile.trim() || undefined,
    };
    saveSshConnection(cfg);
    onConnect(cfg);
    onClose();
  };

  const handlePickSaved = (c: SavedSshConnection) => {
    setHost(c.host);
    setPort(String(c.port));
    setUsername(c.username);
    setIdentityFile(c.identity_file ?? '');
    setTimeout(() => hostRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'Enter') { handleConnect(); }
  };

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    padding: '8px 10px',
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
    borderRadius: 6,
    color: 'var(--text-primary)',
    fontSize: 13,
    fontFamily: 'var(--font-mono, monospace)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono, monospace)',
    marginBottom: 4,
    display: 'block',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '18vh',
        zIndex: 1100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-raised)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          width: 460,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-default)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono, monospace)',
        }}>
          SSH Connect
        </div>

        {/* Recent connections */}
        {saved.length > 0 && (
          <div style={{ borderBottom: '1px solid var(--border-default)' }}>
            <div style={{
              padding: '6px 16px 4px',
              fontSize: 10,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono, monospace)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Recent
            </div>
            {saved.map((c, i) => (
              <div
                key={i}
                onClick={() => handlePickSaved(c)}
                style={{
                  padding: '7px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  fontFamily: 'var(--font-mono, monospace)',
                  color: 'var(--text-primary)',
                  transition: 'background-color 80ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-overlay)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <span style={{ color: 'var(--accent-primary)', flexShrink: 0 }}>⬡</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.username}@{c.host}:{c.port}
                </span>
                {c.identity_file && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>
                    key
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Form */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Host + Port row */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Hostname</label>
              <input
                ref={hostRef}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="myserver.com"
                style={inputStyle}
              />
            </div>
            <div style={{ width: 80 }}>
              <label style={labelStyle}>Port</label>
              <input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="22"
                type="number"
                min={1}
                max={65535}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Username */}
          <div>
            <label style={labelStyle}>Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="deploy"
              style={inputStyle}
            />
          </div>

          {/* Identity file */}
          <div>
            <label style={labelStyle}>Identity File (optional)</label>
            <input
              value={identityFile}
              onChange={(e) => setIdentityFile(e.target.value)}
              placeholder="~/.ssh/id_ed25519"
              style={inputStyle}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              onClick={onClose}
              style={{
                padding: '7px 16px',
                backgroundColor: 'transparent',
                border: '1px solid var(--border-default)',
                borderRadius: 6,
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 12,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConnect}
              disabled={!host.trim() || !username.trim()}
              style={{
                padding: '7px 16px',
                backgroundColor: host.trim() && username.trim() ? 'var(--accent-primary)' : 'var(--bg-overlay)',
                border: 'none',
                borderRadius: 6,
                color: host.trim() && username.trim() ? 'var(--bg-base)' : 'var(--text-muted)',
                cursor: host.trim() && username.trim() ? 'pointer' : 'default',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Connect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
