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
        border: '2px solid #f0a500',
        borderRadius: 8,
        padding: 16,
        margin: 12,
        backgroundColor: '#2d2d44',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
          color: '#f0a500',
          fontWeight: 'bold',
          fontSize: 14,
        }}
      >
        BLOCKING - Claude needs input
      </div>

      <div
        style={{
          padding: 12,
          backgroundColor: '#1a1a2e',
          borderRadius: 4,
          marginBottom: 12,
          fontFamily: 'monospace',
          fontSize: 13,
          whiteSpace: 'pre-wrap',
          color: '#e0e0e0',
        }}
      >
        {question}
      </div>

      {context.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>
            Context:
          </div>
          {context.map((c, i) => (
            <div
              key={i}
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                color: '#aaa',
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
            backgroundColor: '#1a1a2e',
            color: '#e0e0e0',
            border: '1px solid #444',
            borderRadius: 4,
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button
            onClick={handleSubmit}
            style={{
              padding: '8px 16px',
              backgroundColor: '#4ecdc4',
              color: '#1a1a2e',
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
              backgroundColor: '#ff6b6b',
              color: '#fff',
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
