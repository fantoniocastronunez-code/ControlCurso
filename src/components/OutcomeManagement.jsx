import React, { useEffect, useState } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { ArrowLeft, CheckCircle, Trash2, TrendingDown } from 'lucide-react';

const OutcomeManagement = ({ onBack }) => {
  const [outcomes, setOutcomes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  
  const [newTitle, setNewTitle] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newMethod, setNewMethod] = useState('cash');
  const [selectedFundId, setSelectedFundId] = useState('');
  
  const [funds, setFunds] = useState([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // 1. Obtener Gastos
      const outcomesCollection = collection(db, 'outcomes');
      const snapshot = await getDocs(outcomesCollection);
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      // Ordenar por fecha, más reciente primero
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      setOutcomes(list);

      // 2. Obtener Fondos
      const fundsCollection = collection(db, 'funds');
      const fundsSnapshot = await getDocs(fundsCollection);
      const fundsList = fundsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setFunds(fundsList);
      if (fundsList.length > 0) {
        setSelectedFundId(fundsList[0].id);
      }
    } catch (error) {
      console.error("Error al obtener datos:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddOutcome = async (e) => {
    e.preventDefault();
    if (!newTitle || !newAmount || !selectedFundId) {
       alert("Faltan datos. Asegúrate de tener al menos un fondo creado.");
       return;
    }

    try {
      const outcomeId = 'out_' + Date.now().toString();
      const outcomeRef = doc(db, 'outcomes', outcomeId);
      
      const newOutcome = {
        title: newTitle,
        amount: parseFloat(newAmount),
        paymentMethod: newMethod,
        fundId: selectedFundId,
        date: new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString()
      };
      
      await setDoc(outcomeRef, newOutcome);
      
      setOutcomes([{ id: outcomeId, ...newOutcome }, ...outcomes]);
      setNewTitle('');
      setNewAmount('');
      setNewMethod('cash');
      
      setMessage('Gasto registrado correctamente');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error registrando gasto:", error);
      setMessage('Error al registrar el gasto');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Seguro que deseas eliminar este gasto? El dinero volverá a los fondos.')) return;
    try {
      await deleteDoc(doc(db, 'outcomes', id));
      setOutcomes(outcomes.filter(o => o.id !== id));
      setMessage('Gasto eliminado');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error eliminando:", error);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando gastos...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
          <ArrowLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>Registro de Gastos (Egresos)</h3>
      </div>

      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
        Registra aquí las compras o pagos que realiza la directiva usando los fondos del curso. Esto restará del saldo disponible en caja.
      </p>

      {message && (
        <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', color: 'var(--success)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={18} /> {message}
        </div>
      )}

      {/* Formulario para agregar egreso */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)' }}>
          <TrendingDown size={18} /> Registrar Nuevo Gasto
        </h4>
        <form onSubmit={handleAddOutcome} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: '2', minWidth: '200px', marginBottom: 0 }}>
            <label className="input-label">Motivo / Descripción</label>
            <input 
              type="text" 
              required
              className="input-field" 
              placeholder="Ej. Compra de cartulinas"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '150px', marginBottom: 0 }}>
            <label className="input-label">Monto ($)</label>
            <input 
              type="number" 
              required
              min="1"
              className="input-field" 
              placeholder="Ej. 15000"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '150px', marginBottom: 0 }}>
            <label className="input-label">Medio de Pago</label>
            <select 
              className="input-field" 
              value={newMethod}
              onChange={(e) => setNewMethod(e.target.value)}
            >
              <option value="cash">Efectivo (Caja Chica)</option>
              <option value="transfer">Transferencia (Cuenta)</option>
            </select>
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '150px', marginBottom: 0 }}>
            <label className="input-label">Fondo de Origen</label>
            <select 
              className="input-field" 
              value={selectedFundId}
              onChange={(e) => setSelectedFundId(e.target.value)}
              required
            >
              <option value="" disabled>Selecciona un fondo...</option>
              {funds.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-outline" style={{ height: '42px', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
            Registrar Gasto
          </button>
        </form>
      </div>

      <div className="glass-panel" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <th style={{ padding: '1rem' }}>Fecha</th>
              <th style={{ padding: '1rem' }}>Motivo</th>
              <th style={{ padding: '1rem' }}>Monto</th>
              <th style={{ padding: '1rem' }}>Medio/Fondo</th>
              <th style={{ padding: '1rem' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map(o => {
              const f = funds.find(fund => fund.id === o.fundId);
              return (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{o.date}</td>
                  <td style={{ padding: '1rem', fontWeight: '500' }}>{o.title}</td>
                  <td style={{ padding: '1rem', color: 'var(--danger)', fontWeight: 'bold' }}>- {formatMoney(o.amount)}</td>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ fontSize: '0.9rem' }}>{o.paymentMethod === 'cash' ? '💵 Efectivo' : '🏦 Transferencia'}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{f ? f.name : 'Fondo General'}</div>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <button onClick={() => handleDelete(o.id)} className="btn btn-outline" style={{ padding: '0.4rem 0.75rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)', gap: '0.5rem', display: 'flex', alignItems: 'center' }}>
                      <Trash2 size={16} /> Eliminar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {outcomes.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No se han registrado gastos aún.
          </div>
        )}
      </div>
    </div>
  );
};

export default OutcomeManagement;
