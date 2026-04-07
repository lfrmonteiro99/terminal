// PaneRenderer — recursively renders a PaneLayout tree (M2-02)

import React, { useCallback, useRef, useState } from 'react';
import type { PaneLayout } from '../domain/pane/types';
import { isSingle, isSplit } from '../domain/pane/types';
import { getPane } from './registry';
import type { PaneProps } from './registry';

interface PaneRendererProps {
  layout: PaneLayout;
  workspaceId: string;
  focusedPaneId: string | null;
  onFocusPane: (id: string) => void;
  depth?: number;
}

const SPLITTER_SIZE = 4;

export function PaneRenderer({
  layout,
  workspaceId,
  focusedPaneId,
  onFocusPane,
  depth = 0,
}: PaneRendererProps) {
  if (isSingle(layout)) {
    const pane = layout.Single;
    const Component = getPane(pane.kind);
    const focused = focusedPaneId === pane.id;

    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          outline: focused ? '2px solid #4ecdc4' : '2px solid transparent',
          outlineOffset: '-2px',
        }}
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
              color: '#888',
              fontFamily: 'monospace',
              fontSize: 13,
              backgroundColor: '#1a1a2e',
            }}
          >
            Pane: {pane.kind}
          </div>
        )}
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
            depth={depth + 1}
          />
        }
        second={
          <PaneRenderer
            layout={second}
            workspaceId={workspaceId}
            focusedPaneId={focusedPaneId}
            onFocusPane={onFocusPane}
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
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

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
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [isHorizontal],
  );

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
          backgroundColor: '#333',
          cursor: isHorizontal ? 'col-resize' : 'row-resize',
          flexShrink: 0,
        }}
        onMouseDown={handleMouseDown}
      />
      <div style={{ flex: 1 - ratio, overflow: 'hidden', display: 'flex' }}>{second}</div>
    </div>
  );
}
