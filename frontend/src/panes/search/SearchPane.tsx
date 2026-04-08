// SearchPane — grep across project files (TERMINAL-006)

import { useEffect, useRef, useState } from 'react';
import { registerPane } from '../registry';
import type { PaneProps } from '../registry';
import { useSend } from '../../context/SendContext';
import type { SearchMatch } from '../../types/protocol';

interface SearchResultsEvent {
  type: 'SearchResults';
  query: string;
  matches: SearchMatch[];
  total_matches: number;
  files_searched: number;
  truncated: boolean;
  duration_ms: number;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'searching'; query: string }
  | { status: 'results'; event: SearchResultsEvent }
  | { status: 'error'; message: string };

function escapeRegex(s: string): RegExp {
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
}

function highlightMatch(text: string, query: string, isRegex: boolean): React.ReactNode {
  if (!query) return text;
  try {
    const re = isRegex ? new RegExp(query, 'gi') : escapeRegex(query);
    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      parts.push(
        <mark
          key={m.index}
          style={{
            background: 'var(--accent-primary, #4ecdc4)',
            color: 'var(--bg-base, #0e0e1a)',
            borderRadius: 2,
            padding: '0 1px',
          }}
        >
          {m[0]}
        </mark>,
      );
      last = m.index + m[0].length;
      if (re.lastIndex === m.index) re.lastIndex++; // prevent infinite loop on zero-length match
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.length > 0 ? parts : text;
  } catch {
    return text;
  }
}

