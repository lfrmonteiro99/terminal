const placeholderStyle: React.CSSProperties = {
  padding: 16,
  color: '#888',
  fontFamily: 'monospace',
  fontSize: 12,
  textAlign: 'center',
};

export function ChangesView() {
  return (
    <div style={placeholderStyle}>
      <div style={{ fontSize: 13, color: '#e0e0e0', marginBottom: 8 }}>Changes</div>
      <div>Diff viewer coming in Phase 2</div>
    </div>
  );
}
