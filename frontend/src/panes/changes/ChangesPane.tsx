// ChangesPane — the working-tree changes and the diff of the selected file,
// side by side in one pane.
//
// Why this exists: the Changes *sidebar* pairs a narrow list with an inline
// diff that is capped at 320px, so reading a real patch meant scrolling a slot
// the width of the sidebar. The pane gives the diff the whole rest of the
// screen, which is what reviewing a change actually needs.
//
// It reuses ChangesView for the list rather than reimplementing it: the staged
// /unstaged split heuristic, the stage buttons and the run-context selector all
// live there, and a second copy would drift.

import { useCallback, useState } from 'react';
import { FileText } from 'lucide-react';
import { useAppState } from '../../context/AppContext';
import { registerPane } from '../registry';
import type { PaneProps } from '../registry';
import { ChangesView } from '../../components/sidebar/ChangesView';
import { DiffPanel } from '../../components/DiffPanel';
import { ResizeHandle } from '../../components/ResizeHandle';
import { useIsMobile } from '../../hooks/useMediaQuery';

const MIN_LIST_WIDTH = 200;
const MAX_LIST_WIDTH = 520;
const DEFAULT_LIST_WIDTH = 300;
const STORAGE_KEY = 'changes-pane-list-width';

function getStoredListWidth(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const n = parseInt(raw, 10);
    if (n >= MIN_LIST_WIDTH && n <= MAX_LIST_WIDTH) return n;
  }
  return DEFAULT_LIST_WIDTH;
}

function EmptyDiff() {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      color: 'var(--text-muted)',
      padding: 24,
      textAlign: 'center',
    }}>
      <FileText size={22} strokeWidth={1.6} />
      <span style={{ fontSize: 'var(--font-size-small)' }}>
        Select a changed file to read its diff
      </span>
    </div>
  );
}

export function ChangesPane({ focused }: PaneProps) {
  const state = useAppState();
  const isMobile = useIsMobile();
  const [listWidth, setListWidth] = useState(getStoredListWidth);
  const selected = state.diffPanel.open && state.diffPanel.file !== null;

  const handleResize = useCallback((delta: number) => {
    setListWidth((w) => Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, w + delta)));
  }, []);

  // Persist on release, not on every mousemove: a drag fires this at ~60 Hz and
  // a synchronous localStorage write per frame is what the sidebar avoids too.
  const handleResizeEnd = useCallback(() => {
    setListWidth((w) => {
      localStorage.setItem(STORAGE_KEY, String(w));
      return w;
    });
  }, []);

  // A phone is ~390px wide: a 300px list and a diff beside it leaves neither
  // usable, so the two stack — the list on top, the diff below. The list keeps
  // a fixed share so the diff has somewhere to appear, and the empty state says
  // so; letting the list fill the screen left a silent blank half.
  if (isMobile) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        backgroundColor: 'var(--bg-surface)',
        opacity: focused ? 1 : 0.98,
      }}>
        <div style={{
          flex: '0 0 52%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          borderBottom: '1px solid var(--border-default)',
        }}>
          <ChangesView inlineDiff={false} />
        </div>
        <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {selected ? <DiffPanel displayMode="pane" /> : <EmptyDiff />}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      minHeight: 0,
      overflow: 'hidden',
      backgroundColor: 'var(--bg-surface)',
      // The focused pane is marked by its header; a second border here would
      // double up with it.
      opacity: focused ? 1 : 0.98,
    }}>
      <div style={{
        width: listWidth,
        flexShrink: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}>
        <ChangesView inlineDiff={false} />
      </div>

      <ResizeHandle direction="horizontal" onResize={handleResize} onResizeEnd={handleResizeEnd} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {selected ? <DiffPanel displayMode="pane" /> : <EmptyDiff />}
      </div>
    </div>
  );
}

registerPane('Changes', ChangesPane);
