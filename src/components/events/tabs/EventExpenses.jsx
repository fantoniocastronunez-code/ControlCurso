import React, { useState, useEffect } from 'react';
import { db } from '../../../firebase/config';
import { collection, getDocs, doc, setDoc, query, where, orderBy } from 'firebase/firestore';
import { Plus, Trash2, DollarSign } from 'lucide-react';
import { useModal } from '../../../context/ModalContext';

const EventExpenses = ({ event }) => {
  const { showAlert, showConfirm } = useModal();
  const [outcomes, setOutcomes] = useState([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState('cash'); // cash, transfer
  const [responsable, setResponsable] = useState('');

  useEffect(() => {
    fetchOutcomes();
  }, [event.id]);

  const fetchOutcomes = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'outcomes'), where('fundId', '==', event.fundId));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      setOutcomes(list);
    } catch (error) {
      console.error("Error fetching event outcomes:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddOutcome = async (e) => {
    e.preventDefault();
    if (!title || !amount || !responsable) {
      showAlert("Por favor, completa todos los campos requeridos.");
      return;
    }

    try {
      const id = 'out_' + Date.now();
      const newOutcome = {
        title: title.trim(),
        amount: parseFloat(amount),
        date,
        paymentMethod,
        responsable: responsable.trim(),
        fundId: event.fundId,
        eventId: event.id,
        createdAt: new Date().toISOString()
      };
      
      await setDoc(doc(db, 'outcomes', id), newOutcome);
      setOutcomes([ { id, ...newOutcome }, ...outcomes ]);
      
      setTitle('');
      setAmount('');
      setResponsable('');
      showAlert("Gasto registrado con éxito.");
    } catch (error) {
      console.error("Error adding outcome:", error);
      showAlert("Hubo un error al registrar el gasto.");
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  if (loading) return <div>Cargando gastos...</div>;

  return (
    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
      {/* Formulario de Nuevo Gasto */}
      <div className="glass-panel" style={{ flex: '1 1 300px', padding: '1.5rem', alignSelf: 'flex-start' }}>
        <h3 style={{ marginBottom: '1.5rem', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <DollarSign size={20} /> Registrar Gasto
        </h3>
        
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
              placeholder="Ej. Tesorera"
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
        <h3 style={{ marginBottom: '1.5rem' }}>Historial de Gastos del Evento</h3>
        
        {outcomes.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No hay gastos registrados para este evento.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Fecha</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Descripción</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Responsable</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Método</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map(out => (
                  <tr key={out.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>{new Date(out.date).toLocaleDateString('es-CL')}</td>
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
