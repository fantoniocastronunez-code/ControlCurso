import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../../firebase/config';
import { collection, getDocs, doc, setDoc, query, where, orderBy, updateDoc, deleteDoc } from 'firebase/firestore';
import { ShoppingCart, Plus, Minus, Trash2, Printer, Maximize, Minimize, Check, Package, AlertTriangle, UserCheck, Users, RefreshCw } from 'lucide-react';
import { useModal } from '../../../context/ModalContext';
import { useAuth } from '../../../context/AuthContext';
import ThermalReceipt from './ThermalReceipt';

const EventPOS = ({ event }) => {
  const { user } = useAuth();
  const { showAlert, showConfirm } = useModal();
  const [items, setItems] = useState([]);
  const [sales, setSales] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fullscreen State
  const posContainerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Cajero en turno (Gestión de turnos y relevos de caja)
  const [cashierName, setCashierName] = useState(() => localStorage.getItem(`event_cashier_${event.id}`) || '');
  const [showCashierModal, setShowCashierModal] = useState(false);
  const [newCashierInput, setNewCashierInput] = useState('');
  const [cashierFilter, setCashierFilter] = useState('all');

  // POS State
  const [cart, setCart] = useState([]);
  const [clientName, setClientName] = useState('');
  const [saleNote, setSaleNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash'); // cash, transfer
  
  // Subproducts Modal State
  const [showSubproductModal, setShowSubproductModal] = useState(false);
  const [selectedItemForSubproducts, setSelectedItemForSubproducts] = useState(null);
  const [selectedSubproducts, setSelectedSubproducts] = useState([]);
  
  // Cash Calculator Modal State
  const [showCashModal, setShowCashModal] = useState(false);
  const [cashReceived, setCashReceived] = useState('');
  
  // Printing State
  const [lastSale, setLastSale] = useState(null);

  // Inicializar cajero por defecto si no hay uno guardado
  useEffect(() => {
    if (!cashierName && user) {
      const defaultName = user.displayName || user.email?.split('@')[0] || '';
      if (defaultName) {
        setCashierName(defaultName);
        localStorage.setItem(`event_cashier_${event.id}`, defaultName);
      }
    }
  }, [user, event.id, cashierName]);

  useEffect(() => {
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

        // Fetch inventory items
        const qInv = query(collection(db, 'eventInventory'), where('eventId', '==', event.id));
        const snapInv = await getDocs(qInv);
        const invList = snapInv.docs.map(d => ({ id: d.id, ...d.data() }));
        invList.sort((a, b) => a.name.localeCompare(b.name));
        setInventory(invList);

      } catch (error) {
        console.error("Error fetching POS data:", error);
      } finally {
        setLoading(false);
      }
    };
    
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

  // Calcular stock disponible para un ítem del menú según sus insumos
  const getItemStockInfo = (item) => {
    if (!item.ingredients || !Array.isArray(item.ingredients) || item.ingredients.length === 0) {
      return { hasStockLimit: false, availableUnits: null, limitingIngredient: null };
    }

    let minAvailable = Infinity;
    let limitingIng = null;

    for (const ing of item.ingredients) {
      const invItem = inventory.find(i => i.id === ing.inventoryId);
      const currentStock = invItem ? (invItem.currentStock || 0) : 0;
      const possibleWithIng = Math.floor(currentStock / ing.quantity);
      if (possibleWithIng < minAvailable) {
        minAvailable = possibleWithIng;
        limitingIng = invItem;
      }
    }

    return {
      hasStockLimit: true,
      availableUnits: Math.max(0, minAvailable === Infinity ? 0 : minAvailable),
      limitingIngredient: limitingIng
    };
  };

  // Comprobar si hay stock de insumos suficiente considerando lo que ya está en el carrito
  const canAddUnitsToCart = (item, additionalUnits = 1) => {
    if (!item.ingredients || !Array.isArray(item.ingredients) || item.ingredients.length === 0) {
      return { ok: true };
    }

    for (const ing of item.ingredients) {
      const invItem = inventory.find(i => i.id === ing.inventoryId);
      const stock = invItem ? (invItem.currentStock || 0) : 0;

      // Calcular cuánto de este insumo ya está comprometido en el carrito actual
      const committedInCart = cart.reduce((sum, cartItem) => {
        const matchIng = (cartItem.ingredients || []).find(i => i.inventoryId === ing.inventoryId);
        return sum + (matchIng ? matchIng.quantity * cartItem.quantity : 0);
      }, 0);

      const needed = committedInCart + (ing.quantity * additionalUnits);
      if (needed > stock) {
        return {
          ok: false,
          ingredientName: invItem?.name || ing.name || 'Insumo',
          availableStock: stock,
          unit: invItem?.unit || 'un.'
        };
      }
    }

    return { ok: true };
  };

  const handleItemClick = (item) => {
    const stockInfo = getItemStockInfo(item);
    if (stockInfo.hasStockLimit && stockInfo.availableUnits <= 0) {
      showAlert(`"${item.name}" está agotado por falta de insumos (${stockInfo.limitingIngredient?.name || 'insumo'}).`);
      return;
    }

    const check = canAddUnitsToCart(item, 1);
    if (!check.ok) {
      showAlert(`Stock insuficiente de "${check.ingredientName}". Solo quedan ${check.availableStock} ${check.unit} disponibles.`);
      return;
    }

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
    if (delta > 0) {
      const cartItem = cart.find(c => c.cartItemId === cartItemId);
      if (cartItem) {
        const check = canAddUnitsToCart(cartItem, delta);
        if (!check.ok) {
          showAlert(`Stock insuficiente de "${check.ingredientName}". Solo quedan ${check.availableStock} ${check.unit} disponibles.`);
          return;
        }
      }
    }

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

  const handleCompleteSaleClick = () => {
    if (cart.length === 0) return;
    
    if (paymentMethod === 'cash') {
      setCashReceived('');
      setShowCashModal(true);
    } else {
      processSale();
    }
  };

  const processSale = async () => {
    try {
      // Generate next correlative
      const nextCorrelative = sales.length > 0 ? sales[0].correlative + 1 : 1;
      
      // Calcular deducciones de inventario según insumos de los productos
      const deductions = {};
      cart.forEach(cartItem => {
        if (cartItem.ingredients && Array.isArray(cartItem.ingredients)) {
          cartItem.ingredients.forEach(ing => {
            if (ing.inventoryId) {
              const qty = (parseFloat(ing.quantity) || 0) * (cartItem.quantity || 1);
              deductions[ing.inventoryId] = (deductions[ing.inventoryId] || 0) + qty;
            }
          });
        }
      });

      const activeCashier = (cashierName.trim() || user?.displayName || user?.email?.split('@')[0] || 'Cajero').trim();
      if (!cashierName.trim()) {
        setCashierName(activeCashier);
        localStorage.setItem(`event_cashier_${event.id}`, activeCashier);
      }

      const saleId = 'sale_' + Date.now();
      const newSale = {
        eventId: event.id,
        correlative: nextCorrelative,
        clientName: clientName.trim(),
        saleNote: saleNote.trim(),
        cashierName: activeCashier,
        cashierEmail: user?.email || '',
        paymentMethod,
        items: cart,
        inventoryDeductions: deductions,
        total: cartTotal,
        createdAt: new Date().toISOString(),
        createdBy: user?.email || user?.displayName || 'Unknown User'
      };

      // 1. Guardar Venta
      await setDoc(doc(db, 'eventSales', saleId), newSale);

      // 2. Descontar del inventario en Firestore
      for (const [invId, qtyToDeduct] of Object.entries(deductions)) {
        const invItem = inventory.find(i => i.id === invId);
        const newStock = Math.max(0, (invItem?.currentStock ?? 0) - qtyToDeduct);
        await updateDoc(doc(db, 'eventInventory', invId), {
          currentStock: newStock,
          updatedAt: new Date().toISOString()
        });
      }

      // Actualizar inventario en estado local inmediatamente
      setInventory(prev => prev.map(inv => {
        if (deductions[inv.id]) {
          return {
            ...inv,
            currentStock: Math.max(0, (inv.currentStock ?? 0) - deductions[inv.id])
          };
        }
        return inv;
      }));

      // 3. Ingresar el dinero automáticamente al Fondo del evento (como Ingreso Extra)
      const incomeId = 'inc_' + Date.now();
      await setDoc(doc(db, 'incomes', incomeId), {
        title: `Venta #${nextCorrelative} - ${event.name}`,
        date: new Date().toISOString().split('T')[0],
        amount: cartTotal,
        paymentMethod,
        fundId: event.fundId,
        eventId: event.id,
        courseId: event.courseId,
        saleId: saleId,
        createdAt: new Date().toISOString(),
        createdBy: user?.email || user?.displayName || 'Unknown User'
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

  const handleDeleteSale = async (sale) => {
    if (sale.status === 'cancelled') return;
    const confirm = await showConfirm(`¿Estás seguro que deseas anular la venta #${sale.correlative}? Esta acción no se puede deshacer.`);
    if (!confirm) return;
    
    try {
      // 1. Marcar venta como anulada
      await updateDoc(doc(db, 'eventSales', sale.id), { status: 'cancelled' });

      // 2. Restaurar stock en el inventario si la venta tenía insumos descontados
      const deductionsToRestore = sale.inventoryDeductions || {};
      // Si la venta no tenía inventoryDeductions guardadas explícitamente, calcular de sus items
      if (Object.keys(deductionsToRestore).length === 0 && sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(cItem => {
          if (cItem.ingredients && Array.isArray(cItem.ingredients)) {
            cItem.ingredients.forEach(ing => {
              if (ing.inventoryId) {
                const qty = (parseFloat(ing.quantity) || 0) * (cItem.quantity || 1);
                deductionsToRestore[ing.inventoryId] = (deductionsToRestore[ing.inventoryId] || 0) + qty;
              }
            });
          }
        });
      }

      for (const [invId, qtyToRestore] of Object.entries(deductionsToRestore)) {
        const invItem = inventory.find(i => i.id === invId);
        const restoredStock = (invItem?.currentStock ?? 0) + qtyToRestore;
        await updateDoc(doc(db, 'eventInventory', invId), {
          currentStock: restoredStock,
          updatedAt: new Date().toISOString()
        });
      }

      setInventory(prev => prev.map(inv => {
        if (deductionsToRestore[inv.id]) {
          return {
            ...inv,
            currentStock: (inv.currentStock ?? 0) + deductionsToRestore[inv.id]
          };
        }
        return inv;
      }));
      
      // 3. Eliminar el ingreso asociado en la colección incomes
      const qIncome = query(collection(db, 'incomes'), where('saleId', '==', sale.id));
      const snapIncome = await getDocs(qIncome);
      for (const docSnap of snapIncome.docs) {
        await deleteDoc(doc(db, 'incomes', docSnap.id));
      }
      
      // 4. Actualizar estado local
      setSales(prev => prev.map(s => s.id === sale.id ? { ...s, status: 'cancelled' } : s));
      
      await showAlert(`Venta #${sale.correlative} anulada correctamente y el stock de insumos fue restaurado.`);
    } catch (error) {
      console.error("Error al anular venta:", error);
      await showAlert("Ocurrió un error al anular la venta.");
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const activeCashierDisplayName = cashierName.trim() || user?.displayName || user?.email?.split('@')[0] || 'Cajero General';
  const shiftSales = sales.filter(s => s.status !== 'cancelled' && (s.cashierName || s.createdBy) === activeCashierDisplayName);
  const shiftSalesCount = shiftSales.length;
  const shiftSalesTotal = shiftSales.reduce((sum, s) => sum + (s.total || 0), 0);

  const handleSaveCashier = (nameToSet) => {
    const trimmed = nameToSet.trim();
    if (!trimmed) {
      showAlert("Por favor ingresa el nombre de quien estará en caja.");
      return;
    }
    setCashierName(trimmed);
    localStorage.setItem(`event_cashier_${event.id}`, trimmed);
    setShowCashierModal(false);
    showAlert(`Caja asignada a: "${trimmed}". Las siguientes ventas se registrarán a su nombre.`);
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
      {/* Barra Superior de Cajero en Turno y Controles */}
      <div style={{ 
        width: '100%', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        flexWrap: 'wrap', 
        gap: '0.75rem',
        padding: '0.75rem 1.25rem',
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid rgba(255, 255, 255, 0.08)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: '0.4rem', 
            backgroundColor: 'rgba(99, 102, 241, 0.15)', 
            border: '1px solid var(--primary)', 
            padding: '0.35rem 0.85rem', 
            borderRadius: '20px' 
          }}>
            <UserCheck size={16} color="var(--primary)" />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Cajero(a) en turno:</span>
            <strong style={{ fontSize: '0.9rem', color: '#fff' }}>{activeCashierDisplayName}</strong>
          </div>

          <button
            type="button"
            onClick={() => {
              setNewCashierInput(activeCashierDisplayName);
              setShowCashierModal(true);
            }}
            className="btn btn-outline"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <UserCheck size={13} /> Relevar / Cambiar Cajero
          </button>

          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Turno actual: <strong>{shiftSalesCount} ventas</strong> ({formatMoney(shiftSalesTotal)})
          </span>
        </div>

        <button 
          onClick={toggleFullscreen}
          className="btn btn-outline"
          style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}
          title="Pantalla Completa"
        >
          {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          <span>{isFullscreen ? 'Salir' : 'Pantalla Completa'}</span>
        </button>
      </div>

      {/* Modal Relevo de Cajero */}
      {showCashierModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1200
        }}>
          <div className="glass-panel" style={{ width: '90%', maxWidth: '440px', padding: '2rem' }}>
            <h3 style={{ marginBottom: '0.5rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UserCheck size={20} /> Relevo de Cajero(a)
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Ingresa el nombre de quien asume la caja en este momento. Las ventas siguientes quedarán asociadas a su nombre para saber quién vendió qué cosas y cuánto dinero recaudó en su turno.
            </p>

            <form onSubmit={(e) => { e.preventDefault(); handleSaveCashier(newCashierInput); }}>
              <div className="input-group" style={{ marginBottom: '1rem' }}>
                <label className="input-label">Nombre del nuevo cajero(a) *</label>
                <input 
                  type="text"
                  required
                  autoFocus
                  className="input-field"
                  placeholder="Ej. Juan Pérez, María G., Papá de Lucas..."
                  value={newCashierInput}
                  onChange={(e) => setNewCashierInput(e.target.value)}
                />
              </div>

              {user?.displayName && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <button
                    type="button"
                    onClick={() => setNewCashierInput(user.displayName)}
                    className="btn btn-outline"
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                  >
                    Usar mi nombre ({user.displayName})
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowCashierModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Confirmar Turno
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Efectivo / Calculadora de Vuelto */}
      {showCashModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1100
        }}>
          <div className="glass-panel" style={{ width: '90%', maxWidth: '400px', padding: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem', textAlign: 'center', color: 'var(--primary)' }}>Pago en Efectivo</h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', marginBottom: '1rem' }}>
              <span>Total a Cobrar:</span>
              <strong style={{ color: 'var(--text-main)' }}>{formatMoney(cartTotal)}</strong>
            </div>

            <div className="input-group" style={{ marginBottom: '1.5rem' }}>
              <label className="input-label">Monto Recibido</label>
              <input 
                type="number" 
                className="input-field" 
                style={{ fontSize: '1.5rem', textAlign: 'right' }}
                placeholder="Ej. 10000"
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value)}
                autoFocus
              />
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.5rem' }}>
               <button className="btn btn-outline" onClick={() => setCashReceived(cartTotal)}>Exacto</button>
               <button className="btn btn-outline" onClick={() => setCashReceived(Math.ceil(cartTotal / 1000) * 1000)}>Redondear (Mil)</button>
               <button className="btn btn-outline" onClick={() => setCashReceived(5000)}>$5.000</button>
               <button className="btn btn-outline" onClick={() => setCashReceived(10000)}>$10.000</button>
               <button className="btn btn-outline" onClick={() => setCashReceived(20000)}>$20.000</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.5rem', marginBottom: '2rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
              <span>Vuelto:</span>
              <strong style={{ color: (cashReceived && Number(cashReceived) >= cartTotal) ? 'var(--success)' : 'var(--danger)' }}>
                {cashReceived && Number(cashReceived) >= cartTotal ? formatMoney(Number(cashReceived) - cartTotal) : '$0'}
              </strong>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button 
                className="btn btn-outline" 
                style={{ flex: 1 }}
                onClick={() => { setShowCashModal(false); setCashReceived(''); }}
              >
                Cancelar
              </button>
              <button 
                className="btn btn-primary" 
                style={{ flex: 2 }}
                disabled={!cashReceived || Number(cashReceived) < cartTotal}
                onClick={() => {
                  setShowCashModal(false);
                  processSale();
                }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal Subproductos */}
      {showSubproductModal && selectedItemForSubproducts && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(5px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="glass-panel" style={{ width: '92%', maxWidth: '440px', maxHeight: '90vh', overflowY: 'auto', padding: '1.75rem', borderRadius: 'var(--radius-lg)' }}>
            <h3 style={{ marginBottom: '0.25rem', color: 'var(--text-main)' }}>Opciones para {selectedItemForSubproducts.name}</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
              Precio base: <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{formatMoney(selectedItemForSubproducts.price)}</span>
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1.5rem' }}>
              {selectedItemForSubproducts.subproducts.map((sp, idx) => {
                const currentSelection = selectedSubproducts.find(s => s.baseName === sp.name || s.name === sp.name);
                const isSelected = !!currentSelection;
                const hasOptions = Boolean(sp.hasOptions && sp.options && sp.options.length > 0);

                return (
                  <div 
                    key={idx} 
                    style={{ 
                      padding: '0.85rem', 
                      backgroundColor: isSelected ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.03)',
                      borderRadius: 'var(--radius-md)', 
                      border: isSelected ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.1)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <label style={{ 
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      cursor: 'pointer', userSelect: 'none'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <input 
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              const defaultOption = hasOptions ? sp.options[0] : null;
                              const displayName = defaultOption ? `${sp.name} (${defaultOption})` : sp.name;
                              setSelectedSubproducts([
                                ...selectedSubproducts, 
                                { 
                                  baseName: sp.name, 
                                  name: displayName, 
                                  selectedOption: defaultOption, 
                                  price: parseFloat(sp.price || 0) 
                                }
                              ]);
                            } else {
                              setSelectedSubproducts(selectedSubproducts.filter(s => s.baseName !== sp.name && s.name !== sp.name));
                            }
                          }}
                          style={{ accentColor: 'var(--primary)', width: '18px', height: '18px' }}
                        />
                        <span style={{ fontWeight: isSelected ? '600' : 'normal', color: 'var(--text-main)' }}>
                          {sp.name}
                        </span>
                      </div>
                      <span style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '0.9rem' }}>
                        {parseFloat(sp.price || 0) > 0 ? `+${formatMoney(sp.price)}` : 'Incluido'}
                      </span>
                    </label>

                    {/* Submenú de tipos / opciones si está marcado */}
                    {hasOptions && isSelected && (
                      <div style={{ 
                        marginTop: '0.75rem', 
                        paddingTop: '0.75rem', 
                        borderTop: '1px solid rgba(255,255,255,0.08)',
                        paddingLeft: '0.25rem'
                      }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span>Elegir tipo de {sp.name}:</span>
                          <strong style={{ color: 'var(--primary)' }}>{currentSelection.selectedOption}</strong>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                          {sp.options.map((opt, optIdx) => {
                            const isOptActive = currentSelection.selectedOption === opt;
                            return (
                              <button
                                key={optIdx}
                                type="button"
                                onClick={() => {
                                  setSelectedSubproducts(selectedSubproducts.map(s => {
                                    if (s.baseName === sp.name || s.name.startsWith(sp.name)) {
                                      return {
                                        ...s,
                                        baseName: sp.name,
                                        name: `${sp.name} (${opt})`,
                                        selectedOption: opt
                                      };
                                    }
                                    return s;
                                  }));
                                }}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.35rem',
                                  padding: '0.35rem 0.75rem',
                                  fontSize: '0.8rem',
                                  fontWeight: isOptActive ? 'bold' : 'normal',
                                  borderRadius: '20px',
                                  border: isOptActive ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.15)',
                                  backgroundColor: isOptActive ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                                  color: isOptActive ? '#ffffff' : 'var(--text-main)',
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                {isOptActive && <Check size={12} />}
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button 
                className="btn btn-outline" 
                style={{ flex: 1, padding: '0.75rem' }}
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
                style={{ flex: 2, padding: '0.75rem', fontWeight: 'bold' }}
                onClick={() => addToCart(selectedItemForSubproducts, selectedSubproducts)}
              >
                Agregar • {formatMoney(selectedItemForSubproducts.price + selectedSubproducts.reduce((acc, s) => acc + parseFloat(s.price || 0), 0))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Impresión oculta */}
      <ThermalReceipt sale={lastSale} eventName={event.name} />

      {/* Lado Izquierdo: Productos */}
      <div style={{ flex: '1 1 400px', marginTop: isFullscreen ? '0' : '3rem' }}>
        
        {/* Barra en vivo de Stock de Insumos */}
        {inventory.length > 0 && (
          <div style={{ 
            marginBottom: '1.25rem', 
            padding: '0.85rem 1rem', 
            backgroundColor: 'rgba(255,255,255,0.03)', 
            borderRadius: 'var(--radius-md)', 
            border: '1px solid rgba(255,255,255,0.08)' 
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Package size={15} color="var(--primary)" /> Stock de Insumos en Vivo:
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Se descuenta automáticamente al vender
              </span>
            </div>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {inventory.map(inv => {
                const stock = inv.currentStock !== undefined ? inv.currentStock : (inv.totalPurchased || inv.initialQuantity || 0);
                let color = 'var(--success)';
                let bg = 'rgba(16,185,129,0.12)';
                let border = '1px solid rgba(16,185,129,0.3)';

                if (stock <= 0) {
                  color = 'var(--danger)';
                  bg = 'rgba(239,68,68,0.15)';
                  border = '1px solid rgba(239,68,68,0.4)';
                } else if (stock <= 10) {
                  color = 'var(--warning)';
                  bg = 'rgba(245,158,11,0.15)';
                  border = '1px solid rgba(245,158,11,0.4)';
                }

                return (
                  <div 
                    key={inv.id}
                    style={{ 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      gap: '0.35rem', 
                      padding: '0.25rem 0.65rem', 
                      borderRadius: '16px', 
                      backgroundColor: bg, 
                      border,
                      color, 
                      fontSize: '0.8rem',
                      fontWeight: 'bold'
                    }}
                  >
                    <span>{inv.name}:</span>
                    <span>{stock} {inv.unit}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <h3 style={{ marginBottom: '1.25rem', color: 'var(--primary)' }}>Productos Disponibles</h3>
        {items.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No hay productos en el menú.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '1rem' }}>
            {items.map(item => {
              const stockInfo = getItemStockInfo(item);
              const isOutOfStock = stockInfo.hasStockLimit && stockInfo.availableUnits <= 0;
              const isLowStock = stockInfo.hasStockLimit && stockInfo.availableUnits <= 10 && stockInfo.availableUnits > 0;

              return (
                <div 
                  key={item.id} 
                  onClick={() => !isOutOfStock && handleItemClick(item)}
                  style={{ 
                    backgroundColor: isOutOfStock ? 'rgba(255,255,255,0.02)' : 'rgba(99,102,241,0.1)', 
                    border: isOutOfStock ? '1px dashed rgba(239,68,68,0.4)' : isLowStock ? '1px solid var(--warning)' : '1px solid var(--primary)', 
                    borderRadius: 'var(--radius-md)', 
                    padding: '1rem', 
                    textAlign: 'center',
                    cursor: isOutOfStock ? 'not-allowed' : 'pointer',
                    opacity: isOutOfStock ? 0.5 : 1,
                    userSelect: 'none',
                    transition: 'transform 0.1s, opacity 0.2s',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: '115px'
                  }}
                  onMouseDown={(e) => !isOutOfStock && (e.currentTarget.style.transform = 'scale(0.95)')}
                  onMouseUp={(e) => !isOutOfStock && (e.currentTarget.style.transform = 'scale(1)')}
                  onMouseLeave={(e) => !isOutOfStock && (e.currentTarget.style.transform = 'scale(1)')}
                >
                  <div>
                    <strong style={{ display: 'block', marginBottom: '0.25rem', fontSize: '1rem', color: isOutOfStock ? 'var(--text-muted)' : 'var(--text-main)' }}>
                      {item.name}
                    </strong>
                    <span style={{ color: isOutOfStock ? 'var(--text-muted)' : 'var(--primary)', fontWeight: 'bold' }}>
                      {formatMoney(item.price)}
                    </span>
                  </div>

                  {stockInfo.hasStockLimit && (
                    <div style={{ marginTop: '0.5rem' }}>
                      {isOutOfStock ? (
                        <span style={{ 
                          display: 'inline-block',
                          backgroundColor: 'rgba(239,68,68,0.2)', 
                          color: 'var(--danger)', 
                          padding: '2px 8px', 
                          borderRadius: '10px', 
                          fontSize: '0.75rem', 
                          fontWeight: 'bold' 
                        }}>
                          AGOTADO (0 disp.)
                        </span>
                      ) : (
                        <span style={{ 
                          display: 'inline-block',
                          backgroundColor: isLowStock ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)', 
                          color: isLowStock ? 'var(--warning)' : 'var(--success)', 
                          padding: '2px 8px', 
                          borderRadius: '10px', 
                          fontSize: '0.75rem', 
                          fontWeight: 'bold' 
                        }}>
                          {stockInfo.availableUnits} disp. {isLowStock && '⚠️'}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
            onClick={handleCompleteSaleClick}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h4 style={{ margin: 0, color: 'var(--text-muted)' }}>
            Últimas Ventas Emitidas {cashierFilter !== 'all' && `(Cajero: ${cashierFilter})`}
          </h4>

          {Array.from(new Set(sales.map(s => s.cashierName || s.createdBy || 'General'))).filter(Boolean).length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Filtrar por Cajero:</label>
              <select 
                className="input-field" 
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: 'auto' }}
                value={cashierFilter}
                onChange={(e) => setCashierFilter(e.target.value)}
              >
                <option value="all">Todos los cajeros ({sales.length})</option>
                {Array.from(new Set(sales.map(s => s.cashierName || s.createdBy || 'General'))).filter(Boolean).map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {sales.filter(s => cashierFilter === 'all' || (s.cashierName || s.createdBy || 'General') === cashierFilter).length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No hay ventas registradas con este filtro.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}># Ticket</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Hora</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Cajero/a</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Cliente</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Ítems</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Total</th>
                  <th style={{ textAlign: 'center', padding: '0.5rem' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {sales
                  .filter(s => cashierFilter === 'all' || (s.cashierName || s.createdBy || 'General') === cashierFilter)
                  .slice(0, 15)
                  .map(sale => {
                    const isCancelled = sale.status === 'cancelled';
                    return (
                      <tr key={sale.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: isCancelled ? 0.5 : 1 }}>
                        <td style={{ padding: '0.5rem', textDecoration: isCancelled ? 'line-through' : 'none' }}>{sale.correlative}</td>
                        <td style={{ padding: '0.5rem', textDecoration: isCancelled ? 'line-through' : 'none' }}>{new Date(sale.createdAt).toLocaleTimeString('es-CL')}</td>
                        <td style={{ padding: '0.5rem', textDecoration: isCancelled ? 'line-through' : 'none' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 'bold' }}>
                            {sale.cashierName || sale.createdBy || 'General'}
                          </span>
                        </td>
                        <td style={{ padding: '0.5rem', textDecoration: isCancelled ? 'line-through' : 'none' }}>
                          {sale.clientName || 'General'}
                          {isCancelled && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', backgroundColor: 'var(--danger)', color: 'white', padding: '2px 4px', borderRadius: '4px' }}>ANULADA</span>}
                        </td>
                        <td style={{ padding: '0.5rem', color: 'var(--text-muted)', textDecoration: isCancelled ? 'line-through' : 'none' }}>
                          {sale.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                        </td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 'bold', color: isCancelled ? 'var(--text-muted)' : 'var(--success)', textDecoration: isCancelled ? 'line-through' : 'none' }}>
                          {formatMoney(sale.total)}
                        </td>
                        <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                          {!isCancelled && (
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                              <button 
                                onClick={() => { setLastSale(sale); setTimeout(() => window.print(), 200); }} 
                                className="btn btn-outline"
                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                title="Reimprimir"
                              >
                                <Printer size={14} />
                              </button>
                              <button 
                                onClick={() => handleDeleteSale(sale)} 
                                className="btn btn-outline"
                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(239, 68, 68, 0.3)', color: 'var(--danger)' }}
                                title="Anular Venta"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default EventPOS;
