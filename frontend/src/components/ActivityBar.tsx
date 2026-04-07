import { FolderTree, GitCompareArrows, GitBranch } from 'lucide-react';
import { useAppState, useAppDispatch } from '../context/AppContext';

type SidebarView = 'explorer' | 'changes' | 'git';

const icons: { view: SidebarView; label: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { view: 'explorer', label: 'Explorer', Icon: FolderTree },
  { view: 'changes', label: 'Changes', Icon: GitCompareArrows },
  { view: 'git', label: 'Git', Icon: GitBranch },
];

export function ActivityBar() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const active = state.activeSidebarView;

  return (
    <div style={{
      width: 'var(--activitybar-width)',
      flexShrink: 0,
      backgroundColor: 'var(--bg-base)',
      borderRight: '1px solid var(--border-default)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingTop: 8,
      gap: 4,
    }}>
      {icons.map(({ view, label, Icon }) => {
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
              borderLeft: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              transition: 'color 120ms ease',
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = '#8b8fa3'; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = '#555a6e'; }}
          >
            <Icon size={18} strokeWidth={1.5} />
          </div>
        );
      })}
    </div>
  );
}
