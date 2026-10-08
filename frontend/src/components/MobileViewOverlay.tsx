// MobileViewOverlay — a sidebar view rendered full-width on a phone.
//
// On desktop the views for Files/Changes/Git/Agents live in the 220–460px
// panel next to the work. On a phone that column does not exist, so the view
// takes the whole surface — the same treatment Overview and Settings already
// get on both form factors. A back affordance returns to the panes, because
// the drawer that opened this has already closed.

import {
  ArrowLeft, LayoutDashboard, FolderTree, FileDiff, GitBranch, Users,
  SlidersHorizontal,
} from 'lucide-react';
import type { SidebarView } from '../types/sidebar';
import { OverviewView } from './sidebar/OverviewView';
import { SettingsView } from './SettingsView';
import { ExplorerView } from './sidebar/ExplorerView';
import { ChangesView } from './sidebar/ChangesView';
import { GitView } from './sidebar/GitView';
import { AgentsView } from './sidebar/AgentsView';

type IconCmp = React.ComponentType<{ size?: number; strokeWidth?: number }>;

const META: Record<SidebarView, { label: string; Icon: IconCmp }> = {
  overview: { label: 'Overview', Icon: LayoutDashboard },
  explorer: { label: 'Files', Icon: FolderTree },
  changes: { label: 'Changes', Icon: FileDiff },
  git: { label: 'Git', Icon: GitBranch },
  agents: { label: 'Agents', Icon: Users },
  settings: { label: 'Settings', Icon: SlidersHorizontal },
};

function ViewBody({ view }: { view: SidebarView }) {
  switch (view) {
    case 'overview': return <OverviewView />;
    case 'settings': return <SettingsView />;
    case 'changes': return <ChangesView />;
    case 'git': return <GitView />;
    case 'agents': return <AgentsView />;
    default: return <ExplorerView />;
  }
}

interface MobileViewOverlayProps {
  view: SidebarView;
  onBack: () => void;
}

export function MobileViewOverlay({ view, onBack }: MobileViewOverlayProps) {
  const meta = META[view] ?? META.explorer;

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 8,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-base)',
    }}>
      <div style={{
        height: 'var(--chrome-height)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px',
        borderBottom: '1px solid var(--tint-border)',
        background: 'var(--bg-surface)',
        fontFamily: 'var(--font-display)',
      }}>
        <button
          onClick={onBack}
          aria-label="Back to panes"
          title="Back to panes"
          className="touch-row"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 34, height: 34, flexShrink: 0,
            background: 'transparent', border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)', cursor: 'pointer', padding: 0,
          }}
        >
          <ArrowLeft size={18} strokeWidth={1.9} />
        </button>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0,
          color: 'var(--text-primary)',
          fontSize: 'var(--font-size-title)',
          fontWeight: 600,
          letterSpacing: '-0.01em',
        }}>
          <meta.Icon size={16} strokeWidth={1.9} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meta.label}
          </span>
        </span>
      </div>

      <div className="mobile-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <ViewBody view={view} />
      </div>
    </div>
  );
}