import { FolderTree, FileDiff, GitBranch, TerminalSquare, Bot, Globe } from 'lucide-react';
import { useAppState, useAppDispatch } from '../context/AppContext';

type SidebarView = 'explorer' | 'changes' | 'git';

interface ActivityBarProps {
  onLayoutPreset?: (preset: string) => void;
}

const sidebarIcons: { view: SidebarView; label: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { view: 'explorer', label: 'Explorer', Icon: FolderTree },
  { view: 'changes', label: 'Changes', Icon: FileDiff },
  { view: 'git', label: 'Git', Icon: GitBranch },
];

const layoutIcons: { preset: string; label: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { preset: 'terminal', label: 'Terminal', Icon: TerminalSquare },
  { preset: 'ai', label: 'AI Session', Icon: Bot },
  { preset: 'browser', label: 'Browser', Icon: Globe },
];

export function ActivityBar({ onLayoutPreset }: ActivityBarProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const active = state.activeSidebarView;

  const iconStyle = (isActive: boolean): React.CSSProperties => ({
    width: 32,
    height: 32,
    margin: '2px 4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    borderRadius: 6,
    color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
    backgroundColor: isActive ? 'var(--accent-primary-15)' : 'transparent',
    boxShadow: isActive ? 'var(--glow-accent)' : 'none',
    transition:
      'color 180ms var(--ease-out-expo), background-color 200ms var(--ease-out-expo), ' +
      'transform 180ms var(--ease-out-expo), box-shadow 200ms var(--ease-out-expo)',
  });

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
      {/* Sidebar view icons */}
      {sidebarIcons.map(({ view, label, Icon }) => {
        const isActive = active === view && !state.sidebarCollapsed;
        return (
          <div
            key={view}
            title={label}
            onClick={() => {
              if (isActive) dispatch({ type: 'TOGGLE_SIDEBAR' });
              else dispatch({ type: 'SET_SIDEBAR_VIEW', view });
            }}
            style={iconStyle(isActive)}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.backgroundColor = 'var(--accent-primary-08)';
                e.currentTarget.style.transform = 'scale(1.06)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--text-muted)';
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
          >
            <Icon size={18} strokeWidth={1.75} />
          </div>
        );
      })}

      {/* Separator */}
      <div style={{ width: 20, height: 1, backgroundColor: 'var(--border-default)', margin: '6px 0' }} />

      {/* Layout preset icons */}
      {layoutIcons.map(({ preset, label, Icon }) => (
        <div
          key={preset}
          title={label}
          onClick={() => onLayoutPreset?.(preset)}
          style={iconStyle(false)}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)';
            e.currentTarget.style.backgroundColor = 'var(--accent-primary-08)';
            e.currentTarget.style.transform = 'scale(1.06)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-muted)';
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <Icon size={18} strokeWidth={1.75} />
        </div>
      ))}
    </div>
  );
}
