import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { LogIn, UserPlus, Key } from 'lucide-react';
import { auth, db } from '../firebase/config';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { collection, query, where, getDocs, setDoc, doc } from 'firebase/firestore';
import InstallAppGuide from '../components/InstallAppGuide';

const Login = () => {
  const { user, role, userData, loginWithGoogle, logout } = useAuth();
  const navigate = useNavigate();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [inviteCode, setInviteCode] = useState('');
  const [validatingCode, setValidatingCode] = useState(false);

  const hasNoRoles = user && userData && (!userData.roles || Object.keys(userData.roles).length === 0);

  useEffect(() => {
    if (user && role && !hasNoRoles) {
      // If superadmin, always go to admin panel
      if (role === 'superadmin' || role === 'admin' || userData?.roles?.['global'] === 'superadmin') {
        navigate('/admin');
      } else {
        // Here we could check the role of the default course, but for now fallback to apoderado
        navigate('/apoderado');
      }
    }
  }, [user, role, userData, hasNoRoles, navigate]);

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

  const handleInviteCodeSubmit = async (e) => {
    e.preventDefault();
    setValidatingCode(true);
    setError('');
    
    try {
      // 1. Check if course exists with this invite code
      const q = query(collection(db, 'courses'), where('inviteCode', '==', inviteCode.trim()));
      const snap = await getDocs(q);
      
      if (snap.empty) {
        setError('Código de invitación inválido. Por favor, verifica e intenta nuevamente.');
        setValidatingCode(false);
        return;
      }
      
      const course = snap.docs[0];
      const courseId = course.id;
      
      // 2. Add apoderado role to this user for this course
      const newRoles = { ...(userData.roles || {}) };
      newRoles[courseId] = 'apoderado';
      
      await setDoc(doc(db, 'users', user.uid), {
        roles: newRoles,
        role: 'apoderado', // keep for backwards compatibility if needed
        defaultCourseId: courseId
      }, { merge: true });
      
      window.location.reload();
      
    } catch (err) {
      console.error(err);
      setError('Hubo un error al validar el código.');
    } finally {
      setValidatingCode(false);
    }
  };

  if (hasNoRoles) {
    return (
      <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '1rem' }}>
        <div className="glass-panel animate-fade-in" style={{ padding: '3rem 2rem', textAlign: 'center', maxWidth: '400px', width: '100%' }}>
          
          <div style={{ marginBottom: '2rem' }}>
            <div style={{ backgroundColor: 'rgba(99, 102, 241, 0.1)', width: '80px', height: '80px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
              <Key size={40} style={{ color: 'var(--primary)' }} />
            </div>
            <h2 className="text-gradient" style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>Únete a tu Curso</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Ingresa el código de invitación proporcionado por la directiva de tu curso.</p>
          </div>

          {error && (
            <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.9rem' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleInviteCodeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem', textAlign: 'left' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Código de Invitación</label>
              <input 
                type="text" 
                required
                className="input-field" 
                placeholder="Ej: KINDER-B-CALDR-2026"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                style={{ textTransform: 'uppercase', letterSpacing: '1px', textAlign: 'center', fontWeight: 'bold' }}
              />
            </div>
            
            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ width: '100%', padding: '0.8rem', marginTop: '0.5rem', justifyContent: 'center' }}
              disabled={validatingCode || !inviteCode.trim()}
            >
              {validatingCode ? 'Validando...' : 'Unirse al Curso'}
            </button>
          </form>

          <button 
            onClick={logout}
            type="button"
            className="btn btn-outline" 
            style={{ width: '100%', padding: '0.8rem', justifyContent: 'center', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}
          >
            Volver / Cerrar Sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '1rem' }}>
      <div className="glass-panel animate-fade-in" style={{ padding: '3rem 2rem', textAlign: 'center', maxWidth: '400px', width: '100%' }}>
        
        <div style={{ marginBottom: '2rem' }}>
          <img 
            src="/LOGOAPPCURSO.jpg" 
            alt="Logo Curso" 
            style={{ width: '120px', height: '120px', borderRadius: '50%', marginBottom: '1.5rem', objectFit: 'cover', backgroundColor: 'white', padding: 0 }} 
            onError={(e) => e.target.style.display = 'none'}
          />
          <h1 className="text-gradient" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>AppCurso</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Portal de control de gastos y cobros</p>
        </div>

        <div style={{ 
          backgroundColor: 'rgba(59, 130, 246, 0.1)', 
          border: '1px solid rgba(59, 130, 246, 0.3)', 
          borderRadius: 'var(--radius-md)', 
          padding: '1rem', 
          marginBottom: '1.5rem', 
          textAlign: 'left',
          fontSize: '0.85rem',
          color: 'var(--text-main)'
        }}>
          <h4 style={{ color: 'var(--primary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <UserPlus size={18} /> ¿Eres un apoderado nuevo?
          </h4>
          <p style={{ marginBottom: '0.5rem', lineHeight: '1.4' }}>Sigue estos sencillos pasos para vincularte:</p>
          <ol style={{ margin: 0, paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <li>Crea una cuenta o ingresa más rápido usando Google.</li>
            <li>Ingresa el código de invitación entregado por la directiva.</li>
            <li>Dentro del portal, busca a tu hijo/a por su apellido y confírmalo con su RUT.</li>
          </ol>
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
          Ingreso rápido con Google
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

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
          <InstallAppGuide />
        </div>
      </div>
    </div>
  );
};

export default Login;
