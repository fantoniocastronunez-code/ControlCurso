import React from 'react';
import { X, Users, AlertTriangle } from 'lucide-react';

const StudentsWithoutApoderadosModal = ({ isOpen, onClose, students }) => {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.75)',
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        zIndex: 1000, padding: '1rem 0.5rem 2rem', overflowY: 'auto', WebkitOverflowScrolling: 'touch'
      }}
      onClick={onClose}
    >
      <div style={{
        backgroundColor: 'var(--bg-card)', padding: '1.5rem', borderRadius: 'var(--radius-lg)',
        width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto',
        marginTop: '1rem',
        border: '1px solid var(--border-color)', position: 'relative',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)'
      }} onClick={e => e.stopPropagation()}>

        <button onClick={onClose} style={{
          position: 'absolute', top: '1.25rem', right: '1.25rem',
          background: 'transparent', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer'
        }}>
          <X size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{ width: '38px', height: '38px', minWidth: '38px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--danger)' }}>
            <AlertTriangle size={18} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-main)', fontWeight: '600' }}>Sin Apoderado</h3>
            <p style={{ margin: '0.15rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{students.length} alumnos pendientes de vinculación</p>
          </div>
        </div>

        {students.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>
            Todos los alumnos tienen un apoderado vinculado.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {students.map(student => (
              <div key={student.id} style={{
                padding: '0.85rem 1rem', backgroundColor: 'var(--bg-card-hover)',
                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                  <div style={{ backgroundColor: 'var(--bg-card)', width: '36px', height: '36px', minWidth: '36px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '600', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                    {student.listNumber || '-'}
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-main)', fontWeight: '600' }}>{student.name}</h4>
                    <p style={{ margin: '0.15rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      RUT: {student.rut || 'No registrado'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentsWithoutApoderadosModal;
