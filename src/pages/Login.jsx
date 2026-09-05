import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { LogIn, UserPlus } from 'lucide-react';
import { auth } from '../firebase/config';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';

const Login = () => {
  const { user, role, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user && role) {
      if (role === 'superadmin' || role === 'admin') {
        navigate('/admin');
      } else {
        navigate('/apoderado');
      }
    }
  }, [user, role, navigate]);

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Correo o contraseña incorrectos.');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('El correo ya está registrado.');
      } else if (err.code === 'auth/weak-password') {
        setError('La contraseña debe tener al menos 6 caracteres.');
      } else {
        setError('Hubo un error al procesar tu solicitud.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '1rem' }}>
      <div className="glass-panel animate-fade-in" style={{ padding: '3rem 2rem', textAlign: 'center', maxWidth: '400px', width: '100%' }}>
        
        <div style={{ marginBottom: '2rem' }}>
          <img 
            src="/LOGOAPPCURSO.jpg" 
            alt="Logo Colegio" 
            style={{ 
              width: '100px', 
              height: '100px', 
              objectFit: 'contain', 
              borderRadius: '50%', 
              marginBottom: '1rem', 
              border: '2px solid rgba(255,255,255,0.1)' 
            }} 
            onError={(e) => e.target.style.display = 'none'}
          />
          <h1 className="text-gradient" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>AppCurso</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Portal de control de gastos y cobros</p>
        </div>

        {error && (
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleEmailAuth} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem', textAlign: 'left' }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Correo Electrónico</label>
            <input 
              type="email" 
              required
              className="input-field" 
              placeholder="tu@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Contraseña</label>
            <input 
              type="password" 
              required
              className="input-field" 
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button 
            type="submit" 
            className="btn btn-primary" 
            style={{ width: '100%', padding: '0.8rem', marginTop: '0.5rem', justifyContent: 'center' }}
            disabled={loading}
          >
            {loading ? 'Procesando...' : (isRegistering ? 'Crear Cuenta' : 'Iniciar Sesión')}
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', margin: '1.5rem 0' }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }}></div>
          <span style={{ padding: '0 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>O</span>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }}></div>
        </div>

        <button 
          onClick={loginWithGoogle} 
          type="button"
          className="btn btn-outline" 
          style={{ width: '100%', padding: '0.8rem', justifyContent: 'center' }}
        >
          <svg style={{ width: '18px', height: '18px', marginRight: '8px' }} viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Ingresar con Google
        </button>

        <p style={{ marginTop: '2rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {isRegistering ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?'}
          <button 
            type="button"
            onClick={() => setIsRegistering(!isRegistering)} 
            style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', marginLeft: '0.5rem', textDecoration: 'underline' }}
          >
            {isRegistering ? 'Inicia Sesión' : 'Regístrate aquí'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default Login;
