import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../../firebase/config';
import { collection, getDocs, doc, setDoc, query, where, orderBy } from 'firebase/firestore';
import { ShoppingCart, Plus, Minus, Trash2, Printer, Maximize, Minimize } from 'lucide-react';
import { useModal } from '../../../context/ModalContext';
import ThermalReceipt from './ThermalReceipt';

const EventPOS = ({ event }) => {
  const { showAlert, showConfirm } = useModal();
  const [items, setItems] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fullscreen State
  const posContainerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // POS State
  const [cart, setCart] = useState([]);
  const [clientName, setClientName] = useState('');
  const [saleNote, setSaleNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash'); // cash, transfer
  
  // Subproducts Modal State
  const [showSubproductModal, setShowSubproductModal] = useState(false);
  const [selectedItemForSubproducts, setSelectedItemForSubproducts] = useState(null);
  const [selectedSubproducts, setSelectedSubproducts] = useState([]);
  
  // Printing State
  const [lastSale, setLastSale] = useState(null);

  useEffect(() => {
    fetchData();
  }, [event.id]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (posContainerRef.current?.requestFullscreen) {
        posContainerRef.current.requestFullscreen().catch(err => {
          console.error("Error attempting to enable fullscreen:", err);
        });
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

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

  const handleItemClick = (item) => {
    if (item.subproducts && item.subproducts.length > 0) {
      setSelectedItemForSubproducts(item);
      setSelectedSubproducts([]);
      setShowSubproductModal(true);
    } else {
      addToCart(item, []);
    }
  };

  const addToCart = (item, selectedSp) => {
    const spIds = selectedSp.map(sp => sp.name).sort().join('_');
    const cartItemId = `${item.id}_${spIds}`;
    
    setCart(prev => {
      const existing = prev.find(c => c.cartItemId === cartItemId);
      if (existing) {
        return prev.map(c => c.cartItemId === cartItemId ? { ...c, quantity: c.quantity + 1 } : c);
      }
      
      const spTotal = selectedSp.reduce((sum, sp) => sum + parseFloat(sp.price || 0), 0);
      return [...prev, { 
        ...item, 
        cartItemId,
        selectedSubproducts: selectedSp,
        unitPrice: item.price + spTotal,
        quantity: 1 
      }];
    });
    
    setShowSubproductModal(false);
    setSelectedItemForSubproducts(null);
    setSelectedSubproducts([]);
  };

  const updateQuantity = (cartItemId, delta) => {
    setCart(prev => prev.map(c => {
      if (c.cartItemId === cartItemId) {
        const newQ = c.quantity + delta;
        return newQ > 0 ? { ...c, quantity: newQ } : c;
      }
      return c;
    }));
  };

  const removeFromCart = (cartItemId) => {
    setCart(prev => prev.filter(c => c.cartItemId !== cartItemId));
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);

  const handleCompleteSale = async () => {
    if (cart.length === 0) return;
    if (!window.confirm('¿Completar esta venta y generar ticket?')) return;

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
    <div 
      ref={posContainerRef}
      style={{ 
        display: 'flex', gap: '2rem', flexWrap: 'wrap', position: 'relative',
        backgroundColor: isFullscreen ? '#0f172a' : 'transparent', // using slate-900 as fallback if var is not available
        padding: isFullscreen ? '2rem' : '0',
        overflowY: isFullscreen ? 'auto' : 'visible',
        minHeight: isFullscreen ? '100vh' : 'auto'
      }}
    >
      {/* Fullscreen Toggle Button */}
      <button 
        onClick={toggleFullscreen}
        className="btn btn-outline"
        style={{ position: 'absolute', top: isFullscreen ? '2rem' : '0', right: isFullscreen ? '2rem' : '0', padding: '0.5rem', zIndex: 10 }}
        title="Pantalla Completa"
      >
        {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
      </button>
      
      {/* Modal Subproductos */}
      {showSubproductModal && selectedItemForSubproducts && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="glass-panel" style={{ width: '90%', maxWidth: '400px', padding: '2rem' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Opciones para {selectedItemForSubproducts.name}</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              Precio base: {formatMoney(selectedItemForSubproducts.price)}
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
              {selectedItemForSubproducts.subproducts.map((sp, idx) => {
                const isSelected = selectedSubproducts.some(s => s.name === sp.name);
                return (
                  <label key={idx} style={{ 
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.75rem', backgroundColor: isSelected ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.05)',
                    borderRadius: 'var(--radius-md)', cursor: 'pointer', border: isSelected ? '1px solid var(--primary)' : '1px solid transparent'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <input 
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedSubproducts([...selectedSubproducts, sp]);
                          } else {
                            setSelectedSubproducts(selectedSubproducts.filter(s => s.name !== sp.name));
                          }
                        }}
                        style={{ accentColor: 'var(--primary)' }}
                      />
                      <span>{sp.name}</span>
                    </div>
                    <span style={{ color: 'var(--primary)' }}>+{formatMoney(sp.price)}</span>
                  </label>
                );
              })}
            </div>
            
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button 
                className="btn btn-outline" 
                style={{ flex: 1 }}
                onClick={() => {
                  setShowSubproductModal(false);
                  setSelectedItemForSubproducts(null);
                  setSelectedSubproducts([]);
                }}
              >
                Cancelar
              </button>
              <button 
                className="btn btn-primary" 
                style={{ flex: 1 }}
                onClick={() => addToCart(selectedItemForSubproducts, selectedSubproducts)}
              >
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Impresión oculta */}
      <ThermalReceipt sale={lastSale} eventName={event.name} />

      {/* Lado Izquierdo: Productos */}
      <div style={{ flex: '1 1 400px', marginTop: isFullscreen ? '0' : '3rem' }}>
        <h3 style={{ marginBottom: '1.5rem', color: 'var(--primary)' }}>Productos Disponibles</h3>
        {items.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No hay productos en el menú.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '1rem' }}>
            {items.map(item => (
              <div 
                key={item.id} 
                onClick={() => handleItemClick(item)}
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
                <div key={item.cartItemId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
                  <div style={{ flex: 1 }}>
                    <strong style={{ display: 'block' }}>{item.name}</strong>
                    {item.selectedSubproducts && item.selectedSubproducts.length > 0 && (
                      <div style={{ paddingLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {item.selectedSubproducts.map((sp, idx) => (
                          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', paddingRight: '1rem' }}>
                            <span>+ {sp.name}</span>
                            <span>{formatMoney(sp.price)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.25rem' }}>{formatMoney(item.unitPrice)} c/u (total)</span>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                    <button onClick={() => updateQuantity(item.cartItemId, -1)} className="btn btn-outline" style={{ padding: '0.2rem' }}>
                      <Minus size={14} />
                    </button>
                    <span style={{ width: '20px', textAlign: 'center' }}>{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.cartItemId, 1)} className="btn btn-outline" style={{ padding: '0.2rem' }}>
                      <Plus size={14} />
                    </button>
                  </div>
                  
                  <div style={{ width: '80px', textAlign: 'right', fontWeight: 'bold', marginTop: '0.25rem' }}>
                    {formatMoney(item.unitPrice * item.quantity)}
                  </div>
                  
                  <button onClick={() => removeFromCart(item.cartItemId)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', marginLeft: '0.5rem', marginTop: '0.25rem' }}>
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
