import React, { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { X, User, AlertCircle, CheckCircle, Clock } from 'lucide-react';

const StudentDetailModal = ({ student, usersMap, onClose }) => {
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDebts();
  }, [student.id]);

  const fetchDebts = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'debts'), where('studentId', '==', student.id));
      const snap = await getDocs(q);
      const fetchedDebts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setDebts(fetchedDebts);
    } catch (error) {
      console.error("Error fetching debts:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const pendingDebts = debts.filter(d => d.status === 'pending' || d.status === 'review');
  const paidDebts = debts.filter(d => d.status === 'paid');

  const emails = student.apoderadoEmails || (student.apoderadoEmail ? [student.apoderadoEmail] : []);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '700px', padding: '2rem', backgroundColor: 'var(--bg-main)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: '0 0 0.5rem 0', color: 'var(--primary)' }}>{student.name}</h2>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Número de Lista: {student.listNumber || '-'}</p>
          </div>
          <button onClick={onClose} className="btn btn-outline" style={{ padding: '0.5rem' }}>
            <X size={20} />
          </button>
        </div>

        {/* Sección Apoderados */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <User size={20} /> Apoderados Vinculados
          </h3>
          {emails.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No hay apoderados vinculados a este alumno.</p>
          ) : (
            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
              {emails.map((email, idx) => (
                <div key={idx} style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                  <p style={{ fontWeight: '500', margin: '0 0 0.25rem 0', fontSize: '1.1rem' }}>
                    {usersMap[email] || 'Nombre no registrado'}
                  </p>
                  <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>{email}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '1fr 1fr' }}>
          {/* Deudas Pendientes */}
          <div>
            <h4 style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <AlertCircle size={18} /> Por Pagar / En Revisión
            </h4>
            {loading ? (
              <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>
            ) : pendingDebts.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No tiene deudas pendientes.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
                {pendingDebts.map(d => (
                  <li key={d.id} style={{ padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)', borderLeft: `3px solid ${d.status === 'review' ? 'var(--warning)' : 'var(--danger)'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: '500' }}>{d.title}</span>
                      <span style={{ fontWeight: 'bold' }}>{formatMoney(d.amount)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {d.status === 'review' ? (
                         <span style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Clock size={12} /> Comprobante enviado</span>
                      ) : (
                         <span>Emitido: {d.date}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Historial Pagado */}
          <div>
            <h4 style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <CheckCircle size={18} /> Pagos Realizados
            </h4>
            {loading ? (
              <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>
            ) : paidDebts.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No tiene historial de pagos.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
                {paidDebts.map(d => (
                  <li key={d.id} style={{ padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--success)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: '500' }}>{d.title}</span>
                      <span style={{ fontWeight: 'bold' }}>{formatMoney(d.amount)}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Pagado: {d.paidAt ? new Date(d.paidAt).toLocaleDateString() : d.date}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default StudentDetailModal;
