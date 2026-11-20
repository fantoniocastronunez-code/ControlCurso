import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { auth, db, googleProvider } from '../firebase/config';
import { signInAnonymously, signInWithPopup, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, addDoc } from 'firebase/firestore';
import SignaturePad from '../components/SignaturePad';
import {
  CheckCircle2, FileText, ShieldCheck, Calendar, DollarSign,
  Send, RefreshCw, AlertCircle, UserCheck, Smartphone
} from 'lucide-react';

const ROLE_CONFIG = {
  presidente: {
    label: 'Presidenta / Presidente de Curso',
    shortLabel: 'Presidente(a)',
    color: '#6366f1',
    bgLight: 'rgba(99, 102, 241, 0.12)',
    borderLight: 'rgba(99, 102, 241, 0.35)'
  },
  tesorero: {
    label: 'Tesorera / Tesorero de Curso',
    shortLabel: 'Tesorero(a)',
    color: '#10b981',
    bgLight: 'rgba(16, 185, 129, 0.12)',
    borderLight: 'rgba(16, 185, 129, 0.35)'
  },
  secretario: {
    label: 'Secretaria / Secretario de Curso',
    shortLabel: 'Secretario(a)',
    color: '#f59e0b',
    bgLight: 'rgba(245, 158, 11, 0.12)',
    borderLight: 'rgba(245, 158, 11, 0.35)'
  }
};

const formatMoney = (amount) => {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0
  }).format(amount || 0);
};

