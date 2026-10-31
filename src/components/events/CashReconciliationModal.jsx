import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase/config';
import { doc, setDoc } from 'firebase/firestore';
import { 
  Calculator, Banknote, Coins, Printer, Check, X, 
  RotateCcw, AlertTriangle, CheckCircle2, 
  TrendingUp, Edit3, Save
} from 'lucide-react';
import { 
  formatMoneyCLP, 
  getPrinterConfig, 
  buildCashReconciliationReceiptPayload, 
  printViaRawBT, 
  printViaWebBluetooth 
} from '../../utils/thermalPrinterService';

// Denominaciones chilenas oficiales
const BILL_CONFIG = [
  { value: 20000, label: '$20.000', color: '#1e40af', bg: 'rgba(30, 64, 175, 0.25)', border: '#3b82f6' }, // Azul
  { value: 10000, label: '$10.000', color: '#15803d', bg: 'rgba(21, 128, 61, 0.25)', border: '#22c55e' }, // Verde
  { value: 5000,  label: '$5.000',  color: '#b91c1c', bg: 'rgba(185, 28, 28, 0.25)', border: '#ef4444' }, // Rojo
  { value: 2000,  label: '$2.000',  color: '#7e22ce', bg: 'rgba(126, 34, 206, 0.25)', border: '#a855f7' }, // Morado
  { value: 1000,  label: '$1.000',  color: '#0e7490', bg: 'rgba(14, 116, 144, 0.25)', border: '#06b6d4' }  // Verde agua / Celeste
];

const COIN_CONFIG = [
  { value: 500, label: '$500', color: '#d97706', bg: 'rgba(217, 119, 6, 0.25)', border: '#f59e0b' }, // Bimetálica
  { value: 100, label: '$100', color: '#ca8a04', bg: 'rgba(202, 138, 4, 0.25)', border: '#eab308' }, // Dorada
  { value: 50,  label: '$50',  color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.2)', border: '#cbd5e1' }, // Plateada decagonal
  { value: 10,  label: '$10',  color: '#c2410c', bg: 'rgba(194, 65, 12, 0.25)', border: '#ea580c' }   // Cobriza
];

