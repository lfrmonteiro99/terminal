// BrowserPane — embedded browser with URL bar and navigation (M6-01)

import { useRef, useState } from 'react';
import { registerPane } from '../registry';
import type { PaneProps } from '../registry';

const navButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#888',
  cursor: 'pointer',
  padding: '0 6px',
  fontSize: 16,
};

export function BrowserPane({ pane: _pane }: PaneProps) {
  const [url, setUrl] = useState('about:blank');
  const [input, setInput] = useState('');
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
    try { iframeRef.current?.contentWindow?.history.back(); } catch {}
  };

  const goForward = () => {
    try { iframeRef.current?.contentWindow?.history.forward(); } catch {}
  };

  const reload = () => {
    try { iframeRef.current?.contentWindow?.location.reload(); } catch {}
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: '#16213e' }}>
      {/* URL bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderBottom: '1px solid #333',
          backgroundColor: '#1a1a2e',
        }}
      >
        <button onClick={goBack} style={navButtonStyle} title="Back">←</button>
        <button onClick={goForward} style={navButtonStyle} title="Forward">→</button>
        <button onClick={reload} style={navButtonStyle} title="Reload">↻</button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(input); }}
          placeholder="Enter URL..."
          style={{
            flex: 1,
            backgroundColor: '#16213e',
            border: '1px solid #333',
            color: '#e0e0e0',
            padding: '4px 8px',
            borderRadius: 3,
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        />
        <button
          onClick={() => navigate(input)}
          style={{
            backgroundColor: '#4ecdc4',
            color: '#1a1a2e',
            border: 'none',
            borderRadius: 3,
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Go
        </button>
      </div>

      {/* Iframe */}
      {url === 'about:blank' ? (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 8, color: 'var(--text-muted)', fontSize: 13,
          fontFamily: 'var(--font-mono)', backgroundColor: 'var(--bg-surface)',
        }}>
          <span style={{ fontSize: 24 }}>🌐</span>
          <span>Enter a URL above to browse</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Note: some sites block iframe embedding (e.g. Google)
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Try: localhost URLs, docs, or sites that allow embedding
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
