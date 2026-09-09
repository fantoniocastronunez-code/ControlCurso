import React, { useState, useEffect } from 'react';
import { Download, X, Share, PlusSquare, Smartphone } from 'lucide-react';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';

const InstallAppGuide = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useLockBodyScroll(showModal);

  useEffect(() => {
    // Check if already installed
    const isInstalled = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    setIsStandalone(isInstalled);

    // Detect iOS
    const ua = window.navigator.userAgent;
    const webkit = !!ua.match(/WebKit/i);
    const isIPad = !!ua.match(/iPad/i);
    const isIPhone = !!ua.match(/iPhone/i);
    const isIOSDevice = isIPad || isIPhone;
    setIsIOS(isIOSDevice && webkit && !ua.match(/CriOS/i));

    // Listen for Android/Chrome install prompt
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  if (isStandalone) {
    return null; // Already installed
  }

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // Chrome/Android flow
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      // iOS or fallback flow
      setShowModal(true);
    }
  };

  return (
    <>
      <button 
        onClick={handleInstallClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem 1.5rem',
          backgroundColor: 'var(--primary)',
          color: 'var(--bg-color)',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          fontWeight: '600',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
          transition: 'all 0.2s'
        }}
        onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
        onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
      >
        <Download size={20} />
        Instalar App en el Celular
      </button>

      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.8)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div className="glass-panel" style={{
            backgroundColor: 'var(--surface)',
            padding: '2rem',
            borderRadius: 'var(--radius-lg)',
            maxWidth: '400px',
            width: '100%',
            position: 'relative'
          }}>
            <button 
              onClick={() => setShowModal(false)}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer'
              }}
            >
              <X size={24} />
            </button>
            
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '1rem', borderRadius: '50%', display: 'inline-block', marginBottom: '1rem' }}>
                <Smartphone size={40} color="var(--primary)" />
              </div>
              <h2 style={{ margin: '0 0 0.5rem 0' }}>Instalar Aplicación</h2>
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>Para un acceso más rápido, instala la app en tu pantalla de inicio.</p>
            </div>

            {isIOS ? (
              <div style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: '1.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <ol style={{ margin: 0, paddingLeft: '1.5rem', color: 'var(--text-main)' }}>
                  <li style={{ marginBottom: '1rem' }}>
                    Toca el ícono de <strong>Compartir</strong> en la barra inferior de Safari.
                    <div style={{ display: 'flex', justifyContent: 'center', margin: '0.5rem 0' }}>
                      <Share size={24} color="var(--primary)" />
                    </div>
                  </li>
                  <li>
                    Selecciona <strong>"Agregar a inicio"</strong> en el menú.
                    <div style={{ display: 'flex', justifyContent: 'center', margin: '0.5rem 0' }}>
                      <PlusSquare size={24} color="var(--primary)" />
                    </div>
                  </li>
                </ol>
              </div>
            ) : (
              <div style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: '1.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                <p style={{ margin: '0 0 1rem 0' }}>1. Toca el menú de opciones de tu navegador (los 3 puntitos).</p>
                <p style={{ margin: 0 }}>2. Selecciona <strong>"Instalar aplicación"</strong> o <strong>"Agregar a la pantalla principal"</strong>.</p>
              </div>
            )}
            
            <button 
              onClick={() => setShowModal(false)}
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: 'var(--border-color)',
                color: 'var(--text-main)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                marginTop: '1.5rem',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default InstallAppGuide;
