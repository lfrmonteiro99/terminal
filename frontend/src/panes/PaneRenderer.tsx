// PaneRenderer — flat absolute-positioned rendering to prevent React remounts on layout changes

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, Rows2, X } from 'lucide-react';
import type { PaneLayout } from '../domain/pane/types';
import { isSingle, isSplit, collectPanes } from '../domain/pane/types';
import { getPane } from './registry';

const PANE_LABELS: Record<string, string> = {
  Terminal: 'Terminal',
  AiRun: 'AI Run',
  GitStatus: 'Git Status',
  GitHistory: 'Git History',
  Browser: 'Browser',
  Diff: 'Diff',
  FileExplorer: 'Explorer',
  Empty: 'New Pane',
};

// --- PaneHeader ---

interface PaneHeaderProps {
  kind: string;
  focused: boolean;
  paneIndex: number;
  canClose: boolean;
  onSplitH?: () => void;
  onSplitV?: () => void;
  onClose?: () => void;
}

function PaneHeader({ kind, focused, paneIndex, canClose, onSplitH, onSplitV, onClose }: PaneHeaderProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 'var(--pane-header-height, 28px)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: focused ? 7 : 10,
        paddingRight: 6,
        userSelect: 'none',
        backgroundColor: focused ? 'var(--bg-overlay)' : 'var(--bg-surface)',
        borderBottom: focused
          ? '2px solid var(--accent-primary)'
          : '1px solid var(--border-default)',
        borderLeft: focused ? '3px solid var(--accent-primary)' : '3px solid transparent',
        boxShadow: focused ? 'inset 0 -2px 0 var(--accent-primary)' : 'none',
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          fontSize: 'var(--font-size-chrome, 11px)',
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span style={{
          color: focused ? 'var(--accent-primary, #4ecdc4)' : 'var(--text-muted, #888)',
          fontWeight: focused ? 700 : 400,
          fontSize: '10px',
          minWidth: 12,
          textAlign: 'center',
        }}>{paneIndex}</span>
        <span style={{ color: focused ? 'var(--text-primary, #e0e0e0)' : 'var(--text-muted, #888)' }}>
          {PANE_LABELS[kind] ?? kind}
        </span>
      </span>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 120ms',
        }}
      >
        {onSplitH && (
          <HeaderButton title="Split Right" onClick={onSplitH}>
            <Columns2 size={12} />
          </HeaderButton>
        )}
        {onSplitV && (
          <HeaderButton title="Split Down" onClick={onSplitV}>
            <Rows2 size={12} />
          </HeaderButton>
        )}
        {onClose && canClose && (
          <HeaderButton title="Close Pane" onClick={onClose}>
            <X size={12} />
          </HeaderButton>
        )}
      </div>
    </div>
  );
}

interface HeaderButtonProps {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}

function HeaderButton({ title, onClick, children }: HeaderButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        border: 'none',
        borderRadius: 3,
        cursor: 'pointer',
        backgroundColor: hovered ? 'var(--bg-elevated, rgba(255,255,255,0.08))' : 'transparent',
        color: 'var(--text-muted, #888)',
        padding: 0,
        transition: 'background-color 100ms, color 100ms',
      }}
    >
      {children}
    </button>
  );
}

// --- Flat rect computation ---

interface Rect { x: number; y: number; w: number; h: number }

/**
 * Recursively walk the layout tree and compute a normalized bounding rect
 * (0–1) for every leaf pane. Because this is pure math over a data tree,
 * it does NOT affect React component identity — panes keep their keys.
 */
function computePaneRects(
  layout: PaneLayout,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
): Map<string, Rect> {
  const result = new Map<string, Rect>();

  if (isSingle(layout)) {
    result.set(layout.Single.id, rect);
    return result;
  }

  if (isSplit(layout)) {
    const { direction, ratio, first, second } = layout.Split;

    if (direction === 'Horizontal') {
      for (const [id, r] of computePaneRects(first, {
        x: rect.x,
        y: rect.y,
        w: rect.w * ratio,
        h: rect.h,
      })) result.set(id, r);

      for (const [id, r] of computePaneRects(second, {
        x: rect.x + rect.w * ratio,
        y: rect.y,
        w: rect.w * (1 - ratio),
        h: rect.h,
      })) result.set(id, r);
    } else {
      // Vertical — top / bottom
      for (const [id, r] of computePaneRects(first, {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h * ratio,
      })) result.set(id, r);

      for (const [id, r] of computePaneRects(second, {
        x: rect.x,
        y: rect.y + rect.h * ratio,
        w: rect.w,
        h: rect.h * (1 - ratio),
      })) result.set(id, r);
    }
  }

  return result;
}

// --- PaneRenderer ---

interface PaneRendererProps {
  layout: PaneLayout;
  workspaceId: string;
  focusedPaneId: string | null;
  zoomedPaneId?: string | null;
  onFocusPane: (id: string) => void;
  onLayoutChange?: (layout: PaneLayout) => void;
  onSplitPane?: (paneId: string, direction: 'Horizontal' | 'Vertical') => void;
  onClosePane?: (paneId: string) => void;
}

export function PaneRenderer({
  layout,
  workspaceId,
  focusedPaneId,
  zoomedPaneId,
  onFocusPane,
  onLayoutChange: _onLayoutChange,
  onSplitPane,
  onClosePane,
}: PaneRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Suppress unused-var warning; containerSize is intentionally observed so
  // that pane children that depend on container dimensions re-render correctly.
  void containerSize;

  const allPanes = useMemo(() => collectPanes(layout), [layout]);

  // Normalized rects for each pane id from the layout tree
  const rects = useMemo(() => computePaneRects(layout), [layout]);

  // When a pane is zoomed give it the full rect; collapse others to zero-size
  const displayRects = useMemo(() => {
    if (!zoomedPaneId) return rects;
    const zoomed = new Map<string, Rect>();
    for (const [id] of rects) {
      zoomed.set(
        id,
        id === zoomedPaneId
          ? { x: 0, y: 0, w: 1, h: 1 }
          : { x: 0, y: 0, w: 0, h: 0 },
      );
    }
    return zoomed;
  }, [rects, zoomedPaneId]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
    >
      {allPanes.map((pane, index) => {
        const rect = displayRects.get(pane.id);
        if (!rect) return null;

        const Component = getPane(pane.kind);
        const focused = focusedPaneId === pane.id;
        const hidden = rect.w === 0 || rect.h === 0;

        return (
          <div
            key={pane.id}
            style={{
              position: 'absolute',
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
              display: hidden ? 'none' : 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxSizing: 'border-box',
              // 3 px border on right + bottom for visual separation between panes
              borderRight: '3px solid var(--border-default, #333)',
              borderBottom: '3px solid var(--border-default, #333)',
            }}
            onClick={() => onFocusPane(pane.id)}
          >
            <PaneHeader
              kind={pane.kind}
              focused={focused}
              paneIndex={index + 1}
              canClose={allPanes.length > 1}
              onSplitH={() => onSplitPane?.(pane.id, 'Horizontal')}
              onSplitV={() => onSplitPane?.(pane.id, 'Vertical')}
              onClose={() => onClosePane?.(pane.id)}
            />
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
              {Component ? (
                <Component pane={pane} workspaceId={workspaceId} focused={focused} />
              ) : (
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                    fontFamily: 'monospace',
                    fontSize: 13,
                    backgroundColor: 'var(--bg-surface)',
                  }}
                >
                  Pane: {pane.kind}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