const CashReconciliationModal = ({
  isOpen,
  onClose,
  eventId,
  courseId,
  eventName,
  initialPettyCash = 0,
  cashSalesTotal = 0,
  cashierName = 'Cajero/a',
  currentPettyCashData = null,
  onReconciliationSaved
}) => {
  // Modo de ingreso: 'breakdown' (billetes y monedas) | 'quick' (monto total directo)
  const [inputMode, setInputMode] = useState('breakdown');
  
  // Fondo inicial que había antes de comenzar (por defecto viene de la caja chica registrada)
  const [initialFund, setInitialFund] = useState(initialPettyCash || 0);
  const [isEditingInitialFund, setIsEditingInitialFund] = useState(false);
  const [initialFundInput, setInitialFundInput] = useState(String(initialPettyCash || 0));

  // Desglose de billetes contados al cierre
  const [bills, setBills] = useState({
    20000: 0,
    10000: 0,
    5000: 0,
    2000: 0,
    1000: 0
  });

  // Desglose de monedas contadas al cierre
  const [coins, setCoins] = useState({
    500: 0,
    100: 0,
    50: 0,
    10: 0
  });

  // Ingreso directo de monto contado
  const [quickTotalCounted, setQuickTotalCounted] = useState('');

  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const wasOpenRef = useRef(false);

  // Inicializar o cargar cuadratura guardada previamente al abrir el modal
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      const savedAudit = currentPettyCashData?.closingAudit;
      const baseInitial = (currentPettyCashData?.total !== undefined && Number(currentPettyCashData.total) > 0)
        ? Number(currentPettyCashData.total)
        : (savedAudit?.initialPettyCash !== undefined && Number(savedAudit.initialPettyCash) > 0)
          ? Number(savedAudit.initialPettyCash)
          : (Number(initialPettyCash) || 0);

      setInitialFund(baseInitial);
      setInitialFundInput(String(baseInitial));

      if (savedAudit) {
        if (savedAudit.bills) {
          setBills({
            20000: savedAudit.bills[20000] || 0,
            10000: savedAudit.bills[10000] || 0,
            5000: savedAudit.bills[5000] || 0,
            2000: savedAudit.bills[2000] || 0,
            1000: savedAudit.bills[1000] || 0
          });
        }
        if (savedAudit.coins) {
          setCoins({
            500: savedAudit.coins[500] || 0,
            100: savedAudit.coins[100] || 0,
            50: savedAudit.coins[50] || 0,
            10: savedAudit.coins[10] || 0
          });
        }
        if (savedAudit.initialPettyCash !== undefined && Number(savedAudit.initialPettyCash) > 0) {
          setInitialFund(Number(savedAudit.initialPettyCash));
          setInitialFundInput(String(savedAudit.initialPettyCash));
        } else {
          setInitialFund(baseInitial);
          setInitialFundInput(String(baseInitial));
        }
        if (savedAudit.quickTotalCounted) {
          setQuickTotalCounted(String(savedAudit.quickTotalCounted));
          setInputMode('quick');
        } else {
          setInputMode('breakdown');
        }
        setNotes(savedAudit.notes || '');
      } else {
        // Valores en cero para iniciar el conteo
        setBills({ 20000: 0, 10000: 0, 5000: 0, 2000: 0, 1000: 0 });
        setCoins({ 500: 0, 100: 0, 50: 0, 10: 0 });
        setQuickTotalCounted('');
        setNotes('');
        setInputMode('breakdown');
      }
      setSaveSuccess(false);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, currentPettyCashData, initialPettyCash]);

  if (!isOpen) return null;

  // Cálculos del efectivo contado físicamente
  const totalBills = BILL_CONFIG.reduce((sum, b) => sum + (bills[b.value] || 0) * b.value, 0);
  const totalCoins = COIN_CONFIG.reduce((sum, c) => sum + (coins[c.value] || 0) * c.value, 0);
  const calculatedBreakdownTotal = totalBills + totalCoins;

  const finalCashCounted = inputMode === 'breakdown' 
    ? calculatedBreakdownTotal 
    : Math.max(0, parseInt(quickTotalCounted.replace(/\D/g, ''), 10) || 0);

  // Recaudación Neta Real = Efectivo Físico Contado - Lo que había antes de comenzar
  const netCashEarned = finalCashCounted - initialFund;

  // Comparación contra las ventas en efectivo registradas en el POS
  // Diferencia = Recaudación Neta Real - Ventas POS en Efectivo
  // Equivalente a: Efectivo Físico Contado - (Fondo Inicial + Ventas POS)
  const expectedTotalCashInDrawer = initialFund + cashSalesTotal;
  const difference = finalCashCounted - expectedTotalCashInDrawer;

  const isExact = difference === 0;
  const isSurplus = difference > 0;

  const handleBillChange = (val, qty) => {
    const parsed = Math.max(0, parseInt(qty, 10) || 0);
    setBills(prev => ({ ...prev, [val]: parsed }));
  };

  const handleCoinChange = (val, qty) => {
    const parsed = Math.max(0, parseInt(qty, 10) || 0);
    setCoins(prev => ({ ...prev, [val]: parsed }));
  };

  const handleResetCount = () => {
    if (window.confirm('¿Deseas reiniciar los valores del conteo de efectivo a cero?')) {
      setBills({ 20000: 0, 10000: 0, 5000: 0, 2000: 0, 1000: 0 });
      setCoins({ 500: 0, 100: 0, 50: 0, 10: 0 });
      setQuickTotalCounted('');
    }
  };

  const handleSaveInitialFund = async () => {
    const parsed = Math.max(0, parseInt(initialFundInput.replace(/\D/g, ''), 10) || 0);
    setInitialFund(parsed);
    setIsEditingInitialFund(false);
    try {
      const docId = `petty_${eventId}`;
      await setDoc(doc(db, 'eventPettyCash', docId), {
        eventId,
        courseId: courseId || currentPettyCashData?.courseId || '',
        total: parsed,
        totalAmount: parsed,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.warn("Error guardando fondo inicial:", err);
    }
  };

  const handleSaveReconciliation = async () => {
    setSaving(true);
    try {
      const docId = `petty_${eventId}`;
      const closingAuditPayload = {
        finalCashCounted,
        inputMode,
        quickTotalCounted: inputMode === 'quick' ? finalCashCounted : null,
        bills: inputMode === 'breakdown' ? bills : null,
        coins: inputMode === 'breakdown' ? coins : null,
        totalBills: inputMode === 'breakdown' ? totalBills : 0,
        totalCoins: inputMode === 'breakdown' ? totalCoins : 0,
        initialPettyCash: initialFund,
        netCashEarned,
        systemCashSales: cashSalesTotal,
        expectedCashTotal: expectedTotalCashInDrawer,
        difference,
        status: isExact ? 'balanced' : isSurplus ? 'surplus' : 'shortage',
        notes: notes.trim(),
        auditedAt: new Date().toISOString(),
        auditedBy: cashierName
      };

      const docPayload = {
        eventId,
        courseId: courseId || currentPettyCashData?.courseId || '',
        total: initialFund,
        totalAmount: initialFund,
        closingAudit: closingAuditPayload,
        updatedAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'eventPettyCash', docId), docPayload, { merge: true });
      
      setSaveSuccess(true);
      if (onReconciliationSaved) {
        onReconciliationSaved(closingAuditPayload);
      }
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 700);
    } catch (err) {
      console.error("Error al guardar cuadratura:", err);
      alert("Error al guardar la cuadratura: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePrintReceipt = async () => {
    const payload = buildCashReconciliationReceiptPayload(
      eventName,
      initialFund,
      finalCashCounted,
      cashSalesTotal,
      netCashEarned,
      difference,
      cashierName,
      notes
    );

    const printMode = getPrinterConfig();
    if (printMode === 'rawbt') {
      printViaRawBT(payload);
    } else if (printMode === 'bluetooth') {
      try {
        await printViaWebBluetooth(payload);
      } catch (err) {
        console.warn("Fallo bluetooth directo, usando ventana de impresión:", err);
        window.print();
      }
    } else {
      window.print();
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100000,
      padding: '1rem'
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '740px',
        maxHeight: '94vh',
        backgroundColor: '#090e17',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: '18px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 25px 60px rgba(0, 0, 0, 0.75)'
      }}>
        {/* Cabecera del Modal */}
        <div style={{
          padding: '1.15rem 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          background: 'linear-gradient(90deg, rgba(16, 185, 129, 0.1) 0%, rgba(99, 102, 241, 0.05) 100%)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              backgroundColor: 'rgba(16, 185, 129, 0.2)',
              border: '1px solid #10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#10b981'
            }}>
              <Calculator size={22} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', fontWeight: 800 }}>
                Cuadratura Final de Efectivo en Caja
              </h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {eventName} • Responsable: <strong style={{ color: '#fff' }}>{cashierName}</strong>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn btn-outline"
            style={{ padding: '0.4rem', borderRadius: '50%', color: 'var(--text-muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Panel Superior Resumen de la Ecuación: [Físico] - [Inicial] = [Ganancia Neta] vs [POS] */}
        <div style={{
          padding: '1rem 1.5rem',
          backgroundColor: 'rgba(0, 0, 0, 0.35)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          {/* Tarjetas de Métricas Clave */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.75rem',
            marginBottom: '0.85rem'
          }}>
            {/* 1. Efectivo Contado Físicamente */}
            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '12px',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.35)'
            }}>
              <span style={{ fontSize: '0.72rem', color: '#6ee7b7', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Banknote size={14} /> Total Contado en Gaveta
              </span>
              <strong style={{ fontSize: '1.35rem', color: '#10b981', display: 'block', marginTop: '0.2rem' }}>
                {formatMoneyCLP(finalCashCounted)}
              </strong>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Billetes y monedas físicos
              </span>
            </div>

            {/* 2. Menos Fondo Inicial que había al comenzar */}
            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '12px',
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.3)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Coins size={14} /> (-) Fondo Inicial
                </span>
                <button
                  type="button"
                  onClick={() => setIsEditingInitialFund(!isEditingInitialFund)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#93c5fd',
                    fontSize: '0.72rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    padding: 0
                  }}
                  title="Cambiar monto del fondo inicial si fue diferente"
                >
                  <Edit3 size={11} /> {isEditingInitialFund ? 'Cancelar' : 'Modificar'}
                </button>
              </div>

              {isEditingInitialFund ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '0.35rem' }}>
                  <input
                    type="number"
                    min="0"
                    value={initialFundInput}
                    onChange={(e) => setInitialFundInput(e.target.value)}
                    className="input-field"
                    style={{ padding: '0.2rem 0.4rem', fontSize: '0.85rem', width: '100px' }}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleSaveInitialFund}
                    className="btn btn-primary"
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  >
                    OK
                  </button>
                </div>
              ) : (
                <strong style={{ fontSize: '1.35rem', color: '#f87171', display: 'block', marginTop: '0.2rem' }}>
                  - {formatMoneyCLP(initialFund)}
                </strong>
              )}
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Caja chica que había antes
              </span>
            </div>

            {/* 3. Recaudación Neta Real (= Efectivo Físico - Fondo Inicial) */}
            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '12px',
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid rgba(99, 102, 241, 0.35)'
            }}>
              <span style={{ fontSize: '0.72rem', color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <TrendingUp size={14} /> (=) Recaudación Neta Real
              </span>
              <strong style={{ fontSize: '1.35rem', color: '#fff', display: 'block', marginTop: '0.2rem' }}>
                {formatMoneyCLP(netCashEarned)}
              </strong>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Vendido neto en efectivo
              </span>
            </div>
          </div>

          {/* Banner de Resultado de Cuadratura (Comparación con Ventas POS) */}
          <div style={{
            padding: '0.85rem 1.15rem',
            borderRadius: '12px',
            backgroundColor: isExact
              ? 'rgba(16, 185, 129, 0.15)'
              : isSurplus
                ? 'rgba(59, 130, 246, 0.15)'
                : 'rgba(239, 68, 68, 0.15)',
            border: isExact
              ? '1px solid #10b981'
              : isSurplus
                ? '1px solid #3b82f6'
                : '1px solid #ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              {isExact ? (
                <CheckCircle2 size={24} color="#10b981" />
              ) : isSurplus ? (
                <TrendingUp size={24} color="#60a5fa" />
              ) : (
                <AlertTriangle size={24} color="#f87171" />
              )}
              <div>
                <strong style={{
                  fontSize: '1rem',
                  color: isExact ? '#6ee7b7' : isSurplus ? '#93c5fd' : '#fca5a5',
                  display: 'block'
                }}>
                  {isExact
                    ? '¡Caja Cuadrada Perfecta! ($0 de diferencia)'
                    : isSurplus
                      ? `Sobrante en Caja: +${formatMoneyCLP(difference)}`
                      : `Faltante en Caja: ${formatMoneyCLP(difference)}`}
                </strong>
                <span style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>
                  {isExact
                    ? 'El efectivo neto contado coincide exactamente con las ventas en efectivo registradas en el POS.'
                    : isSurplus
                      ? 'Hay más dinero físico en gaveta del registrado por el sistema (posible propina o venta no ingresada).'
                      : 'Falta dinero en la gaveta física respecto a las ventas en efectivo registradas en el POS.'}
                </span>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>
                Ventas POS en Efectivo:
              </span>
              <strong style={{ fontSize: '1.05rem', color: '#fff' }}>
                {formatMoneyCLP(cashSalesTotal)}
              </strong>
            </div>
          </div>
        </div>

        {/* Selector de Modo de Conteo: Billetes/Monedas vs Ingreso Rápido */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          backgroundColor: 'rgba(0, 0, 0, 0.2)'
        }}>
          <button
            type="button"
            onClick={() => setInputMode('breakdown')}
            style={{
              flex: 1,
              padding: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.45rem',
              fontSize: '0.85rem',
              fontWeight: inputMode === 'breakdown' ? 'bold' : 'normal',
              color: inputMode === 'breakdown' ? '#fff' : 'var(--text-muted)',
              borderBottom: inputMode === 'breakdown' ? '2px solid #10b981' : '2px solid transparent',
              backgroundColor: inputMode === 'breakdown' ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              cursor: 'pointer'
            }}
          >
            <Coins size={15} color="#10b981" />
            <span>Desglose por Billetes y Monedas ({formatMoneyCLP(calculatedBreakdownTotal)})</span>
          </button>

          <button
            type="button"
            onClick={() => setInputMode('quick')}
            style={{
              flex: 1,
              padding: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.45rem',
              fontSize: '0.85rem',
              fontWeight: inputMode === 'quick' ? 'bold' : 'normal',
              color: inputMode === 'quick' ? '#fff' : 'var(--text-muted)',
              borderBottom: inputMode === 'quick' ? '2px solid var(--primary)' : '2px solid transparent',
              backgroundColor: inputMode === 'quick' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              cursor: 'pointer'
            }}
          >
            <Banknote size={15} color="var(--primary)" />
            <span>Ingreso Rápido de Monto Total</span>
          </button>
        </div>

        {/* Contenido con Scroll */}
        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
          {inputMode === 'quick' ? (
            <div style={{
              padding: '2rem 1.5rem',
              textAlign: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '14px',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}>
              <Banknote size={36} color="var(--primary)" style={{ margin: '0 auto 0.75rem' }} />
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#fff', fontSize: '1.1rem' }}>
                Ingresa el Monto Total Físico en la Caja
              </h4>
              <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Escribe la suma completa de dinero (billetes + monedas) que tienes físicamente en la gaveta.
              </p>

              <div style={{ maxWidth: '300px', margin: '0 auto' }}>
                <input
                  type="number"
                  min="0"
                  placeholder="$ 0"
                  value={quickTotalCounted}
                  onChange={(e) => setQuickTotalCounted(e.target.value)}
                  className="input-field"
                  style={{
                    width: '100%',
                    fontSize: '1.6rem',
                    textAlign: 'center',
                    fontWeight: 900,
                    padding: '0.75rem 1rem',
                    color: '#10b981',
                    borderRadius: '12px',
                    borderColor: 'rgba(16, 185, 129, 0.4)'
                  }}
                  autoFocus
                />
              </div>

              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                {[10000, 20000, 50000, 100000].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      const cur = parseInt(quickTotalCounted || '0', 10) || 0;
                      setQuickTotalCounted(String(cur + val));
                    }}
                    className="btn btn-outline"
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                  >
                    +{formatMoneyCLP(val)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              {/* Sección de Billetes */}
              <div style={{ marginBottom: '1.35rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Banknote size={16} color="var(--primary)" /> Billetes en Gaveta
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: '#a5b4fc', fontWeight: 'bold' }}>
                    Total Billetes: {formatMoneyCLP(totalBills)}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.55rem' }}>
                  {BILL_CONFIG.map(b => {
                    const qty = bills[b.value] || 0;
                    const subtotal = qty * b.value;
                    return (
                      <div
                        key={b.value}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.45rem 0.75rem',
                          backgroundColor: 'rgba(255, 255, 255, 0.03)',
                          border: `1px solid ${qty > 0 ? b.border : 'rgba(255, 255, 255, 0.08)'}`,
                          borderRadius: '10px'
                        }}
                      >
                        <span style={{
                          padding: '2px 7px',
                          borderRadius: '6px',
                          backgroundColor: b.bg,
                          border: `1px solid ${b.border}`,
                          color: '#fff',
                          fontWeight: 'bold',
                          fontSize: '0.82rem',
                          width: '78px',
                          textAlign: 'center'
                        }}>
                          {b.label}
                        </span>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <button
                            type="button"
                            onClick={() => handleBillChange(b.value, Math.max(0, qty - 1))}
                            className="btn btn-outline"
                            style={{ padding: '0.15rem 0.45rem', fontSize: '0.85rem' }}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            value={qty === 0 ? '' : qty}
                            placeholder="0"
                            onChange={(e) => handleBillChange(b.value, e.target.value)}
                            className="input-field"
                            style={{
                              width: '50px',
                              textAlign: 'center',
                              padding: '0.2rem',
                              fontSize: '0.9rem',
                              fontWeight: 'bold'
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleBillChange(b.value, qty + 1)}
                            className="btn btn-outline"
                            style={{ padding: '0.15rem 0.45rem', fontSize: '0.85rem' }}
                          >
                            +
                          </button>
                        </div>

                        <div style={{ width: '80px', textAlign: 'right', fontSize: '0.85rem', fontWeight: qty > 0 ? 'bold' : 'normal', color: qty > 0 ? '#6ee7b7' : 'var(--text-muted)' }}>
                          {formatMoneyCLP(subtotal)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Sección de Monedas */}
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Coins size={16} color="#f59e0b" /> Monedas en Gaveta
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: '#fcd34d', fontWeight: 'bold' }}>
                    Total Monedas: {formatMoneyCLP(totalCoins)}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.55rem' }}>
                  {COIN_CONFIG.map(c => {
                    const qty = coins[c.value] || 0;
                    const subtotal = qty * c.value;
                    return (
                      <div
                        key={c.value}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.45rem 0.75rem',
                          backgroundColor: 'rgba(255, 255, 255, 0.03)',
                          border: `1px solid ${qty > 0 ? c.border : 'rgba(255, 255, 255, 0.08)'}`,
                          borderRadius: '10px'
                        }}
                      >
                        <span style={{
                          padding: '2px 7px',
                          borderRadius: '6px',
                          backgroundColor: c.bg,
                          border: `1px solid ${c.border}`,
                          color: '#fff',
                          fontWeight: 'bold',
                          fontSize: '0.82rem',
                          width: '78px',
                          textAlign: 'center'
                        }}>
                          {c.label}
                        </span>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <button
                            type="button"
                            onClick={() => handleCoinChange(c.value, Math.max(0, qty - 1))}
                            className="btn btn-outline"
                            style={{ padding: '0.15rem 0.45rem', fontSize: '0.85rem' }}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            value={qty === 0 ? '' : qty}
                            placeholder="0"
                            onChange={(e) => handleCoinChange(c.value, e.target.value)}
                            className="input-field"
                            style={{
                              width: '50px',
                              textAlign: 'center',
                              padding: '0.2rem',
                              fontSize: '0.9rem',
                              fontWeight: 'bold'
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleCoinChange(c.value, qty + 1)}
                            className="btn btn-outline"
                            style={{ padding: '0.15rem 0.45rem', fontSize: '0.85rem' }}
                          >
                            +
                          </button>
                        </div>

                        <div style={{ width: '80px', textAlign: 'right', fontSize: '0.85rem', fontWeight: qty > 0 ? 'bold' : 'normal', color: qty > 0 ? '#6ee7b7' : 'var(--text-muted)' }}>
                          {formatMoneyCLP(subtotal)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Notas / Observaciones del Cierre */}
          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              Observación o Nota de la Cuadratura (Opcional):
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Cuadratura conforme al cierre de evento, dinero entregado a tesorero..."
              className="input-field"
              style={{ width: '100%', fontSize: '0.85rem', padding: '0.45rem 0.75rem' }}
            />
          </div>
        </div>

        {/* Barra Inferior de Acciones */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          backgroundColor: 'rgba(0, 0, 0, 0.4)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={handleResetCount}
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              title="Restablecer contadores a cero"
            >
              <RotateCcw size={14} /> Limpiar
            </button>

            <button
              type="button"
              onClick={handlePrintReceipt}
              className="btn btn-outline"
              style={{
                fontSize: '0.8rem',
                padding: '0.45rem 0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                borderColor: '#10b981',
                color: '#10b981'
              }}
              title="Imprimir comprobante térmico de cuadratura"
            >
              <Printer size={14} /> Imprimir Comprobante
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {saveSuccess && (
              <span style={{ fontSize: '0.82rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 'bold' }}>
                <Check size={16} /> ¡Cuadratura Guardada!
              </span>
            )}

            <button
              type="button"
              onClick={onClose}
              className="btn btn-outline"
              style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
            >
              Cerrar
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={handleSaveReconciliation}
              className="btn btn-primary"
              style={{
                fontSize: '0.85rem',
                padding: '0.5rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                backgroundColor: '#10b981',
                borderColor: '#10b981',
                color: '#fff',
                fontWeight: 'bold'
              }}
            >
              <Save size={16} /> {saving ? 'Guardando...' : 'Guardar Cuadratura'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CashReconciliationModal;
