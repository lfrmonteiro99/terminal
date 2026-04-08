import { useCallback, useState } from 'react';
import { useAppState } from '../../context/AppContext';
import { SessionStrip } from './SessionStrip';
import { ExplorerView } from './ExplorerView';
import { ChangesView } from './ChangesView';
import { GitView } from './GitView';
import { ResizeHandle } from '../ResizeHandle';

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 250;
const STORAGE_KEY = 'sidebar-width';

function getStoredWidth(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const n = parseInt(stored, 10);
    if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
  }
  return DEFAULT_WIDTH;
}

export function SidebarContainer() {
  const state = useAppState();
  const [width, setWidth] = useState(getStoredWidth);

  const handleResize = useCallback((delta: number) => {
    setWidth((prev) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, prev + delta));
      return next;
    });
  }, []);

  const handleResizeEnd = useCallback(() => {
    setWidth((current) => {
      localStorage.setItem(STORAGE_KEY, current.toString());
      return current;
    });
  }, []);

  const collapsed = state.sidebarCollapsed;

  const ActiveView = (() => {
    switch (state.activeSidebarView) {
      case 'explorer': return ExplorerView;
      case 'changes': return ChangesView;
      case 'git': return GitView;
    }
  })();

  return (
    <>
      <div style={{
        width: collapsed ? 0 : width,
        flexShrink: 0,
        backgroundColor: 'var(--bg-surface)',
        borderRight: collapsed ? 'none' : '1px solid var(--border-default)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'monospace',
        fontSize: 12,
        transition: 'width 150ms ease-out',
      }}>
        <SessionStrip />
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <ActiveView />
        </div>
      </div>
      {!collapsed && (
        <ResizeHandle direction="horizontal" onResize={handleResize} onResizeEnd={handleResizeEnd} />
      )}
    </>
  );
}
