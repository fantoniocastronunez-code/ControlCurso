import React, { useState, useEffect } from 'react';
import { db } from '../../../firebase/config';
import { collection, getDocs, doc, setDoc, query, where, deleteDoc } from 'firebase/firestore';
import { Plus, Trash2, Edit2 } from 'lucide-react';
import { useModal } from '../../../context/ModalContext';

const EventMenu = ({ event }) => {
  const { showAlert, showConfirm } = useModal();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');

  useEffect(() => {
    fetchItems();
  }, [event.id]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'eventItems'), where('eventId', '==', event.id));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setItems(list);
    } catch (error) {
      console.error("Error fetching items:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!newItemName || !newItemPrice) return;

    try {
      const id = 'item_' + Date.now();
      const item = {
        eventId: event.id,
        name: newItemName.trim(),
        price: parseFloat(newItemPrice)
      };
      
      await setDoc(doc(db, 'eventItems', id), item);
      setItems([...items, { id, ...item }].sort((a, b) => a.name.localeCompare(b.name)));
      
      setNewItemName('');
      setNewItemPrice('');
    } catch (error) {
      console.error("Error adding item:", error);
      showAlert("Hubo un error al agregar el ítem.");
    }
  };

  const handleDeleteItem = async (id) => {
    if (!(await showConfirm('¿Eliminar este ítem del menú?'))) return;
    try {
      await deleteDoc(doc(db, 'eventItems', id));
      setItems(items.filter(i => i.id !== id));
    } catch (error) {
      console.error("Error deleting item:", error);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  if (loading) return <div>Cargando menú...</div>;

  return (
    <div className="glass-panel" style={{ padding: '2rem' }}>
      <h3 style={{ marginBottom: '1.5rem', color: 'var(--primary)' }}>Menú / Inventario del Evento</h3>
      
      <form onSubmit={handleAddItem} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <div className="input-group" style={{ flex: 1, minWidth: '200px' }}>
          <label className="input-label">Nombre del Producto (Ej. Completo, Bebida)</label>
          <input 
            type="text"
            required
            className="input-field"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
          />
        </div>
        <div className="input-group" style={{ flex: 1, minWidth: '150px' }}>
          <label className="input-label">Precio de Venta ($)</label>
          <input 
            type="number"
            min="1"
            required
            className="input-field"
            value={newItemPrice}
            onChange={(e) => setNewItemPrice(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" style={{ padding: '0.65rem 1.5rem', marginBottom: '1rem' }}>
          <Plus size={18} /> Agregar
        </button>
      </form>

      {items.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No hay ítems en el menú todavía. Agrega algunos arriba.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
          {items.map(item => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ display: 'block', fontSize: '1.1rem' }}>{item.name}</strong>
                <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{formatMoney(item.price)}</span>
              </div>
              <button 
                onClick={() => handleDeleteItem(item.id)}
                style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem' }}
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default EventMenu;
