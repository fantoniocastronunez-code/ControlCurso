import React from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Capturado por ErrorBoundary:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#090d16',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          textAlign: 'center'
        }}>
          <div className="glass-panel" style={{
            maxWidth: '480px',
            width: '100%',
            padding: '2rem',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '16px',
            boxShadow: '0 0 30px rgba(239, 68, 68, 0.2)'
          }}>
            <AlertTriangle size={52} style={{ color: 'var(--danger)', margin: '0 auto 1rem' }} />
            <h2 style={{ margin: '0 0 0.5rem 0', color: '#fff' }}>Algo no salió como esperábamos</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Se produjo un error visual inesperado. Puedes reintentar o volver al panel principal sin perder tus datos.
            </p>

            {this.state.error && (
              <div style={{
                padding: '0.75rem',
                backgroundColor: 'rgba(0,0,0,0.4)',
                borderRadius: '8px',
                fontSize: '0.75rem',
                color: '#fca5a5',
                fontFamily: 'monospace',
                marginBottom: '1.5rem',
                textAlign: 'left',
                overflowX: 'auto',
                maxHeight: '100px'
              }}>
                {String(this.state.error?.message || this.state.error)}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={this.handleReload}
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.65rem 1.25rem' }}
              >
                <RotateCcw size={16} /> Reintentar
              </button>
              <button
                type="button"
                onClick={this.handleGoHome}
                className="btn btn-outline"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.65rem 1.25rem' }}
              >
                <Home size={16} /> Ir al Inicio
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

