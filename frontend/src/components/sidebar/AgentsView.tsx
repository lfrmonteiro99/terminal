import { useEffect, useState } from 'react';
import { useAppState } from '../../context/AppContext';
import { useSend } from '../../context/SendContext';
import type { AgentSummary, Personality, Role, Runner } from '../../types/protocol';

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
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
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

const hintStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 10,
  fontFamily: 'monospace',
  marginTop: 4,
  lineHeight: 1.4,
};

const RUNNERS: Runner[] = ['Claude', 'Hermes'];

interface FormState {
  name: string;
  roleId: string;
  personalityId: string;
  runner: Runner;
  description: string;
  instructions: string;
  model: string;
}

const emptyForm: FormState = {
  name: '',
  roleId: '',
  personalityId: '',
  runner: 'Claude',
  description: '',
  instructions: '',
  model: '',
};

/** Catalogue entry being edited inline (role or personality). `id: null` = new. */
interface CatalogDraft {
  id: string | null;
  name: string;
  body: string;
}

type Mode = 'list' | 'new' | 'edit' | 'role' | 'personality';

export function AgentsView() {
  const state = useAppState();
  const send = useSend();

  const [mode, setMode] = useState<Mode>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [draft, setDraft] = useState<CatalogDraft>({ id: null, name: '', body: '' });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // A freshly created catalogue entry has no id until the daemon mints one, so
  // we remember the name we submitted and select it when the snapshot arrives.
  const [pendingRoleName, setPendingRoleName] = useState<string | null>(null);
  const [pendingPersonalityName, setPendingPersonalityName] = useState<string | null>(null);
  // Where to go back to when a catalogue editor closes. The only entry point is
  // the agent form, but keeping this explicit avoids guessing from form state.
  const [returnMode, setReturnMode] = useState<'new' | 'edit' | 'list'>('list');

  useEffect(() => {
    send({ type: 'ListAgents' });
    send({ type: 'ListCatalog' });
  }, [send]);

  const agents = Array.from(state.agents.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const roles = Array.from(state.roles.values());
  const personalities = Array.from(state.personalities.values());
  const roleName = (id: string | null) =>
    (id ? state.roles.get(id)?.name : null) ?? null;
  const personalityName = (id: string | null) =>
    (id ? state.personalities.get(id)?.name : null) ?? null;

  // Select a just-created catalogue entry once it appears in the snapshot.
  useEffect(() => {
    if (!pendingRoleName) return;
    const found = roles.find((r) => r.name === pendingRoleName);
    if (found) {
      setForm((f) => ({ ...f, roleId: found.id }));
      setPendingRoleName(null);
    }
  }, [roles, pendingRoleName]);

  useEffect(() => {
    if (!pendingPersonalityName) return;
    const found = personalities.find((p) => p.name === pendingPersonalityName);
    if (found) {
      setForm((f) => ({ ...f, personalityId: found.id }));
      setPendingPersonalityName(null);
    }
  }, [personalities, pendingPersonalityName]);

  const startNew = () => {
    setForm(emptyForm);
    setSelectedId(null);
    setMode('new');
  };

  const startEdit = (agent: AgentSummary) => {
    setForm({
      name: agent.name,
      roleId: agent.role_id ?? '',
      personalityId: agent.personality_id ?? '',
      runner: agent.runner,
      description: agent.description,
      instructions: agent.instructions,
      model: agent.model ?? '',
    });
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
    // Empty reference = no overlay. On create that is simply absent; on update
    // the empty string is what clears an existing reference.
    const role_id = form.roleId || undefined;
    const personality_id = form.personalityId || undefined;

    if (mode === 'new') {
      send({
        type: 'CreateAgent',
        name: form.name.trim(),
        role_id,
        personality_id,
        runner: form.runner,
        description: form.description,
        instructions: form.instructions,
        model,
      });
    } else if (mode === 'edit' && selectedId) {
      send({
        type: 'UpdateAgent',
        agent_id: selectedId,
        name: form.name.trim(),
        role_id: form.roleId,
        personality_id: form.personalityId,
        runner: form.runner,
        description: form.description,
        // The field is prefilled from the saved agent, so what is on screen is
        // the whole truth: send it unconditionally (this also allows clearing).
        instructions: form.instructions,
        model,
      });
    }
    cancel();
  };

  const remove = (agentId: string) => {
    send({ type: 'DeleteAgent', agent_id: agentId });
    cancel();
  };

  // --- Catalogue editors ---

  const openRole = (role?: Role) => {
    setReturnMode(mode === 'edit' ? 'edit' : mode === 'new' ? 'new' : 'list');
    setDraft(
      role
        ? { id: role.id, name: role.name, body: role.instructions }
        : { id: null, name: '', body: '' },
    );
    setMode('role');
  };

  const openPersonality = (personality?: Personality) => {
    setReturnMode(mode === 'edit' ? 'edit' : mode === 'new' ? 'new' : 'list');
    setDraft(
      personality
        ? { id: personality.id, name: personality.name, body: personality.prompt }
        : { id: null, name: '', body: '' },
    );
    setMode('personality');
  };

  const closeDraft = () => setMode(returnMode);

  const saveDraft = () => {
    if (draft.name.trim().length === 0) return;
    const now = new Date().toISOString();
    if (mode === 'role') {
      const existing = draft.id ? state.roles.get(draft.id) : undefined;
      send({
        type: 'SaveRole',
        role: {
          id: draft.id ?? '',
          name: draft.name.trim(),
          instructions: draft.body,
          builtin: existing?.builtin ?? false,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        },
      });
      if (!draft.id) setPendingRoleName(draft.name.trim());
    } else {
      const existing = draft.id ? state.personalities.get(draft.id) : undefined;
      send({
        type: 'SavePersonality',
        personality: {
          id: draft.id ?? '',
          name: draft.name.trim(),
          prompt: draft.body,
          builtin: existing?.builtin ?? false,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        },
      });
      if (!draft.id) setPendingPersonalityName(draft.name.trim());
    }
    // Back to the agent form, keeping whatever the user had typed there.
    setMode(returnMode);
  };

  const deleteDraft = () => {
    if (!draft.id) return;
    if (mode === 'role') send({ type: 'DeleteRole', id: draft.id });
    else send({ type: 'DeletePersonality', id: draft.id });
    setForm((f) => ({
      ...f,
      roleId: mode === 'role' && f.roleId === draft.id ? '' : f.roleId,
      personalityId: mode === 'personality' && f.personalityId === draft.id ? '' : f.personalityId,
    }));
    setMode(returnMode);
  };

  const canSubmit = form.name.trim().length > 0;
  const editingCatalogue = mode === 'role' || mode === 'personality';
  const editingForm = mode === 'new' || mode === 'edit';

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

      {editingCatalogue && (
        <div style={formStyle}>
          <div style={{ color: 'var(--text-primary)', fontSize: 11, marginBottom: 4 }}>
            {draft.id ? 'Edit' : 'New'} {mode === 'role' ? 'role' : 'personality'}
          </div>
          <div style={fieldLabelStyle}>Name</div>
          <input
            style={inputStyle}
            value={draft.name}
            placeholder={mode === 'role' ? 'e.g. architect' : 'e.g. blunt'}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            autoFocus
          />
          <div style={fieldLabelStyle}>
            {mode === 'role' ? 'Base instructions' : 'Prompt'}
          </div>
          <textarea
            style={{ ...inputStyle, minHeight: 96, resize: 'vertical' }}
            value={draft.body}
            placeholder={
              mode === 'role'
                ? 'what every agent in this role must do'
                : 'how this agent should communicate'
            }
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
          <div style={hintStyle}>
            {mode === 'role'
              ? 'Sent to the model ahead of the agent’s own instructions.'
              : 'Appended after the role and the agent’s instructions.'}
          </div>
          <div style={actionRowStyle}>
            <button
              style={
                draft.name.trim().length > 0
                  ? primaryBtnStyle
                  : { ...primaryBtnStyle, opacity: 0.5, cursor: 'not-allowed' }
              }
              onClick={saveDraft}
              disabled={draft.name.trim().length === 0}
            >
              Save
            </button>
            <button
              style={secondaryBtnStyle}
              onClick={closeDraft}
            >
              Back
            </button>
            {draft.id && (
              <button
                style={{ ...dangerBtnStyle, marginLeft: 'auto' }}
                onClick={deleteDraft}
                title={`Delete this ${mode === 'role' ? 'role' : 'personality'}`}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {editingForm && (
        <div style={formStyle}>
          <div style={fieldLabelStyle}>Name</div>
          <input
            style={inputStyle}
            value={form.name}
            placeholder="e.g. planner"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />

          <div style={fieldLabelStyle}>
            <span>Role</span>
            <button
              style={{ ...newBtnStyle, padding: '0 6px' }}
              onClick={() => openRole()}
              title="Create a role"
            >
              + Edit roles
            </button>
          </div>
          <select
            style={inputStyle}
            value={form.roleId}
            onChange={(e) => setForm({ ...form, roleId: e.target.value })}
          >
            <option value="">— none —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.builtin ? '' : ' *'}
              </option>
            ))}
          </select>
          {form.roleId && (
            <button
              style={{ ...secondaryBtnStyle, marginTop: 4 }}
              onClick={() => openRole(state.roles.get(form.roleId))}
            >
              Edit “{roleName(form.roleId)}”
            </button>
          )}

          <div style={fieldLabelStyle}>
            <span>Personality</span>
            <button
              style={{ ...newBtnStyle, padding: '0 6px' }}
              onClick={() => openPersonality()}
              title="Create a personality"
            >
              + Edit
            </button>
          </div>
          <select
            style={inputStyle}
            value={form.personalityId}
            onChange={(e) => setForm({ ...form, personalityId: e.target.value })}
          >
            <option value="">— none —</option>
            {personalities.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.builtin ? '' : ' *'}
              </option>
            ))}
          </select>
          {form.personalityId && (
            <button
              style={{ ...secondaryBtnStyle, marginTop: 4 }}
              onClick={() => openPersonality(state.personalities.get(form.personalityId))}
            >
              Edit “{personalityName(form.personalityId)}”
            </button>
          )}

          <div style={fieldLabelStyle}>Runner</div>
          <select
            style={inputStyle}
            value={form.runner}
            onChange={(e) => setForm({ ...form, runner: e.target.value as Runner })}
          >
            {RUNNERS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <div style={fieldLabelStyle}>Model (optional)</div>
          <input
            style={inputStyle}
            value={form.model}
            placeholder="leave empty for the runner default"
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
            <span>Instructions {mode === 'edit' && '(empty = unchanged)'}</span>
          </div>
          <textarea
            style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }}
            value={form.instructions}
            placeholder="what is specific to this agent, on top of its role"
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          />
          <div style={hintStyle}>
            Final prompt = role + these instructions + personality.
          </div>

          <div style={actionRowStyle}>
            <button
              style={
                canSubmit
                  ? primaryBtnStyle
                  : { ...primaryBtnStyle, opacity: 0.5, cursor: 'not-allowed' }
              }
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
                {roleName(agent.role_id) ?? 'no role'}
                {agent.personality_id ? ` · ${personalityName(agent.personality_id)}` : ''}
                {` · ${agent.runner}`}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
