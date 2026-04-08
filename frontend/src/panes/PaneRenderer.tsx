// PaneRenderer — recursively renders a PaneLayout tree (M2-02)

import React, { useCallback, useRef, useState } from 'react';
import { Columns2, Rows2, X } from 'lucide-react';
import type { PaneLayout } from '../domain/pane/types';
import { isSingle, isSplit } from '../domain/pane/types';
import { getPane } from './registry';

// --- PaneHeader ---

interface PaneHeaderProps {
  kind: string;
  focused: boolean;
  onSplitH?: () => void;
  onSplitV?: () => void;
  onClose?: () => void;
}

function PaneHeader({ kind, focused, onSplitH, onSplitV, onClose }: PaneHeaderProps) {
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
        paddingLeft: 10,
        paddingRight: 6,
        userSelect: 'none',
        backgroundColor: focused ? 'var(--bg-overlay)' : 'var(--bg-surface)',
        borderBottom: focused
          ? '2px solid var(--accent-primary)'
          : '1px solid var(--border-default)',
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          fontSize: 'var(--font-size-chrome, 11px)',
          color: focused ? 'var(--text-primary, #e0e0e0)' : 'var(--text-muted, #888)',
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
        }}
      >
        {kind}
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
        {onClose && (
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

// --- PaneRenderer ---

interface PaneRendererProps {
  layout: PaneLayout;
  workspaceId: string;
  focusedPaneId: string | null;
  onFocusPane: (id: string) => void;
  onLayoutChange?: (layout: PaneLayout) => void;
  onSplitPane?: (paneId: string, direction: 'Horizontal' | 'Vertical') => void;
  onClosePane?: (paneId: string) => void;
  depth?: number;
}

const SPLITTER_SIZE = 4;

export function PaneRenderer({
  layout,
  workspaceId,
  focusedPaneId,
  onFocusPane,
  onLayoutChange,
  onSplitPane,
  onClosePane,
  depth = 0,
}: PaneRendererProps) {
  if (isSingle(layout)) {
    const pane = layout.Single;
    const Component = getPane(pane.kind);
    const focused = focusedPaneId === pane.id;

    const handleSplitH = () => onSplitPane?.(pane.id, 'Horizontal');
    const handleSplitV = () => onSplitPane?.(pane.id, 'Vertical');
    const handleClose = () => onClosePane?.(pane.id);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, overflow: 'hidden' }}>
        <PaneHeader
          kind={pane.kind}
          focused={focused}
          onSplitH={handleSplitH}
          onSplitV={handleSplitV}
          onClose={handleClose}
        />
        <div
          style={{ flex: 1, overflow: 'hidden', display: 'flex' }}
          onClick={() => onFocusPane(pane.id)}
        >
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
  }

  if (isSplit(layout)) {
    const { direction, ratio, first, second } = layout.Split;
    const isHorizontal = direction === 'Horizontal';

    return (
      <SplitContainer
        isHorizontal={isHorizontal}
        initialRatio={ratio}
        first={
          <PaneRenderer
            layout={first}
            workspaceId={workspaceId}
            focusedPaneId={focusedPaneId}
            onFocusPane={onFocusPane}
            onLayoutChange={onLayoutChange}
            onSplitPane={onSplitPane}
            onClosePane={onClosePane}
            depth={depth + 1}
          />
        }
        second={
          <PaneRenderer
            layout={second}
            workspaceId={workspaceId}
            focusedPaneId={focusedPaneId}
            onFocusPane={onFocusPane}
            onLayoutChange={onLayoutChange}
            onSplitPane={onSplitPane}
            onClosePane={onClosePane}
            depth={depth + 1}
          />
        }
      />
    );
  }

  return null;
}

// --- SplitContainer with drag-to-resize (M2-03) ---

interface SplitContainerProps {
  isHorizontal: boolean;
  initialRatio: number;
  first: React.ReactNode;
  second: React.ReactNode;
}

function SplitContainer({ isHorizontal, initialRatio, first, second }: SplitContainerProps) {
  const [ratio, setRatio] = useState(initialRatio);
  const [splitterState, setSplitterState] = useState<'idle' | 'hover' | 'dragging'>('idle');
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      setSplitterState('dragging');
      document.body.style.userSelect = 'none';

      const onMouseMove = (moveEvt: MouseEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        let newRatio: number;
        if (isHorizontal) {
          newRatio = (moveEvt.clientX - rect.left) / rect.width;
        } else {
          newRatio = (moveEvt.clientY - rect.top) / rect.height;
        }
        // Clamp between 10% and 90%
        setRatio(Math.max(0.1, Math.min(0.9, newRatio)));
      };

      const onMouseUp = () => {
        dragging.current = false;
        setSplitterState('idle');
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [isHorizontal],
  );

  const splitterBg =
    splitterState === 'dragging'
      ? 'var(--accent-primary, #4ecdc4)'
      : splitterState === 'hover'
        ? 'rgba(78, 205, 196, 0.4)'
        : 'var(--border-default, #333)';

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: ratio, overflow: 'hidden', display: 'flex' }}>{first}</div>
      <div
        style={{
          width: isHorizontal ? SPLITTER_SIZE : '100%',
          height: isHorizontal ? '100%' : SPLITTER_SIZE,
          backgroundColor: splitterBg,
          cursor: isHorizontal ? 'col-resize' : 'row-resize',
          flexShrink: 0,
          transition: 'background-color 150ms',
        }}
        onMouseEnter={() => {
          if (!dragging.current) setSplitterState('hover');
        }}
        onMouseLeave={() => {
          if (!dragging.current) setSplitterState('idle');
        }}
        onMouseDown={handleMouseDown}
      />
      <div style={{ flex: 1 - ratio, overflow: 'hidden', display: 'flex' }}>{second}</div>
    </div>
  );
}