function FileGroup({
  file,
  matches,
  query,
  isRegex,
}: {
  file: string;
  matches: SearchMatch[];
  query: string;
  isRegex: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  function openFile() {
    window.dispatchEvent(new CustomEvent('open-file-viewer', { detail: { path: file } }));
  }

  return (
    <div style={{ marginBottom: 4 }}>
      {/* File header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 8px',
          background: 'var(--bg-overlay, rgba(255,255,255,0.04))',
          borderLeft: '3px solid var(--accent-primary, #4ecdc4)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setCollapsed((v) => !v)}
      >
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-muted, #888)',
            minWidth: 10,
          }}
        >
          {collapsed ? '▶' : '▼'}
        </span>
        <span
          style={{
            flex: 1,
            fontFamily: 'monospace',
            fontSize: 11,
            color: 'var(--accent-primary, #4ecdc4)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={file}
          onClick={(e) => {
            e.stopPropagation();
            openFile();
          }}
        >
          {file}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted, #888)' }}>
          {matches.length} {matches.length === 1 ? 'match' : 'matches'}
        </span>
      </div>

      {/* Match lines */}
      {!collapsed && (
        <div>
          {matches.map((m, i) => (
            <div key={i}>
              {/* Context before */}
              {m.context_before.map((ctx, ci) => (
                <div
                  key={`before-${ci}`}
                  style={{
                    display: 'flex',
                    padding: '1px 8px 1px 20px',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: 'var(--text-muted, #666)',
                    whiteSpace: 'pre',
                  }}
                >
                  <span style={{ minWidth: 40, color: 'var(--text-muted, #555)', userSelect: 'none' }}>
                    {m.line_number - m.context_before.length + ci}
                  </span>
                  <span>{ctx}</span>
                </div>
              ))}

              {/* Match line */}
              <div
                style={{
                  display: 'flex',
                  padding: '2px 8px 2px 20px',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  background: 'rgba(78, 205, 196, 0.06)',
                  cursor: 'pointer',
                  whiteSpace: 'pre',
                }}
                onClick={openFile}
                title={`${file}:${m.line_number}`}
              >
                <span
                  style={{
                    minWidth: 40,
                    color: 'var(--accent-primary, #4ecdc4)',
                    userSelect: 'none',
                    flexShrink: 0,
                  }}
                >
                  {m.line_number}
                </span>
                <span style={{ color: 'var(--text-primary, #e0e0e0)' }}>
                  {highlightMatch(m.line_content, query, isRegex)}
                </span>
              </div>

              {/* Context after */}
              {m.context_after.map((ctx, ci) => (
                <div
                  key={`after-${ci}`}
                  style={{
                    display: 'flex',
                    padding: '1px 8px 1px 20px',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: 'var(--text-muted, #666)',
                    whiteSpace: 'pre',
                  }}
                >
                  <span style={{ minWidth: 40, color: 'var(--text-muted, #555)', userSelect: 'none' }}>
                    {m.line_number + ci + 1}
                  </span>
                  <span>{ctx}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SearchPane(_props: PaneProps) {
  const send = useSend();
  const [query, setQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeGlob, setIncludeGlob] = useState('');
  const [excludeGlob, setExcludeGlob] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchState, setSearchState] = useState<SearchState>({ status: 'idle' });
  const activeQueryRef = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);

  function runSearch() {
    const q = query.trim();
    if (!q) return;
    activeQueryRef.current = q;
    setSearchState({ status: 'searching', query: q });
    send({
      type: 'SearchFiles',
      query: q,
      is_regex: isRegex,
      case_sensitive: caseSensitive,
      include_glob: includeGlob.trim() || undefined,
      exclude_glob: excludeGlob.trim() || undefined,
      max_results: 500,
      context_lines: 1,
    });
  }

  // Listen for search-results events dispatched from App.tsx
  useEffect(() => {
    const handler = (e: Event) => {
      const event = (e as CustomEvent).detail as SearchResultsEvent;
      // Only accept results for the query we last fired
      if (event.query === activeQueryRef.current) {
        setSearchState({ status: 'results', event });
      }
    };
    window.addEventListener('search-results', handler);
    return () => window.removeEventListener('search-results', handler);
  }, []);

  // Group matches by file
  const fileGroups: Map<string, SearchMatch[]> = (() => {
    if (searchState.status !== 'results') return new Map();
    const map = new Map<string, SearchMatch[]>();
    for (const m of searchState.event.matches) {
      const key = m.file_path;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
  })();

  const toggleStyle = (active: boolean): React.CSSProperties => ({
    padding: '2px 7px',
    borderRadius: 3,
    border: '1px solid',
    borderColor: active ? 'var(--accent-primary, #4ecdc4)' : 'var(--border-default, #444)',
    background: active ? 'rgba(78,205,196,0.12)' : 'transparent',
    color: active ? 'var(--accent-primary, #4ecdc4)' : 'var(--text-muted, #888)',
    fontSize: 10,
    cursor: 'pointer',
    userSelect: 'none',
    fontFamily: 'monospace',
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        overflow: 'hidden',
        background: 'var(--bg-surface, #12121f)',
      }}
    >
      {/* Search input row */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '8px 8px 6px',
          borderBottom: '1px solid var(--border-default, #333)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder="Search files… (Enter)"
            style={{
              flex: 1,
              background: 'var(--bg-overlay, rgba(255,255,255,0.04))',
              border: '1px solid var(--border-default, #444)',
              borderRadius: 4,
              color: 'var(--text-primary, #e0e0e0)',
              fontFamily: 'monospace',
              fontSize: 12,
              padding: '4px 8px',
              outline: 'none',
            }}
          />
          <button
            onClick={runSearch}
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              border: 'none',
              background: 'var(--accent-primary, #4ecdc4)',
              color: 'var(--bg-base, #0e0e1a)',
              fontFamily: 'monospace',
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            Search
          </button>
        </div>

        {/* Toggle row */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={toggleStyle(isRegex)} onClick={() => setIsRegex((v) => !v)}>
            .*  Regex
          </button>
          <button style={toggleStyle(caseSensitive)} onClick={() => setCaseSensitive((v) => !v)}>
            Aa  Case
          </button>
          <button
            style={{ ...toggleStyle(filtersOpen), marginLeft: 4 }}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            {filtersOpen ? '▼' : '▶'} Filters
          </button>
        </div>

        {/* Expandable filter inputs */}
        {filtersOpen && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <input
              value={includeGlob}
              onChange={(e) => setIncludeGlob(e.target.value)}
              placeholder="Include glob (e.g. *.ts)"
              style={{
                flex: 1,
                minWidth: 100,
                background: 'var(--bg-overlay, rgba(255,255,255,0.04))',
                border: '1px solid var(--border-default, #444)',
                borderRadius: 3,
                color: 'var(--text-primary, #e0e0e0)',
                fontFamily: 'monospace',
                fontSize: 11,
                padding: '3px 6px',
                outline: 'none',
              }}
            />
            <input
              value={excludeGlob}
              onChange={(e) => setExcludeGlob(e.target.value)}
              placeholder="Exclude (e.g. dist)"
              style={{
                flex: 1,
                minWidth: 100,
                background: 'var(--bg-overlay, rgba(255,255,255,0.04))',
                border: '1px solid var(--border-default, #444)',
                borderRadius: 3,
                color: 'var(--text-primary, #e0e0e0)',
                fontFamily: 'monospace',
                fontSize: 11,
                padding: '3px 6px',
                outline: 'none',
              }}
            />
          </div>
        )}
      </div>

      {/* Results area */}
      <div style={{ flex: 1, overflow: 'auto', fontSize: 12 }}>
        {searchState.status === 'idle' && (
          <div
            style={{
              padding: 20,
              color: 'var(--text-muted, #666)',
              fontFamily: 'monospace',
              fontSize: 12,
              textAlign: 'center',
            }}
          >
            Type a query and press Enter to search project files.
            <br />
            <span style={{ fontSize: 10, opacity: 0.7 }}>
              Supports plain text (default) or regex mode.
            </span>
          </div>
        )}

        {searchState.status === 'searching' && (
          <div
            style={{
              padding: 20,
              color: 'var(--text-muted, #888)',
              fontFamily: 'monospace',
              fontSize: 12,
              textAlign: 'center',
            }}
          >
            Searching for "{searchState.query}"…
          </div>
        )}

        {searchState.status === 'results' && (
          <>
            {/* Summary bar */}
            <div
              style={{
                padding: '4px 10px',
                borderBottom: '1px solid var(--border-default, #333)',
                fontSize: 10,
                color: 'var(--text-muted, #888)',
                fontFamily: 'monospace',
                display: 'flex',
                gap: 8,
              }}
            >
              <span>
                {searchState.event.total_matches} match
                {searchState.event.total_matches !== 1 ? 'es' : ''} in{' '}
                {searchState.event.files_searched} file
                {searchState.event.files_searched !== 1 ? 's' : ''}
              </span>
              {searchState.event.truncated && (
                <span style={{ color: 'var(--color-warning, #f0a500)' }}>
                  (truncated at 500 results)
                </span>
              )}
              <span style={{ marginLeft: 'auto' }}>{searchState.event.duration_ms}ms</span>
            </div>

            {searchState.event.matches.length === 0 ? (
              <div
                style={{
                  padding: 20,
                  color: 'var(--text-muted, #666)',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  textAlign: 'center',
                }}
              >
                No matches found for "{searchState.event.query}"
              </div>
            ) : (
              <div style={{ padding: '4px 0' }}>
                {Array.from(fileGroups.entries()).map(([file, matches]) => (
                  <FileGroup
                    key={file}
                    file={file}
                    matches={matches}
                    query={searchState.status === 'results' ? searchState.event.query : ''}
                    isRegex={isRegex}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {searchState.status === 'error' && (
          <div
            style={{
              padding: 16,
              color: 'var(--color-error, #ff6b6b)',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            Error: {searchState.message}
          </div>
        )}
      </div>
    </div>
  );
}

registerPane('Search', SearchPane);
