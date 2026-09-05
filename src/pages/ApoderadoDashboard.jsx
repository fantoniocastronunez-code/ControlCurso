import React from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, CheckCircle, Clock } from 'lucide-react';

const ApoderadoDashboard = () => {
  const { user, logout } = useAuth();

  return (
    <div className="container animate-fade-in">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2>Mi Portal</h2>
          <p style={{ color: 'var(--text-muted)' }}>Bienvenido, {user?.displayName}</p>
        </div>
        <button onClick={logout} className="btn btn-outline">
          <LogOut size={18} />
          Salir
        </button>
      </header>

      <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1.5rem', color: 'var(--primary)' }}>Estado de Pagos: Juanito Pérez</h3>
        
        <div style={{ display: 'grid', gap: '1rem' }}>
          {/* Pago Completado */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--success)' }}>
            <div>
              <p style={{ fontWeight: '500' }}>Cuota Septiembre</p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Pagado el 02 de Septiembre, 2026</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--success)' }}>
              <CheckCircle size={18} />
              <span style={{ fontWeight: '500' }}>Al día</span>
            </div>
          </div>

          {/* Pago Pendiente */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--warning)' }}>
            <div>
              <p style={{ fontWeight: '500' }}>Cuota Octubre</p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Vence el 05 de Octubre, 2026</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--warning)' }}>
              <Clock size={18} />
              <span style={{ fontWeight: '500' }}>Pendiente</span>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h3>Información del Curso</h3>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          Para cualquier duda respecto a los pagos, por favor contacta a la directiva del curso.
        </p>
      </div>
    </div>
  );
};

export default ApoderadoDashboard;
