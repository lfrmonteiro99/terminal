import { useState, useEffect } from 'react';
import { useAppState } from '../../context/AppContext';
import { useSend } from '../../context/SendContext';
import type { FileTreeEntry } from '../../types/protocol';

// --- Helpers ---

function joinPath(parent: string, name: string): string {
  return parent === '.' ? name : parent + '/' + name;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'b';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'k';
  return (bytes / (1024 * 1024)).toFixed(1) + 'M';
}

function splitFileName(name: string): { stem: string; ext: string } {
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, lastDot), ext: name.slice(lastDot) };
}

// --- Styles ---

const rowBaseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  paddingTop: 3,
  paddingBottom: 3,
  paddingRight: 8,
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: 'monospace',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  userSelect: 'none',
  borderLeft: '2px solid transparent',
};

const triangleStyle: React.CSSProperties = {
  width: 12,
  height: 12,
  fontSize: 9,
  lineHeight: '12px',
  textAlign: 'center',
  color: '#666',
  flexShrink: 0,
  transition: 'transform 0.1s ease',
};

const dirNameStyle: React.CSSProperties = {
  color: '#e0e0e0',
  fontWeight: '500',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
};

const folderIconStyle: React.CSSProperties = {
  fontSize: 10,
  width: 14,
  textAlign: 'center',
  color: '#f0a500',
};

const fileSizeStyle: React.CSSProperties = {
  color: '#666',
  fontSize: 10,
  marginLeft: 'auto',
  paddingLeft: 8,
};

// --- Props ---

interface FileTreeNodeProps {
  entry: FileTreeEntry;
  depth: number;
  fullPath: string;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

// --- Component ---

export function FileTreeNode({
  entry,
  depth,
  fullPath,
  expandedPaths,
  onToggleExpand,
  selectedFile,
  onSelectFile,
}: FileTreeNodeProps) {
  const state = useAppState();
  const send = useSend();
  const [hover, setHover] = useState(false);

  const isDir = entry.is_dir;
  const isExpanded = isDir && expandedPaths.has(fullPath);
  const isSelected = !isDir && selectedFile === fullPath;
  const children = isDir ? state.explorerTree.get(fullPath) : undefined;

  // When a directory is expanded and we don't have its children yet, fetch them
  useEffect(() => {
    if (isExpanded && children === undefined) {
      send({ type: 'ListDirectory', path: fullPath });
    }
  }, [isExpanded, children, fullPath, send]);

  const paddingLeft = 12 + depth * 16;

  const rowStyle: React.CSSProperties = {
    ...rowBaseStyle,
    paddingLeft,
    ...(isSelected
      ? { backgroundColor: 'rgba(78, 205, 196, 0.12)', borderLeft: '2px solid #4ecdc4' }
      : hover
        ? { backgroundColor: 'rgba(255, 255, 255, 0.05)' }
        : {}),
  };

  const handleClick = () => {
    if (isDir) {
      onToggleExpand(fullPath);
    } else {
      onSelectFile(fullPath);
    }
  };

  return (
    <>
      <div
        style={rowStyle}
        onClick={handleClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {/* Triangle / spacer */}
        {isDir ? (
          <span style={{ ...triangleStyle, transform: isExpanded ? 'rotate(90deg)' : 'none' }}>
            {'\u25B6'}
          </span>
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}

        {/* Icon */}
        {isDir ? (
          <span style={folderIconStyle}>{'\u25AA'}</span>
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}

        {/* Name */}
        {isDir ? (
          <span style={dirNameStyle}>{entry.name}</span>
        ) : (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'flex' }}>
            <span style={{ color: '#e0e0e0' }}>{splitFileName(entry.name).stem}</span>
            <span style={{ color: '#666', fontSize: 10 }}>{splitFileName(entry.name).ext}</span>
          </span>
        )}

        {/* File size */}
        {!isDir && entry.size !== undefined && (
          <span style={fileSizeStyle}>{formatSize(entry.size)}</span>
        )}
      </div>

      {/* Children (directories only, when expanded) */}
      {isDir && isExpanded && (
        <>
          {children === undefined ? (
            <div style={{ ...rowBaseStyle, paddingLeft: 12 + (depth + 1) * 16, color: '#666', cursor: 'default' }}>
              Loading...
            </div>
          ) : children.length === 0 ? (
            <div style={{ ...rowBaseStyle, paddingLeft: 12 + (depth + 1) * 16, color: '#666', fontStyle: 'italic', cursor: 'default' }}>
              (empty)
            </div>
          ) : (
            children.map(child => (
              <FileTreeNode
                key={child.name}
                entry={child}
                depth={depth + 1}
                fullPath={joinPath(fullPath, child.name)}
                expandedPaths={expandedPaths}
                onToggleExpand={onToggleExpand}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
              />
            ))
          )}
        </>
      )}
    </>
  );
}
