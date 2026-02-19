import { useAppState, useAppDispatch } from '../../context/AppContext';

const placeholderStyle: React.CSSProperties = {
  padding: 16,
  color: '#888',
  fontFamily: 'monospace',
  fontSize: 12,
};

export function GitView() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  return (
    <div style={placeholderStyle}>
      <div style={{ fontSize: 13, color: '#e0e0e0', marginBottom: 8 }}>Git</div>
      <div>Full git panel coming in Phase 4</div>
      <div style={{ marginTop: 16, borderTop: '1px solid #333', paddingTop: 12 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Stashes
        </div>
        <div
          onClick={() => dispatch({ type: 'TOGGLE_STASH_DRAWER' })}
          style={{
            padding: '6px 8px',
            cursor: 'pointer',
            borderRadius: 4,
            color: '#e0e0e0',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#16213e'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          {'\u25CB'} Stashes{state.stashes.length > 0 ? ` (${state.stashes.length})` : ''}
        </div>
      </div>
    </div>
  );
}
