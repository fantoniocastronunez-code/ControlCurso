import React, { useState, useEffect } from 'react';
import { db } from '../../../firebase/config';
import { collection, getDocs, doc, setDoc, query, where, orderBy } from 'firebase/firestore';
import { ShoppingCart, Plus, Minus, Trash2, Printer } from 'lucide-react';
import { useModal } from '../../../context/ModalContext';
import ThermalReceipt from './ThermalReceipt';

const EventPOS = ({ event }) => {
  const { showAlert, showConfirm } = useModal();
  const [items, setItems] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);

  // POS State
  const [cart, setCart] = useState([]);
  const [clientName, setClientName] = useState('');
  const [saleNote, setSaleNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash'); // cash, transfer
  
  // Printing State
  const [lastSale, setLastSale] = useState(null);

  useEffect(() => {
    fetchData();
  }, [event.id]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch menu items
      const qItems = query(collection(db, 'eventItems'), where('eventId', '==', event.id));
      const snapItems = await getDocs(qItems);
      const itemsList = snapItems.docs.map(d => ({ id: d.id, ...d.data() }));
      itemsList.sort((a, b) => a.name.localeCompare(b.name));
      setItems(itemsList);

      // Fetch past sales for correlative and history
      const qSales = query(collection(db, 'eventSales'), where('eventId', '==', event.id));
      const snapSales = await getDocs(qSales);
      const salesList = snapSales.docs.map(d => ({ id: d.id, ...d.data() }));
      salesList.sort((a, b) => b.correlative - a.correlative); // Local sort to avoid requiring composite index
      setSales(salesList);

    } catch (error) {
      console.error("Error fetching POS data:", error);
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (item) => {
    setCart(prev => {
      const existing = prev.find(c => c.id === item.id);
      if (existing) {
        return prev.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const updateQuantity = (id, delta) => {
    setCart(prev => prev.map(c => {
      if (c.id === id) {
        const newQ = c.quantity + delta;
        return newQ > 0 ? { ...c, quantity: newQ } : c;
      }
      return c;
    }));
  };

  const removeFromCart = (id) => {
    setCart(prev => prev.filter(c => c.id !== id));
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const handleCompleteSale = async () => {
    if (cart.length === 0) return;
    if (!(await showConfirm('¿Completar esta venta y generar ticket?'))) return;

    try {
      // Generate next correlative
      const nextCorrelative = sales.length > 0 ? sales[0].correlative + 1 : 1;
      
      const saleId = 'sale_' + Date.now();
      const newSale = {
        eventId: event.id,
        correlative: nextCorrelative,
        clientName: clientName.trim(),
        saleNote: saleNote.trim(),
        paymentMethod,
        items: cart,
        total: cartTotal,
        createdAt: new Date().toISOString()
      };

      // 1. Guardar Venta
      await setDoc(doc(db, 'eventSales', saleId), newSale);

      // 2. Ingresar el dinero automáticamente al Fondo del evento (como Ingreso Extra)
      const incomeId = 'inc_' + Date.now();
      await setDoc(doc(db, 'incomes', incomeId), {
        title: `Venta #${nextCorrelative} - ${event.name}`,
        date: new Date().toISOString().split('T')[0],
        amount: cartTotal,
        paymentMethod,
        fundId: event.fundId,
        eventId: event.id,
        saleId: saleId,
        createdAt: new Date().toISOString()
      });

      // Actualizar estado local
      setSales([ { id: saleId, ...newSale }, ...sales ]);
      setLastSale(newSale); // Para imprimir
      
      // Limpiar carrito
      setCart([]);
      setClientName('');
      setSaleNote('');
      setPaymentMethod('cash');

      // Disparar impresión
      setTimeout(() => {
        window.print();
      }, 500);

    } catch (error) {
      console.error("Error al completar venta:", error);
      showAlert("Ocurrió un error al registrar la venta.");
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  if (loading) return <div>Cargando Punto de Venta...</div>;

  return (
    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
      {/* Impresión oculta */}
      <ThermalReceipt sale={lastSale} eventName={event.name} />

      {/* Lado Izquierdo: Productos */}
      <div style={{ flex: '1 1 400px' }}>
        <h3 style={{ marginBottom: '1.5rem', color: 'var(--primary)' }}>Productos Disponibles</h3>
        {items.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No hay productos en el menú.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '1rem' }}>
            {items.map(item => (
              <div 
                key={item.id} 
                onClick={() => addToCart(item)}
                style={{ 
                  backgroundColor: 'rgba(99,102,241,0.1)', 
                  border: '1px solid var(--primary)', 
                  borderRadius: 'var(--radius-md)', 
                  padding: '1rem', 
                  textAlign: 'center',
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'transform 0.1s'
                }}
                onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
                onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                <strong style={{ display: 'block', marginBottom: '0.5rem' }}>{item.name}</strong>
                <span style={{ color: 'var(--primary)' }}>{formatMoney(item.price)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lado Derecho: Carrito */}
      <div className="glass-panel" style={{ flex: '1 1 300px', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShoppingCart size={20} /> Venta Actual
        </h3>

        <div style={{ flex: 1, minHeight: '200px', overflowY: 'auto', marginBottom: '1.5rem' }}>
          {cart.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '3rem' }}>El carrito está vacío.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {cart.map(item => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
                  <div style={{ flex: 1 }}>
                    <strong style={{ display: 'block' }}>{item.name}</strong>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{formatMoney(item.price)} c/u</span>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button onClick={() => updateQuantity(item.id, -1)} className="btn btn-outline" style={{ padding: '0.2rem' }}>
                      <Minus size={14} />
                    </button>
                    <span style={{ width: '20px', textAlign: 'center' }}>{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, 1)} className="btn btn-outline" style={{ padding: '0.2rem' }}>
                      <Plus size={14} />
                    </button>
                  </div>
                  
                  <div style={{ width: '80px', textAlign: 'right', fontWeight: 'bold' }}>
                    {formatMoney(item.price * item.quantity)}
                  </div>
                  
                  <button onClick={() => removeFromCart(item.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', marginLeft: '0.5rem' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ borderTop: '2px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
          <div className="input-group" style={{ marginBottom: '1rem' }}>
            <label className="input-label">Nombre del Cliente (Opcional)</label>
            <input 
              type="text" 
              className="input-field" 
              placeholder="Ej. Familia Pérez"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>

          <div className="input-group" style={{ marginBottom: '1rem' }}>
            <label className="input-label">Detalle a Imprimir (Opcional)</label>
            <input 
              type="text" 
              className="input-field" 
              placeholder="Ej. Retira en puerta 2, Sin mayo..."
              value={saleNote}
              onChange={(e) => setSaleNote(e.target.value)}
            />
          </div>
          
          <div className="input-group" style={{ marginBottom: '1.5rem' }}>
            <label className="input-label">Medio de Pago</label>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="paymentMethod" 
                  value="cash"
                  checked={paymentMethod === 'cash'}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  style={{ accentColor: 'var(--primary)' }}
                /> Efectivo
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="paymentMethod" 
                  value="transfer"
                  checked={paymentMethod === 'transfer'}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  style={{ accentColor: 'var(--primary)' }}
                /> Transferencia
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', fontSize: '1.25rem' }}>
            <strong>TOTAL:</strong>
            <strong style={{ color: 'var(--success)' }}>{formatMoney(cartTotal)}</strong>
          </div>

          <button 
            onClick={handleCompleteSale}
            disabled={cart.length === 0} 
            className="btn btn-primary" 
            style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', padding: '1rem', fontSize: '1.1rem' }}
          >
            <Printer size={20} /> Vender e Imprimir Vale
          </button>
        </div>
      </div>
      
      {/* Historial rápido (abajo) */}
      <div style={{ width: '100%', marginTop: '2rem' }}>
        <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>Últimas Ventas Emitidas</h4>
        {sales.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No hay ventas registradas.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}># Ticket</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Hora</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Cliente</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Ítems</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Total</th>
                  <th style={{ textAlign: 'center', padding: '0.5rem' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {sales.slice(0, 10).map(sale => (
                  <tr key={sale.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.5rem' }}>{sale.correlative}</td>
                    <td style={{ padding: '0.5rem' }}>{new Date(sale.createdAt).toLocaleTimeString('es-CL')}</td>
                    <td style={{ padding: '0.5rem' }}>{sale.clientName || 'General'}</td>
                    <td style={{ padding: '0.5rem', color: 'var(--text-muted)' }}>
                      {sale.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 'bold', color: 'var(--success)' }}>
                      {formatMoney(sale.total)}
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                      <button 
                        onClick={() => { setLastSale(sale); setTimeout(() => window.print(), 200); }} 
                        className="btn btn-outline"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        Reimprimir
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

export default EventPOS;
