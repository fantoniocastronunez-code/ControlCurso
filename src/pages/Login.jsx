import React, { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';

const Login = () => {
  const { user, role, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && role) {
      if (role === 'superadmin' || role === 'admin') {
        navigate('/admin');
      } else {
        navigate('/apoderado');
      }
    }
  }, [user, role, navigate]);

  return (
    <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="glass-panel animate-fade-in" style={{ padding: '3rem', textAlign: 'center', maxWidth: '400px', width: '100%' }}>
        
        <div style={{ marginBottom: '2rem' }}>
          <img 
            src="/logocolegio.jpg" 
            alt="Logo Colegio" 
            style={{ 
              width: '120px', 
              height: '120px', 
              objectFit: 'contain', 
              borderRadius: '50%', 
              marginBottom: '1rem', 
              border: '2px solid rgba(255,255,255,0.1)' 
            }} 
            onError={(e) => e.target.style.display = 'none'} // Fallback if logo doesn't exist yet
          />
          <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>AppCurso</h1>
          <p style={{ color: 'var(--text-muted)' }}>Portal de control de gastos y cobros</p>
        </div>

        <button 
          onClick={loginWithGoogle} 
          className="btn btn-primary" 
          style={{ width: '100%', padding: '0.8rem' }}
        >
          <LogIn size={20} />
          <span>Ingresar con Google</span>
        </button>

        <p style={{ marginTop: '2rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Sólo usuarios autorizados. Si no tienes cuenta, comunícate con el administrador.
        </p>
      </div>
    </div>
  );
};

export default Login;
