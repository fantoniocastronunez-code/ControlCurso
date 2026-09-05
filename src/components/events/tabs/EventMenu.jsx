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
  const [hasSubproducts, setHasSubproducts] = useState(false);
  const [subproducts, setSubproducts] = useState([{ name: '', price: '' }]);

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
        price: parseFloat(newItemPrice),
        subproducts: hasSubproducts ? subproducts.filter(sp => sp.name.trim() !== '').map(sp => ({
          name: sp.name.trim(),
          price: parseFloat(sp.price || 0)
        })) : []
      };
      
      await setDoc(doc(db, 'eventItems', id), item);
      setItems([...items, { id, ...item }].sort((a, b) => a.name.localeCompare(b.name)));
      
      setNewItemName('');
      setNewItemPrice('');
      setHasSubproducts(false);
      setSubproducts([{ name: '', price: '' }]);
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

        <div style={{ width: '100%', marginTop: '0.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input 
              type="checkbox"
              checked={hasSubproducts}
              onChange={(e) => setHasSubproducts(e.target.checked)}
            />
            Este producto tiene opciones o agregados (ej. Palta, Bebida)
          </label>
        </div>

        {hasSubproducts && (
          <div style={{ width: '100%', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-md)', marginTop: '0.5rem' }}>
            <h4 style={{ marginBottom: '1rem' }}>Opciones / Agregados</h4>
            {subproducts.map((sp, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                <div className="input-group" style={{ flex: 2 }}>
                  <input 
                    type="text"
                    placeholder="Nombre (ej. Palta)"
                    className="input-field"
                    value={sp.name}
                    onChange={(e) => {
                      const newSp = [...subproducts];
                      newSp[idx].name = e.target.value;
                      setSubproducts(newSp);
                    }}
                  />
                </div>
                <div className="input-group" style={{ flex: 1 }}>
                  <input 
                    type="number"
                    min="0"
                    placeholder="Precio extra ($)"
                    className="input-field"
                    value={sp.price}
                    onChange={(e) => {
                      const newSp = [...subproducts];
                      newSp[idx].price = e.target.value;
                      setSubproducts(newSp);
                    }}
                  />
                </div>
                {subproducts.length > 1 && (
                  <button 
                    type="button"
                    className="btn btn-outline"
                    style={{ padding: '0 0.5rem', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                    onClick={() => setSubproducts(subproducts.filter((_, i) => i !== idx))}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
            <button 
              type="button" 
              className="btn btn-outline" 
              style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
              onClick={() => setSubproducts([...subproducts, { name: '', price: '' }])}
            >
              + Añadir otra opción
            </button>
          </div>
        )}
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
                {item.subproducts && item.subproducts.length > 0 && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Agregados: {item.subproducts.map(sp => `${sp.name} (+${sp.price})`).join(', ')}
                  </div>
                )}
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
