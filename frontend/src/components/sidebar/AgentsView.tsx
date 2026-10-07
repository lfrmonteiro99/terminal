import { useEffect, useState } from 'react';
import { useAppState } from '../../context/AppContext';
import { useSend } from '../../context/SendContext';
import type { AgentRole, AgentSummary } from '../../types/protocol';

// --- Styles (mirrors the other sidebar views: monospace, 11-13px) ---

const headerStyle: React.CSSProperties = {
  padding: '8px 12px 4px',
  fontSize: 10,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexShrink: 0,
};

const newBtnStyle: React.CSSProperties = {
  padding: '2px 8px',
  backgroundColor: 'transparent',
  color: 'var(--accent-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 3,
  fontSize: 10,
  fontFamily: 'monospace',
  cursor: 'pointer',
  textTransform: 'none',
  letterSpacing: 0,
};

const rowStyle = (hovered: boolean, selected: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  cursor: 'pointer',
  borderRadius: 4,
  backgroundColor: hovered || selected ? 'var(--bg-raised)' : 'transparent',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 1,
});

const nameStyle: React.CSSProperties = {
  color: 'var(--text-primary)',
  fontSize: 12,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const metaStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 10,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const fieldLabelStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 10,
  marginTop: 6,
  marginBottom: 2,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: 'var(--bg-base)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 3,
  fontSize: 11,
  fontFamily: 'monospace',
  padding: '4px 6px',
  outline: 'none',
  boxSizing: 'border-box',
};

const formStyle: React.CSSProperties = {
  padding: '4px 12px 12px',
  borderBottom: '1px solid var(--border-default)',
  flexShrink: 0,
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 8,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  backgroundColor: 'var(--accent-primary)',
  color: 'var(--bg-surface)',
  border: 'none',
  borderRadius: 3,
  fontSize: 11,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  backgroundColor: 'transparent',
  color: 'var(--text-muted)',
  border: '1px solid var(--border-default)',
  borderRadius: 3,
  fontSize: 10,
  fontFamily: 'monospace',
  cursor: 'pointer',
};

const dangerBtnStyle: React.CSSProperties = {
  ...secondaryBtnStyle,
  color: '#e5484d',
};

const emptyStyle: React.CSSProperties = {
  padding: 16,
  color: 'var(--text-muted)',
  fontSize: 11,
  fontFamily: 'monospace',
  textAlign: 'center',
};

const ROLES: AgentRole[] = ['Generic', 'Planner', 'Implementer', 'Verifier'];

interface FormState {
  name: string;
  role: AgentRole;
  description: string;
  instructions: string;
  model: string;
}

const emptyForm: FormState = {
  name: '',
  role: 'Generic',
  description: '',
  instructions: '',
  model: '',
};

function toForm(agent: AgentSummary): FormState {
  return {
    name: agent.name,
    role: agent.role,
    description: agent.description,
    instructions: '', // instructions are not in the summary; left blank = unchanged on save
    model: agent.model ?? '',
  };
}

export function AgentsView() {
  const state = useAppState();
  const send = useSend();

  const [mode, setMode] = useState<'list' | 'new' | 'edit'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    send({ type: 'ListAgents' });
  }, [send]);

  const agents = Array.from(state.agents.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const startNew = () => {
    setForm(emptyForm);
    setSelectedId(null);
    setMode('new');
  };

  const startEdit = (agent: AgentSummary) => {
    setForm(toForm(agent));
    setSelectedId(agent.id);
    setMode('edit');
  };

  const cancel = () => {
    setMode('list');
    setSelectedId(null);
    setForm(emptyForm);
  };

  const submit = () => {
    if (form.name.trim().length === 0) return;
    // An empty model field means "no pin" — send null so the daemon clears it
    // rather than passing a literal empty --model.
    const model = form.model.trim().length > 0 ? form.model.trim() : null;

    if (mode === 'new') {
      send({
        type: 'CreateAgent',
        name: form.name.trim(),
        role: form.role,
        description: form.description,
        instructions: form.instructions,
        model,
      });
    } else if (mode === 'edit' && selectedId) {
      send({
        type: 'UpdateAgent',
        agent_id: selectedId,
        name: form.name.trim(),
        role: form.role,
        description: form.description,
        // Only send instructions when the field was filled — the summary
        // doesn't carry them, so an untouched field means "keep as-is".
        ...(form.instructions.trim().length > 0 ? { instructions: form.instructions } : {}),
        model,
      });
    }
    cancel();
  };

  const remove = (agentId: string) => {
    send({ type: 'DeleteAgent', agent_id: agentId });
    cancel();
  };

  const canSubmit = form.name.trim().length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={headerStyle}>
        <span>Agents ({agents.length})</span>
        {mode === 'list' && (
          <button style={newBtnStyle} onClick={startNew} title="Create an agent">
            + New
          </button>
        )}
      </div>

      {(mode === 'new' || mode === 'edit') && (
        <div style={formStyle}>
          <div style={fieldLabelStyle}>Name</div>
          <input
            style={inputStyle}
            value={form.name}
            placeholder="e.g. planner"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />

          <div style={fieldLabelStyle}>Role</div>
          <select
            style={inputStyle}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as AgentRole })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <div style={fieldLabelStyle}>Model (optional)</div>
          <input
            style={inputStyle}
            value={form.model}
            placeholder="leave empty for the CLI default"
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />

          <div style={fieldLabelStyle}>Description</div>
          <input
            style={inputStyle}
            value={form.description}
            placeholder="what this agent is for"
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />

          <div style={fieldLabelStyle}>
            Instructions {mode === 'edit' && '(leave empty to keep unchanged)'}
          </div>
          <textarea
            style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }}
            value={form.instructions}
            placeholder="the agent's mission, appended as a system prompt"
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          />

          <div style={actionRowStyle}>
            <button
              style={canSubmit ? primaryBtnStyle : { ...primaryBtnStyle, opacity: 0.5, cursor: 'not-allowed' }}
              onClick={submit}
              disabled={!canSubmit}
            >
              {mode === 'new' ? 'Create' : 'Save'}
            </button>
            <button style={secondaryBtnStyle} onClick={cancel}>
              Cancel
            </button>
            {mode === 'edit' && selectedId && (
              <button
                style={{ ...dangerBtnStyle, marginLeft: 'auto' }}
                onClick={() => remove(selectedId)}
                title="Delete this agent"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {agents.length === 0 ? (
          <div style={emptyStyle}>No agents yet</div>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              style={rowStyle(hoveredId === agent.id, selectedId === agent.id)}
              onClick={() => startEdit(agent)}
              onMouseEnter={() => setHoveredId(agent.id)}
              onMouseLeave={() => setHoveredId(null)}
              title={agent.description || agent.name}
            >
              <span style={nameStyle}>{agent.name}</span>
              <span style={metaStyle}>
                {agent.role}
                {agent.model ? ` · ${agent.model}` : ''}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
