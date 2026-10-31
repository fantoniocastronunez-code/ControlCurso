import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { db } from '../../../firebase/config';
import { collection, getDocs, doc, setDoc, query, where, orderBy, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { ShoppingCart, Plus, Minus, Trash2, Printer, Maximize, Minimize, Check, Package, AlertTriangle, UserCheck, Users, RefreshCw, Settings, ChefHat, Camera, Banknote, Calculator, Search, X, Edit2 } from 'lucide-react';
import { useModal } from '../../../context/ModalContext';
import { useAuth } from '../../../context/AuthContext';
import ThermalReceipt from './ThermalReceipt';
import PrinterSettingsModal from '../PrinterSettingsModal';
import ComandasQRModal from '../ComandasQRModal';
import QRScannerModal from '../QRScannerModal';
import PettyCashModal from '../PettyCashModal';
import CashReconciliationModal from '../CashReconciliationModal';
import {
  getPrinterConfig,
  buildSaleReceiptPayload,
  buildTestReceiptPayload,
  printViaRawBT,
  printViaWebBluetooth
} from '../../../utils/thermalPrinterService';
import {
  calculateTotalDeductions,
  resolveSubproductDeductions,
  getSubproductStockInfo
} from '../../../utils/inventoryDeductions';

const EventPOS = ({ event, onNavigateTab }) => {
  const { user } = useAuth();
  const { showAlert, showConfirm } = useModal();
  const [items, setItems] = useState([]);
  const [sales, setSales] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fullscreen State
  const posContainerRef = useRef(null);
  const isPrintingRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);

  // Cajero en turno (Gestión de turnos y relevos de caja)
  const [cashierName, setCashierName] = useState(() => localStorage.getItem(`event_cashier_${event.id}`) || '');
  const [showCashierModal, setShowCashierModal] = useState(false);
  const [newCashierInput, setNewCashierInput] = useState('');
  const [cashierFilter, setCashierFilter] = useState('all');
  const [clientNameFilter, setClientNameFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const navigate = useNavigate();
  const [showPrinterModal, setShowPrinterModal] = useState(false);
  const [showComandasModal, setShowComandasModal] = useState(false);
  const [showPettyCashModal, setShowPettyCashModal] = useState(false);
  const [showReconciliationModal, setShowReconciliationModal] = useState(false);
  const [pettyCash, setPettyCash] = useState(null);
  const [showScanner, setShowScanner] = useState(false);

  const handleScanSuccess = (decodedText) => {
    setShowScanner(false);
    let cleanId = decodedText.trim();
    if (cleanId.includes('/entrega/')) {
      cleanId = cleanId.split('/entrega/')[1].split('?')[0].split('#')[0].trim();
    }
    cleanId = cleanId.replace('#', '').trim();
    navigate(`/entrega/${cleanId}`);
  };

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
    let unsubscribeSales = () => {};
    let unsubscribePettyCash = () => {};

    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch menu items
        const qItems = query(collection(db, 'eventItems'), where('eventId', '==', event.id));
        const snapItems = await getDocs(qItems);
        const itemsList = snapItems.docs.map(d => ({ id: d.id, ...d.data() }));
        itemsList.sort((a, b) => a.name.localeCompare(b.name));
        setItems(itemsList);

        // Suscripción en tiempo real a las ventas para sincronizar con la cocina (Comandas)
        const qSales = query(collection(db, 'eventSales'), where('eventId', '==', event.id));
        unsubscribeSales = onSnapshot(qSales, (snapSales) => {
          const salesList = snapSales.docs.map(d => ({ id: d.id, ...d.data() }));
          salesList.sort((a, b) => (b.correlative || 0) - (a.correlative || 0));
          setSales(salesList);
        });

        // Suscripción en tiempo real a la Caja Chica (Fondo Inicial)
        const pettyDocRef = doc(db, 'eventPettyCash', `petty_${event.id}`);
        unsubscribePettyCash = onSnapshot(pettyDocRef, (snapDoc) => {
          if (snapDoc.exists()) {
            setPettyCash({ id: snapDoc.id, ...snapDoc.data() });
          } else {
            setPettyCash(null);
          }
        }, (err) => {
          console.warn("Listener Caja Chica:", err);
        });

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

    return () => {
      unsubscribeSales();
      unsubscribePettyCash();
    };
  }, [event.id]);

  // Manejo de Pantalla Completa y sincronización con el navegador
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNative = Boolean(document.fullscreenElement);
      setIsNativeFullscreen(isNative);

      // Si el navegador salió de pantalla completa debido a una impresión externa (RawBT),
      // mantenemos el modo POS inmersivo para que el cajero no pierda su pantalla
      if (isPrintingRef.current) return;

      // Si el usuario salió manualmente (ej. tecla ESC o botón del navegador), salimos del modo POS
      if (!isNative) {
        setIsFullscreen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        exitFullscreenMode();
      }
    };

    const handleClearPrintingFlag = () => {
      setTimeout(() => {
        isPrintingRef.current = false;
        setIsNativeFullscreen(Boolean(document.fullscreenElement));
      }, 1800);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('afterprint', handleClearPrintingFlag);
    window.addEventListener('focus', handleClearPrintingFlag);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('afterprint', handleClearPrintingFlag);
      window.removeEventListener('focus', handleClearPrintingFlag);
    };
  }, []);

  const enterFullscreenMode = () => {
    setIsFullscreen(true);
    setIsNativeFullscreen(true);
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const exitFullscreenMode = () => {
    setIsFullscreen(false);
    setIsNativeFullscreen(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleContainerClick = (e) => {
    // Si estamos en modo POS pero el navegador perdió la pantalla completa nativa (ej. tras imprimir en RawBT),
    // reanudamos la pantalla completa nativa en el primer toque del usuario (excepto si hizo click en un botón/input)
    if (isFullscreen && !document.fullscreenElement && !e.target.closest('button') && !e.target.closest('input') && !e.target.closest('select')) {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }
  };

  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

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

  // Comprobar si hay stock de insumos suficiente considerando lo que ya está en el carrito (incluye receta base y agregados)
  const canAddUnitsToCart = (item, additionalUnits = 1, selectedSp = []) => {
    // 1. Insumos del ítem base
    const baseIngredients = item.ingredients || [];
    // 2. Insumos de los agregados
    const spDeductions = (selectedSp || []).flatMap(sp => 
      resolveSubproductDeductions(sp, item, inventory, items)
    );

    const neededPerUnit = {};
    baseIngredients.forEach(ing => {
      if (ing.inventoryId) {
        neededPerUnit[ing.inventoryId] = (neededPerUnit[ing.inventoryId] || 0) + (parseFloat(ing.quantity) || 0);
      }
    });
    spDeductions.forEach(d => {
      if (d.inventoryId) {
        neededPerUnit[d.inventoryId] = (neededPerUnit[d.inventoryId] || 0) + (parseFloat(d.quantity) || 1);
      }
    });

    if (Object.keys(neededPerUnit).length === 0) {
      return { ok: true };
    }

    const currentCommitted = calculateTotalDeductions(cart, inventory, items);

    for (const [invId, qtyNeededPerUnit] of Object.entries(neededPerUnit)) {
      const invItem = inventory.find(i => i.id === invId);
      const stock = invItem ? (invItem.currentStock || 0) : 0;
      const alreadyCommitted = currentCommitted[invId] || 0;
      const totalNeeded = alreadyCommitted + (qtyNeededPerUnit * additionalUnits);

      if (totalNeeded > stock) {
        return {
          ok: false,
          ingredientName: invItem?.name || 'Insumo',
          availableStock: Math.max(0, stock - alreadyCommitted),
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

    if (item.subproducts && item.subproducts.length > 0) {
      setSelectedItemForSubproducts(item);
      setSelectedSubproducts([]);
      setShowSubproductModal(true);
    } else {
      const check = canAddUnitsToCart(item, 1, []);
      if (!check.ok) {
        showAlert(`Stock insuficiente de "${check.ingredientName}". Solo quedan ${check.availableStock} ${check.unit} disponibles.`);
        return;
      }
      addToCart(item, []);
    }
  };

  const addToCart = (item, selectedSp) => {
    const check = canAddUnitsToCart(item, 1, selectedSp);
    if (!check.ok) {
      showAlert(`Stock insuficiente de "${check.ingredientName}". Solo quedan ${check.availableStock} ${check.unit} disponibles.`);
      return;
    }

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
        const check = canAddUnitsToCart(cartItem, delta, cartItem.selectedSubproducts || []);
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

      // Calcular deducciones de inventario según insumos del producto y de sus agregados (ej. té, bebidas, etc.)
      const deductions = calculateTotalDeductions(cart, inventory, items);

      const activeCashier = (cashierName.trim() || user?.displayName || user?.email?.split('@')[0] || 'Cajero').trim();
      if (!cashierName.trim()) {
        setCashierName(activeCashier);
        localStorage.setItem(`event_cashier_${event.id}`, activeCashier);
      }

      const saleId = 'sale_' + Date.now();
      const newSale = {
        id: saleId,
        eventId: event.id,
        isTest: Boolean(event.isTestEvent),
        correlative: nextCorrelative,
        clientName: clientName.trim(),
        saleNote: saleNote.trim(),
        cashierName: activeCashier,
        cashierEmail: user?.email || '',
        paymentMethod,
        items: cart,
        inventoryDeductions: deductions,
        total: cartTotal,
        orderStatus: 'pending',
        kitchenStatus: 'pending',
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
        isTest: Boolean(event.isTestEvent),
        createdAt: new Date().toISOString(),
        createdBy: user?.email || user?.displayName || 'Unknown User'
      });

      // Actualizar estado local
      setSales([{ id: saleId, ...newSale }, ...sales]);
      setLastSale(newSale); // Para imprimir

      // Limpiar carrito
      setCart([]);
      setClientName('');
      setSaleNote('');
      setPaymentMethod('cash');

      // Disparar impresión según el método configurado
      isPrintingRef.current = true;
      const printMode = getPrinterConfig();
      if (printMode === 'rawbt') {
        printViaRawBT(buildSaleReceiptPayload(newSale, event.name));
      } else if (printMode === 'bluetooth') {
        try {
          await printViaWebBluetooth(buildSaleReceiptPayload(newSale, event.name));
        } catch (err) {
          console.warn("Fallo bluetooth directo, usando ventana de impresión:", err);
          setTimeout(() => {
            window.print();
          }, 300);
        }
      } else {
        setTimeout(() => {
          window.print();
        }, 300);
      }

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
      let deductionsToRestore = sale.inventoryDeductions || {};
      // Si la venta no tenía inventoryDeductions guardadas explícitamente, calcular de sus items y agregados
      if (Object.keys(deductionsToRestore).length === 0 && sale.items && Array.isArray(sale.items)) {
        deductionsToRestore = calculateTotalDeductions(sale.items, inventory, items);
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

  const handleChangePaymentMethod = async (sale) => {
    if (sale.status === 'cancelled') return;
    const currentMethod = sale.paymentMethod || 'cash';
    const newMethod = currentMethod === 'cash' ? 'transfer' : 'cash';
    const newMethodLabel = newMethod === 'cash' ? 'Efectivo' : 'Transferencia';
    const confirm = await showConfirm(
      `¿Deseas cambiar el medio de pago del ticket #${sale.correlative} (${sale.clientName || 'General'}) a ${newMethodLabel}?`
    );
    if (!confirm) return;

    try {
      await updateDoc(doc(db, 'eventSales', sale.id), {
        paymentMethod: newMethod,
        updatedAt: new Date().toISOString()
      });

      // Actualizar también en incomes si existe ingreso asociado
      const qIncome = query(collection(db, 'incomes'), where('saleId', '==', sale.id));
      const snapIncome = await getDocs(qIncome);
      for (const docSnap of snapIncome.docs) {
        await updateDoc(doc(db, 'incomes', docSnap.id), { paymentMethod: newMethod });
      }

      setSales(prev => prev.map(s => s.id === sale.id ? { ...s, paymentMethod: newMethod } : s));
      await showAlert(`Medio de pago del ticket #${sale.correlative} actualizado a ${newMethodLabel}.`);
    } catch (err) {
      console.error("Error al actualizar medio de pago:", err);
      await showAlert("Error al cambiar medio de pago: " + err.message);
    }
  };

  const handleEditSaleNote = async (sale) => {
    if (sale.status === 'cancelled') return;
    const currentNote = sale.saleNote || '';
    const newNote = window.prompt(`Editar nota del ticket #${sale.correlative} (${sale.clientName || 'General'}):`, currentNote);
    if (newNote === null || newNote === currentNote) return;

    try {
      await updateDoc(doc(db, 'eventSales', sale.id), {
        saleNote: newNote.trim(),
        updatedAt: new Date().toISOString()
      });
      setSales(prev => prev.map(s => s.id === sale.id ? { ...s, saleNote: newNote.trim() } : s));
    } catch (err) {
      console.error("Error al actualizar nota:", err);
      alert("Error al actualizar nota: " + err.message);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const activeCashierDisplayName = cashierName.trim() || user?.displayName || user?.email?.split('@')[0] || 'Cajero General';
  const shiftSales = sales.filter(s => s.status !== 'cancelled' && (s.cashierName || s.createdBy) === activeCashierDisplayName);
  const shiftSalesCount = shiftSales.length;
  const shiftSalesTotal = shiftSales.reduce((sum, s) => sum + (s.total || 0), 0);

  // Cálculos de Caja Chica y Efectivo en Caja
  const validSales = sales.filter(s => s.status !== 'cancelled');
  const cashSalesTotal = validSales.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + (s.total || 0), 0);
  const transferSalesTotal = validSales.filter(s => s.paymentMethod === 'transfer').reduce((sum, s) => sum + (s.total || 0), 0);
  const totalSalesAmount = validSales.reduce((sum, s) => sum + (s.total || 0), 0);
  const pettyCashTotal = pettyCash?.total || 0;
  const expectedTotalCashInDrawer = pettyCashTotal + cashSalesTotal;

  // Filtrado de ventas (por Cajero, Medio de Pago y Nombre de Cliente / Nota / #Ticket)
  const filteredSales = sales.filter(s => {
    if (cashierFilter !== 'all' && (s.cashierName || s.createdBy || 'General') !== cashierFilter) {
      return false;
    }
    if (paymentFilter !== 'all' && s.paymentMethod !== paymentFilter) {
      return false;
    }
    if (clientNameFilter.trim()) {
      const term = clientNameFilter.toLowerCase().trim();
      const name = (s.clientName || '').toLowerCase();
      const note = (s.saleNote || '').toLowerCase();
      const corr = String(s.correlative || '');
      const items = Array.isArray(s.items) ? s.items.map(i => (i.name || '').toLowerCase()).join(' ') : '';
      return name.includes(term) || note.includes(term) || corr.includes(term) || items.includes(term);
    }
    return true;
  });

  const isFilteringActive = Boolean(clientNameFilter.trim() || paymentFilter !== 'all' || cashierFilter !== 'all');
  const displayedSales = isFilteringActive ? filteredSales.slice(0, 50) : filteredSales.slice(0, 15);

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

  const handlePrintTestTicket = async () => {
    isPrintingRef.current = true;
    const printMode = getPrinterConfig();
    if (printMode === 'rawbt') {
      printViaRawBT(buildTestReceiptPayload(event.name, activeCashierDisplayName));
    } else if (printMode === 'bluetooth') {
      try {
        await printViaWebBluetooth(buildTestReceiptPayload(event.name, activeCashierDisplayName));
      } catch (err) {
        console.warn("Fallo bluetooth directo:", err);
        setLastSale({
          isTestTicket: true,
          correlative: 'PRUEBA',
          createdAt: new Date().toISOString(),
          cashierName: activeCashierDisplayName,
          total: 0,
          items: []
        });
        setTimeout(() => window.print(), 200);
      }
    } else {
      setLastSale({
        isTestTicket: true,
        correlative: 'PRUEBA',
        createdAt: new Date().toISOString(),
        cashierName: activeCashierDisplayName,
        total: 0,
        items: []
      });
      setTimeout(() => window.print(), 200);
    }
  };

  const handleReprintSale = async (sale) => {
    isPrintingRef.current = true;
    const printMode = getPrinterConfig();
    if (printMode === 'rawbt') {
      printViaRawBT(buildSaleReceiptPayload(sale, event.name));
    } else if (printMode === 'bluetooth') {
      try {
        await printViaWebBluetooth(buildSaleReceiptPayload(sale, event.name));
      } catch (err) {
        console.warn("Fallo bluetooth directo:", err);
        setLastSale(sale);
        setTimeout(() => window.print(), 200);
      }
    } else {
      setLastSale(sale);
      setTimeout(() => window.print(), 200);
    }
  };

  if (loading) return <div>Cargando Punto de Venta...</div>;

  const posContent = (
    <div
      ref={posContainerRef}
      onClick={handleContainerClick}
      style={isFullscreen ? {
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 99999,
        backgroundColor: '#0f172a',
        backgroundImage: 'radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.15) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(236, 72, 153, 0.1) 0px, transparent 50%)',
        padding: '1.25rem',
        overflowY: 'auto',
        boxSizing: 'border-box'
      } : {
        position: 'relative',
        backgroundColor: 'transparent',
        padding: '0',
        minHeight: 'auto'
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

          {/* Badge de Efectivo Físico Esperado en Caja */}
          <div
            onClick={() => setShowPettyCashModal(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10b981',
              padding: '0.35rem 0.85rem',
              borderRadius: '20px',
              cursor: 'pointer'
            }}
            title="Total de efectivo que debe haber físicamente en caja (Caja Chica + Ventas Efectivo). Haz clic para abrir el arqueo."
          >
            <Calculator size={15} color="#10b981" />
            <span style={{ fontSize: '0.8rem', color: '#a7f3d0' }}>Efectivo en Caja:</span>
            <strong style={{ fontSize: '0.9rem', color: '#10b981' }}>{formatMoney(expectedTotalCashInDrawer)}</strong>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {event.isTestEvent && (
            <span style={{ backgroundColor: 'var(--warning)', color: '#000', padding: '0.25rem 0.65rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' }}>
              🧪 MODO PRUEBA
            </span>
          )}

          {/* Botón de Gestión de Caja Chica */}
          <button
            type="button"
            onClick={() => setShowPettyCashModal(true)}
            className="btn btn-outline"
            style={{ 
              padding: '0.4rem 0.75rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.35rem', 
              fontSize: '0.8rem',
              borderColor: pettyCashTotal > 0 ? '#10b981' : '#f59e0b',
              color: pettyCashTotal > 0 ? '#6ee7b7' : '#fcd34d',
              backgroundColor: pettyCashTotal > 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)'
            }}
            title="Ingreso de billetes y monedas de la Caja Chica (Fondo Inicial) y Arqueo de Efectivo"
          >
            <Banknote size={15} />
            <span>{pettyCashTotal > 0 ? `Caja Chica (${formatMoney(pettyCashTotal)})` : 'Ingresar Caja Chica'}</span>
          </button>

          {/* Botón para Cuadrar Efectivo Final en Caja */}
          <button
            type="button"
            onClick={() => {
              if (onNavigateTab) {
                if (isFullscreen) {
                  exitFullscreenMode();
                }
                onNavigateTab('reconciliation');
              } else {
                setShowReconciliationModal(true);
              }
            }}
            className="btn btn-outline"
            style={{
              padding: '0.4rem 0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.8rem',
              borderColor: '#10b981',
              color: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              fontWeight: '600'
            }}
            title="Ir a la sección Cuadrar Caja para ver todas las ventas y conciliar pagos"
          >
            <Calculator size={15} />
            <span>{pettyCash?.closingAudit ? 'Ver Cuadratura' : 'Cuadrar Caja'}</span>
          </button>

          <button
            type="button"
            onClick={handlePrintTestTicket}
            className="btn btn-outline"
            style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', borderColor: 'var(--warning)', color: 'var(--warning)' }}
            title="Mandar ticket de prueba a la impresora térmica"
          >
            <Printer size={15} /> Probar Impresora
          </button>

          <button
            type="button"
            onClick={() => setShowPrinterModal(true)}
            className="btn btn-outline"
            style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}
            title="Configurar método de impresión térmica (Automático Android, Bluetooth, Navegador)"
          >
            <Settings size={15} /> Impresora
          </button>

          <button
            type="button"
            onClick={() => setShowComandasModal(true)}
            className="btn btn-outline"
            style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', borderColor: '#f59e0b', color: '#f59e0b' }}
            title="Abrir código QR para pantalla de comandas y cocina"
          >
            <ChefHat size={15} /> Comandas (QR)
          </button>

          {isFullscreen ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {!isNativeFullscreen && (
                <button
                  type="button"
                  onClick={enterFullscreenMode}
                  className="btn btn-primary"
                  style={{
                    padding: '0.4rem 0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    fontSize: '0.8rem'
                  }}
                  title="Reanudar pantalla completa en el navegador"
                >
                  <Maximize size={15} />
                  <span>Pantalla Completa</span>
                </button>
              )}
              <button
                type="button"
                onClick={exitFullscreenMode}
                className="btn btn-outline"
                style={{ 
                  padding: '0.4rem 0.75rem', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.4rem', 
                  fontSize: '0.8rem',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  borderColor: 'rgba(255, 255, 255, 0.2)'
                }}
                title="Volver a la vista normal con pestañas"
              >
                <Minimize size={15} />
                <span>Salir de Pantalla Completa</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={enterFullscreenMode}
              className="btn btn-outline"
              style={{ 
                padding: '0.4rem 0.75rem', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.4rem', 
                fontSize: '0.8rem'
              }}
              title="Entrar a Pantalla Completa"
            >
              <Maximize size={16} />
              <span>Pantalla Completa</span>
            </button>
          )}
        </div>
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

                // Stock check para subproducto sin opciones (ej. "Té" directo o "Palta extra")
                const spStockInfo = !hasOptions 
                  ? getSubproductStockInfo(sp, null, selectedItemForSubproducts, inventory, items) 
                  : null;
                const isSpOutOfStock = spStockInfo?.hasStockLimit && spStockInfo.availableStock <= 0;

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
                      cursor: isSpOutOfStock ? 'not-allowed' : 'pointer', userSelect: 'none'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <input
                          type="checkbox"
                          disabled={isSpOutOfStock}
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              if (isSpOutOfStock) return;
                              const firstAvailOpt = hasOptions 
                                ? (sp.options.find(opt => {
                                    const st = getSubproductStockInfo(sp, opt, selectedItemForSubproducts, inventory, items);
                                    return !st.hasStockLimit || st.availableStock > 0;
                                  }) || sp.options[0])
                                : null;
                              const defaultOptionName = firstAvailOpt ? (typeof firstAvailOpt === 'string' ? firstAvailOpt : firstAvailOpt.name) : null;
                              const defaultOptionInvId = typeof firstAvailOpt === 'object' ? firstAvailOpt.inventoryId : (sp.inventoryId || null);
                              const defaultOptionQty = typeof firstAvailOpt === 'object' ? (firstAvailOpt.quantity || 1) : (sp.quantity || 1);
                              const displayName = defaultOptionName ? `${sp.name} (${defaultOptionName})` : sp.name;

                              setSelectedSubproducts([
                                ...selectedSubproducts,
                                {
                                  baseName: sp.name,
                                  name: displayName,
                                  selectedOption: defaultOptionName,
                                  inventoryId: defaultOptionInvId,
                                  quantity: defaultOptionQty,
                                  price: parseFloat(sp.price || 0)
                                }
                              ]);
                            } else {
                              setSelectedSubproducts(selectedSubproducts.filter(s => s.baseName !== sp.name && s.name !== sp.name));
                            }
                          }}
                          style={{ accentColor: 'var(--primary)', width: '18px', height: '18px' }}
                        />
                        <span style={{ fontWeight: isSelected ? '600' : 'normal', color: isSpOutOfStock ? 'var(--text-muted)' : 'var(--text-main)' }}>
                          {sp.name}
                          {spStockInfo?.hasStockLimit && (
                            <span style={{ 
                              fontSize: '0.75rem', 
                              marginLeft: '0.4rem', 
                              color: isSpOutOfStock ? 'var(--danger)' : 'var(--success)',
                              fontWeight: '500'
                            }}>
                              {isSpOutOfStock ? '(Agotado)' : `(${spStockInfo.availableStock} disp.)`}
                            </span>
                          )}
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
                            const optName = typeof opt === 'string' ? opt : opt.name;
                            const optStockInfo = getSubproductStockInfo(sp, opt, selectedItemForSubproducts, inventory, items);
                            const isOutOfStock = optStockInfo.hasStockLimit && optStockInfo.availableStock <= 0;
                            const isOptActive = currentSelection.selectedOption === optName;

                            return (
                              <button
                                key={optIdx}
                                type="button"
                                disabled={isOutOfStock}
                                onClick={() => {
                                  if (isOutOfStock) return;
                                  setSelectedSubproducts(selectedSubproducts.map(s => {
                                    if (s.baseName === sp.name || s.name.startsWith(sp.name)) {
                                      return {
                                        ...s,
                                        baseName: sp.name,
                                        name: `${sp.name} (${optName})`,
                                        selectedOption: optName,
                                        inventoryId: typeof opt === 'object' ? opt.inventoryId : null,
                                        quantity: typeof opt === 'object' ? (opt.quantity || 1) : 1
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
                                  border: isOptActive 
                                    ? '1px solid var(--primary)' 
                                    : isOutOfStock 
                                      ? '1px solid rgba(239, 68, 68, 0.3)' 
                                      : '1px solid rgba(255,255,255,0.15)',
                                  backgroundColor: isOptActive 
                                    ? 'var(--primary)' 
                                    : isOutOfStock 
                                      ? 'rgba(239, 68, 68, 0.08)' 
                                      : 'rgba(255,255,255,0.05)',
                                  color: isOptActive 
                                    ? '#ffffff' 
                                    : isOutOfStock 
                                      ? 'var(--text-muted)' 
                                      : 'var(--text-main)',
                                  opacity: isOutOfStock ? 0.6 : 1,
                                  cursor: isOutOfStock ? 'not-allowed' : 'pointer',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                {isOptActive && <Check size={12} />}
                                <span>{optName}</span>
                                {optStockInfo.hasStockLimit && (
                                  <span style={{ 
                                    fontSize: '0.7rem', 
                                    opacity: 0.85, 
                                    color: isOutOfStock ? 'var(--danger)' : isOptActive ? '#ffffff' : 'var(--success)' 
                                  }}>
                                    {isOutOfStock ? '(Agotado)' : `(${optStockInfo.availableStock})`}
                                  </span>
                                )}
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

      {/* Contenedor Principal en 2 Columnas (Izquierda: Catálogo + Historial | Derecha: Carrito) */}
      <div style={{
        width: '100%',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: '1.5rem',
        alignItems: 'start',
        marginTop: isFullscreen ? '1rem' : '1.5rem'
      }}>
        {/* Columna Izquierda: Insumos + Catálogo de Productos + Historial de Ventas */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>

          {/* Barra en vivo de Stock de Insumos */}
          {inventory.length > 0 && (
            <div style={{
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

          {/* Catálogo de Productos Disponibles */}
          <div>
            <h3 style={{ marginBottom: '1rem', color: 'var(--primary)' }}>Productos Disponibles</h3>
            {items.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No hay productos en el menú.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.75rem' }}>
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
                        padding: '0.85rem',
                        textAlign: 'center',
                        cursor: isOutOfStock ? 'not-allowed' : 'pointer',
                        opacity: isOutOfStock ? 0.5 : 1,
                        userSelect: 'none',
                        transition: 'transform 0.1s, opacity 0.2s',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        minHeight: '105px'
                      }}
                      onMouseDown={(e) => !isOutOfStock && (e.currentTarget.style.transform = 'scale(0.96)')}
                      onMouseUp={(e) => !isOutOfStock && (e.currentTarget.style.transform = 'scale(1)')}
                      onMouseLeave={(e) => !isOutOfStock && (e.currentTarget.style.transform = 'scale(1)')}
                    >
                      <div>
                        <strong style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.92rem', color: isOutOfStock ? 'var(--text-muted)' : 'var(--text-main)' }}>
                          {item.name}
                        </strong>
                        <span style={{ color: isOutOfStock ? 'var(--text-muted)' : 'var(--primary)', fontWeight: 'bold', fontSize: '0.95rem' }}>
                          {formatMoney(item.price)}
                        </span>
                      </div>

                      {stockInfo.hasStockLimit && (
                        <div style={{ marginTop: '0.4rem' }}>
                          {isOutOfStock ? (
                            <span style={{
                              display: 'inline-block',
                              backgroundColor: 'rgba(239,68,68,0.2)',
                              color: 'var(--danger)',
                              padding: '2px 6px',
                              borderRadius: '8px',
                              fontSize: '0.7rem',
                              fontWeight: 'bold'
                            }}>
                              AGOTADO
                            </span>
                          ) : (
                            <span style={{
                              display: 'inline-block',
                              backgroundColor: isLowStock ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)',
                              color: isLowStock ? 'var(--warning)' : 'var(--success)',
                              padding: '2px 6px',
                              borderRadius: '8px',
                              fontSize: '0.7rem',
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

          {/* Historial rápido (Directamente visible bajo los productos) */}
          <div className="glass-panel" style={{ padding: '1.25rem', minWidth: 0, marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.65rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h4 style={{ margin: 0, color: 'var(--text-main)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>Ventas Emitidas</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                    ({filteredSales.length}{filteredSales.length !== sales.length ? ` de ${sales.length}` : ''})
                  </span>
                </h4>
              </div>

              {/* Controles de Filtros: Búsqueda por Nombre/Nota + Medio de Pago + Cajero */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end' }}>
                {/* Buscador por Nombre de Cliente / Nota / Ticket */}
                <div style={{ position: 'relative', minWidth: '190px', maxWidth: '280px', flex: 1 }}>
                  <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    value={clientNameFilter}
                    onChange={(e) => setClientNameFilter(e.target.value)}
                    placeholder="Filtrar por nombre o nota..."
                    className="input-field"
                    style={{ padding: '0.25rem 1.6rem 0.25rem 2rem', fontSize: '0.78rem', width: '100%' }}
                  />
                  {clientNameFilter && (
                    <button
                      type="button"
                      onClick={() => setClientNameFilter('')}
                      style={{ position: 'absolute', right: '0.4rem', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                      title="Limpiar búsqueda"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Filtro Medio de Pago */}
                <select
                  className="input-field"
                  style={{ padding: '0.25rem 0.4rem', fontSize: '0.75rem', width: 'auto' }}
                  value={paymentFilter}
                  onChange={(e) => setPaymentFilter(e.target.value)}
                  title="Filtrar por método de pago"
                >
                  <option value="all">Pago: Todos</option>
                  <option value="cash">Solo Efectivo</option>
                  <option value="transfer">Solo Transferencia</option>
                </select>

                {/* Filtro Cajero */}
                {Array.from(new Set(sales.map(s => s.cashierName || s.createdBy || 'General'))).filter(Boolean).length > 1 && (
                  <select
                    className="input-field"
                    style={{ padding: '0.25rem 0.4rem', fontSize: '0.75rem', width: 'auto' }}
                    value={cashierFilter}
                    onChange={(e) => setCashierFilter(e.target.value)}
                    title="Filtrar por cajero"
                  >
                    <option value="all">Cajero: Todos</option>
                    {Array.from(new Set(sales.map(s => s.cashierName || s.createdBy || 'General'))).filter(Boolean).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}

                {isFilteringActive && (
                  <button
                    type="button"
                    onClick={() => {
                      setClientNameFilter('');
                      setPaymentFilter('all');
                      setCashierFilter('all');
                    }}
                    className="btn btn-outline"
                    style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', color: '#fca5a5', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                    title="Limpiar todos los filtros"
                  >
                    Limpiar
                  </button>
                )}

                {onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isFullscreen) exitFullscreenMode();
                      onNavigateTab('reconciliation');
                    }}
                    className="btn btn-outline"
                    style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', color: '#6ee7b7', borderColor: 'rgba(16, 185, 129, 0.4)', backgroundColor: 'rgba(16, 185, 129, 0.08)' }}
                    title="Abrir la sección completa de Cuadrar Caja con todas las ventas"
                  >
                    Abrir Cuadrar Caja ↗
                  </button>
                )}
              </div>
            </div>

            {displayedSales.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '10px' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 0.5rem 0' }}>
                  {clientNameFilter.trim() 
                    ? `No se encontraron ventas para "${clientNameFilter}".`
                    : 'No hay ventas registradas con los filtros seleccionados.'}
                </p>
                {isFilteringActive && (
                  <button
                    type="button"
                    onClick={() => {
                      setClientNameFilter('');
                      setPaymentFilter('all');
                      setCashierFilter('all');
                    }}
                    className="btn btn-outline"
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                  >
                    Mostrar todas las ventas
                  </button>
                )}
              </div>
            ) : (
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      <th style={{ textAlign: 'left', padding: '0.4rem' }}>#</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem' }}>Hora</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem' }}>Cajero/a</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem' }}>Cliente / Nota</th>
                      <th style={{ textAlign: 'center', padding: '0.4rem' }}>Pago</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem' }}>Ítems</th>
                      <th style={{ textAlign: 'center', padding: '0.4rem' }}>Cocina</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem' }}>Total</th>
                      <th style={{ textAlign: 'center', padding: '0.4rem' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedSales.map(sale => {
                      const isCancelled = sale.status === 'cancelled';
                      const isNameMatch = clientNameFilter.trim() && (sale.clientName || '').toLowerCase().includes(clientNameFilter.toLowerCase().trim());
                      const isNoteMatch = clientNameFilter.trim() && (sale.saleNote || '').toLowerCase().includes(clientNameFilter.toLowerCase().trim());

                      return (
                        <tr key={sale.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: isCancelled ? 0.5 : 1 }}>
                          <td style={{ padding: '0.4rem', fontWeight: 'bold' }}>{sale.correlative}</td>
                          <td style={{ padding: '0.4rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                            {new Date(sale.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td style={{ padding: '0.4rem', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: '0.78rem', color: 'var(--primary)', fontWeight: '600' }}>
                              {sale.cashierName || sale.createdBy || 'General'}
                            </span>
                          </td>
                          <td style={{ padding: '0.4rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <strong style={{
                                color: isNameMatch ? '#fcd34d' : '#fff',
                                backgroundColor: isNameMatch ? 'rgba(245, 158, 11, 0.2)' : 'transparent',
                                padding: isNameMatch ? '1px 4px' : '0',
                                borderRadius: '4px',
                                display: 'inline-block',
                                maxWidth: '160px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}>
                                {sale.clientName || 'General'}
                              </strong>
                              {sale.saleNote && (
                                <span style={{
                                  fontSize: '0.72rem',
                                  color: isNoteMatch ? '#fcd34d' : '#fde68a',
                                  backgroundColor: isNoteMatch ? 'rgba(245, 158, 11, 0.25)' : 'transparent',
                                  padding: isNoteMatch ? '1px 4px' : '0',
                                  borderRadius: '4px',
                                  marginTop: '2px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                  maxWidth: '160px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }} title={sale.saleNote}>
                                  📝 {sale.saleNote}
                                </span>
                              )}
                              {isCancelled && <span style={{ marginTop: '2px', fontSize: '0.65rem', backgroundColor: 'var(--danger)', color: 'white', padding: '1px 4px', borderRadius: '4px', width: 'fit-content' }}>ANULADA</span>}
                            </div>
                          </td>
                          <td style={{ padding: '0.4rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button
                              type="button"
                              onClick={() => handleChangePaymentMethod(sale)}
                              style={{
                                padding: '2px 7px',
                                borderRadius: '10px',
                                fontSize: '0.72rem',
                                fontWeight: 'bold',
                                border: `1px solid ${sale.paymentMethod === 'cash' ? '#10b981' : '#6366f1'}`,
                                backgroundColor: sale.paymentMethod === 'cash' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                                color: sale.paymentMethod === 'cash' ? '#6ee7b7' : '#a5b4fc',
                                cursor: !isCancelled ? 'pointer' : 'default',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                              title="Haz clic para cambiar método de pago (Efectivo / Transferencia)"
                            >
                              {sale.paymentMethod === 'cash' 
                                ? '💵 Efectivo' 
                                : sale.transferVerified 
                                  ? '🏦 Transf ✓' 
                                  : '🏦 Transf ⏳'}
                            </button>
                          </td>
                          <td 
                            style={{ 
                              padding: '0.4rem', 
                              color: 'var(--text-muted)', 
                              maxWidth: '180px', 
                              overflow: 'hidden', 
                              textOverflow: 'ellipsis', 
                              whiteSpace: 'nowrap' 
                            }} 
                            title={sale.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                          >
                            {sale.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                          </td>
                          <td style={{ padding: '0.4rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {isCancelled ? (
                              <span style={{ fontSize: '0.72rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', padding: '2px 6px', borderRadius: '10px' }}>
                                Anulada
                              </span>
                            ) : (sale.orderStatus || sale.kitchenStatus) === 'delivered' ? (
                              <span style={{ fontSize: '0.72rem', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '2px 6px', borderRadius: '10px', fontWeight: 'bold' }}>
                                ✓ Entregado
                              </span>
                            ) : (sale.orderStatus || sale.kitchenStatus) === 'preparing' ? (
                              <span style={{ fontSize: '0.72rem', backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '2px 6px', borderRadius: '10px', fontWeight: 'bold' }}>
                                🔥 Preparando
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', backgroundColor: 'rgba(148, 163, 184, 0.15)', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.3)', padding: '2px 6px', borderRadius: '10px' }}>
                                ⏳ Pendiente
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.4rem', textAlign: 'right', fontWeight: 'bold', whiteSpace: 'nowrap', color: isCancelled ? 'var(--text-muted)' : 'var(--success)' }}>
                            {formatMoney(sale.total)}
                          </td>
                          <td style={{ padding: '0.4rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {!isCancelled && (
                              <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => handleEditSaleNote(sale)}
                                  className="btn btn-outline"
                                  style={{ padding: '0.2rem 0.35rem', fontSize: '0.72rem' }}
                                  title="Editar nota del pedido"
                                >
                                  <Edit2 size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReprintSale(sale)}
                                  className="btn btn-outline"
                                  style={{ padding: '0.2rem 0.35rem', fontSize: '0.72rem' }}
                                  title="Reimprimir Ticket"
                                >
                                  <Printer size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSale(sale)}
                                  className="btn btn-outline"
                                  style={{ padding: '0.2rem 0.35rem', fontSize: '0.72rem', borderColor: 'rgba(239, 68, 68, 0.3)', color: 'var(--danger)' }}
                                  title="Anular Venta"
                                >
                                  <Trash2 size={13} />
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

        {/* Columna Derecha: Carrito de Venta Actual (Sticky) */}
        <div className="glass-panel" style={{
          position: 'sticky',
          top: '1rem',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: isFullscreen ? 'calc(100vh - 5rem)' : 'auto',
          overflowY: 'auto'
        }}>
          <h3 style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem' }}>
            <ShoppingCart size={18} /> Venta Actual
          </h3>

          <div style={{ flex: 1, minHeight: '140px', maxHeight: '280px', overflowY: 'auto', marginBottom: '1.25rem' }}>
            {cart.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '2rem', fontSize: '0.9rem' }}>El carrito está vacío.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {cart.map(item => (
                  <div key={item.cartItemId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.5rem' }}>
                    <div style={{ flex: 1 }}>
                      <strong style={{ display: 'block', fontSize: '0.9rem' }}>{item.name}</strong>
                      {item.selectedSubproducts && item.selectedSubproducts.length > 0 && (
                        <div style={{ paddingLeft: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {item.selectedSubproducts.map((sp, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', paddingRight: '0.5rem' }}>
                              <span>+ {sp.name}</span>
                              <span>{formatMoney(sp.price)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.15rem' }}>{formatMoney(item.unitPrice)} c/u</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
                      <button onClick={() => updateQuantity(item.cartItemId, -1)} className="btn btn-outline" style={{ padding: '0.15rem 0.35rem' }}>
                        <Minus size={12} />
                      </button>
                      <span style={{ width: '18px', textAlign: 'center', fontSize: '0.85rem' }}>{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.cartItemId, 1)} className="btn btn-outline" style={{ padding: '0.15rem 0.35rem' }}>
                        <Plus size={12} />
                      </button>
                    </div>

                    <div style={{ width: '70px', textAlign: 'right', fontWeight: 'bold', fontSize: '0.9rem', marginTop: '0.2rem' }}>
                      {formatMoney(item.unitPrice * item.quantity)}
                    </div>

                    <button onClick={() => removeFromCart(item.cartItemId)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', marginLeft: '0.35rem', marginTop: '0.2rem' }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
            <div className="input-group" style={{ marginBottom: '0.75rem' }}>
              <label className="input-label" style={{ fontSize: '0.8rem' }}>Nombre del Cliente (Opcional)</label>
              <input
                type="text"
                className="input-field"
                placeholder="Ej. Familia Pérez"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
              />
            </div>

            <div className="input-group" style={{ marginBottom: '0.75rem' }}>
              <label className="input-label" style={{ fontSize: '0.8rem' }}>Detalle a Imprimir (Opcional)</label>
              <input
                type="text"
                className="input-field"
                placeholder="Ej. Retira en puerta 2, Sin mayo..."
                value={saleNote}
                onChange={(e) => setSaleNote(e.target.value)}
                style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
              />
            </div>

            <div className="input-group" style={{ marginBottom: '1rem' }}>
              <label className="input-label" style={{ fontSize: '0.8rem' }}>Medio de Pago</label>
              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="cash"
                    checked={paymentMethod === 'cash'}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    style={{ accentColor: 'var(--primary)' }}
                  /> Efectivo
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', fontSize: '1.2rem' }}>
              <strong>TOTAL:</strong>
              <strong style={{ color: 'var(--success)' }}>{formatMoney(cartTotal)}</strong>
            </div>

            <button
              onClick={handleCompleteSaleClick}
              disabled={cart.length === 0}
              className="btn btn-primary"
              style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', padding: '0.85rem', fontSize: '1.05rem', fontWeight: 'bold' }}
            >
              <Printer size={18} /> Vender e Imprimir Vale
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Configuración de Impresora */}
      <PrinterSettingsModal
        isOpen={showPrinterModal}
        onClose={() => setShowPrinterModal(false)}
        eventName={event.name}
      />

      {/* Modal de Código QR para Pantalla de Comandas / Cocina */}
      <ComandasQRModal
        isOpen={showComandasModal}
        onClose={() => setShowComandasModal(false)}
        eventId={event.id}
        eventName={event.name}
      />

      {/* Modal de Caja Chica y Arqueo de Efectivo */}
      <PettyCashModal
        isOpen={showPettyCashModal}
        onClose={() => setShowPettyCashModal(false)}
        eventId={event.id}
        eventName={event.name}
        currentPettyCash={pettyCash}
        cashSalesTotal={cashSalesTotal}
        transferSalesTotal={transferSalesTotal}
        totalSales={totalSalesAmount}
        cashierName={activeCashierDisplayName}
        onOpenReconciliation={() => setShowReconciliationModal(true)}
      />

      {/* Modal para Cuadrar Efectivo Final en Caja */}
      <CashReconciliationModal
        isOpen={showReconciliationModal}
        onClose={() => setShowReconciliationModal(false)}
        eventId={event.id}
        courseId={event.courseId}
        eventName={event.name}
        initialPettyCash={pettyCashTotal}
        cashSalesTotal={cashSalesTotal}
        cashierName={activeCashierDisplayName}
        currentPettyCashData={pettyCash}
        onReconciliationSaved={(audit) => {
          setPettyCash(prev => ({
            ...(prev || {}),
            total: prev?.total ?? pettyCashTotal,
            totalAmount: prev?.totalAmount ?? pettyCashTotal,
            closingAudit: audit
          }));
        }}
      />
    </div>
  );

  return isFullscreen ? createPortal(posContent, document.body) : posContent;
};

export default EventPOS;
