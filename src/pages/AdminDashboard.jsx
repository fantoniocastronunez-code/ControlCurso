import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, Users, DollarSign, Activity } from 'lucide-react';
import UserManagement from '../components/UserManagement';

const AdminDashboard = () => {
  const { user, role, logout } = useAuth();
  const [currentView, setCurrentView] = useState('dashboard');

  return (
    <div className="container animate-fade-in">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2>Panel de Administración</h2>
          <p style={{ color: 'var(--text-muted)' }}>Bienvenido, {user?.displayName} ({role})</p>
        </div>
        <button onClick={logout} className="btn btn-outline">
          <LogOut size={18} />
          Salir
        </button>
      </header>

      {currentView === 'dashboard' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ backgroundColor: 'rgba(99,102,241,0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--primary)' }}>
                <Users size={24} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.5rem', margin: 0 }}>45</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Alumnos Activos</p>
              </div>
            </div>

            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--success)' }}>
                <DollarSign size={24} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.5rem', margin: 0 }}>$1,250.00</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Cobros del mes</p>
              </div>
            </div>

            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ backgroundColor: 'rgba(239,68,68,0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--danger)' }}>
                <Activity size={24} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.5rem', margin: 0 }}>$320.00</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Gastos del mes</p>
              </div>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h3>Gestión Rápida</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Selecciona una acción para administrar el curso.</p>
            
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <button className="btn btn-primary">Registrar Pago</button>
              <button className="btn btn-outline">Añadir Gasto</button>
              <button className="btn btn-outline">Gestionar Alumnos</button>
              {role === 'superadmin' && (
                 <button 
                   onClick={() => setCurrentView('users')}
                   className="btn btn-outline" 
                   style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
                 >
                   Gestionar Administradores
                 </button>
              )}
            </div>
          </div>
        </>
      ) : currentView === 'users' ? (
        <UserManagement onBack={() => setCurrentView('dashboard')} />
      ) : null}
    </div>
  );
};

export default AdminDashboard;
