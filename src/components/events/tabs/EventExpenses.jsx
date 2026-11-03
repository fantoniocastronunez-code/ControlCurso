import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../../../firebase/config';
import { collection, getDocs, doc, setDoc, query, where, deleteDoc, updateDoc, getDoc } from 'firebase/firestore';
import { Plus, DollarSign, Trash2, Tag, Sparkles } from 'lucide-react';
import { useModal } from '../../../context/ModalContext';
import { useAuth } from '../../../context/AuthContext';
import { useCourse } from '../../../context/CourseContext';
import { formatEventDate } from '../../../utils/eventPdfService';

const EventExpenses = ({ event }) => {
  const { user } = useAuth();
  const { selectedCourse } = useCourse();
  const { showAlert, showConfirm } = useModal();
  const [outcomes, setOutcomes] = useState([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState('cash'); // cash, transfer
  const [responsable, setResponsable] = useState('');

  const effectiveCourseId = event?.courseId || selectedCourse?.id || '';

  const fetchOutcomes = useCallback(async () => {
    setLoading(true);
    try {
      const outcomesMap = new Map();
      if (event?.id) {
        try {
          const qByEvent = query(collection(db, 'outcomes'), where('eventId', '==', event.id));
          const snapEvent = await getDocs(qByEvent);
          snapEvent.docs.forEach(d => {
            const data = d.data();
            // Auto-reparar si le faltaba courseId o eventName para asegurar visibilidad en "Historial y Registro de Gastos"
            if (effectiveCourseId && (!data.courseId || data.courseId !== effectiveCourseId || !data.eventName)) {
              updateDoc(d.ref, {
                courseId: effectiveCourseId,
                eventName: event.name || data.eventName || 'Evento',
                isEventExpense: true
              }).catch(console.error);
            }
            outcomesMap.set(d.id, { 
              id: d.id, 
              ...data, 
              courseId: effectiveCourseId, 
              eventName: event.name || data.eventName || 'Evento' 
            });
          });
        } catch (e) {
          console.warn("Error buscando gastos por eventId:", e);
        }
      }
      if (event?.fundId) {
        try {
          const qByFund = query(collection(db, 'outcomes'), where('fundId', '==', event.fundId));
          const snapFund = await getDocs(qByFund);
          snapFund.docs.forEach(d => {
            const data = d.data();
            if (effectiveCourseId && (!data.courseId || data.courseId !== effectiveCourseId)) {
              updateDoc(d.ref, {
                courseId: effectiveCourseId,
                eventId: event.id,
                eventName: event.name || 'Evento',
                isEventExpense: true
              }).catch(console.error);
            }
            if (!outcomesMap.has(d.id)) {
              outcomesMap.set(d.id, { 
                id: d.id, 
                ...data, 
                courseId: effectiveCourseId, 
                eventName: event.name || 'Evento' 
              });
            }
          });
        } catch (e) {
          console.warn("Error buscando gastos por fundId:", e);
        }
      }
      const list = Array.from(outcomesMap.values());
      list.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
      setOutcomes(list);
    } catch (error) {
      console.error("Error fetching event outcomes:", error);
    } finally {
      setLoading(false);
    }
  }, [event?.id, event?.fundId, event?.name, effectiveCourseId]);

  useEffect(() => {
    fetchOutcomes();
  }, [fetchOutcomes]);

  const handleAddOutcome = async (e) => {
    e.preventDefault();
    if (!title || !amount || !responsable) {
      showAlert("Por favor, completa todos los campos requeridos.");
      return;
    }

    try {
      const id = 'out_' + Date.now();
      const effectiveFundId = event.fundId || ('fund_' + event.id);

      // Si el evento no tenía courseId en su doc, actualizarlo
      if (event.id && effectiveCourseId && (!event.courseId || event.courseId !== effectiveCourseId)) {
        try {
          await updateDoc(doc(db, 'events', event.id), { courseId: effectiveCourseId });
        } catch (evErr) {
          console.warn("Error actualizando courseId en evento:", evErr);
        }
      }

      // Asegurar que el fondo del evento existe en la colección 'funds' para contabilidad central
      try {
        const fundRef = doc(db, 'funds', effectiveFundId);
        const fundSnap = await getDoc(fundRef);
        if (!fundSnap.exists()) {
          await setDoc(fundRef, {
            name: `Evento: ${event.name || 'Evento'}`,
            description: `Fondo automático para el evento ${event.name || ''}`,
            courseId: effectiveCourseId,
            createdAt: new Date().toISOString()
          });
        }
      } catch (fErr) {
        console.warn("Error verificando fondo de evento:", fErr);
      }

      const newOutcome = {
        title: title.trim(),
        amount: parseFloat(amount),
        date,
        paymentMethod,
        responsable: responsable.trim(),
        fundId: effectiveFundId,
        eventId: event.id,
        eventName: event.name || 'Evento',
        courseId: effectiveCourseId,
        isEventExpense: true,
        visibleInPortal: true,
        createdAt: new Date().toISOString(),
        createdBy: user?.email || user?.displayName || 'Unknown User'
      };

      await setDoc(doc(db, 'outcomes', id), newOutcome);
      setOutcomes([{ id, ...newOutcome }, ...outcomes]);

      setTitle('');
      setAmount('');
      setResponsable('');
      showAlert("Gasto registrado con éxito y sincronizado con el Historial y Registro de Gastos general.");
    } catch (error) {
      console.error("Error adding outcome:", error);
      showAlert("Hubo un error al registrar el gasto.");
    }
  };

  const handleDeleteOutcome = async (outcomeId) => {
    if (!(await showConfirm("¿Estás seguro de eliminar este gasto? Se eliminará tanto del evento como del Historial y Registro de Gastos general."))) return;
    try {
      await deleteDoc(doc(db, 'outcomes', outcomeId));
      setOutcomes(prev => prev.filter(o => o.id !== outcomeId));
      showAlert("Gasto eliminado correctamente.");
    } catch (err) {
      console.error("Error eliminando gasto:", err);
      showAlert("Hubo un error al eliminar el gasto.");
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const totalEventExpenses = outcomes.reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);

  if (loading) return <div>Cargando gastos...</div>;

  return (
    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
      {/* Formulario de Nuevo Gasto */}
      <div className="glass-panel" style={{ flex: '1 1 300px', padding: '1.5rem', alignSelf: 'flex-start' }}>
        <h3 style={{ marginBottom: '0.75rem', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <DollarSign size={20} /> Registrar Gasto del Evento
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
          Todo gasto registrado aquí queda automáticamente incorporado en el <strong>Historial y Registro de Gastos</strong> del curso.
        </p>

        <form onSubmit={handleAddOutcome}>
          <div className="input-group">
            <label className="input-label">Descripción del Gasto</label>
            <input
              type="text"
              required
              className="input-field"
              placeholder="Ej. Compra de salchichas, pan..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Monto ($)</label>
            <input
              type="number"
              min="1"
              required
              className="input-field"
              placeholder="Ej. 15000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Responsable (Quién compró)</label>
            <input
              type="text"
              required
              className="input-field"
              placeholder="Ej. Tesorera, Delegado..."
              value={responsable}
              onChange={(e) => setResponsable(e.target.value)}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Fecha del Gasto</label>
            <input
              type="date"
              required
              className="input-field"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Medio de Pago</label>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="payMethodOut"
                  value="cash"
                  checked={paymentMethod === 'cash'}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  style={{ accentColor: 'var(--primary)' }}
                /> Efectivo (Caja Chica)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="payMethodOut"
                  value="transfer"
                  checked={paymentMethod === 'transfer'}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  style={{ accentColor: 'var(--primary)' }}
                /> Transferencia (Banco)
              </label>
            </div>
          </div>

          <button type="submit" className="btn btn-outline" style={{ width: '100%', borderColor: 'var(--danger)', color: 'var(--danger)', marginTop: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={18} /> Registrar Gasto
          </button>
        </form>
      </div>

      {/* Lista de Gastos */}
      <div className="glass-panel" style={{ flex: '2 1 400px', padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0 }}>Historial de Gastos del Evento</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{outcomes.length} registro(s) sincronizado(s) con la contabilidad general</span>
          </div>
          <div style={{ 
            backgroundColor: 'rgba(239, 68, 68, 0.1)', 
            border: '1px solid rgba(239, 68, 68, 0.3)', 
            padding: '0.45rem 0.85rem', 
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Gastado:</span>
            <strong style={{ color: 'var(--danger)', fontSize: '1.05rem' }}>-{formatMoney(totalEventExpenses)}</strong>
          </div>
        </div>

        {outcomes.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No hay gastos registrados para este evento.</p>
        ) : (
          <div className="table-responsive" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Fecha</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Descripción</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Responsable</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Método</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Monto</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map(out => (
                  <tr key={out.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>{formatEventDate(out.date)}</td>
                    <td style={{ padding: '0.75rem 0.5rem', fontWeight: '500' }}>{out.title}</td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>{out.responsable}</td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '10px', backgroundColor: out.paymentMethod === 'cash' ? 'rgba(16,185,129,0.2)' : 'rgba(59,130,246,0.2)', color: out.paymentMethod === 'cash' ? 'var(--success)' : '#3b82f6' }}>
                        {out.paymentMethod === 'cash' ? 'Efectivo' : 'Transf.'}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 'bold', color: 'var(--danger)' }}>
                      -{formatMoney(out.amount)}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleDeleteOutcome(out.id)}
                        className="btn btn-outline"
                        style={{ padding: '0.3rem 0.5rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                        title="Eliminar este gasto"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default EventExpenses;
