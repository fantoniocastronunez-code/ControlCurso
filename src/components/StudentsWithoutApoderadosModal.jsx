import React from 'react';
import { X, Users, AlertTriangle } from 'lucide-react';

const StudentsWithoutApoderadosModal = ({ isOpen, onClose, students }) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      zIndex: 1000, padding: '1rem'
    }} onClick={onClose}>
      <div style={{
        backgroundColor: 'var(--bg-card)', padding: '2rem', borderRadius: 'var(--radius-lg)',
        width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto',
        border: '1px solid var(--border-color)', position: 'relative'
      }} onClick={e => e.stopPropagation()}>
        
        <button onClick={onClose} style={{
          position: 'absolute', top: '1.5rem', right: '1.5rem',
          background: 'transparent', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer'
        }}>
          <X size={24} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--danger)' }}>
            <AlertTriangle size={24} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Sin Apoderado</h2>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>{students.length} alumnos pendientes de vinculación</p>
          </div>
        </div>

        {students.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>
            ¡Excelente! Todos los alumnos tienen un apoderado vinculado.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {students.map(student => (
              <div key={student.id} style={{
                padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)',
                borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ backgroundColor: 'rgba(255,255,255,0.1)', width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                    {student.listNumber || '-'}
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '1.1rem' }}>{student.name}</h4>
                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
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
