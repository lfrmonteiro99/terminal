// BrowserPane — embedded browser with URL bar and navigation (M6-01)

import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Globe } from 'lucide-react';
import { registerPane } from '../registry';
import type { PaneProps } from '../registry';

function NavButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      style={{
        width: 28,
        height: 28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: hover ? 'var(--accent-primary-08)' : 'transparent',
        border: 'none',
        color: hover ? 'var(--accent-primary)' : 'var(--text-muted)',
        cursor: 'pointer',
        borderRadius: 6,
        padding: 0,
        transition: 'color 140ms var(--ease-out-expo), background 140ms var(--ease-out-expo)',
      }}
    >
      {children}
    </button>
  );
}

export function BrowserPane({ pane: _pane }: PaneProps) {
  const [url, setUrl] = useState('about:blank');
  const [input, setInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const navigate = (destination: string) => {
    let finalUrl = destination.trim();
    if (!finalUrl) return;
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://') && !finalUrl.startsWith('about:')) {
      finalUrl = `https://${finalUrl}`;
    }
    setUrl(finalUrl);
    setInput(finalUrl);
  };

  const goBack = () => {
    try { iframeRef.current?.contentWindow?.history.back(); } catch { /* cross-origin */ }
  };

  const goForward = () => {
    try { iframeRef.current?.contentWindow?.history.forward(); } catch { /* cross-origin */ }
  };

  const reload = () => {
    try { iframeRef.current?.contentWindow?.location.reload(); } catch { /* cross-origin */ }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--bg-surface)' }}>
      {/* URL bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderBottom: '1px solid var(--border-default)',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <NavButton onClick={goBack} title="Back"><ArrowLeft size={16} strokeWidth={1.75} /></NavButton>
        <NavButton onClick={goForward} title="Forward"><ArrowRight size={16} strokeWidth={1.75} /></NavButton>
        <NavButton onClick={reload} title="Reload"><RotateCw size={14} strokeWidth={1.75} /></NavButton>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(input); }}
          placeholder="Enter URL..."
          style={{
            flex: 1,
            backgroundColor: 'var(--bg-raised)',
            border: `1px solid ${inputFocused ? 'var(--accent-primary)' : 'var(--border-default)'}`,
            color: 'var(--text-primary)',
            padding: '5px 10px',
            borderRadius: 5,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            outline: 'none',
            boxShadow: inputFocused ? 'var(--glow-accent)' : 'none',
            transition: 'border-color 160ms, box-shadow 200ms var(--ease-out-expo)',
          }}
        />
        <button
          onClick={() => navigate(input)}
          style={{
            backgroundColor: 'var(--accent-primary)',
            color: 'var(--bg-base)',
            border: 'none',
            borderRadius: 5,
            padding: '5px 14px',
            cursor: 'pointer',
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 12,
            letterSpacing: '0.02em',
            boxShadow: 'var(--glow-accent)',
          }}
        >
          Go
        </button>
      </div>

      {/* Iframe */}
      {url === 'about:blank' ? (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 10,
          color: 'var(--text-muted)',
          fontSize: 13,
          fontFamily: 'var(--font-display)',
          backgroundColor: 'var(--bg-surface)',
        }}>
          <Globe size={32} strokeWidth={1.4} style={{ color: 'var(--accent-primary)', opacity: 0.7 }} />
          <span>enter a URL above to browse</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 360, textAlign: 'center', lineHeight: 1.5 }}>
            some sites block iframe embedding — try localhost URLs, docs, or sites that allow embedding
          </span>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          src={url}
          style={{ flex: 1, border: 'none', backgroundColor: '#fff' }}
          title="Browser Pane"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      )}
    </div>
  );
}

registerPane('Browser', BrowserPane);
