import React, { useEffect, useState } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, doc, setDoc, deleteDoc, addDoc } from 'firebase/firestore';
import { ArrowLeft, CheckCircle, Trash2, Wallet, Plus, ArrowRightLeft, DollarSign } from 'lucide-react';

const FundManagement = ({ onBack }) => {
  const [funds, setFunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');

  // Ingreso Extra State
  const [incomeTitle, setIncomeTitle] = useState('');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeMethod, setIncomeMethod] = useState('cash');
  const [incomeFund, setIncomeFund] = useState('');

  // Transferencia de Fondos State
  const [transferFrom, setTransferFrom] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');

  useEffect(() => {
    fetchFunds();
  }, []);

  const fetchFunds = async () => {
    try {
      const fundsCollection = collection(db, 'funds');
      const snapshot = await getDocs(fundsCollection);
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      // Ordenar por nombre
      list.sort((a, b) => a.name.localeCompare(b.name));
      setFunds(list);
    } catch (error) {
      console.error("Error al obtener fondos:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddFund = async (e) => {
    e.preventDefault();
    if (!newTitle) return;

    try {
      const fundId = 'fund_' + Date.now().toString();
      const fundRef = doc(db, 'funds', fundId);
      
      const newFund = {
        name: newTitle,
        description: newDescription,
        createdAt: new Date().toISOString()
      };
      
      await setDoc(fundRef, newFund);
      
      setFunds([...funds, { id: fundId, ...newFund }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTitle('');
      setNewDescription('');
      
      setMessage('Fondo creado correctamente');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error creando fondo:", error);
      setMessage('Error al crear el fondo');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Seguro que deseas eliminar este fondo contable? Esto no borra el dinero, solo la categoría.')) return;
    try {
      await deleteDoc(doc(db, 'funds', id));
      setFunds(funds.filter(f => f.id !== id));
      setMessage('Fondo eliminado');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error eliminando:", error);
    }
  };

  const handleAddIncome = async (e) => {
    e.preventDefault();
    if (!incomeTitle || !incomeAmount || !incomeFund) return;

    try {
      await addDoc(collection(db, 'incomes'), {
        title: incomeTitle,
        amount: Number(incomeAmount),
        paymentMethod: incomeMethod,
        fundId: incomeFund,
        createdAt: new Date().toISOString()
      });
      setIncomeTitle('');
      setIncomeAmount('');
      setMessage('Ingreso registrado correctamente. El saldo ha sido actualizado.');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error registrando ingreso:", error);
      setMessage('Error al registrar el ingreso.');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleTransfer = async (e) => {
    e.preventDefault();
    if (!transferFrom || !transferTo || !transferAmount) return;
    if (transferFrom === transferTo) {
      setMessage('El fondo de origen y destino deben ser diferentes.');
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    try {
      await addDoc(collection(db, 'fund_transfers'), {
        fromFundId: transferFrom,
        toFundId: transferTo,
        amount: Number(transferAmount),
        createdAt: new Date().toISOString()
      });
      setTransferFrom('');
      setTransferTo('');
      setTransferAmount('');
      setMessage('Fondos transferidos correctamente.');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error transfiriendo fondos:", error);
      setMessage('Error al transferir fondos.');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando fondos...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
          <ArrowLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>Gestión de Fondos Contables</h3>
      </div>

      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
        Crea las categorías contables (ej. "Fondo Aniversario", "Fondo Paseo"). Cuando cobres una cuota, el dinero ingresará al fondo que elijas.
      </p>

      {message && (
        <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', color: 'var(--success)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={18} /> {message}
        </div>
      )}

      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
          <Plus size={18} /> Crear Nuevo Fondo
        </h4>
        <form onSubmit={handleAddFund} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: '1', minWidth: '200px', marginBottom: 0 }}>
            <label className="input-label">Nombre del Fondo</label>
            <input 
              type="text" 
              required
              className="input-field" 
              placeholder="Ej. Fondo Licenciatura"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '2', minWidth: '250px', marginBottom: 0 }}>
            <label className="input-label">Descripción (Opcional)</label>
            <input 
              type="text" 
              className="input-field" 
              placeholder="Ej. Para cubrir los gastos de la fiesta"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: '42px' }}>
            Crear Fondo
          </button>
        </form>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
        {/* Panel de Ingreso Extra / Saldo Inicial */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--success)' }}>
            <DollarSign size={18} /> Ingreso Extra / Saldo Inicial
          </h4>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Inyecta dinero físico al sistema (ej: plata de un año anterior, bingo, etc).</p>
          <form onSubmit={handleAddIncome} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Motivo</label>
              <input type="text" required className="input-field" placeholder="Ej. Saldo inicial 2025" value={incomeTitle} onChange={(e) => setIncomeTitle(e.target.value)} />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Monto ($)</label>
              <input type="number" required className="input-field" placeholder="Ej. 50000" value={incomeAmount} onChange={(e) => setIncomeAmount(e.target.value)} />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">¿Dónde está la plata?</label>
              <select className="input-field" value={incomeMethod} onChange={(e) => setIncomeMethod(e.target.value)}>
                <option value="cash">Efectivo (Caja Chica)</option>
                <option value="transfer">Banco (Transferencia)</option>
              </select>
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">¿A qué fondo va?</label>
              <select required className="input-field" value={incomeFund} onChange={(e) => setIncomeFund(e.target.value)}>
                <option value="">-- Selecciona un fondo --</option>
                <option value="general">Fondo General</option>
                {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" style={{ backgroundColor: 'var(--success)' }}>Registrar Ingreso</button>
          </form>
        </div>

        {/* Panel de Transferencia entre Fondos */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--warning)' }}>
            <ArrowRightLeft size={18} /> Repartir Fondos
          </h4>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Mueve saldo contable de un fondo a otro sin afectar la caja física ni el banco.</p>
          <form onSubmit={handleTransfer} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Desde el Fondo (Origen)</label>
              <select required className="input-field" value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)}>
                <option value="">-- Selecciona un fondo --</option>
                <option value="general">Fondo General</option>
                {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Hacia el Fondo (Destino)</label>
              <select required className="input-field" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                <option value="">-- Selecciona un fondo --</option>
                <option value="general">Fondo General</option>
                {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Monto a mover ($)</label>
              <input type="number" required className="input-field" placeholder="Ej. 15000" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-outline" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>Transferir</button>
          </form>
        </div>
      </div>

      <div className="glass-panel" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <th style={{ padding: '1rem' }}>Fondo Contable</th>
              <th style={{ padding: '1rem' }}>Descripción</th>
              <th style={{ padding: '1rem' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {funds.map(f => (
              <tr key={f.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '1rem', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Wallet size={16} color="var(--primary)" /> {f.name}
                </td>
                <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{f.description || '-'}</td>
                <td style={{ padding: '1rem' }}>
                  <button onClick={() => handleDelete(f.id)} className="btn btn-outline" style={{ padding: '0.4rem 0.75rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)', gap: '0.5rem', display: 'flex', alignItems: 'center' }}>
                    <Trash2 size={16} /> Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {funds.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No se han creado fondos todavía. Crea un "Fondo General" para empezar.
          </div>
        )}
      </div>
    </div>
  );
};

export default FundManagement;
