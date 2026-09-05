import React, { useEffect, useState } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { ArrowLeft, CheckCircle, Trash2, Wallet, Plus } from 'lucide-react';

const FundManagement = ({ onBack }) => {
  const [funds, setFunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');

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