export default function MeetingSignPage() {
  const { sessionId, roleKey } = useParams();
  const normalizedInitialRole =
    roleKey === 'tesorero'
      ? 'tesorero'
      : roleKey === 'secretario'
        ? 'secretario'
        : 'presidente';

  const [activeRole, setActiveRole] = useState(normalizedInitialRole);
  const [authReady, setAuthReady] = useState(false);
  const [needsManualAuth, setNeedsManualAuth] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionData, setSessionData] = useState(null);

  const [signerName, setSignerName] = useState('');
  const [signatureData, setSignatureData] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 1. Autenticación silenciosa anónima (o sesión activa si ya inició sesión en su teléfono)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        if (currentUser.displayName) {
          setSignerName((prev) => prev || currentUser.displayName);
        }
        setNeedsManualAuth(false);
        setAuthReady(true);
      } else {
        try {
          await signInAnonymously(auth);
        } catch (err) {
          console.warn('Silent anonymous auth not available, falling back to Google login:', err);
          setNeedsManualAuth(true);
          setAuthReady(true);
          setLoadingSession(false);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Cargar resumen del informe de reunión
  useEffect(() => {
    if (!authReady || needsManualAuth || !sessionId) return;

    const fetchSessionInfo = async () => {
      setLoadingSession(true);
      try {
        const snap = await getDoc(doc(db, 'approvals', sessionId));
        if (snap.exists()) {
          setSessionData(snap.data());
        }
      } catch (err) {
        console.warn('No se pudo cargar el resumen previo de la sesión:', err);
      } finally {
        setLoadingSession(false);
      }
    };

    fetchSessionInfo();
  }, [authReady, needsManualAuth, sessionId]);

  const handleGoogleLogin = async () => {
    setErrorMsg('');
    try {
      const res = await signInWithPopup(auth, googleProvider);
      if (res.user?.displayName && !signerName) {
        setSignerName(res.user.displayName);
      }
      setNeedsManualAuth(false);
    } catch (err) {
      console.error('Error al iniciar sesión con Google:', err);
      setErrorMsg('No se pudo iniciar sesión con Google. Intenta nuevamente.');
    }
  };

  const handleSubmitSignature = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!signatureData) {
      setErrorMsg('Por favor dibuja tu firma en el recuadro blanco antes de enviar.');
      return;
    }

    setSubmitting(true);
    try {
      const roleInfo = ROLE_CONFIG[activeRole] || ROLE_CONFIG.presidente;
      await addDoc(collection(db, 'approvals'), {
        type: 'MEETING_SIGNATURE_SUBMISSION',
        sessionId,
        courseId: sessionData?.courseId || 'general',
        courseName: sessionData?.courseName || '',
        meetingDate: sessionData?.meetingDate || new Date().toISOString().split('T')[0],
        signerRole: activeRole,
        signerName: signerName.trim() || roleInfo.shortLabel,
        signatureDataUrl: signatureData,
        createdAt: new Date().toISOString()
      });
      setSubmittedSuccess(true);
    } catch (err) {
      console.error('Error al enviar la firma:', err);
      if (!auth.currentUser) {
        setNeedsManualAuth(true);
      }
      setErrorMsg('No se pudo enviar la firma. Verifica tu conexión o inicia sesión con Google.');
    } finally {
      setSubmitting(false);
    }
  };

  const roleInfo = ROLE_CONFIG[activeRole] || ROLE_CONFIG.presidente;

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0f172a',
      color: '#f8fafc',
      padding: '1.25rem 1rem 3rem 1rem',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ width: '100%', maxWidth: '520px' }}>
        {/* Header Card */}
        <div style={{
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '1.25rem',
          padding: '1.25rem',
          marginBottom: '1rem',
          boxShadow: '0 10px 25px rgba(0,0,0,0.35)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '0.75rem' }}>
            <img
              src="/LOGOAPPCURSO.jpg"
              alt="Logo"
              style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #6366f1' }}
            />
            <div>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.72rem',
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: '#818cf8',
                background: 'rgba(99, 102, 241, 0.15)',
                padding: '0.2rem 0.6rem',
                borderRadius: '999px'
              }}>
                <Smartphone size={12} /> Firma Digital Remota
              </span>
              <h1 style={{ margin: '0.25rem 0 0 0', fontSize: '1.2rem', fontWeight: '800', color: '#ffffff' }}>
                {sessionData?.meetingTitle || 'Informe Financiero - Reunión de Apoderados'}
              </h1>
            </div>
          </div>

          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            fontSize: '0.82rem',
            color: '#94a3b8',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            paddingTop: '0.75rem'
          }}>
            {sessionData?.courseName && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#e2e8f0', fontWeight: '600' }}>
                <FileText size={14} color="#818cf8" /> {sessionData.courseName}
              </span>
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <Calendar size={14} color="#94a3b8" /> Fecha: {sessionData?.meetingDate || new Date().toISOString().split('T')[0]}
            </span>
          </div>
        </div>

        {/* Resumen Financiero del Informe (si está disponible) */}
        {!loadingSession && sessionData?.summary && (
          <div style={{
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '1.1rem',
            padding: '1rem',
            marginBottom: '1rem'
          }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <DollarSign size={14} color="#10b981" /> Resumen del Informe a Firmar
            </div>

            <div style={{
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: '0.85rem',
              padding: '0.75rem 1rem',
              marginBottom: '0.65rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ fontSize: '0.85rem', color: '#cbd5e1', fontWeight: '600' }}>Fondo Total Disponible</span>
              <span style={{ fontSize: '1.15rem', fontWeight: '800', color: '#34d399' }}>
                {formatMoney(sessionData.summary.totalAvailable)}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8rem' }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.55rem 0.75rem', borderRadius: '0.65rem' }}>
                <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Efectivo en Caja</div>
                <div style={{ fontWeight: '700', color: '#f8fafc' }}>{formatMoney(sessionData.summary.cashBalance)}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.55rem 0.75rem', borderRadius: '0.65rem' }}>
                <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Cuenta Bancaria</div>
                <div style={{ fontWeight: '700', color: '#f8fafc' }}>{formatMoney(sessionData.summary.transferBalance)}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.55rem 0.75rem', borderRadius: '0.65rem' }}>
                <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Total Ingresos</div>
                <div style={{ fontWeight: '700', color: '#34d399' }}>{formatMoney(sessionData.summary.totalIncome)}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.55rem 0.75rem', borderRadius: '0.65rem' }}>
                <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Total Gastos</div>
                <div style={{ fontWeight: '700', color: '#f87171' }}>{formatMoney(sessionData.summary.totalOutcomes)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Fallback si requiere autenticación con Google */}
        {needsManualAuth ? (
          <div style={{
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '1.25rem',
            padding: '1.75rem 1.25rem',
            textAlign: 'center'
          }}>
            <ShieldCheck size={42} color="#6366f1" style={{ marginBottom: '0.75rem' }} />
            <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem' }}>Verificación de Directiva</h2>
            <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.88rem', color: '#94a3b8', lineHeight: 1.5 }}>
              Para registrar tu firma de manera segura en el informe de reunión, continúa con tu cuenta de Google.
            </p>
            <button
              type="button"
              onClick={handleGoogleLogin}
              style={{
                width: '100%',
                padding: '0.85rem 1rem',
                borderRadius: '0.85rem',
                border: 'none',
                background: '#6366f1',
                color: '#ffffff',
                fontWeight: '700',
                fontSize: '0.95rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem'
              }}
            >
              <UserCheck size={18} /> Continuar con Google para Firmar
            </button>
          </div>
        ) : submittedSuccess ? (
          /* Pantalla de Éxito */
          <div style={{
            background: '#1e293b',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            borderRadius: '1.25rem',
            padding: '2rem 1.5rem',
            textAlign: 'center',
            boxShadow: '0 15px 35px rgba(0,0,0,0.35)'
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'rgba(16, 185, 129, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem auto'
            }}>
              <CheckCircle2 size={38} color="#10b981" />
            </div>

            <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.3rem', color: '#ffffff' }}>
              ¡Firma Enviada con Éxito!
            </h2>
            <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.9rem', color: '#94a3b8', lineHeight: 1.5 }}>
              Tu firma como <strong style={{ color: '#e2e8f0' }}>{roleInfo.label}</strong> ya se actualizó automáticamente en el computador donde está abierto el Modo Reunión.
            </p>

            {signatureData && (
              <div style={{
                background: '#ffffff',
                borderRadius: '0.85rem',
                padding: '0.75rem',
                marginBottom: '1.25rem',
                border: '1px solid #cbd5e1'
              }}>
                <img
                  src={signatureData}
                  alt="Firma registrada"
                  style={{ maxHeight: '90px', maxWidth: '100%', objectFit: 'contain', display: 'block', margin: '0 auto' }}
                />
                <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '0.35rem', fontWeight: '600' }}>
                  {signerName.trim() || roleInfo.shortLabel}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSubmittedSuccess(false)}
              style={{
                padding: '0.7rem 1.25rem',
                borderRadius: '0.75rem',
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.05)',
                color: '#cbd5e1',
                fontSize: '0.85rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              <RefreshCw size={15} /> Volver a firmar / Corregir firma
            </button>
          </div>
        ) : (
          /* Formulario de Firma */
          <form
            onSubmit={handleSubmitSignature}
            style={{
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '1.25rem',
              padding: '1.25rem',
              boxShadow: '0 10px 25px rgba(0,0,0,0.3)'
            }}
          >
            {/* Selector de Cargo */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                Cargo que firma
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setActiveRole('presidente')}
                  style={{
                    padding: '0.7rem 0.35rem',
                    borderRadius: '0.75rem',
                    border: activeRole === 'presidente' ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.1)',
                    background: activeRole === 'presidente' ? 'rgba(99, 102, 241, 0.18)' : 'rgba(255,255,255,0.03)',
                    color: activeRole === 'presidente' ? '#ffffff' : '#94a3b8',
                    fontWeight: '700',
                    fontSize: '0.82rem',
                    cursor: 'pointer'
                  }}
                >
                  Presidente(a)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveRole('tesorero')}
                  style={{
                    padding: '0.7rem 0.35rem',
                    borderRadius: '0.75rem',
                    border: activeRole === 'tesorero' ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                    background: activeRole === 'tesorero' ? 'rgba(16, 185, 129, 0.18)' : 'rgba(255,255,255,0.03)',
                    color: activeRole === 'tesorero' ? '#ffffff' : '#94a3b8',
                    fontWeight: '700',
                    fontSize: '0.82rem',
                    cursor: 'pointer'
                  }}
                >
                  Tesorero(a)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveRole('secretario')}
                  style={{
                    padding: '0.7rem 0.35rem',
                    borderRadius: '0.75rem',
                    border: activeRole === 'secretario' ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)',
                    background: activeRole === 'secretario' ? 'rgba(245, 158, 11, 0.18)' : 'rgba(255,255,255,0.03)',
                    color: activeRole === 'secretario' ? '#ffffff' : '#94a3b8',
                    fontWeight: '700',
                    fontSize: '0.82rem',
                    cursor: 'pointer'
                  }}
                >
                  Secretario(a)
                </button>
              </div>
            </div>

            {/* Nombre de quien firma */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#cbd5e1', marginBottom: '0.35rem' }}>
                Tu Nombre (opcional, aparecerá bajo tu firma)
              </label>
              <input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder={`Ej. Nombre de ${roleInfo.shortLabel}`}
                style={{
                  width: '100%',
                  padding: '0.75rem 0.9rem',
                  borderRadius: '0.75rem',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: '#0f172a',
                  color: '#ffffff',
                  fontSize: '0.92rem',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Lienzo de Firma */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: '700', color: '#f8fafc' }}>
                  Dibuja tu firma aquí ({roleInfo.shortLabel})
                </label>
                <span style={{ fontSize: '0.73rem', color: '#94a3b8' }}>
                  Usa tu dedo o lápiz táctil
                </span>
              </div>

              <SignaturePad
                initialData={signatureData}
                onChange={(b64) => {
                  setSignatureData(b64);
                  setErrorMsg('');
                }}
                onSave={(b64) => {
                  setSignatureData(b64);
                  setErrorMsg('');
                }}
                onClear={() => setSignatureData(null)}
              />
            </div>

            {errorMsg && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#fca5a5',
                padding: '0.75rem',
                borderRadius: '0.75rem',
                fontSize: '0.83rem',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                padding: '0.95rem 1rem',
                borderRadius: '0.85rem',
                border: 'none',
                background: roleInfo.color,
                color: '#ffffff',
                fontWeight: '800',
                fontSize: '0.98rem',
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: '0 8px 20px rgba(0,0,0,0.25)'
              }}
            >
              <Send size={18} />
              {submitting ? 'Enviando Firma...' : `Confirmar y Enviar Firma de ${roleInfo.shortLabel}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
