import { useAppState, useAppDispatch } from '../context/AppContext';

const barStyle: React.CSSProperties = {
  width: 40,
  flexShrink: 0,
  backgroundColor: '#0d1117',
  borderRight: '1px solid #333',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  paddingTop: 8,
  gap: 4,
};

type SidebarView = 'explorer' | 'changes' | 'git';

const icons: { view: SidebarView; label: string; symbol: string }[] = [
  { view: 'explorer', label: 'Explorer', symbol: '\u{1F4C1}' },
  { view: 'changes', label: 'Changes', symbol: '\u{1F504}' },
  { view: 'git', label: 'Git', symbol: '\u{2442}' },
];

export function ActivityBar() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const active = state.activeSidebarView;

  return (
    <div style={barStyle}>
      {icons.map(({ view, label, symbol }) => {
        const isActive = active === view && !state.sidebarCollapsed;
        return (
          <div
            key={view}
            title={label}
            onClick={() => {
              if (isActive) {
                dispatch({ type: 'TOGGLE_SIDEBAR' });
              } else {
                dispatch({ type: 'SET_SIDEBAR_VIEW', view });
              }
            }}
            style={{
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              borderLeft: isActive ? '2px solid #4ecdc4' : '2px solid transparent',
              color: isActive ? '#e0e0e0' : '#666',
              fontSize: 16,
              borderRadius: 2,
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = '#aaa'; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = '#666'; }}
          >
            {symbol}
          </div>
        );
      })}
    </div>
  );
}
