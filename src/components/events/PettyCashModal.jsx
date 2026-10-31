import React, { useState, useEffect } from 'react';
import { db } from '../../firebase/config';
import { doc, setDoc } from 'firebase/firestore';
import { 
  Banknote, Coins, Calculator, Printer, Check, X, 
  RotateCcw, Sparkles, DollarSign, AlertCircle, ArrowRight
} from 'lucide-react';
import { 
  formatMoneyCLP, 
  getPrinterConfig, 
  buildPettyCashReceiptPayload, 
  buildCashAuditReceiptPayload, 
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

const PettyCashModal = ({ 
  isOpen, 
  onClose, 
  eventId, 
  courseId,
  eventName, 
  currentPettyCash, 
  cashSalesTotal = 0, 
  transferSalesTotal = 0, 
  totalSales = 0, 
  cashierName = 'Cajero General',
  onOpenReconciliation,
  onPettyCashSaved
}) => {
  const [bills, setBills] = useState({
    20000: 0,
    10000: 0,
    5000: 0,
    2000: 0,
    1000: 0
  });

  const [coins, setCoins] = useState({
    500: 0,
    100: 0,
    50: 0,
    10: 0
  });

  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('input'); // 'input' | 'audit'

  // Cargar datos existentes si ya hay una caja chica registrada
  useEffect(() => {
    if (currentPettyCash) {
      if (currentPettyCash.bills) {
        setBills({
          20000: currentPettyCash.bills[20000] || 0,
          10000: currentPettyCash.bills[10000] || 0,
          5000: currentPettyCash.bills[5000] || 0,
          2000: currentPettyCash.bills[2000] || 0,
          1000: currentPettyCash.bills[1000] || 0
        });
      }
      if (currentPettyCash.coins) {
        setCoins({
          500: currentPettyCash.coins[500] || 0,
          100: currentPettyCash.coins[100] || 0,
          50: currentPettyCash.coins[50] || 0,
          10: currentPettyCash.coins[10] || 0
        });
      }
      setNote(currentPettyCash.note || '');
    } else {
      // Limpiar al abrir vacía
      setBills({ 20000: 0, 10000: 0, 5000: 0, 2000: 0, 1000: 0 });
      setCoins({ 500: 0, 100: 0, 50: 0, 10: 0 });
      setNote('');
    }
  }, [currentPettyCash, isOpen]);

  if (!isOpen) return null;

  // Cálculos dinámicos
  const totalBills = BILL_CONFIG.reduce((sum, b) => sum + (bills[b.value] || 0) * b.value, 0);
  const totalCoins = COIN_CONFIG.reduce((sum, c) => sum + (coins[c.value] || 0) * c.value, 0);
  const totalPettyCash = totalBills + totalCoins;

  // Cuadratura
  const expectedTotalCashInDrawer = totalPettyCash + cashSalesTotal;

  const handleBillChange = (val, qty) => {
    const parsed = Math.max(0, parseInt(qty, 10) || 0);
    setBills(prev => ({ ...prev, [val]: parsed }));
  };

  const handleCoinChange = (val, qty) => {
    const parsed = Math.max(0, parseInt(qty, 10) || 0);
    setCoins(prev => ({ ...prev, [val]: parsed }));
  };

  const handleReset = () => {
    if (window.confirm('¿Deseas reiniciar todas las cantidades a cero?')) {
      setBills({ 20000: 0, 10000: 0, 5000: 0, 2000: 0, 1000: 0 });
      setCoins({ 500: 0, 100: 0, 50: 0, 10: 0 });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const docId = `petty_${eventId}`;
      const payload = {
        eventId,
        courseId: courseId || currentPettyCash?.courseId || '',
        bills,
        coins,
        totalBills,
        totalCoins,
        total: totalPettyCash,
        totalAmount: totalPettyCash,
        breakdown: { ...bills, ...coins },
        note: note.trim(),
        cashierName,
        updatedAt: new Date().toISOString()
      };

      if (!currentPettyCash?.createdAt) {
        payload.createdAt = new Date().toISOString();
      }

      await setDoc(doc(db, 'eventPettyCash', docId), payload, { merge: true });
      if (onPettyCashSaved) {
        onPettyCashSaved(payload);
      }
      onClose();
    } catch (err) {
      console.error("Error al guardar caja chica:", err);
      alert("Error al guardar caja chica: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Impresión térmica de apertura de caja chica
  const handlePrintPettyCash = async () => {
    const payloadData = {
      bills,
      coins,
      total: totalPettyCash,
      note,
      createdAt: currentPettyCash?.createdAt || new Date().toISOString()
    };
    const receiptPayload = buildPettyCashReceiptPayload(eventName, payloadData, cashierName);

    const printMode = getPrinterConfig();
    if (printMode === 'rawbt') {
      printViaRawBT(receiptPayload);
    } else if (printMode === 'bluetooth') {
      try {
        await printViaWebBluetooth(receiptPayload);
      } catch (err) {
        console.warn("Fallo bluetooth, imprimiendo:", err);
      }
    } else {
      window.print();
    }
  };

  // Impresión térmica de arqueo de caja
  const handlePrintAudit = async () => {
    const receiptPayload = buildCashAuditReceiptPayload(
      eventName, 
      totalPettyCash, 
      cashSalesTotal, 
      transferSalesTotal, 
      totalSales, 
      cashierName
    );

    const printMode = getPrinterConfig();
    if (printMode === 'rawbt') {
      printViaRawBT(receiptPayload);
    } else if (printMode === 'bluetooth') {
      try {
        await printViaWebBluetooth(receiptPayload);
      } catch (err) {
        console.warn("Fallo bluetooth, imprimiendo:", err);
      }
    } else {
      window.print();
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.82)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100000,
      padding: '1rem'
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '680px',
        maxHeight: '92vh',
        backgroundColor: '#0f172a',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: '16px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)'
      }}>
        {/* Cabecera */}
        <div style={{
          padding: '1.1rem 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          background: 'rgba(255, 255, 255, 0.02)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              backgroundColor: 'rgba(99, 102, 241, 0.2)',
              border: '1px solid var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)'
            }}>
              <Banknote size={22} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#fff', fontWeight: 700 }}>
                Caja Chica y Control de Efectivo
              </h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {eventName} • Cajero(a): <strong style={{ color: '#fff' }}>{cashierName}</strong>
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

        {/* Pestañas: Ingreso de Desglose vs Arqueo en Vivo */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          backgroundColor: 'rgba(0, 0, 0, 0.2)'
        }}>
          <button
            type="button"
            onClick={() => setActiveTab('input')}
            style={{
              flex: 1,
              padding: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              fontSize: '0.88rem',
              fontWeight: activeTab === 'input' ? 'bold' : 'normal',
              color: activeTab === 'input' ? '#fff' : 'var(--text-muted)',
              borderBottom: activeTab === 'input' ? '2px solid var(--primary)' : '2px solid transparent',
              backgroundColor: activeTab === 'input' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              cursor: 'pointer'
            }}
          >
            <Coins size={16} color="var(--primary)" />
            <span>Desglose de Billetes y Monedas ({formatMoneyCLP(totalPettyCash)})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            style={{
              flex: 1,
              padding: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              fontSize: '0.88rem',
              fontWeight: activeTab === 'audit' ? 'bold' : 'normal',
              color: activeTab === 'audit' ? '#fff' : 'var(--text-muted)',
              borderBottom: activeTab === 'audit' ? '2px solid #10b981' : '2px solid transparent',
              backgroundColor: activeTab === 'audit' ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              cursor: 'pointer'
            }}
          >
            <Calculator size={16} color="#10b981" />
            <span>Arqueo y Total en Caja ({formatMoneyCLP(expectedTotalCashInDrawer)})</span>
          </button>
        </div>

        {/* Contenido con Scroll */}
        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>

          {activeTab === 'input' && (
            <div>
              {/* Tarjeta Resumen Rápido Superior */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '0.75rem',
                marginBottom: '1.25rem'
              }}>
                <div style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(99, 102, 241, 0.12)',
                  border: '1px solid rgba(99, 102, 241, 0.3)'
                }}>
                  <span style={{ fontSize: '0.72rem', color: '#a5b4fc', textTransform: 'uppercase', display: 'block' }}>
                    Total Billetes
                  </span>
                  <strong style={{ fontSize: '1.15rem', color: '#fff' }}>
                    {formatMoneyCLP(totalBills)}
                  </strong>
                </div>

                <div style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.3)'
                }}>
                  <span style={{ fontSize: '0.72rem', color: '#fcd34d', textTransform: 'uppercase', display: 'block' }}>
                    Total Monedas
                  </span>
                  <strong style={{ fontSize: '1.15rem', color: '#fff' }}>
                    {formatMoneyCLP(totalCoins)}
                  </strong>
                </div>

                <div style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid #10b981'
                }}>
                  <span style={{ fontSize: '0.72rem', color: '#6ee7b7', textTransform: 'uppercase', display: 'block' }}>
                    Total Fondo Inicial (Caja Chica)
                  </span>
                  <strong style={{ fontSize: '1.25rem', color: '#10b981' }}>
                    {formatMoneyCLP(totalPettyCash)}
                  </strong>
                </div>
              </div>

              {/* Sección de Billetes */}
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Banknote size={17} color="var(--primary)" /> Billetes Chilenos
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Ingresa la cantidad de billetes por cada valor
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.6rem' }}>
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
                          padding: '0.5rem 0.85rem',
                          backgroundColor: 'rgba(255, 255, 255, 0.03)',
                          border: `1px solid ${qty > 0 ? b.border : 'rgba(255, 255, 255, 0.08)'}`,
                          borderRadius: '10px',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '90px' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            backgroundColor: b.bg,
                            border: `1px solid ${b.border}`,
                            color: '#fff',
                            fontWeight: 'bold',
                            fontSize: '0.85rem'
                          }}>
                            {b.label}
                          </span>
                        </div>

                        {/* Controles de Cantidad */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <button
                            type="button"
                            onClick={() => handleBillChange(b.value, Math.max(0, qty - 1))}
                            className="btn btn-outline"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.85rem', lineHeight: 1 }}
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
                              width: '54px',
                              textAlign: 'center',
                              padding: '0.25rem',
                              fontSize: '0.9rem',
                              fontWeight: 'bold',
                              color: qty > 0 ? '#fff' : 'var(--text-muted)'
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleBillChange(b.value, qty + 1)}
                            className="btn btn-outline"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.85rem', lineHeight: 1 }}
                          >
                            +
                          </button>
                        </div>

                        {/* Subtotal */}
                        <div style={{ width: '85px', textAlign: 'right' }}>
                          <span style={{
                            fontSize: '0.85rem',
                            fontWeight: qty > 0 ? 'bold' : 'normal',
                            color: qty > 0 ? '#6ee7b7' : 'var(--text-muted)'
                          }}>
                            {formatMoneyCLP(subtotal)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Sección de Monedas */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Coins size={17} color="#f59e0b" /> Monedas Chilenas
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Monedas para dar vuelto
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.6rem' }}>
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
                          padding: '0.5rem 0.85rem',
                          backgroundColor: 'rgba(255, 255, 255, 0.03)',
                          border: `1px solid ${qty > 0 ? c.border : 'rgba(255, 255, 255, 0.08)'}`,
                          borderRadius: '10px',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '90px' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            backgroundColor: c.bg,
                            border: `1px solid ${c.border}`,
                            color: '#fff',
                            fontWeight: 'bold',
                            fontSize: '0.85rem'
                          }}>
                            {c.label}
                          </span>
                        </div>

                        {/* Controles de Cantidad */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <button
                            type="button"
                            onClick={() => handleCoinChange(c.value, Math.max(0, qty - 1))}
                            className="btn btn-outline"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.85rem', lineHeight: 1 }}
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
                              width: '54px',
                              textAlign: 'center',
                              padding: '0.25rem',
                              fontSize: '0.9rem',
                              fontWeight: 'bold',
                              color: qty > 0 ? '#fff' : 'var(--text-muted)'
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleCoinChange(c.value, qty + 1)}
                            className="btn btn-outline"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.85rem', lineHeight: 1 }}
                          >
                            +
                          </button>
                        </div>

                        {/* Subtotal */}
                        <div style={{ width: '85px', textAlign: 'right' }}>
                          <span style={{
                            fontSize: '0.85rem',
                            fontWeight: qty > 0 ? 'bold' : 'normal',
                            color: qty > 0 ? '#6ee7b7' : 'var(--text-muted)'
                          }}>
                            {formatMoneyCLP(subtotal)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Nota / Observación Opcional */}
              <div style={{ marginTop: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  Nota u Observación (Opcional, ej. Entregado por Tesorero Pedro):
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ej: Fondo inicial entregado por Tesorería..."
                  className="input-field"
                  style={{ width: '100%', fontSize: '0.85rem', padding: '0.45rem 0.75rem' }}
                />
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Tarjeta Principal de Cuadratura de Efectivo */}
              <div style={{
                padding: '1.5rem',
                borderRadius: '14px',
                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Calculator size={22} color="#10b981" />
                  <h4 style={{ margin: 0, fontSize: '1.1rem', color: '#fff' }}>
                    Cuadratura de Efectivo en Caja
                  </h4>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.95rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Fondo Inicial (Caja Chica):</span>
                    <strong style={{ color: '#fff', fontSize: '1.05rem' }}>{formatMoneyCLP(totalPettyCash)}</strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Ventas Realizadas en Efectivo (+):</span>
                    <strong style={{ color: '#6ee7b7', fontSize: '1.05rem' }}>+ {formatMoneyCLP(cashSalesTotal)}</strong>
                  </div>

                  <div style={{
                    paddingTop: '0.75rem',
                    marginTop: '0.5rem',
                    borderTop: '2px dashed rgba(255, 255, 255, 0.15)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div>
                      <strong style={{ fontSize: '1.1rem', color: '#fff', display: 'block' }}>
                        TOTAL EFECTIVO EN CAJA
                      </strong>
                      <span style={{ fontSize: '0.78rem', color: '#10b981' }}>
                        Monto exacto de billetes y monedas que debe haber en la caja física
                      </span>
                    </div>
                    <strong style={{ fontSize: '1.6rem', color: '#10b981' }}>
                      {formatMoneyCLP(expectedTotalCashInDrawer)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Desglose Complementario de Ventas (Transferencias vs Efectivo) */}
              <div style={{
                padding: '1.25rem',
                borderRadius: '12px',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}>
                <h5 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Resumen de Ventas del POS
                </h5>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.88rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Ventas Pagadas en Efectivo:</span>
                    <span>{formatMoneyCLP(cashSalesTotal)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Ventas Pagadas por Transferencia:</span>
                    <span style={{ color: '#a5b4fc' }}>{formatMoneyCLP(transferSalesTotal)}</span>
                  </div>
                  <div style={{
                    paddingTop: '0.5rem',
                    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontWeight: 'bold'
                  }}>
                    <span>Total General Ventas POS:</span>
                    <span style={{ color: 'var(--primary)' }}>{formatMoneyCLP(totalSales)}</span>
                  </div>
                </div>
              </div>

              {/* Botones de Acción de Arqueo y Cuadratura */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {onOpenReconciliation && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenReconciliation();
                    }}
                    className="btn btn-primary"
                    style={{
                      padding: '0.75rem 1rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      fontSize: '0.9rem',
                      backgroundColor: '#10b981',
                      borderColor: '#10b981',
                      color: '#fff',
                      fontWeight: 'bold'
                    }}
                  >
                    <Calculator size={16} /> Realizar Cuadratura Final (Restar Fondo Inicial)
                  </button>
                )}

                <button
                  type="button"
                  onClick={handlePrintAudit}
                  className="btn btn-outline"
                  style={{
                    padding: '0.75rem 1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    fontSize: '0.9rem',
                    borderColor: '#10b981',
                    color: '#10b981'
                  }}
                >
                  <Printer size={16} /> Imprimir Comprobante de Arqueo en Impresora Térmica
                </button>
              </div>
            </div>
          )}
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
          backgroundColor: 'rgba(0, 0, 0, 0.25)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={handleReset}
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              title="Reiniciar todas las cantidades de billetes y monedas a cero"
            >
              <RotateCcw size={14} /> Limpiar
            </button>

            <button
              type="button"
              onClick={handlePrintPettyCash}
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              title="Imprimir ticket con el desglose de apertura de caja chica en la impresora térmica"
            >
              <Printer size={14} /> Imprimir Apertura
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
              onClick={handleSave}
              disabled={saving}
              className="btn btn-primary"
              style={{
                fontSize: '0.9rem',
                padding: '0.5rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontWeight: 'bold',
                backgroundColor: 'var(--primary)'
              }}
            >
              {saving ? 'Guardando...' : <><Check size={16} /> Guardar Caja Chica</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PettyCashModal;
