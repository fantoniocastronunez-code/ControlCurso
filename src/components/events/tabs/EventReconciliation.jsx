import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../../firebase/config';
import { 
  collection, doc, getDocs, updateDoc, deleteDoc, 
  query, where, orderBy, onSnapshot 
} from 'firebase/firestore';
import { 
  Calculator, Banknote, CreditCard, ShoppingBag, Search, X, 
  Edit2, Printer, Trash2, AlertTriangle, CheckCircle2, 
  ChevronDown, ChevronUp, Check, Coins, 
  RefreshCw, FileText, Receipt
} from 'lucide-react';
import { useModal } from '../../../context/ModalContext';
import { useAuth } from '../../../context/AuthContext';
import PettyCashModal from '../PettyCashModal';
import CashReconciliationModal from '../CashReconciliationModal';
import ThermalReceipt from './ThermalReceipt';
import { 
  formatMoneyCLP, 
  getPrinterConfig, 
  buildSaleReceiptPayload,
  buildCashReconciliationReceiptPayload,
  printViaRawBT, 
  printViaWebBluetooth 
} from '../../../utils/thermalPrinterService';
import { calculateTotalDeductions } from '../../../utils/inventoryDeductions';

const EventReconciliation = ({ event, onNavigateTab }) => {
  const { user } = useAuth();
  const { showAlert, showConfirm } = useModal();

  // Estados de datos
  const [sales, setSales] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [pettyCashData, setPettyCashData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Estados de filtros y búsqueda
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('all'); // 'all' | 'cash' | 'transfer'
  const [transferStatusFilter, setTransferStatusFilter] = useState('all'); // 'all' | 'verified' | 'pending'
  const [cashierFilter, setCashierFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'cancelled' | 'all'
  const [sortBy, setSortBy] = useState('newest'); // 'newest' | 'oldest' | 'amount_desc' | 'amount_asc'

  // Estados de interfaz y modales
  const [showArqueoModal, setShowArqueoModal] = useState(false);
  const [showPettyCashModal, setShowPettyCashModal] = useState(false);
  const [reprintSale, setReprintSale] = useState(null);
  const [expandedSaleIds, setExpandedSaleIds] = useState(new Set());
  const [updatingSaleId, setUpdatingSaleId] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);

  // Modal para editar nota de venta
  const [editingSale, setEditingSale] = useState(null);
  const [editingNoteValue, setEditingNoteValue] = useState('');

  // 1. Cargar ventas en tiempo real
  useEffect(() => {
    if (!event?.id) return;
    setLoading(true);

    const qSales = query(
      collection(db, 'eventSales'),
      where('eventId', '==', event.id),
      orderBy('createdAt', 'desc')
    );

    const unsubscribeSales = onSnapshot(qSales, (snapshot) => {
      const salesList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setSales(salesList);
      setLoading(false);
    }, (error) => {
      console.error("Error al escuchar ventas en tiempo real:", error);
      setLoading(false);
    });

    // Cargar Caja Chica / Arqueo
    const pettyCashDocRef = doc(db, 'eventPettyCash', `petty_${event.id}`);
    const unsubscribePetty = onSnapshot(pettyCashDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setPettyCashData({ id: docSnap.id, ...docSnap.data() });
      } else {
        setPettyCashData(null);
      }
    });

    // Cargar Inventario y Menú (para deducciones/reposiciones al anular)
    const fetchAuxData = async () => {
      try {
        const qInv = query(collection(db, 'eventInventory'), where('eventId', '==', event.id));
        const snapInv = await getDocs(qInv);
        setInventory(snapInv.docs.map(d => ({ id: d.id, ...d.data() })));

        const qMenu = query(collection(db, 'eventItems'), where('eventId', '==', event.id));
        const snapMenu = await getDocs(qMenu);
        setMenuItems(snapMenu.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error("Error al cargar datos auxiliares:", err);
      }
    };
    fetchAuxData();

    return () => {
      unsubscribeSales();
      unsubscribePetty();
    };
  }, [event?.id]);

  // Mostrar mensaje efímero (toast)
  const showToast = (text, type = 'success') => {
    setStatusMessage({ text, type });
    setTimeout(() => {
      setStatusMessage(null);
    }, 3500);
  };

  // Cálculos estadísticos en vivo sobre ventas activas
  const activeSales = useMemo(() => sales.filter(s => s.status !== 'cancelled'), [sales]);
  const cancelledSales = useMemo(() => sales.filter(s => s.status === 'cancelled'), [sales]);

  const totalSalesAmount = useMemo(() => {
    return activeSales.reduce((acc, s) => acc + (s.total || 0), 0);
  }, [activeSales]);

  const cashSales = useMemo(() => {
    return activeSales.filter(s => (s.paymentMethod || 'cash') === 'cash');
  }, [activeSales]);

  const totalCashAmount = useMemo(() => {
    return cashSales.reduce((acc, s) => acc + (s.total || 0), 0);
  }, [cashSales]);

  const transferSales = useMemo(() => {
    return activeSales.filter(s => s.paymentMethod === 'transfer');
  }, [activeSales]);

  const totalTransferAmount = useMemo(() => {
    return transferSales.reduce((acc, s) => acc + (s.total || 0), 0);
  }, [transferSales]);

  const verifiedTransfers = useMemo(() => {
    return transferSales.filter(s => Boolean(s.transferVerified));
  }, [transferSales]);

  const verifiedTransfersAmount = useMemo(() => {
    return verifiedTransfers.reduce((acc, s) => acc + (s.total || 0), 0);
  }, [verifiedTransfers]);

  const pendingTransfers = useMemo(() => {
    return transferSales.filter(s => !s.transferVerified);
  }, [transferSales]);

  const pendingTransfersAmount = useMemo(() => {
    return pendingTransfers.reduce((acc, s) => acc + (s.total || 0), 0);
  }, [pendingTransfers]);

  // Fondo inicial de caja chica
  const initialFund = useMemo(() => {
    if (pettyCashData?.closingAudit?.initialPettyCash !== undefined) {
      return pettyCashData.closingAudit.initialPettyCash;
    }
    return pettyCashData?.total || 0;
  }, [pettyCashData]);

  // Efectivo esperado en caja = Fondo Inicial + Ventas en Efectivo
  const expectedCashInDrawer = useMemo(() => {
    return initialFund + totalCashAmount;
  }, [initialFund, totalCashAmount]);

  // Datos del arqueo registrado (si existe)
  const closingAudit = pettyCashData?.closingAudit || null;
  const countedCash = closingAudit?.finalCashCounted;
  const auditDiff = countedCash !== undefined ? countedCash - expectedCashInDrawer : null;

  // Lista de cajeros únicos para filtro
  const uniqueCashiers = useMemo(() => {
    const set = new Set();
    sales.forEach(s => {
      const name = (s.cashierName || s.createdBy || '').trim();
      if (name) set.add(name);
    });
    return Array.from(set).sort();
  }, [sales]);

  // Filtrado y ordenamiento de ventas
  const filteredSales = useMemo(() => {
    let result = sales;

    // Filtro por estado
    if (statusFilter === 'active') {
      result = result.filter(s => s.status !== 'cancelled');
    } else if (statusFilter === 'cancelled') {
      result = result.filter(s => s.status === 'cancelled');
    }

    // Filtro por medio de pago
    if (paymentFilter === 'cash') {
      result = result.filter(s => (s.paymentMethod || 'cash') === 'cash');
    } else if (paymentFilter === 'transfer') {
      result = result.filter(s => s.paymentMethod === 'transfer');
    }

    // Filtro por verificación de transferencias en banco
    if (transferStatusFilter === 'verified') {
      result = result.filter(s => s.paymentMethod === 'transfer' && Boolean(s.transferVerified));
    } else if (transferStatusFilter === 'pending') {
      result = result.filter(s => s.paymentMethod === 'transfer' && !s.transferVerified);
    }

    // Filtro por cajero
    if (cashierFilter !== 'all') {
      result = result.filter(s => (s.cashierName || s.createdBy || 'General') === cashierFilter);
    }

    // Filtro por búsqueda de texto
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      result = result.filter(s => {
        const name = (s.clientName || '').toLowerCase();
        const note = (s.saleNote || '').toLowerCase();
        const corr = String(s.correlative || '').toLowerCase();
        const cashier = (s.cashierName || s.createdBy || '').toLowerCase();
        const itemsStr = (s.items || []).map(i => (i.name || '').toLowerCase()).join(' ');
        return name.includes(term) || note.includes(term) || corr.includes(term) || itemsStr.includes(term) || cashier.includes(term);
      });
    }

    // Ordenamiento
    const sorted = [...result];
    if (sortBy === 'newest') {
      sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else if (sortBy === 'oldest') {
      sorted.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    } else if (sortBy === 'amount_desc') {
      sorted.sort((a, b) => (b.total || 0) - (a.total || 0));
    } else if (sortBy === 'amount_asc') {
      sorted.sort((a, b) => (a.total || 0) - (b.total || 0));
    }

    return sorted;
  }, [sales, statusFilter, paymentFilter, transferStatusFilter, cashierFilter, searchTerm, sortBy]);

  // Monto total de las ventas visibles filtradas
  const visibleFilteredTotal = useMemo(() => {
    return filteredSales
      .filter(s => s.status !== 'cancelled')
      .reduce((acc, s) => acc + (s.total || 0), 0);
  }, [filteredSales]);

  // Alternar medio de pago (Efectivo <-> Transferencia)
  const handleTogglePaymentMethod = async (sale, targetMethod) => {
    if (sale.status === 'cancelled') {
      await showAlert('No se puede modificar el medio de pago de una venta anulada.');
      return;
    }

    const currentMethod = sale.paymentMethod || 'cash';
    if (currentMethod === targetMethod) return;

    const targetLabel = targetMethod === 'cash' ? 'Efectivo (💵)' : 'Transferencia (🏦)';
    const confirm = await showConfirm(
      `¿Cambiar el medio de pago del Ticket #${sale.correlative} (${sale.clientName || 'General'}) a ${targetLabel}?\n\nEl monto de ${formatMoneyCLP(sale.total)} se recalculará inmediatamente en la cuadratura de caja.`
    );
    if (!confirm) return;

    setUpdatingSaleId(sale.id);
    try {
      // 1. Actualizar en colección eventSales
      await updateDoc(doc(db, 'eventSales', sale.id), {
        paymentMethod: targetMethod,
        updatedAt: new Date().toISOString(),
        paymentUpdatedBy: user?.displayName || user?.email || 'Admin'
      });

      // 2. Actualizar también en colección incomes si existe ingreso asociado
      const qIncome = query(collection(db, 'incomes'), where('saleId', '==', sale.id));
      const snapIncome = await getDocs(qIncome);
      for (const docSnap of snapIncome.docs) {
        await updateDoc(doc(db, 'incomes', docSnap.id), { 
          paymentMethod: targetMethod,
          updatedAt: new Date().toISOString()
        });
      }

      // Actualizar estado local inmediato
      setSales(prev => prev.map(s => s.id === sale.id ? { ...s, paymentMethod: targetMethod } : s));
      showToast(`Ticket #${sale.correlative} cambiado a ${targetMethod === 'cash' ? 'Efectivo' : 'Transferencia'}.`);
    } catch (err) {
      console.error("Error al actualizar medio de pago:", err);
      await showAlert("Error al modificar el medio de pago: " + err.message);
    } finally {
      setUpdatingSaleId(null);
    }
  };

  // Alternar verificación de transferencia en banco
  const handleToggleTransferVerified = async (sale) => {
    if (sale.status === 'cancelled') return;
    const newStatus = !sale.transferVerified;
    const updatedBy = user?.displayName || user?.email?.split('@')[0] || 'Tesorero/a';
    const nowIso = new Date().toISOString();

    try {
      // 1. Actualizar en colección eventSales
      await updateDoc(doc(db, 'eventSales', sale.id), {
        transferVerified: newStatus,
        transferVerifiedAt: newStatus ? nowIso : null,
        transferVerifiedBy: newStatus ? updatedBy : null,
        updatedAt: nowIso
      });

      // 2. Actualizar también en colección incomes si existe
      const qIncome = query(collection(db, 'incomes'), where('saleId', '==', sale.id));
      const snapIncome = await getDocs(qIncome);
      for (const docSnap of snapIncome.docs) {
        await updateDoc(doc(db, 'incomes', docSnap.id), {
          transferVerified: newStatus,
          transferVerifiedAt: newStatus ? nowIso : null
        });
      }

      setSales(prev => prev.map(s => s.id === sale.id ? {
        ...s,
        transferVerified: newStatus,
        transferVerifiedAt: newStatus ? nowIso : null,
        transferVerifiedBy: newStatus ? updatedBy : null
      } : s));

      showToast(
        newStatus 
          ? `Ticket #${sale.correlative} marcado como transfer verificada en banco (✓).`
          : `Ticket #${sale.correlative} marcado como transfer pendiente (⏳).`
      );
    } catch (err) {
      console.error("Error al actualizar verificación de transferencia:", err);
      await showAlert("Error al actualizar verificación de transferencia: " + err.message);
    }
  };

  // Marcar todas las transferencias visibles como verificadas
  const handleVerifyAllVisibleTransfers = async () => {
    const unverifiedTransfers = filteredSales.filter(s => s.paymentMethod === 'transfer' && s.status !== 'cancelled' && !s.transferVerified);
    if (unverifiedTransfers.length === 0) {
      await showAlert("No hay transferencias pendientes de verificar en la lista actual.");
      return;
    }

    const confirm = await showConfirm(`¿Deseas marcar las ${unverifiedTransfers.length} transferencias visibles como VERIFICADAS en el banco?`);
    if (!confirm) return;

    const updatedBy = user?.displayName || user?.email?.split('@')[0] || 'Tesorero/a';
    const nowIso = new Date().toISOString();

    try {
      for (const sale of unverifiedTransfers) {
        await updateDoc(doc(db, 'eventSales', sale.id), {
          transferVerified: true,
          transferVerifiedAt: nowIso,
          transferVerifiedBy: updatedBy,
          updatedAt: nowIso
        });
      }
      setSales(prev => prev.map(s => {
        if (unverifiedTransfers.some(u => u.id === s.id)) {
          return { ...s, transferVerified: true, transferVerifiedAt: nowIso, transferVerifiedBy: updatedBy };
        }
        return s;
      }));
      showToast(`¡${unverifiedTransfers.length} transferencias marcadas como verificadas en banco!`);
    } catch (err) {
      console.error("Error en verificación masiva:", err);
      await showAlert("Error al marcar transferencias: " + err.message);
    }
  };

  // Abrir modal de edición de notas
  const handleOpenEditNote = (sale) => {
    setEditingSale(sale);
    setEditingNoteValue(sale.saleNote || '');
  };

  // Guardar nota editada
  const handleSaveNote = async () => {
    if (!editingSale) return;
    try {
      await updateDoc(doc(db, 'eventSales', editingSale.id), {
        saleNote: editingNoteValue.trim(),
        updatedAt: new Date().toISOString()
      });
      setSales(prev => prev.map(s => s.id === editingSale.id ? { ...s, saleNote: editingNoteValue.trim() } : s));
      showToast(`Nota del ticket #${editingSale.correlative} guardada.`);
      setEditingSale(null);
    } catch (err) {
      console.error("Error al guardar nota:", err);
      await showAlert("Error al guardar nota: " + err.message);
    }
  };

  // Anular venta con reposición de inventario
  const handleCancelSale = async (sale) => {
    if (sale.status === 'cancelled') return;
    const confirm = await showConfirm(
      `¿Estás seguro de anular la venta #${sale.correlative} por ${formatMoneyCLP(sale.total)}?\n\nEsto restaurará el stock de los insumos y restará el dinero de la recaudación.`
    );
    if (!confirm) return;

    try {
      // 1. Marcar como anulada en eventSales
      await updateDoc(doc(db, 'eventSales', sale.id), {
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancelledBy: user?.displayName || user?.email || 'Admin'
      });

      // 2. Restaurar stock de inventario
      let deductionsToRestore = sale.inventoryDeductions || {};
      if (Object.keys(deductionsToRestore).length === 0 && sale.items && Array.isArray(sale.items)) {
        deductionsToRestore = calculateTotalDeductions(sale.items, inventory, menuItems);
      }

      for (const [invId, qtyToRestore] of Object.entries(deductionsToRestore)) {
        const invItem = inventory.find(i => i.id === invId);
        const restoredStock = (invItem?.currentStock ?? 0) + qtyToRestore;
        await updateDoc(doc(db, 'eventInventory', invId), {
          currentStock: restoredStock,
          updatedAt: new Date().toISOString()
        });
      }

      // 3. Eliminar de incomes
      const qIncome = query(collection(db, 'incomes'), where('saleId', '==', sale.id));
      const snapIncome = await getDocs(qIncome);
      for (const docSnap of snapIncome.docs) {
        await deleteDoc(doc(db, 'incomes', docSnap.id));
      }

      setSales(prev => prev.map(s => s.id === sale.id ? { ...s, status: 'cancelled' } : s));
      showToast(`Venta #${sale.correlative} anulada y stock devuelto.`, 'warning');
    } catch (err) {
      console.error("Error al anular venta:", err);
      await showAlert("Error al anular venta: " + err.message);
    }
  };

  // Reimpresión de ticket
  const handleReprintSaleTicket = async (sale) => {
    const printMode = getPrinterConfig();
    if (printMode === 'rawbt') {
      printViaRawBT(buildSaleReceiptPayload(sale, event.name));
    } else if (printMode === 'bluetooth') {
      try {
        await printViaWebBluetooth(buildSaleReceiptPayload(sale, event.name));
      } catch (err) {
        console.warn("Fallo bluetooth directo:", err);
        setReprintSale(sale);
        setTimeout(() => window.print(), 200);
      }
    } else {
      setReprintSale(sale);
      setTimeout(() => window.print(), 200);
    }
  };

  // Imprimir comprobante térmico de cuadratura
  const handlePrintReconciliationReceipt = async () => {
    const cashier = user?.displayName || user?.email?.split('@')[0] || 'Tesorero/a';
    const finalCounted = countedCash !== undefined ? countedCash : expectedCashInDrawer;
    const diff = auditDiff !== null ? auditDiff : 0;
    const netCash = totalCashAmount;

    const payload = buildCashReconciliationReceiptPayload(
      event.name,
      initialFund,
      finalCounted,
      totalCashAmount,
      netCash,
      diff,
      cashier,
      closingAudit?.notes || 'Cuadratura desde sección de control de ventas'
    );

    const printMode = getPrinterConfig();
    if (printMode === 'rawbt') {
      printViaRawBT(payload);
    } else if (printMode === 'bluetooth') {
      try {
        await printViaWebBluetooth(payload);
        showToast('¡Comprobante de cuadratura enviado a la impresora!');
      } catch (err) {
        console.warn("Fallo bluetooth:", err);
        window.print();
      }
    } else {
      window.print();
    }
  };

  // Toggle para expandir fila de productos
  const toggleExpandSale = (saleId) => {
    setExpandedSaleIds(prev => {
      const next = new Set(prev);
      if (next.has(saleId)) {
        next.delete(saleId);
      } else {
        next.add(saleId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        <RefreshCw size={24} className="spin" style={{ margin: '0 auto 1rem' }} />
        <p>Cargando registros de ventas y cuadratura de caja...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '3rem' }}>
      {/* Componente de Impresión Térmica Oculto */}
      <ThermalReceipt sale={reprintSale} eventName={event.name} />

      {/* Toast de Notificación Flotante */}
      {statusMessage && (
        <div style={{
          position: 'fixed',
          bottom: '2rem',
          right: '2rem',
          backgroundColor: statusMessage.type === 'warning' ? '#b45309' : '#065f46',
          color: '#fff',
          padding: '0.85rem 1.4rem',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          zIndex: 9999,
          fontWeight: 600,
          fontSize: '0.9rem',
          animation: 'fadeIn 0.25s ease-out'
        }}>
          {statusMessage.type === 'warning' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Encabezado Principal */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
        marginBottom: '1.5rem',
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 'var(--radius-lg)',
        padding: '1.25rem 1.5rem'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              color: '#10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Calculator size={22} />
            </div>
            <h2 style={{ margin: 0, fontSize: '1.35rem', color: '#fff' }}>
              Cuadratura de Caja y Control de Ventas
            </h2>
          </div>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            Revisa todas las ventas del evento, ajusta si pagaron en <strong>Efectivo</strong> o <strong>Transferencia</strong> en 1 clic y concilia el dinero físico en caja.
          </p>
        </div>

        {/* Botones de Acción Rápida */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab('pos')}
              className="btn btn-outline"
              style={{
                fontSize: '0.82rem',
                padding: '0.5rem 0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                borderColor: 'rgba(255, 255, 255, 0.2)',
                color: '#cbd5e1'
              }}
              title="Ir a la pantalla de venta"
            >
              <Receipt size={15} />
              <span>Ir al POS</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowPettyCashModal(true)}
            className="btn btn-outline"
            style={{
              fontSize: '0.82rem',
              padding: '0.5rem 0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              borderColor: initialFund > 0 ? '#10b981' : '#f59e0b',
              color: initialFund > 0 ? '#6ee7b7' : '#fcd34d',
              backgroundColor: initialFund > 0 ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)'
            }}
            title="Ver o editar el fondo inicial de sencillo con el que se abrió la caja"
          >
            <Banknote size={15} />
            <span>Fondo Inicial: {formatMoneyCLP(initialFund)}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowArqueoModal(true)}
            className="btn btn-primary"
            style={{
              fontSize: '0.85rem',
              padding: '0.5rem 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              backgroundColor: '#10b981',
              borderColor: '#10b981',
              color: '#fff',
              fontWeight: 'bold'
            }}
            title="Contar billetes y monedas físicos para cuadrar la caja"
          >
            <Coins size={16} />
            <span>{closingAudit ? 'Editar Arqueo de Caja' : 'Realizar Arqueo (Billetes / Monedas)'}</span>
          </button>

          <button
            type="button"
            onClick={handlePrintReconciliationReceipt}
            className="btn btn-outline"
            style={{
              fontSize: '0.82rem',
              padding: '0.5rem 0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              borderColor: 'var(--primary)',
              color: 'var(--primary)'
            }}
            title="Imprimir comprobante térmico o reporte de cuadratura"
          >
            <Printer size={15} />
            <span>Imprimir Resumen</span>
          </button>
        </div>
      </div>

      {/* Tarjetas KPI de Balance Financiero */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem'
      }}>
        {/* 1. Recaudación Total Ventas */}
        <div className="glass-panel" style={{ padding: '1.15rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
              Recaudación Total
            </span>
            <div style={{ color: 'var(--primary)', backgroundColor: 'rgba(99, 102, 241, 0.15)', padding: '0.35rem', borderRadius: '6px' }}>
              <ShoppingBag size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', marginBottom: '0.2rem' }}>
            {formatMoneyCLP(totalSalesAmount)}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {activeSales.length} ventas activas {cancelledSales.length > 0 && `(${cancelledSales.length} anuladas)`}
          </div>
        </div>

        {/* 2. Ventas en Efectivo */}
        <div 
          className="glass-panel" 
          onClick={() => setPaymentFilter(paymentFilter === 'cash' ? 'all' : 'cash')}
          style={{ 
            padding: '1.15rem 1.25rem',
            cursor: 'pointer',
            border: paymentFilter === 'cash' ? '2px solid #10b981' : '1px solid rgba(16, 185, 129, 0.25)',
            backgroundColor: paymentFilter === 'cash' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(30, 41, 59, 0.7)',
            transition: 'all 0.2s ease'
          }}
          title="Haz clic para filtrar solo ventas en efectivo"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', color: '#6ee7b7', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
              💵 En Efectivo
            </span>
            <div style={{ color: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.15)', padding: '0.35rem', borderRadius: '6px' }}>
              <Banknote size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10b981', marginBottom: '0.2rem' }}>
            {formatMoneyCLP(totalCashAmount)}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {cashSales.length} tickets ({totalSalesAmount > 0 ? Math.round((totalCashAmount / totalSalesAmount) * 100) : 0}%)
          </div>
        </div>

        {/* 3. Ventas en Transferencia */}
        <div 
          className="glass-panel" 
          onClick={() => setPaymentFilter(paymentFilter === 'transfer' ? 'all' : 'transfer')}
          style={{ 
            padding: '1.15rem 1.25rem',
            cursor: 'pointer',
            border: paymentFilter === 'transfer' ? '2px solid #3b82f6' : '1px solid rgba(59, 130, 246, 0.25)',
            backgroundColor: paymentFilter === 'transfer' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(30, 41, 59, 0.7)',
            transition: 'all 0.2s ease'
          }}
          title="Haz clic para filtrar solo ventas por transferencia"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
              🏦 Por Transferencia
            </span>
            <div style={{ color: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.15)', padding: '0.35rem', borderRadius: '6px' }}>
              <CreditCard size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#60a5fa', marginBottom: '0.2rem' }}>
            {formatMoneyCLP(totalTransferAmount)}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {transferSales.length} tickets ({totalSalesAmount > 0 ? Math.round((totalTransferAmount / totalSalesAmount) * 100) : 0}%)
          </div>
          {transferSales.length > 0 && (
            <div style={{
              marginTop: '0.55rem',
              paddingTop: '0.45rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.74rem'
            }}>
              <span style={{ color: '#34d399', fontWeight: 600 }}>
                ✓ {verifiedTransfers.length} Verificadas ({formatMoneyCLP(verifiedTransfersAmount)})
              </span>
              <span style={{ color: pendingTransfers.length > 0 ? '#fbbf24' : 'var(--text-muted)', fontWeight: 600 }}>
                ⏳ {pendingTransfers.length} Pendientes ({formatMoneyCLP(pendingTransfersAmount)})
              </span>
            </div>
          )}
        </div>

        {/* 4. Efectivo Total Esperado en Gaveta */}
        <div className="glass-panel" style={{ 
          padding: '1.15rem 1.25rem',
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.15)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', color: '#fcd34d', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
              💰 Esperado en Caja
            </span>
            <div style={{ color: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.15)', padding: '0.35rem', borderRadius: '6px' }}>
              <Calculator size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fef08a', marginBottom: '0.2rem' }}>
            {formatMoneyCLP(expectedCashInDrawer)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {formatMoneyCLP(initialFund)} (Fondo) + {formatMoneyCLP(totalCashAmount)} (Ventas)
          </div>
        </div>

        {/* 5. Estado de Arqueo Físico */}
        <div className="glass-panel" style={{ 
          padding: '1.15rem 1.25rem',
          border: closingAudit ? (
            auditDiff === 0 ? '1px solid #10b981' : auditDiff > 0 ? '1px solid #3b82f6' : '1px solid #ef4444'
          ) : '1px dashed rgba(255, 255, 255, 0.2)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
              Resultado de Arqueo
            </span>
            <div style={{ 
              color: closingAudit ? (auditDiff === 0 ? '#10b981' : auditDiff > 0 ? '#3b82f6' : '#ef4444') : '#94a3b8',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              padding: '0.35rem',
              borderRadius: '6px'
            }}>
              {closingAudit ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            </div>
          </div>

          {closingAudit ? (
            <div>
              <div style={{ 
                fontSize: '1.3rem', 
                fontWeight: 800, 
                color: auditDiff === 0 ? '#10b981' : auditDiff > 0 ? '#60a5fa' : '#f87171',
                marginBottom: '0.2rem'
              }}>
                {auditDiff === 0 
                  ? '✓ Cuadrado Exacto' 
                  : auditDiff > 0 
                    ? `Sobrante (+${formatMoneyCLP(auditDiff)})`
                    : `Faltante (${formatMoneyCLP(auditDiff)})`}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Físico contado: <strong>{formatMoneyCLP(countedCash)}</strong>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                Sin arqueo aún
              </div>
              <button
                type="button"
                onClick={() => setShowArqueoModal(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary)',
                  fontSize: '0.78rem',
                  padding: 0,
                  cursor: 'pointer',
                  textDecoration: 'underline'
                }}
              >
                Contar billetes y monedas ahora
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Barra de Filtros, Búsqueda y Ordenamiento */}
      <div style={{
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 'var(--radius-md)',
        padding: '1rem',
        marginBottom: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.85rem'
      }}>
        {/* Fila superior: Buscador y Filtros Rápidos de Medio de Pago */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Buscador */}
          <div style={{ position: 'relative', flex: '1 1 300px', minWidth: '240px' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por cliente, notas (ej. pendiente), # ticket, producto..."
              className="input-field"
              style={{
                width: '100%',
                paddingLeft: '32px',
                paddingRight: searchTerm ? '32px' : '10px',
                fontSize: '0.85rem',
                height: '38px',
                backgroundColor: 'rgba(0,0,0,0.3)'
              }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px'
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Selector de Medios de Pago (Pills) */}
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setPaymentFilter('all')}
              className="btn"
              style={{
                fontSize: '0.78rem',
                padding: '0.4rem 0.75rem',
                backgroundColor: paymentFilter === 'all' ? 'var(--primary)' : 'rgba(255, 255, 255, 0.05)',
                color: paymentFilter === 'all' ? '#fff' : 'var(--text-muted)',
                borderColor: paymentFilter === 'all' ? 'var(--primary)' : 'transparent',
                fontWeight: paymentFilter === 'all' ? 700 : 500
              }}
            >
              Todas ({activeSales.length})
            </button>
            <button
              type="button"
              onClick={() => setPaymentFilter('cash')}
              className="btn"
              style={{
                fontSize: '0.78rem',
                padding: '0.4rem 0.75rem',
                backgroundColor: paymentFilter === 'cash' ? '#10b981' : 'rgba(16, 185, 129, 0.1)',
                color: paymentFilter === 'cash' ? '#fff' : '#6ee7b7',
                borderColor: paymentFilter === 'cash' ? '#10b981' : 'rgba(16, 185, 129, 0.3)',
                fontWeight: paymentFilter === 'cash' ? 700 : 500
              }}
            >
              💵 Solo Efectivo ({cashSales.length})
            </button>
            <button
              type="button"
              onClick={() => setPaymentFilter('transfer')}
              className="btn"
              style={{
                fontSize: '0.78rem',
                padding: '0.4rem 0.75rem',
                backgroundColor: paymentFilter === 'transfer' ? '#3b82f6' : 'rgba(59, 130, 246, 0.1)',
                color: paymentFilter === 'transfer' ? '#fff' : '#93c5fd',
                borderColor: paymentFilter === 'transfer' ? '#3b82f6' : 'rgba(59, 130, 246, 0.3)',
                fontWeight: paymentFilter === 'transfer' ? 700 : 500
              }}
            >
              🏦 Solo Transferencia ({transferSales.length})
            </button>
          </div>
        </div>

        {/* Fila secundaria: Filtros complementarios y orden */}
        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem' }}>
          <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Filtro por Cajero */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Cajero:</span>
              <select
                value={cashierFilter}
                onChange={(e) => setCashierFilter(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.78rem', padding: '0.25rem 0.5rem', height: '32px', backgroundColor: 'rgba(0,0,0,0.3)' }}
              >
                <option value="all">Todos los cajeros</option>
                {uniqueCashiers.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Filtro por Estado de Venta */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Estado:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.78rem', padding: '0.25rem 0.5rem', height: '32px', backgroundColor: 'rgba(0,0,0,0.3)' }}
              >
                <option value="active">Solo Activas</option>
                <option value="cancelled">Solo Anuladas</option>
                <option value="all">Todas</option>
              </select>
            </div>

            {/* Filtro por Estado de Transferencia */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Banco:</span>
              <select
                value={transferStatusFilter}
                onChange={(e) => setTransferStatusFilter(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.78rem', padding: '0.25rem 0.5rem', height: '32px', backgroundColor: 'rgba(0,0,0,0.3)' }}
              >
                <option value="all">Todas las transfs.</option>
                <option value="verified">✓ Solo Verificadas ({verifiedTransfers.length})</option>
                <option value="pending">⏳ Solo Pendientes ({pendingTransfers.length})</option>
              </select>
            </div>

            {/* Ordenamiento */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Ordenar:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.78rem', padding: '0.25rem 0.5rem', height: '32px', backgroundColor: 'rgba(0,0,0,0.3)' }}
              >
                <option value="newest">Más recientes primero</option>
                <option value="oldest">Más antiguos primero</option>
                <option value="amount_desc">Mayor monto ($)</option>
                <option value="amount_asc">Menor monto ($)</option>
              </select>
            </div>

            {/* Botón para marcar visibles como verificadas si hay pendientes */}
            {filteredSales.some(s => s.paymentMethod === 'transfer' && s.status !== 'cancelled' && !s.transferVerified) && (
              <button
                type="button"
                onClick={handleVerifyAllVisibleTransfers}
                className="btn btn-outline"
                style={{
                  fontSize: '0.75rem',
                  padding: '0.2rem 0.55rem',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  borderColor: '#10b981',
                  color: '#6ee7b7',
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                  fontWeight: 600
                }}
                title="Marcar todas las transferencias visibles como verificadas en el banco"
              >
                <Check size={13} />
                <span>Verificar visibles</span>
              </button>
            )}
          </div>

          {/* Conteo de resultados */}
          <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>Mostrando <strong>{filteredSales.length}</strong> ventas</span>
            <span>•</span>
            <span>Total visible: <strong style={{ color: 'var(--success)' }}>{formatMoneyCLP(visibleFilteredTotal)}</strong></span>
            {(searchTerm || paymentFilter !== 'all' || transferStatusFilter !== 'all' || cashierFilter !== 'all' || statusFilter !== 'active') && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setPaymentFilter('all');
                  setTransferStatusFilter('all');
                  setCashierFilter('all');
                  setStatusFilter('active');
                }}
                className="btn btn-outline"
                style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem', marginLeft: '0.35rem' }}
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabla Completa de Ventas */}
      <div style={{
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden'
      }}>
        {filteredSales.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
            <FileText size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
            <p style={{ margin: 0, fontWeight: 600 }}>No se encontraron ventas con los filtros seleccionados.</p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem' }}>
              {searchTerm ? 'Prueba cambiando el término de búsqueda.' : 'Aún no se han registrado ventas en este evento.'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.4)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'var(--text-muted)',
                  fontSize: '0.76rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'center', width: '70px' }}>Ticket #</th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'left', width: '130px' }}>Fecha / Hora</th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'left', minWidth: '160px' }}>Cliente / Nota</th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'left', minWidth: '220px' }}>Productos</th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'right', width: '105px' }}>Total</th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'center', minWidth: '210px' }}>
                    Medio de Pago (Modificar)
                  </th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'center', minWidth: '155px' }}>
                    Verificación Banco
                  </th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'left', width: '110px' }}>Cajero</th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'center', width: '105px' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((sale, index) => {
                  const isCancelled = sale.status === 'cancelled';
                  const isExpanded = expandedSaleIds.has(sale.id);
                  const isUpdating = updatingSaleId === sale.id;
                  const currentMethod = sale.paymentMethod || 'cash';
                  const dateObj = sale.createdAt ? new Date(sale.createdAt) : null;
                  const timeFormatted = dateObj ? dateObj.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                  const dateFormatted = dateObj ? dateObj.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }) : '';

                  return (
                    <React.Fragment key={sale.id || index}>
                      <tr style={{
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        backgroundColor: isCancelled 
                          ? 'rgba(239, 68, 68, 0.04)' 
                          : index % 2 === 0 
                            ? 'transparent' 
                            : 'rgba(255, 255, 255, 0.015)',
                        opacity: isCancelled ? 0.6 : 1,
                        transition: 'background-color 0.15s ease'
                      }}>
                        {/* 1. Ticket # */}
                        <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block',
                            fontWeight: 800,
                            fontSize: '0.92rem',
                            color: isCancelled ? 'var(--danger)' : '#fff',
                            backgroundColor: isCancelled ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.08)',
                            padding: '2px 8px',
                            borderRadius: '6px'
                          }}>
                            #{sale.correlative || '?'}
                          </span>
                        </td>

                        {/* 2. Fecha / Hora */}
                        <td style={{ padding: '0.65rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{timeFormatted} hrs</div>
                          <div style={{ fontSize: '0.72rem' }}>{dateFormatted}</div>
                        </td>

                        {/* 3. Cliente / Nota */}
                        <td style={{ padding: '0.65rem 0.75rem' }}>
                          <div style={{ fontWeight: 600, color: sale.clientName ? '#fef08a' : '#cbd5e1' }}>
                            {sale.clientName || 'Cliente General'}
                          </div>
                          {sale.saleNote ? (
                            <div 
                              onClick={() => handleOpenEditNote(sale)}
                              style={{ 
                                fontSize: '0.75rem', 
                                color: '#f59e0b', 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '3px',
                                marginTop: '2px',
                                cursor: 'pointer',
                                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                                padding: '1px 6px',
                                borderRadius: '4px'
                              }}
                              title="Haz clic para editar esta nota"
                            >
                              <span>📝 {sale.saleNote}</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenEditNote(sale)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-muted)',
                                fontSize: '0.72rem',
                                padding: 0,
                                cursor: 'pointer',
                                marginTop: '2px',
                                opacity: 0.6
                              }}
                              title="Agregar una nota a este pedido (ej. pago pendiente)"
                            >
                              + Agregar nota
                            </button>
                          )}
                        </td>

                        {/* 4. Resumen de Productos */}
                        <td style={{ padding: '0.65rem 0.75rem' }}>
                          <div 
                            onClick={() => toggleExpandSale(sale.id)}
                            style={{ 
                              cursor: 'pointer',
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: '0.35rem',
                              color: 'var(--text-muted)',
                              fontSize: '0.82rem'
                            }}
                            title="Haz clic para ver u ocultar el desglose de productos"
                          >
                            <span style={{
                              maxWidth: '240px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: '#cbd5e1'
                            }}>
                              {(sale.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ') || 'Sin productos'}
                            </span>
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </div>
                        </td>

                        {/* 5. Total de Venta */}
                        <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span style={{
                            fontWeight: 800,
                            fontSize: '0.95rem',
                            color: isCancelled ? 'var(--text-muted)' : 'var(--success)'
                          }}>
                            {formatMoneyCLP(sale.total)}
                          </span>
                        </td>

                        {/* 6. MEDIO DE PAGO MODIFICABLE (Segmented Switch) */}
                        <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center' }}>
                          {isCancelled ? (
                            <span style={{
                              fontSize: '0.75rem',
                              padding: '3px 8px',
                              borderRadius: '10px',
                              backgroundColor: 'rgba(239, 68, 68, 0.15)',
                              color: 'var(--danger)',
                              fontWeight: 'bold'
                            }}>
                              Venta Anulada
                            </span>
                          ) : (
                            <div style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              backgroundColor: 'rgba(0, 0, 0, 0.35)',
                              padding: '2px',
                              borderRadius: '8px',
                              border: '1px solid rgba(255, 255, 255, 0.1)'
                            }}>
                              {/* Botón Efectivo */}
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() => handleTogglePaymentMethod(sale, 'cash')}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '4px 10px',
                                  fontSize: '0.78rem',
                                  fontWeight: currentMethod === 'cash' ? 700 : 500,
                                  borderRadius: '6px',
                                  border: 'none',
                                  cursor: isUpdating ? 'not-allowed' : 'pointer',
                                  backgroundColor: currentMethod === 'cash' ? '#10b981' : 'transparent',
                                  color: currentMethod === 'cash' ? '#fff' : 'var(--text-muted)',
                                  boxShadow: currentMethod === 'cash' ? '0 2px 6px rgba(16, 185, 129, 0.3)' : 'none',
                                  transition: 'all 0.15s ease'
                                }}
                                title={currentMethod === 'cash' ? 'Pagado en Efectivo' : 'Cambiar a Efectivo'}
                              >
                                {currentMethod === 'cash' && <Check size={12} />}
                                <span>💵 Efectivo</span>
                              </button>

                              {/* Botón Transferencia */}
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() => handleTogglePaymentMethod(sale, 'transfer')}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '4px 10px',
                                  fontSize: '0.78rem',
                                  fontWeight: currentMethod === 'transfer' ? 700 : 500,
                                  borderRadius: '6px',
                                  border: 'none',
                                  cursor: isUpdating ? 'not-allowed' : 'pointer',
                                  backgroundColor: currentMethod === 'transfer' ? '#3b82f6' : 'transparent',
                                  color: currentMethod === 'transfer' ? '#fff' : 'var(--text-muted)',
                                  boxShadow: currentMethod === 'transfer' ? '0 2px 6px rgba(59, 130, 246, 0.3)' : 'none',
                                  transition: 'all 0.15s ease'
                                }}
                                title={currentMethod === 'transfer' ? 'Pagado por Transferencia' : 'Cambiar a Transferencia'}
                              >
                                {currentMethod === 'transfer' && <Check size={12} />}
                                <span>🏦 Transferencia</span>
                              </button>
                            </div>
                          )}
                        </td>

                        {/* 7. Verificación de Transferencia en Banco (Casilla de verificación) */}
                        <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {isCancelled ? (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>-</span>
                          ) : currentMethod === 'transfer' ? (
                            <label
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '7px',
                                padding: '4px 10px',
                                borderRadius: '8px',
                                border: sale.transferVerified ? '1px solid #10b981' : '1px solid rgba(245, 158, 11, 0.45)',
                                backgroundColor: sale.transferVerified ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.08)',
                                color: sale.transferVerified ? '#6ee7b7' : '#fcd34d',
                                cursor: 'pointer',
                                userSelect: 'none',
                                fontSize: '0.78rem',
                                fontWeight: 600,
                                transition: 'all 0.15s ease'
                              }}
                              title={sale.transferVerified 
                                ? `Verificada en banco el ${sale.transferVerifiedAt ? new Date(sale.transferVerifiedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : ''} por ${sale.transferVerifiedBy || 'Tesorero/a'}` 
                                : 'Haz clic en la casilla para marcar como verificada en la cuenta bancaria'}
                            >
                              <input
                                type="checkbox"
                                checked={Boolean(sale.transferVerified)}
                                onChange={() => handleToggleTransferVerified(sale)}
                                style={{
                                  width: '16px',
                                  height: '16px',
                                  accentColor: '#10b981',
                                  cursor: 'pointer'
                                }}
                              />
                              <span>{sale.transferVerified ? '✓ Verificada' : '⏳ Pendiente'}</span>
                            </label>
                          ) : (
                            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', opacity: 0.6 }}>
                              💵 Efectivo
                            </span>
                          )}
                        </td>

                        {/* 8. Cajero */}
                        <td style={{ padding: '0.65rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {sale.cashierName || sale.createdBy || 'General'}
                        </td>

                        {/* 9. Acciones */}
                        <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleOpenEditNote(sale)}
                              className="btn btn-outline"
                              style={{ padding: '0.25rem 0.45rem', fontSize: '0.75rem' }}
                              title="Editar nota del pedido"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReprintSaleTicket(sale)}
                              className="btn btn-outline"
                              style={{ padding: '0.25rem 0.45rem', fontSize: '0.75rem' }}
                              title="Reimprimir ticket térmico"
                            >
                              <Printer size={13} />
                            </button>
                            {!isCancelled && (
                              <button
                                type="button"
                                onClick={() => handleCancelSale(sale)}
                                className="btn btn-outline"
                                style={{ padding: '0.25rem 0.45rem', fontSize: '0.75rem', borderColor: 'rgba(239, 68, 68, 0.4)', color: 'var(--danger)' }}
                                title="Anular venta y restaurar stock"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Desglose Expandido de Productos */}
                      {isExpanded && (
                        <tr style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          <td colSpan={9} style={{ padding: '0.75rem 1.5rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxWidth: '600px' }}>
                              <strong style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                Desglose de Productos - Ticket #{sale.correlative}
                              </strong>
                              {(sale.items || []).map((item, iIdx) => (
                                <div key={iIdx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '0.2rem 0', borderBottom: '1px dashed rgba(255,255,255,0.05)' }}>
                                  <span>
                                    <strong>{item.quantity}x</strong> {item.name}
                                    {item.selectedSubproducts && item.selectedSubproducts.length > 0 && (
                                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '6px' }}>
                                        ({item.selectedSubproducts.map(sp => sp.name).join(', ')})
                                      </span>
                                    )}
                                  </span>
                                  <span style={{ color: '#cbd5e1' }}>
                                    {formatMoneyCLP((item.unitPrice || item.price || 0) * (item.quantity || 1))}
                                  </span>
                                </div>
                              ))}
                              {sale.paymentUpdatedBy && (
                                <div style={{ fontSize: '0.72rem', color: '#60a5fa', marginTop: '0.35rem' }}>
                                  ℹ️ Medio de pago modificado por {sale.paymentUpdatedBy} el {new Date(sale.updatedAt).toLocaleString('es-CL')}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal para Editar Nota de Venta */}
      {editingSale && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div className="glass-panel" style={{
            maxWidth: '480px',
            width: '100%',
            padding: '1.5rem',
            backgroundColor: '#1e293b',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 'var(--radius-lg)'
          }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem', color: '#fff' }}>
              Editar Nota de Venta - Ticket #{editingSale.correlative}
            </h3>
            <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Cliente: <strong>{editingSale.clientName || 'General'}</strong> • Monto: <strong>{formatMoneyCLP(editingSale.total)}</strong>
            </p>

            <textarea
              value={editingNoteValue}
              onChange={(e) => setEditingNoteValue(e.target.value)}
              placeholder="Ej: Transferencia enviada por WhatsApp, pago pendiente a Juan, comprobante #123456..."
              rows={3}
              className="input-field"
              style={{ width: '100%', fontSize: '0.88rem', padding: '0.6rem', marginBottom: '1.25rem', resize: 'vertical' }}
              autoFocus
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setEditingSale(null)}
                className="btn btn-outline"
                style={{ fontSize: '0.85rem', padding: '0.45rem 1rem' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveNote}
                className="btn btn-primary"
                style={{ fontSize: '0.85rem', padding: '0.45rem 1.25rem', backgroundColor: '#10b981', borderColor: '#10b981' }}
              >
                Guardar Nota
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Fondo Inicial (Caja Chica) */}
      <PettyCashModal
        isOpen={showPettyCashModal}
        onClose={() => setShowPettyCashModal(false)}
        eventId={event.id}
        courseId={event.courseId}
        eventName={event.name}
        cashierName={user?.displayName || user?.email?.split('@')[0] || 'Cajero/a'}
        currentPettyCash={pettyCashData}
        cashSalesTotal={totalCashAmount}
        onPettyCashSaved={(savedData) => {
          setPettyCashData(prev => ({
            ...(prev || {}),
            ...savedData
          }));
          showToast('Fondo inicial de caja chica actualizado.');
        }}
      />

      {/* Modal de Arqueo y Cuadratura Final de Billetes y Monedas */}
      <CashReconciliationModal
        isOpen={showArqueoModal}
        onClose={() => setShowArqueoModal(false)}
        eventId={event.id}
        courseId={event.courseId}
        eventName={event.name}
        initialPettyCash={initialFund}
        cashSalesTotal={totalCashAmount}
        cashierName={user?.displayName || user?.email?.split('@')[0] || 'Tesorero/a'}
        currentPettyCashData={pettyCashData}
        onReconciliationSaved={(audit) => {
          setPettyCashData(prev => ({
            ...(prev || {}),
            total: prev?.total ?? initialFund,
            totalAmount: prev?.totalAmount ?? initialFund,
            closingAudit: audit
          }));
          showToast('¡Arqueo de caja guardado con éxito!');
        }}
      />
    </div>
  );
};

export default EventReconciliation;
