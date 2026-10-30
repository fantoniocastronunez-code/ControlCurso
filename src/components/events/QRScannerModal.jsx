import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, X, RefreshCw, AlertCircle, Hash, Check } from 'lucide-react';

/**
 * Sonido de lectura exitosa de código QR (Web Audio API)
 */
const playSuccessBeep = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1600, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Ignorar si el audio está restringido
  }
};

const QRScannerModal = ({ isOpen, onClose, onScanSuccess }) => {
  const [cameraError, setCameraError] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const scannerRef = useRef(null);
  const isStoppingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    let html5QrCode = null;
    isStoppingRef.current = false;
    setCameraError(null);

    const startScanner = async () => {
      try {
        html5QrCode = new Html5Qrcode("appcurso-qr-reader");
        scannerRef.current = html5QrCode;

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0
        };

        await html5QrCode.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            if (isStoppingRef.current) return;
            isStoppingRef.current = true;
            playSuccessBeep();
            if (navigator.vibrate) {
              try { navigator.vibrate(100); } catch {}
            }

            // Detener cámara antes de notificar
            html5QrCode.stop().catch(() => {}).then(() => {
              try { html5QrCode.clear(); } catch {}
              onScanSuccess(decodedText);
            });
          },
          () => {
            // Error de frame intermedio ignorado
          }
        );
        setIsScanning(true);
      } catch (err) {
        console.warn("Error al inicializar cámara para QR:", err);
        setCameraError(
          err.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Permite el acceso a la cámara en tu navegador.'
            : 'No se pudo iniciar la cámara en este dispositivo. Puedes ingresar el ticket manualmente.'
        );
      }
    };

    // Pequeño timeout para asegurar que el elemento DOM #appcurso-qr-reader ya existe
    const timer = setTimeout(startScanner, 250);

    return () => {
      clearTimeout(timer);
      isStoppingRef.current = true;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {}).then(() => {
          try { scannerRef.current.clear(); } catch {}
          scannerRef.current = null;
        });
      }
    };
  }, [isOpen, onScanSuccess]);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    const clean = manualInput.trim();
    if (!clean) return;
    playSuccessBeep();
    onScanSuccess(clean);
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100000,
      padding: '1rem'
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '440px',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        backgroundColor: '#0f172a',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Cabecera */}
        <div style={{
          padding: '1rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          background: 'rgba(255, 255, 255, 0.02)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Camera size={20} color="var(--primary)" />
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#fff' }}>Escanear Ticket de Entrega</h3>
          </div>
          <button
            onClick={onClose}
            className="btn btn-outline"
            style={{ padding: '0.35rem', borderRadius: '50%', color: 'var(--text-muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Visor de Cámara */}
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Apunta la cámara al <strong>código QR</strong> impreso al final del ticket
          </p>

          <div style={{
            width: '100%',
            maxWidth: '300px',
            minHeight: '260px',
            borderRadius: '12px',
            overflow: 'hidden',
            backgroundColor: '#000',
            position: 'relative',
            border: '2px solid var(--primary)',
            boxShadow: '0 0 20px rgba(99, 102, 241, 0.25)'
          }}>
            <div id="appcurso-qr-reader" style={{ width: '100%', height: '100%' }}></div>
          </div>

          {cameraError && (
            <div style={{
              marginTop: '0.75rem',
              padding: '0.65rem 0.85rem',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid var(--danger)',
              borderRadius: '8px',
              fontSize: '0.8rem',
              color: '#fca5a5',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <span>{cameraError}</span>
            </div>
          )}

          {/* Opción Manual por si falla la cámara */}
          <div style={{ width: '100%', marginTop: '1.25rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '1rem' }}>
            <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Hash size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="O ingresa N° ticket (ej. 3)"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', paddingLeft: '2rem', fontSize: '0.85rem' }}
                />
              </div>
              <button
                type="submit"
                disabled={!manualInput.trim()}
                className="btn btn-primary"
                style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Check size={15} /> Validar
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRScannerModal;
