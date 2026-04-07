// AiRunPane — wraps the existing RunPanel + DecisionPanel as a pane (M2-04)

import { useCallback, useRef, useState } from 'react';
import { RunPanel } from '../../components/RunPanel';
import { DecisionPanel } from '../../components/DecisionPanel';
import { PostRunSummary } from '../../components/PostRunSummary';
import { useSend } from '../../context/SendContext';
import { useAppState } from '../../context/AppContext';
import type { PaneProps } from '../registry';
import type { RunMode, RunState } from '../../types/protocol';
import { registerPane } from '../registry';

const inputStyle: React.CSSProperties = {
  padding: 8,
  fontFamily: 'monospace',
  fontSize: 13,
  backgroundColor: '#1a1a2e',
  color: '#e0e0e0',
  border: '1px solid #444',
  borderRadius: 4,
  flex: 1,
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: '#4ecdc4',
  color: '#1a1a2e',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 'bold',
  fontFamily: 'monospace',
};

function isTerminalState(rs: RunState): boolean {
  return rs.type === 'Completed' || rs.type === 'Failed' || rs.type === 'Cancelled';
}

export function AiRunPane({ pane: _pane, workspaceId: _workspaceId }: PaneProps) {
  const send = useSend();
  const state = useAppState();
  const [prompt, setPrompt] = useState('');

  const handleStartRun = () => {
    if (state.activeSession && prompt.trim()) {
      send({
        type: 'StartRun',
        session_id: state.activeSession,
        prompt: prompt.trim(),
        mode: 'Free' as RunMode,
      });
      setPrompt('');
    }
  };

  const handleRespond = (runId: string, response: string) => {
    send({ type: 'RespondToBlocking', run_id: runId, response });
  };

  const handleCancel = (runId: string) => {
    send({ type: 'CancelRun', run_id: runId, reason: 'User cancelled' });
  };

  const handleGetDiff = (runId: string) => send({ type: 'GetDiff', run_id: runId });
  const handleRevert = (runId: string) => send({ type: 'RevertRun', run_id: runId });
  const handleMerge = (runId: string) => send({ type: 'MergeRun', run_id: runId });

  const selectedRunObj = state.selectedRun ? state.runs.get(state.selectedRun) : undefined;
  const showPostRunSummary =
    !state.activeRun && selectedRunObj !== undefined && isTerminalState(selectedRunObj.state);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {state.activeRun ? (
        <>
          <RunPanel />
          {state.blocking && (
            <DecisionPanel
              runId={state.activeRun}
              question={state.blocking.question}
              context={state.blocking.context}
              onRespond={handleRespond}
              onCancel={handleCancel}
            />
          )}
        </>
      ) : showPostRunSummary && state.selectedRun ? (
        <PostRunSummary
          runId={state.selectedRun}
          onGetDiff={handleGetDiff}
          onMerge={handleMerge}
          onRevert={handleRevert}
        />
      ) : (
        <RunPanel />
      )}
      {state.activeSession && !state.activeRun && (
        <div style={{ padding: '8px 16px', borderTop: '1px solid #333', display: 'flex', gap: 8 }}>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleStartRun()}
            placeholder="Enter prompt for Claude..."
            style={inputStyle}
          />
          <button onClick={handleStartRun} style={buttonStyle}>
            Run
          </button>
        </div>
      )}
    </div>
  );
}

// Register with the pane registry
registerPane('AiRun', AiRunPane);
