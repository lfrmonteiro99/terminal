import { useState } from 'react';

interface DecisionPanelProps {
  runId: string;
  question: string;
  context: string[];
  onRespond: (runId: string, response: string) => void;
  onCancel: (runId: string) => void;
}

export function DecisionPanel({
  runId,
  question,
  context,
  onRespond,
  onCancel,
}: DecisionPanelProps) {
  const [response, setResponse] = useState('');

  const handleSubmit = () => {
    if (response.trim()) {
      onRespond(runId, response.trim());
      setResponse('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      style={{
        border: '2px solid var(--accent-warn)',
        borderRadius: 8,
        padding: 16,
        margin: 12,
        backgroundColor: 'var(--bg-raised)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
          color: 'var(--accent-warn)',
          fontWeight: 'bold',
          fontSize: 14,
        }}
      >
        BLOCKING - Claude needs input
      </div>

      <div
        style={{
          padding: 12,
          backgroundColor: 'var(--bg-surface)',
          borderRadius: 4,
          marginBottom: 12,
          fontFamily: 'monospace',
          fontSize: 13,
          whiteSpace: 'pre-wrap',
          color: 'var(--text-primary)',
        }}
      >
        {question}
      </div>

      {context.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 4 }}>
            Context:
          </div>
          {context.map((c, i) => (
            <div
              key={i}
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                color: 'var(--text-muted)',
                paddingLeft: 8,
              }}
            >
              {c}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your response..."
          rows={3}
          style={{
            flex: 1,
            padding: 8,
            fontFamily: 'monospace',
            fontSize: 13,
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
            borderRadius: 4,
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button
            onClick={handleSubmit}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--accent-primary)',
              color: 'var(--bg-surface)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Respond
          </button>
          <button
            onClick={() => onCancel(runId)}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--accent-error)',
              color: 'var(--text-primary)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
