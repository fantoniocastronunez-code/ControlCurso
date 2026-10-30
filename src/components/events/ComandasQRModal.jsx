import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Copy, Check, ExternalLink, ChefHat, Smartphone, Volume2, ShieldCheck } from 'lucide-react';
import { useModal } from '../../context/ModalContext';

const ComandasQRModal = ({ isOpen, onClose, eventId, eventName }) => {
  const { showAlert } = useModal();
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const comandasUrl = `${origin}/comandas/${eventId}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(comandasUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      showAlert('No se pudo copiar el enlace automáticamente. Por favor selecciónalo manualmente.');
    }
  };

  const handleOpenDirect = () => {
    window.open(comandasUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100000,
      padding: '1rem'
    }}>
      <div 
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: '460px',
          backgroundColor: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '16px',
          padding: '1.75rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)',
          position: 'relative'
        }}
      >
        {/* Botón Cerrar */}
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            padding: '0.4rem',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Cerrar"
        >
          <X size={20} />
        </button>

        {/* Encabezado */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            backgroundColor: 'rgba(99, 102, 241, 0.15)',
            border: '1px solid var(--primary)',
            color: 'var(--primary)',
            marginBottom: '0.75rem'
          }}>
            <ChefHat size={26} />
          </div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#fff', fontWeight: 'bold' }}>
            Pantalla de Comandas en Vivo
          </h3>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
            {eventName || 'Cocina y Despacho'}
          </p>
        </div>

        {/* Contenedor del Código QR */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '1.25rem',
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
          margin: '0 auto 1.5rem auto',
          width: 'fit-content'
        }}>
          <QRCodeSVG 
            value={comandasUrl}
            size={220}
            level="M"
            includeMargin={false}
          />
        </div>

        {/* Instrucciones Rápidas */}
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          borderRadius: '10px',
          padding: '0.85rem 1rem',
          marginBottom: '1.25rem',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          fontSize: '0.82rem',
          color: '#cbd5e1',
          lineHeight: 1.45
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#818cf8', fontWeight: 600, marginBottom: '0.35rem' }}>
            <Smartphone size={15} /> ¿Cómo funciona?
          </div>
          <p style={{ margin: 0 }}>
            Escanea este código con la cámara de <strong>cualquier celular</strong> en la cocina o entrega. Los pedidos aparecerán en tiempo real automáticamente con sonido de aviso, y podrán marcarlos como <em>En preparación</em> o <em>Entregado</em>.
          </p>
        </div>

        {/* Enlace y Acciones */}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleCopyLink}
            className="btn btn-outline"
            style={{
              flex: '1 1 180px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              padding: '0.6rem',
              fontSize: '0.85rem'
            }}
          >
            {copied ? <Check size={16} color="var(--success)" /> : <Copy size={16} />}
            <span>{copied ? '¡Enlace Copiado!' : 'Copiar Enlace'}</span>
          </button>

          <button
            type="button"
            onClick={handleOpenDirect}
            className="btn btn-primary"
            style={{
              flex: '1 1 180px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              padding: '0.6rem',
              fontSize: '0.85rem',
              fontWeight: 600
            }}
          >
            <ExternalLink size={16} />
            <span>Abrir en esta Pantalla</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComandasQRModal;
