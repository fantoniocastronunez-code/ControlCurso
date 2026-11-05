import React, { useState, useMemo } from 'react';
import { X, Calendar, Search, Users, User } from 'lucide-react';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';

const RegisteredApoderadosModal = ({ isOpen, onClose, apoderados = [] }) => {
  useLockBodyScroll(isOpen);
  const [searchTerm, setSearchTerm] = useState('');

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
  const sortedApoderados = useMemo(() => {
    return [...apoderados].sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
  }, [apoderados]);

  // Filtered by search
  const filteredApoderados = useMemo(() => {
    if (!searchTerm.trim()) return sortedApoderados;
    const term = searchTerm.toLowerCase();
    return sortedApoderados.filter(u => {
      const name = (u.displayName || u.name || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      return name.includes(term) || email.includes(term);
    });
  }, [sortedApoderados, searchTerm]);

  if (!isOpen) return null;

  return (
    <div 
      className="modal-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem 0.5rem 2rem',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch'
      }}
      onClick={onClose}
    >
      <div 
        style={{
          width: '100%',
          maxWidth: '520px',
          maxHeight: '90vh',
          marginTop: '1rem',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '1.25rem 1.5rem', 
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-card)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '38px',
              height: '38px',
              minWidth: '38px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-card-hover)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-main)'
            }}>
              <Users size={18} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-main)', fontWeight: '600' }}>
                  Apoderados Registrados
                </h3>
                <span style={{ 
                  padding: '0.1rem 0.5rem', 
                  borderRadius: 'var(--radius-sm)', 
                  backgroundColor: 'var(--bg-card-hover)', 
                  border: '1px solid var(--border-color)',
                  fontSize: '0.75rem', 
                  color: 'var(--text-muted)',
                  fontWeight: '500'
                }}>
                  {apoderados.length}
                </span>
              </div>
              <p style={{ margin: '0.15rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Cuentas activas en la aplicación
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="btn btn-outline"
            style={{ 
              padding: '0.35rem 0.5rem',
              color: 'var(--text-muted)', 
              borderColor: 'var(--border-color)'
            }}
            title="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search Bar */}
        <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.45rem 0.75rem',
            backgroundColor: 'var(--bg-card-hover)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)'
          }}>
            <Search size={15} style={{ color: 'var(--text-muted)' }} />
            <input 
              type="text"
              placeholder="Buscar por nombre o correo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-main)',
                fontSize: '0.85rem'
              }}
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')} 
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* List Content */}
        <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {filteredApoderados.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
              <User size={32} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
              <p style={{ margin: 0, fontSize: '0.9rem' }}>
                {searchTerm ? 'No se encontraron apoderados que coincidan con la búsqueda.' : 'No hay apoderados registrados.'}
              </p>
            </div>
          ) : (
            filteredApoderados.map(user => {
              const displayName = user.displayName || user.name;
              const initial = displayName ? displayName.charAt(0).toUpperCase() : (user.email ? user.email.charAt(0).toUpperCase() : '?');
              
              return (
                <div 
                  key={user.id} 
                  style={{
                    padding: '0.85rem 1rem',
                    backgroundColor: 'var(--bg-card-hover)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem'
                  }}
                >
                  <div style={{
                    width: '36px',
                    height: '36px',
                    minWidth: '36px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: '600',
                    fontSize: '0.85rem',
                    color: 'var(--text-main)'
                  }}>
                    {initial}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <h4 style={{ 
                        margin: 0, 
                        color: displayName ? 'var(--text-main)' : 'var(--text-muted)', 
                        fontSize: '0.9rem',
                        fontWeight: '600',
                        fontStyle: displayName ? 'normal' : 'italic',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {displayName || 'Sin nombre asignado'}
                      </h4>
                    </div>

                    <p style={{ 
                      margin: '0.15rem 0 0.35rem 0', 
                      color: 'var(--text-muted)', 
                      fontSize: '0.8rem',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {user.email}
                    </p>
                    
                    <div style={{ 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      gap: '0.35rem', 
                      color: 'var(--text-muted)', 
                      fontSize: '0.725rem'
                    }}>
                      <Calendar size={12} />
                      <span>Registrado: {formatDateTime(user.createdAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default RegisteredApoderadosModal;
