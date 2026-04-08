import { useEffect, useState } from 'react';
import { useAppState, useAppDispatch } from '../../context/AppContext';
import { useSend } from '../../context/SendContext';
import { CommitHistoryItem } from './CommitHistoryItem';

// --- Styles ---

const branchRowStyle: React.CSSProperties = {
  padding: '8px 12px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  borderBottom: '1px solid var(--border-default)',
  flexShrink: 0,
};

const branchNameStyle: React.CSSProperties = {
  color: 'var(--accent-primary)',
  fontWeight: 'bold',
  fontSize: 13,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const headHashStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 11,
  fontFamily: 'monospace',
  flexShrink: 0,
};

const sectionHeaderStyle: React.CSSProperties = {
  padding: '4px 12px 2px',
  fontSize: 10,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const commitSectionStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-default)',
  flexShrink: 0,
};

const textareaBaseStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 60,
  maxHeight: 120,
  resize: 'vertical',
  backgroundColor: 'var(--bg-base)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 3,
  fontSize: 11,
  fontFamily: 'monospace',
  padding: '6px 8px',
  outline: 'none',
  boxSizing: 'border-box',
};

const commitBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  backgroundColor: 'var(--accent-primary)',
  color: 'var(--bg-surface)',
  border: 'none',
  borderRadius: 3,
  fontSize: 11,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  cursor: 'pointer',
};

const commitBtnDisabledStyle: React.CSSProperties = {
  ...commitBtnStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

const stageAllBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  backgroundColor: 'transparent',
  color: 'var(--text-muted)',
  border: '1px solid var(--border-default)',
  borderRadius: 3,
  fontSize: 10,
  fontFamily: 'monospace',
  cursor: 'pointer',
};

const emptyStyle: React.CSSProperties = {
  padding: 16,
  color: 'var(--text-muted)',
  fontSize: 11,
  fontFamily: 'monospace',
  textAlign: 'center',
};

const stashRowStyle: React.CSSProperties = {
  padding: '6px 12px',
  cursor: 'pointer',
  borderRadius: 4,
  color: 'var(--text-primary)',
  fontSize: 11,
  fontFamily: 'monospace',
};

// --- Component ---

export function GitView() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const send = useSend();

  const [commitMessage, setCommitMessage] = useState('');
  const [textareaFocused, setTextareaFocused] = useState(false);
  const [stashHover, setStashHover] = useState(false);

  const { repoStatus, commitHistory, stashes } = state;

  // Fetch repo status and commit history on mount
  useEffect(() => {
    send({ type: 'GetRepoStatus' });
    send({ type: 'GetCommitHistory', limit: 20 });
  }, [send]);

  const stagedCount = repoStatus?.staged_count ?? 0;
  const isClean = repoStatus?.clean ?? true;
  const canCommit = commitMessage.trim().length > 0 && stagedCount > 0;

  const handleCommit = () => {
    if (!canCommit) return;
    send({ type: 'CreateCommit', message: commitMessage.trim() });
    setCommitMessage('');
    // Refresh state after commit
    send({ type: 'GetRepoStatus' });
    send({ type: 'GetCommitHistory', limit: 20 });
    send({ type: 'GetChangedFiles', mode: 'working' });
  };

  const statusDotStyle: React.CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: isClean ? '#4caf50' : '#f0a500',
    flexShrink: 0,
  };

  const textareaStyle: React.CSSProperties = {
    ...textareaBaseStyle,
    borderColor: textareaFocused ? 'var(--accent-primary)' : 'var(--border-default)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Branch info row */}
      <div style={branchRowStyle}>
        <span style={statusDotStyle} />
        <span style={branchNameStyle}>{repoStatus?.branch ?? '...'}</span>
        {repoStatus && (
          <span style={headHashStyle}>{repoStatus.head.slice(0, 7)}</span>
        )}
      </div>

      {/* Commit section */}
      {isClean ? (
        <div style={emptyStyle}>No changes to commit</div>
      ) : (
        <div style={commitSectionStyle}>
          <textarea
            style={textareaStyle}
            placeholder="Commit message..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onFocus={() => setTextareaFocused(true)}
            onBlur={() => setTextareaFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleCommit();
              }
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <button
              style={canCommit ? commitBtnStyle : commitBtnDisabledStyle}
              onClick={handleCommit}
              disabled={!canCommit}
            >
              Commit ({stagedCount})
            </button>
            <button
              style={stageAllBtnStyle}
              onClick={() => {
                // Stage all is a convenience — not in AppCommand yet, so no-op placeholder
                // Individual file staging is available via ChangesView
              }}
              title="Stage all (use Changes view for individual files)"
            >
              Stage All
            </button>
          </div>
        </div>
      )}

      {/* History section */}
      <div style={sectionHeaderStyle}>
        History ({commitHistory.length})
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {commitHistory.length === 0 ? (
          <div style={emptyStyle}>No commits yet</div>
        ) : (
          commitHistory.map((commit) => (
            <CommitHistoryItem key={commit.hash} commit={commit} />
          ))
        )}
      </div>

      {/* Stash section */}
      <div style={sectionHeaderStyle}>
        Stashes ({stashes.length})
      </div>
      <div
        style={{
          ...stashRowStyle,
          backgroundColor: stashHover ? 'var(--bg-raised)' : 'transparent',
        }}
        onClick={() => dispatch({ type: 'TOGGLE_STASH_DRAWER' })}
        onMouseEnter={() => setStashHover(true)}
        onMouseLeave={() => setStashHover(false)}
      >
        {'\u25CB'} Stashes{stashes.length > 0 ? ` (${stashes.length})` : ''}
      </div>
    </div>
  );
}
