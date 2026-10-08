// SettingsView — user-facing design settings.
//
// Owns exactly two things the user should control without editing code: the
// appearance (light/dark) and the accent colour. The editor theme list stays
// available but is no longer the way you pick a colour — picking Dracula used
// to silently change the accent and there was no way to keep it.

import { useState } from 'react';
import { Check, Moon, Sun } from 'lucide-react';
import {
  ACCENTS,
  LIGHT_THEME_IDS,
} from '../styles/palettes';
import {
  applyAppearance,
  applyThemeId,
  accentHex,
  currentAppearance,
  savedAccentId,
  type Appearance,
} from '../styles/appearance';
import { getCurrentThemeId, themes } from '../styles/themes';

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-semibold)',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  margin: '0 0 var(--space-3)',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-4)',
  marginBottom: 'var(--space-6)',
};

const hintStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--text-secondary)',
  lineHeight: 'var(--leading-normal)',
  margin: 'var(--space-3) 0 0',
};

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; Icon?: React.ComponentType<{ size?: number }> }[];
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      style={{
        display: 'inline-flex',
        padding: 3,
        gap: 2,
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 28,
              padding: '0 12px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-medium)',
              background: selected ? 'var(--bg-surface)' : 'transparent',
              color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
              boxShadow: selected ? 'var(--shadow-elevated)' : 'none',
            }}
          >
            {o.Icon && <o.Icon size={14} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsView() {
  const [appearance, setAppearance] = useState<Appearance>(() => currentAppearance());
  const [accentId, setAccentId] = useState<string>(() => savedAccentId());
  const [themeId, setThemeId] = useState<string>(() => getCurrentThemeId());

  const onAppearance = (next: Appearance) => {
    applyAppearance(next, accentId);
    setAppearance(next);
    // The appearance switch is a scheme switch, so the theme id moves with it.
    setThemeId(next === 'light' ? 'terminal-engine-light' : 'terminal-engine');
  };

  const onAccent = (id: string) => {
    applyThemeId(themeId, id);
    setAccentId(id);
  };

  const onTheme = (id: string) => {
    applyThemeId(id, accentId);
    setThemeId(id);
    setAppearance(LIGHT_THEME_IDS.has(id) ? 'light' : 'dark');
  };

  const activeAccent = ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0];
  const activeHex = accentHex(activeAccent, appearance);

  return (
    <div
      data-view="settings"
      style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}
    >
      <h1
        style={{
          fontSize: 'var(--font-size-lg)',
          fontWeight: 'var(--font-weight-semibold)',
          letterSpacing: '-0.015em',
          margin: '0 0 var(--space-2)',
        }}
      >
        Appearance
      </h1>
      <p style={{ ...hintStyle, marginTop: 0, marginBottom: 'var(--space-6)' }}>
        These settings are stored locally and apply immediately.
      </p>

      {/* --- Appearance ---------------------------------------------------- */}
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>Theme</h2>
        <Segmented
          value={appearance}
          onChange={onAppearance}
          options={[
            { value: 'light', label: 'Light', Icon: Sun },
            { value: 'dark', label: 'Dark', Icon: Moon },
          ]}
        />
        <p style={hintStyle}>
          Switching flips the neutral surfaces only. Your accent stays where you put it.
        </p>
      </section>

      {/* --- Accent -------------------------------------------------------- */}
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>Accent</h2>
        <div
          role="radiogroup"
          aria-label="Accent colour"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
            gap: 'var(--space-2)',
          }}
        >
          {ACCENTS.map((palette) => {
            const hex = accentHex(palette, appearance);
            const selected = palette.id === accentId;
            return (
              <button
                key={palette.id}
                role="radio"
                aria-checked={selected}
                aria-label={palette.name}
                onClick={() => onAccent(palette.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-2)',
                  background: selected ? 'var(--accent-soft)' : 'transparent',
                  border: `1px solid ${selected ? 'var(--accent-border)' : 'var(--border-default)'}`,
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--font-weight-medium)',
                  color: 'var(--text-primary)',
                  textAlign: 'left',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 'var(--radius-pill)',
                    background: hex,
                    flexShrink: 0,
                    boxShadow: 'inset 0 0 0 1px var(--tint-border)',
                  }}
                />
                <span style={{ flex: 1 }}>{palette.name}</span>
                {selected && <Check size={14} style={{ color: 'var(--accent-primary)' }} />}
              </button>
            );
          })}
        </div>

        {/* Live preview of the accent against its own foreground */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <button
            style={{
              height: 30,
              padding: '0 14px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-primary)',
              color: 'var(--accent-fg)',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-semibold)',
              cursor: 'pointer',
            }}
          >
            Run
          </button>
          <button
            style={{
              height: 30,
              padding: '0 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-default)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-medium)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <span
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--accent-primary)',
              fontWeight: 'var(--font-weight-medium)',
            }}
          >
            dispatcher.rs
          </span>
          <code
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-muted)',
            }}
          >
            {activeHex}
          </code>
        </div>
        <p style={hintStyle}>
          Every palette is contrast-checked against its own foreground, in both themes — AA or
          better.
        </p>
      </section>

      {/* --- Editor theme --------------------------------------------------- */}
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>Editor theme</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 'var(--space-2)',
          }}
        >
          {themes.map((t) => {
            const selected = t.id === themeId;
            return (
              <button
                key={t.id}
                onClick={() => onTheme(t.id)}
                aria-pressed={selected}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-2) var(--space-3)',
                  background: selected ? 'var(--accent-soft)' : 'transparent',
                  border: `1px solid ${selected ? 'var(--accent-border)' : 'var(--border-default)'}`,
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--text-primary)',
                  textAlign: 'left',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name}
                </span>
                {selected && <Check size={13} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
        <p style={hintStyle}>
          Themes change the neutral palette and set the matching light/dark mode. The accent is
          never taken from a theme.
        </p>
      </section>
    </div>
  );
}

export default SettingsView;