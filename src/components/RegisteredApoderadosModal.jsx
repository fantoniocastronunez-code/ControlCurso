import React from 'react';
import { X, Calendar } from 'lucide-react';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';

const RegisteredApoderadosModal = ({ isOpen, onClose, apoderados }) => {
  useLockBodyScroll(isOpen);

  if (!isOpen) return null;

  // Format date and time
  const formatDateTime = (isoString) => {
    if (!isoString) return 'Fecha desconocida';
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  };

  // Sort apoderados by creation date (newest first)
  const sortedApoderados = [...apoderados].sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.5)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem'
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '500px',
        maxHeight: '85vh',
        backgroundColor: '#1e293b', /* Solid background instead of transparent */
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--radius-lg)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem', borderBottom: '1px solid var(--border-color)' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-main)' }}>Apoderados Registrados</h3>
            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Total: {apoderados.length}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.5rem' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '1.25rem', overflowY: 'auto' }}>
          {sortedApoderados.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No hay apoderados registrados.</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {sortedApoderados.map(user => (
                <div key={user.id} style={{
                  padding: '1rem',
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)'
                }}>
                  <h4 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-main)', fontSize: '1rem' }}>{user.displayName || user.name || 'Sin nombre'}</h4>
                  <p style={{ margin: '0 0 0.75rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{user.email}</p>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--primary)', fontSize: '0.8rem' }}>
                    <Calendar size={14} />
                    <span>Registro: {formatDateTime(user.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RegisteredApoderadosModal;
