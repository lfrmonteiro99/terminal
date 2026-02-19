const placeholderStyle: React.CSSProperties = {
  padding: 16,
  color: '#888',
  fontFamily: 'monospace',
  fontSize: 12,
  textAlign: 'center',
};

export function ExplorerView() {
  return (
    <div style={placeholderStyle}>
      <div style={{ fontSize: 13, color: '#e0e0e0', marginBottom: 8 }}>Explorer</div>
      <div>File tree coming in Phase 3</div>
    </div>
  );
}
