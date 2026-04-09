import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'monospace',
          background: '#1a1a2e',
          color: '#e0e0e0',
          padding: '2rem',
        }}>
          <h1 style={{ color: '#ff6b6b', marginBottom: '1rem' }}>
            Something went wrong
          </h1>
          <pre style={{
            background: '#16213e',
            padding: '1rem',
            borderRadius: '8px',
            maxWidth: '600px',
            overflow: 'auto',
            fontSize: '0.85rem',
            color: '#a0a0a0',
          }}>
            {this.state.error?.message}
          </pre>
          <button
            onClick={this.handleReload}
            style={{
              marginTop: '1.5rem',
              padding: '0.5rem 1.5rem',
              background: '#0f3460',
              color: '#e0e0e0',
              border: '1px solid #1a1a4e',
              borderRadius: '4px',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '0.9rem',
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
