import React, { useState } from 'react';
import { db } from '../firebase/config';
import { doc, updateDoc, collection, addDoc } from 'firebase/firestore';
import { X, MinusCircle, AlertCircle, Sparkles } from 'lucide-react';
import { formatStudentName } from '../utils/nameUtils';
import { useAuth } from '../context/AuthContext';
import { useModal } from '../context/ModalContext';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';

const formatMoney = (amount) => {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
};

const DiscountBalanceModal = ({ student, onClose, onSuccess }) => {
  const { user } = useAuth();
  const { showAlert } = useModal();
  const currentBalance = parseFloat(student?.balance) || 0;

  const [discountAmount, setDiscountAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useLockBodyScroll(true);

  if (!student) return null;

  const numericDiscount = parseFloat(discountAmount) || 0;
  const remainingBalance = Math.max(0, currentBalance - numericDiscount);
  const isInvalid = numericDiscount <= 0 || numericDiscount > currentBalance;

  const handleSetMax = () => {
    setDiscountAmount(currentBalance.toString());
    setError('');
  };

  const handleSetPercentage = (pct) => {
    const val = Math.round((currentBalance * pct) / 100);
    setDiscountAmount(val.toString());
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (numericDiscount <= 0) {
      setError('Por favor, ingresa un monto mayor a $0.');
      return;
    }

    if (numericDiscount > currentBalance) {
      setError(`El monto a descontar no puede superar el saldo actual (${formatMoney(currentBalance)}).`);
      return;
    }

    setSubmitting(true);
    try {
      const newBalance = currentBalance - numericDiscount;

      // 1. Actualizar el saldo del alumno en Firestore
      const studentRef = doc(db, 'students', student.id);
      await updateDoc(studentRef, {
        balance: newBalance
      });

      // 2. Registrar en colección de auditoría de ajustes de saldo
      try {
        await addDoc(collection(db, 'balance_adjustments'), {
          studentId: student.id,
          studentName: student.name || `${student.firstName || ''} ${student.lastNamePaternal || ''}`.trim(),
          courseId: student.courseId || '',
          amount: numericDiscount,
          previousBalance: currentBalance,
          newBalance: newBalance,
          reason: reason.trim() || 'Descuento manual de saldo a favor',
          performedBy: user?.email || user?.uid || 'admin',
          createdAt: new Date().toISOString()
        });
      } catch (histErr) {
        console.warn("No se pudo guardar registro en balance_adjustments:", histErr);
      }

      if (onSuccess) {
        await onSuccess(newBalance, numericDiscount);
      }

      await showAlert(`¡Descuento realizado con éxito! Se descontaron ${formatMoney(numericDiscount)} del saldo de ${formatStudentName(student)}. Nuevo saldo: ${formatMoney(newBalance)}.`);
      onClose();
    } catch (err) {
      console.error("Error al descontar saldo a favor:", err);
      setError("Ocurrió un error al procesar el descuento. Intenta nuevamente.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div 
      className="modal-overlay" 
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(6px)',
        zIndex: 10005,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }}
    >
      <div 
        className="modal-content animate-fade-in" 
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '460px',
          backgroundColor: 'var(--bg-main)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'rgba(255, 255, 255, 0.02)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{
              width: '36px', height: '36px',
              borderRadius: '50%',
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              color: '#f59e0b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <MinusCircle size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-main)' }}>Descontar Saldo a Favor</h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {formatStudentName(student)}
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="btn btn-outline" 
            style={{ padding: '0.4rem', border: 'none', borderRadius: '50%' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
          {error && (
            <div style={{
              marginBottom: '1rem',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: 'var(--danger)',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <AlertCircle size={16} /> {error}
            </div>
          )}

          {/* Tarjeta de Resumen Visual */}
          <div style={{
            padding: '1rem',
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            marginBottom: '1.25rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Saldo actual disponible:</span>
              <strong style={{ color: 'var(--success)', fontSize: '0.95rem' }}>{formatMoney(currentBalance)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Monto a descontar:</span>
              <strong style={{ color: '#f59e0b', fontSize: '0.95rem' }}>
                {numericDiscount > 0 ? `-${formatMoney(numericDiscount)}` : '$0'}
              </strong>
            </div>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              paddingTop: '0.5rem', 
              borderTop: '1px dashed var(--border-color)',
              fontWeight: '600'
            }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>Saldo restante:</span>
              <span style={{ color: remainingBalance > 0 ? 'var(--success)' : 'var(--text-muted)', fontSize: '1rem' }}>
                {formatMoney(remainingBalance)}
              </span>
            </div>
          </div>

          {/* Campo Monto a Descontar */}
          <div className="input-group" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <label className="input-label" style={{ margin: 0 }}>Monto a Descontar ($) *</label>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button
                  type="button"
                  onClick={() => handleSetPercentage(50)}
                  className="btn btn-outline"
                  style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem' }}
                >
                  50%
                </button>
                <button
                  type="button"
                  onClick={handleSetMax}
                  className="btn btn-outline"
                  style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem', color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.4)' }}
                >
                  Todo
                </button>
              </div>
            </div>
            <input 
              type="number"
              min="1"
              max={currentBalance}
              autoFocus
              required
              placeholder="Ej: 5000"
              className="input-field"
              value={discountAmount}
              onChange={(e) => {
                setDiscountAmount(e.target.value);
                setError('');
              }}
              style={{ fontSize: '1.1rem', fontWeight: '600' }}
            />
          </div>

          {/* Campo Motivo / Detalle */}
          <div className="input-group" style={{ marginBottom: '1.5rem' }}>
            <label className="input-label">Motivo o Justificación (Opcional)</label>
            <input 
              type="text"
              placeholder="Ej: Devolución en efectivo a apoderado, fotocopias, etc."
              className="input-field"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {/* Botones de Acción */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="btn btn-outline"
              style={{ padding: '0.6rem 1.25rem' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || isInvalid}
              className="btn btn-primary"
              style={{
                padding: '0.6rem 1.5rem',
                backgroundColor: isInvalid ? 'var(--border-color)' : '#d97706',
                border: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontWeight: '600'
              }}
            >
              <MinusCircle size={16} />
              {submitting ? 'Procesando...' : `Descontar ${numericDiscount > 0 ? formatMoney(numericDiscount) : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DiscountBalanceModal;
