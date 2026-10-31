import React, { useState, useEffect } from 'react';
import { db } from '../../../firebase/config';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { 
  DollarSign, Activity, FileText, Printer, Package, UserCheck, Users, Settings,
  Banknote, Coins, Calculator, ChevronDown, ChevronUp, Wallet
} from 'lucide-react';
import ThermalClosureReceipt from './ThermalClosureReceipt';
import PrinterSettingsModal from '../PrinterSettingsModal';
import CashReconciliationModal from '../CashReconciliationModal';
import { 
  getPrinterConfig, 
  buildClosureReceiptPayload, 
  printViaRawBT, 
  printViaWebBluetooth 
} from '../../../utils/thermalPrinterService';

const EventSummary = ({ event }) => {
  const [stats, setStats] = useState({
    totalQuotas: 0,
    paidQuotas: 0,
    salesTotal: 0,
    cashSalesTotal: 0,
    transferSalesTotal: 0,
    pettyCashTotal: 0,
    pettyCashData: null,
    expectedCashTotal: 0,
    expensesTotal: 0,
    netProfit: 0
  });
  const [itemsSummary, setItemsSummary] = useState([]);
  const [expensesSummary, setExpensesSummary] = useState([]);
  const [inventorySummary, setInventorySummary] = useState([]);
  const [cashiersSummary, setCashiersSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPrinterModal, setShowPrinterModal] = useState(false);
  const [showPettyDetails, setShowPettyDetails] = useState(false);
  const [showReconciliationModal, setShowReconciliationModal] = useState(false);

  useEffect(() => {
    fetchStats();
  }, [event.id]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      // 1. Quotas (debts)
      const qDebts = query(collection(db, 'debts'), where('eventId', '==', event.id));
      const snapDebts = await getDocs(qDebts);
      let totalQ = 0;
      let paidQ = 0;
      snapDebts.forEach(d => {
        const data = d.data();
        totalQ += data.amount || 0;
        paidQ += data.paidAmount || 0;
      });

      // 2. Sales
      const qSales = query(collection(db, 'eventSales'), where('eventId', '==', event.id));
      const snapSales = await getDocs(qSales);
      let salesT = 0;
      let cashSalesT = 0;
      let transferSalesT = 0;
      const itemsMap = new Map();
      const cashiersMap = new Map();

      snapSales.forEach(d => {
        const data = d.data();
        if (data.status === 'cancelled' || data.status === 'anulada') return;
        salesT += data.total || 0;
        if (data.paymentMethod === 'cash') {
          cashSalesT += data.total || 0;
        } else {
          transferSalesT += data.total || 0;
        }
        
        // Items global summary
        if (data.items && Array.isArray(data.items)) {
          data.items.forEach(item => {
            let name = item.name;
            if (item.selectedSubproducts && item.selectedSubproducts.length > 0) {
              const spNames = item.selectedSubproducts.map(sp => sp.name).join(', ');
              name = `${item.name} (+${spNames})`;
            }
            
            if (!itemsMap.has(name)) {
              itemsMap.set(name, { name, qty: 0, total: 0 });
            }
            const current = itemsMap.get(name);
            current.qty += item.quantity || 1;
            const itemTotal = (item.unitPrice || item.price || 0) * (item.quantity || 1);
            current.total += itemTotal;
          });
        }

        // Cashiers summary (quien vendió qué cosas)
        const cashierName = (data.cashierName || data.createdBy || 'Cajero General').trim();
        if (!cashiersMap.has(cashierName)) {
          cashiersMap.set(cashierName, {
            name: cashierName,
            salesCount: 0,
            cashTotal: 0,
            transferTotal: 0,
            total: 0,
            productsMap: new Map()
          });
        }
        const cEntry = cashiersMap.get(cashierName);
        cEntry.salesCount += 1;
        cEntry.total += data.total || 0;
        if (data.paymentMethod === 'cash') {
          cEntry.cashTotal += data.total || 0;
        } else {
          cEntry.transferTotal += data.total || 0;
        }

        if (data.items && Array.isArray(data.items)) {
          data.items.forEach(item => {
            const pName = item.name;
            const pQty = item.quantity || 1;
            cEntry.productsMap.set(pName, (cEntry.productsMap.get(pName) || 0) + pQty);
          });
        }
      });
      
      const itemsList = Array.from(itemsMap.values()).sort((a,b) => b.total - a.total);
      setItemsSummary(itemsList);

      const cashiersList = Array.from(cashiersMap.values()).map(c => ({
        ...c,
        productsList: Array.from(c.productsMap.entries()).map(([name, qty]) => ({ name, qty }))
      })).sort((a, b) => b.total - a.total);
      setCashiersSummary(cashiersList);

      // 3. Expenses (outcomes)
      const qOutcomes = query(collection(db, 'outcomes'), where('fundId', '==', event.fundId));
      const snapOutcomes = await getDocs(qOutcomes);
      let expT = 0;
      const expensesList = [];
      snapOutcomes.forEach(d => {
        const data = d.data();
        expT += data.amount || 0;
        expensesList.push({
          title: data.title,
          amount: data.amount
        });
      });
      setExpensesSummary(expensesList);

      // 4. Inventory & Leftovers
      const qInv = query(collection(db, 'eventInventory'), where('eventId', '==', event.id));
      const snapInv = await getDocs(qInv);
      const invList = snapInv.docs.map(d => ({ id: d.id, ...d.data() }));
      invList.sort((a, b) => a.name.localeCompare(b.name));
      setInventorySummary(invList);

      // 5. Petty cash (Caja Chica / Fondo Inicial)
      let pettyCashTotal = 0;
      let pettyCashData = null;
      try {
        const pettySnap = await getDoc(doc(db, 'eventPettyCash', 'petty_' + event.id));
        if (pettySnap.exists()) {
          pettyCashData = pettySnap.data();
          pettyCashTotal = pettyCashData.total ?? pettyCashData.totalAmount ?? 0;
        }
      } catch (err) {
        console.warn("Error cargando caja chica en resumen:", err);
      }

      setStats({
        totalQuotas: totalQ,
        paidQuotas: paidQ,
        salesTotal: salesT,
        cashSalesTotal: cashSalesT,
        transferSalesTotal: transferSalesT,
        pettyCashTotal: pettyCashTotal,
        pettyCashData: pettyCashData,
        expectedCashTotal: pettyCashTotal + cashSalesT,
        expensesTotal: expT,
        netProfit: paidQ + salesT - expT
      });

    } catch (error) {
      console.error("Error fetching event stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const pettyBreakdown = stats.pettyCashData?.breakdown || { 
    ...(stats.pettyCashData?.bills || {}), 
    ...(stats.pettyCashData?.coins || {}) 
  };
  const hasPettyBreakdown = Object.values(pettyBreakdown).some(qty => (parseInt(qty, 10) || 0) > 0);

  const handlePrintClosure = async () => {
    const printMode = getPrinterConfig();
    if (printMode === 'rawbt') {
      printViaRawBT(buildClosureReceiptPayload(event, stats, itemsSummary, expensesSummary, inventorySummary, cashiersSummary));
    } else if (printMode === 'bluetooth') {
      try {
        await printViaWebBluetooth(buildClosureReceiptPayload(event, stats, itemsSummary, expensesSummary, inventorySummary, cashiersSummary));
      } catch (err) {
        console.warn("Fallo bluetooth directo, usando ventana de impresión:", err);
        window.print();
      }
    } else {
      window.print();
    }
  };

  if (loading) return <div>Cargando resumen...</div>;

  return (
    <div style={{ position: 'relative' }}>
      <ThermalClosureReceipt 
        event={event} 
        stats={stats} 
        itemsSummary={itemsSummary} 
        expensesSummary={expensesSummary} 
        inventorySummary={inventorySummary}
        cashiersSummary={cashiersSummary}
      />
      
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.5rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setShowReconciliationModal(true)}
          className="btn btn-primary"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            backgroundColor: '#10b981',
            borderColor: '#10b981',
            color: '#fff',
            fontWeight: 'bold'
          }}
          title="Cuadrar el efectivo completo que quedó en caja restando el fondo inicial que había al comenzar"
        >
          <Calculator size={18} /> Cuadrar Efectivo en Caja
        </button>
        <button
          type="button"
          onClick={() => setShowPrinterModal(true)}
          className="btn btn-outline"
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          title="Configurar método de impresión térmica"
        >
          <Settings size={18} /> Configurar Impresora
        </button>
        <button 
          onClick={handlePrintClosure}
          className="btn btn-outline"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)', borderColor: 'var(--primary)' }}
        >
          <Printer size={18} /> Imprimir Cierre de Evento
        </button>
      </div>

      {/* Tarjetas Financieras */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: 'rgba(59,130,246,0.2)', padding: '1rem', borderRadius: '50%', color: '#3b82f6' }}>
            <FileText size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', margin: 0 }}>{formatMoney(stats.paidQuotas)}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Recaudado por Cuotas</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--warning)', margin: 0 }}>De {formatMoney(stats.totalQuotas)} esperados</p>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--success)' }}>
            <Activity size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', margin: 0 }}>{formatMoney(stats.salesTotal)}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Total en Ventas POS</p>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: 'rgba(239,68,68,0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--danger)' }}>
            <DollarSign size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', margin: 0 }}>{formatMoney(stats.expensesTotal)}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Gastos Registrados</p>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', backgroundColor: stats.netProfit >= 0 ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)', border: `1px solid ${stats.netProfit >= 0 ? 'var(--success)' : 'var(--danger)'}` }}>
          <div>
            <h3 style={{ fontSize: '1.5rem', margin: 0, color: stats.netProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {formatMoney(stats.netProfit)}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', fontWeight: 'bold' }}>Ganancia Neta (Fondo)</p>
          </div>
        </div>
      </div>

      {/* Sección Cuadratura y Arqueo de Efectivo en Caja */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem', border: '1px solid rgba(16, 185, 129, 0.3)', background: 'linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(15,23,42,0.6) 100%)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem' }}>
              <Calculator size={22} /> Cuadratura y Arqueo de Efectivo en Caja
            </h3>
            <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Control del dinero físico en gaveta: Fondo inicial de Caja Chica + ventas en efectivo
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setShowReconciliationModal(true)}
              className="btn btn-outline"
              style={{
                fontSize: '0.82rem',
                padding: '0.35rem 0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                borderColor: '#10b981',
                color: '#6ee7b7',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                fontWeight: '600'
              }}
              title="Contar el efectivo en gaveta y cuadrar restando el fondo inicial que había al comenzar"
            >
              <Calculator size={15} />
              {stats.pettyCashData?.closingAudit ? 'Editar Cuadratura de Caja' : 'Cuadrar Efectivo en Caja'}
            </button>
            {hasPettyBreakdown && (
              <button
                type="button"
                onClick={() => setShowPettyDetails(!showPettyDetails)}
                className="btn btn-outline"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <Banknote size={15} />
                {showPettyDetails ? 'Ocultar desglose billetes/monedas' : 'Ver desglose billetes/monedas'}
                {showPettyDetails ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          {/* Fondo Inicial */}
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#38bdf8', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
              <Coins size={16} /> Fondo Inicial (Caja Chica)
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 'bold' }}>
              {formatMoney(stats.pettyCashTotal || 0)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              {stats.pettyCashData ? 'Registrado en POS' : 'Sin fondo inicial registrado'}
            </div>
          </div>

          {/* Ventas en Efectivo */}
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10b981', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
              <Banknote size={16} /> (+) Ventas en Efectivo
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 'bold', color: 'var(--success)' }}>
              {formatMoney(stats.cashSalesTotal || 0)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Dinero recaudado físicamente
            </div>
          </div>

          {/* Total Físico Esperado */}
          <div style={{ background: 'rgba(16,185,129,0.12)', padding: '1rem', borderRadius: '10px', border: '1px solid rgba(16,185,129,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--success)', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }}>
              <Wallet size={16} /> (=) TOTAL EFECTIVO EN CAJA
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#10b981' }}>
              {formatMoney(stats.expectedCashTotal || 0)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Monto a contar en la gaveta física
            </div>
          </div>

          {/* Ventas por Transferencia */}
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#a855f7', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
              <Activity size={16} /> Ventas Transferencia
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 'bold', color: '#c084fc' }}>
              {formatMoney(stats.transferSalesTotal || 0)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Directo a la cuenta bancaria
            </div>
          </div>
        </div>

        {/* Desglose colapsable de billetes y monedas */}
        {showPettyDetails && hasPettyBreakdown && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.75rem', color: '#38bdf8' }}>
              Desglose detallado del Fondo Inicial:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {Object.entries(pettyBreakdown).map(([denomKey, count]) => {
                const countNum = parseInt(count, 10) || 0;
                if (countNum <= 0) return null;
                const value = parseInt(denomKey, 10) || 0;
                const subtotal = countNum * value;
                const isBill = value >= 1000;
                return (
                  <div 
                    key={denomKey}
                    style={{ 
                      fontSize: '0.8rem',
                      padding: '0.4rem 0.75rem',
                      borderRadius: '6px',
                      background: isBill ? 'rgba(59,130,246,0.15)' : 'rgba(234,179,8,0.15)',
                      border: `1px solid ${isBill ? 'rgba(59,130,246,0.3)' : 'rgba(234,179,8,0.3)'}`,
                      color: 'var(--text-main)'
                    }}
                  >
                    <strong>{countNum}x</strong> {isBill ? 'Billete' : 'Moneda'} {formatMoney(value)} = <span style={{ fontWeight: 'bold', color: isBill ? '#60a5fa' : '#facc15' }}>{formatMoney(subtotal)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* Cuadratura Registrada de Cierre */}
        {stats.pettyCashData?.closingAudit && (
          <div style={{
            marginTop: '1.25rem',
            padding: '1.1rem 1.25rem',
            borderRadius: '12px',
            backgroundColor: stats.pettyCashData.closingAudit.difference === 0
              ? 'rgba(16, 185, 129, 0.12)'
              : stats.pettyCashData.closingAudit.difference > 0
                ? 'rgba(59, 130, 246, 0.12)'
                : 'rgba(239, 68, 68, 0.12)',
            border: stats.pettyCashData.closingAudit.difference === 0
              ? '1px solid #10b981'
              : stats.pettyCashData.closingAudit.difference > 0
                ? '1px solid #3b82f6'
                : '1px solid #ef4444',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <span style={{
                  fontSize: '0.8rem',
                  padding: '3px 10px',
                  borderRadius: '20px',
                  fontWeight: 'bold',
                  backgroundColor: stats.pettyCashData.closingAudit.difference === 0
                    ? '#10b981'
                    : stats.pettyCashData.closingAudit.difference > 0
                      ? '#3b82f6'
                      : '#ef4444',
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  {stats.pettyCashData.closingAudit.difference === 0
                    ? '✓ CAJA CUADRADA ($0)'
                    : stats.pettyCashData.closingAudit.difference > 0
                      ? `SOBRANTE (+${formatMoney(stats.pettyCashData.closingAudit.difference)})`
                      : `FALTANTE (${formatMoney(stats.pettyCashData.closingAudit.difference)})`}
                </span>
                <strong style={{ fontSize: '0.98rem', color: '#fff' }}>
                  Cuadratura de Cierre Guardada
                </strong>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {stats.pettyCashData.closingAudit.auditedAt ? new Date(stats.pettyCashData.closingAudit.auditedAt).toLocaleString('es-CL') : ''}
                  {stats.pettyCashData.closingAudit.auditedBy ? ` • ${stats.pettyCashData.closingAudit.auditedBy}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setShowReconciliationModal(true)}
                  className="btn btn-outline"
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', color: '#cbd5e1' }}
                >
                  Modificar
                </button>
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: '0.75rem',
              fontSize: '0.88rem',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              padding: '0.85rem',
              borderRadius: '8px'
            }}>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem', display: 'block' }}>Total Contado en Gaveta:</span>
                <strong style={{ fontSize: '1.15rem', color: '#10b981' }}>{formatMoney(stats.pettyCashData.closingAudit.finalCashCounted || 0)}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem', display: 'block' }}>(-) Fondo Inicial que había:</span>
                <strong style={{ fontSize: '1.15rem', color: '#f87171' }}>- {formatMoney(stats.pettyCashData.closingAudit.initialPettyCash || 0)}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem', display: 'block' }}>(=) Recaudación Neta Real:</span>
                <strong style={{ fontSize: '1.15rem', color: '#fff' }}>{formatMoney(stats.pettyCashData.closingAudit.netCashEarned || 0)}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem', display: 'block' }}>Ventas POS en Efectivo:</span>
                <strong style={{ fontSize: '1.15rem', color: '#cbd5e1' }}>{formatMoney(stats.pettyCashData.closingAudit.systemCashSales || 0)}</strong>
              </div>
            </div>

            {stats.pettyCashData.closingAudit.notes && (
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#fef08a', fontStyle: 'italic' }}>
                Observación: {stats.pettyCashData.closingAudit.notes}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Sección Rendición y Ventas por Cajero */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={20} /> Rendición y Control de Ventas por Cajero(a)
        </h3>
        
        {cashiersSummary.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
            No hay ventas registradas por cajeros aún.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem 0.5rem' }}>Cajero(a)</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Ventas</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>Efectivo</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>Transferencia</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>Total Recaudado</th>
                  <th style={{ padding: '0.65rem 0.5rem' }}>Productos que vendió</th>
                </tr>
              </thead>
              <tbody>
                {cashiersSummary.map((c, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <UserCheck size={16} color="var(--primary)" />
                        <strong style={{ fontSize: '0.95rem' }}>{c.name}</strong>
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                      <span style={{ fontWeight: '500' }}>{c.salesCount}</span>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                      {formatMoney(c.cashTotal)}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                      {formatMoney(c.transferTotal)}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                      <strong style={{ color: 'var(--success)', fontSize: '0.95rem' }}>{formatMoney(c.total)}</strong>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                        {c.productsList.map((p, pIdx) => (
                          <span 
                            key={pIdx}
                            style={{ 
                              fontSize: '0.75rem', 
                              backgroundColor: 'rgba(99,102,241,0.1)', 
                              border: '1px solid rgba(99,102,241,0.2)',
                              padding: '0.15rem 0.45rem',
                              borderRadius: '12px',
                              color: 'var(--text-main)'
                            }}
                          >
                            <strong>{p.qty}x</strong> {p.name}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sección Balance de Inventario y Sobrantes */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Package size={20} /> Balance de Inventario y Sobrantes del Evento
        </h3>
        
        {inventorySummary.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
            No se registraron insumos en el inventario para este evento.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem 0.5rem' }}>Insumo</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Total Comprado</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Consumido (POS)</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Stock Teórico Restante</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Sobrante Real (Físico)</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Diferencia / Merma</th>
                </tr>
              </thead>
              <tbody>
                {inventorySummary.map(item => {
                  const purchased = item.totalPurchased || item.initialQuantity || 0;
                  const current = item.currentStock !== undefined ? item.currentStock : purchased;
                  const consumed = Math.max(0, purchased - current);
                  const hasPhysical = item.finalCount !== undefined && item.finalCount !== null;
                  const diff = hasPhysical ? (item.finalCount - current) : null;

                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '0.65rem 0.5rem' }}>
                        <strong>{item.name}</strong>
                      </td>
                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        {purchased} {item.unit}
                      </td>
                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        {consumed} {item.unit}
                      </td>
                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                        <strong style={{ color: 'var(--primary)' }}>{current} {item.unit}</strong>
                      </td>
                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                        {hasPhysical ? (
                          <strong style={{ color: 'var(--text-main)' }}>{item.finalCount} {item.unit}</strong>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>
                            (Ver pestaña Inventario)
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                        {!hasPhysical ? (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                        ) : diff === 0 ? (
                          <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>✓ Exacto</span>
                        ) : diff < 0 ? (
                          <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>Merma: {diff} {item.unit}</span>
                        ) : (
                          <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>+{diff} {item.unit}</span>
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

      {/* Modal de Configuración de Impresora */}
      <PrinterSettingsModal
        isOpen={showPrinterModal}
        onClose={() => setShowPrinterModal(false)}
        eventName={event.name}
      />

      {/* Modal para Cuadrar Efectivo en Caja */}
      <CashReconciliationModal
        isOpen={showReconciliationModal}
        onClose={() => setShowReconciliationModal(false)}
        eventId={event.id}
        courseId={event.courseId}
        eventName={event.name}
        initialPettyCash={stats.pettyCashTotal || 0}
        cashSalesTotal={stats.cashSalesTotal || 0}
        cashierName="Cajero/a"
        currentPettyCashData={stats.pettyCashData}
        onReconciliationSaved={fetchStats}
      />
    </div>
  );
};

export default EventSummary;
