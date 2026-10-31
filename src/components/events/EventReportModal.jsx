import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase/config';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { 
  FileText, Download, Share2, Printer, X, DollarSign, 
  TrendingUp, TrendingDown, Users, AlertCircle, CheckCircle2,
  Package, ShoppingBag, Banknote, CreditCard, ChevronRight, Copy, Check
} from 'lucide-react';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';
import { formatStudentName } from '../../utils/nameUtils';
import { buildEventSummaryPdfDoc, shareOrDownloadEventPdf } from '../../utils/eventPdfService';

const formatMoney = (amount) => {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
};

const EventReportModal = ({ isOpen, onClose, event }) => {
  useLockBodyScroll(isOpen);

  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState([]);
  const [debts, setDebts] = useState([]);
  const [outcomes, setOutcomes] = useState([]);
  const [pettyCash, setPettyCash] = useState(null);
  const [courseStudents, setCourseStudents] = useState([]);
  const [activeSubTab, setActiveSubTab] = useState('summary'); // 'summary' | 'items' | 'expenses' | 'debts'
  const [copiedWhatsApp, setCopiedWhatsApp] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(null);

  useEffect(() => {
    if (!isOpen || !event?.id) return;

    const loadAllReportData = async () => {
      setLoading(true);
      try {
        // 1. Ventas
        const qSales = query(collection(db, 'eventSales'), where('eventId', '==', event.id));
        const salesSnap = await getDocs(qSales);
        const salesList = salesSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(s => s.status !== 'cancelled' && s.status !== 'anulada');
        setSales(salesList);

        // 2. Cuotas y Multas (debts)
        const qDebts = query(collection(db, 'debts'), where('eventId', '==', event.id));
        const debtsSnap = await getDocs(qDebts);
        const debtsList = debtsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setDebts(debtsList);

        // 3. Gastos (outcomes)
        const qOutcomes = query(collection(db, 'outcomes'), where('fundId', '==', event.fundId));
        const outcomesSnap = await getDocs(qOutcomes);
        const outcomesList = outcomesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        outcomesList.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        setOutcomes(outcomesList);

        // 4. Caja Chica
        try {
          const pettyDoc = await getDoc(doc(db, 'eventPettyCash', `petty_${event.id}`));
          if (pettyDoc.exists()) {
            setPettyCash(pettyDoc.data());
          } else {
            setPettyCash(null);
          }
        } catch (e) {
          console.warn("Caja chica:", e);
        }

        // 5. Alumnos del curso
        try {
          const qStudents = query(collection(db, 'students'), where('courseId', '==', event.courseId));
          const studentsSnap = await getDocs(qStudents);
          setCourseStudents(studentsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) {
          console.warn("Alumnos:", e);
        }

      } catch (err) {
        console.error("Error al cargar datos del informe:", err);
      } finally {
        setLoading(false);
      }
    };

    loadAllReportData();
  }, [isOpen, event?.id, event?.fundId, event?.courseId]);

  // Cálculos de Ventas POS
  const { totalSales, cashSales, transferSales, itemsSummary } = useMemo(() => {
    let tSales = 0;
    let cSales = 0;
    let trSales = 0;
    const itemsMap = new Map();

    sales.forEach(sale => {
      const amount = sale.total || 0;
      tSales += amount;
      if (sale.paymentMethod === 'cash') {
        cSales += amount;
      } else {
        trSales += amount;
      }

      if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(item => {
          let name = item.name || 'Producto';
          if (item.selectedSubproducts && item.selectedSubproducts.length > 0) {
            const sp = item.selectedSubproducts.map(s => s.name).join(', ');
            name = `${item.name} (+${sp})`;
          }
          const qty = item.quantity || 1;
          const price = item.unitPrice || item.price || 0;
          const subtotal = price * qty;

          if (!itemsMap.has(name)) {
            itemsMap.set(name, { name, qty: 0, total: 0, unitPrice: price });
          }
          const curr = itemsMap.get(name);
          curr.qty += qty;
          curr.total += subtotal;
        });
      }
    });

    const itemsList = Array.from(itemsMap.values())
      .map(item => ({
        ...item,
        percentage: tSales > 0 ? (item.total / tSales) * 100 : 0
      }))
      .sort((a, b) => b.total - a.total);

    return {
      totalSales: tSales,
      cashSales: cSales,
      transferSales: trSales,
      itemsSummary: itemsList
    };
  }, [sales]);

  // Cálculos de Cuotas del Evento
  const { 
    mandatoryDebts, 
    mandatoryTotalPaid, 
    mandatoryTotalExpected,
    mandatoryPaidCount,
    mandatoryPendingCount,
    mandatoryPendingList,
    fineDebts,
    fineTotalPaid,
    finePendingCount
  } = useMemo(() => {
    const fineExpenseId = `exp_evt_fine_${event?.id}`;
    const mainDebts = debts.filter(d => d.expenseId !== fineExpenseId);
    const fines = debts.filter(d => d.expenseId === fineExpenseId);

    let mainPaid = 0;
    let mainExpected = 0;
    let paidCount = 0;
    const pendingList = [];

    mainDebts.forEach(d => {
      const amount = d.amount || 0;
      mainExpected += amount;
      if (d.status === 'paid') {
        mainPaid += amount;
        paidCount++;
      } else {
        const paidPart = d.paidAmount || 0;
        mainPaid += paidPart;
        pendingList.push({
          id: d.id,
          studentName: d.studentName || 'Alumno',
          amount: amount - paidPart,
          status: d.status,
          apoderadoEmails: d.apoderadoEmails || []
        });
      }
    });

    let fPaid = 0;
    let fPending = 0;
    fines.forEach(f => {
      if (f.status === 'paid') {
        fPaid += (f.amount || 0);
      } else {
        fPending++;
      }
    });

    pendingList.sort((a, b) => a.studentName.localeCompare(b.studentName));

    return {
      mandatoryDebts: mainDebts,
      mandatoryTotalPaid: mainPaid,
      mandatoryTotalExpected: mainExpected,
      mandatoryPaidCount: paidCount,
      mandatoryPendingCount: pendingList.length,
      mandatoryPendingList: pendingList,
      fineDebts: fines,
      fineTotalPaid: fPaid,
      finePendingCount: fPending
    };
  }, [debts, event?.id]);

  // Cálculos de Gastos
  const totalExpenses = useMemo(() => {
    return outcomes.reduce((sum, o) => sum + (o.amount || 0), 0);
  }, [outcomes]);

  // Fondo Inicial y Efectivo de Caja Chica
  const initialPettyFund = useMemo(() => {
    if (pettyCash?.total !== undefined && Number(pettyCash.total) > 0) {
      return Number(pettyCash.total);
    }
    if (pettyCash?.closingAudit?.initialPettyCash !== undefined && Number(pettyCash.closingAudit.initialPettyCash) > 0) {
      return Number(pettyCash.closingAudit.initialPettyCash);
    }
    return Number(pettyCash?.total || 0);
  }, [pettyCash]);

  // Balance General y Rentabilidad
  const totalIncomes = totalSales + mandatoryTotalPaid + fineTotalPaid;
  const netProfit = totalIncomes - totalExpenses;

  // Porcentaje de Ganancias vs Gastos (ROI sobre gastos)
  const profitVsExpensesPct = totalExpenses > 0 
    ? (netProfit / totalExpenses) * 100 
    : (netProfit > 0 ? 100 : 0);

  // Margen de Ganancia sobre el Total de Ingresos
  const profitMarginPct = totalIncomes > 0 
    ? (netProfit / totalIncomes) * 100 
    : 0;

  // Copiar Resumen para WhatsApp
  const handleCopyWhatsApp = () => {
    let msg = `📊 *INFORME FINANCIERO - ${event?.name?.toUpperCase()}*\n`;
    msg += `📅 *Fecha:* ${event?.date ? new Date(event.date).toLocaleDateString('es-CL') : 'Hoy'}\n\n`;
    
    msg += `💰 *RESUMEN DE INGRESOS:*\n`;
    msg += `• Ventas POS en Efectivo: ${formatMoney(cashSales)}\n`;
    msg += `• Ventas POS por Transferencia: ${formatMoney(transferSales)}\n`;
    msg += `👉 *Total Ventas POS:* ${formatMoney(totalSales)}\n`;
    if (mandatoryTotalExpected > 0) {
      msg += `• Cuotas Obligatorias Recaudadas: ${formatMoney(mandatoryTotalPaid)} (de ${formatMoney(mandatoryTotalExpected)})\n`;
    }
    if (fineTotalPaid > 0) {
      msg += `• Multas de Inasistencia Recaudadas: ${formatMoney(fineTotalPaid)}\n`;
    }
    msg += `📈 *TOTAL INGRESOS BRUTOS:* ${formatMoney(totalIncomes)}\n\n`;

    msg += `📉 *GASTOS DEL EVENTO:*\n`;
    msg += `• Total Gastos Realizados: ${formatMoney(totalExpenses)}\n\n`;

    msg += `🏆 *BALANCE FINAL Y RENTABILIDAD:*\n`;
    msg += `• *GANANCIA NETA REAL:* ${formatMoney(netProfit)}\n`;
    msg += `• *Rentabilidad vs Gastos:* ${profitVsExpensesPct >= 0 ? '+' : ''}${profitVsExpensesPct.toFixed(1)}%\n`;
    msg += `• *Margen de Ganancia:* ${profitMarginPct.toFixed(1)}%\n\n`;

    if (mandatoryDebts.length > 0) {
      msg += `👥 *CONTROL CUOTA OBLIGATORIA:*\n`;
      msg += `• Familias al día: ${mandatoryPaidCount} de ${mandatoryDebts.length}\n`;
      if (mandatoryPendingCount > 0) {
        msg += `• ⚠️ *Faltan por pagar:* ${mandatoryPendingCount} papás\n`;
        msg += `_Alumnos con cuota pendiente:_\n`;
        mandatoryPendingList.forEach((p, idx) => {
          msg += `  ${idx + 1}. ${p.studentName} (${formatMoney(p.amount)})\n`;
        });
      } else {
        msg += `• ✅ ¡Todas las familias están al día con la cuota!\n`;
      }
      msg += `\n`;
    }

    if (itemsSummary.length > 0) {
      msg += `🍔 *TOP ARTÍCULOS VENDIDOS:*\n`;
      itemsSummary.slice(0, 5).forEach((item, idx) => {
        msg += `  ${idx + 1}. ${item.name}: ${item.qty} un. (${formatMoney(item.total)})\n`;
      });
      msg += `\n`;
    }

    msg += `_Informe emitido automáticamente desde AppCurso._`;

    navigator.clipboard.writeText(msg).then(() => {
      setCopiedWhatsApp(true);
      setTimeout(() => setCopiedWhatsApp(false), 2500);
    });
  };

  // Compartir PDF Formal (Menú nativo de compartir en celular: WhatsApp, Correo, etc.)
  const handleSharePdf = async () => {
    setGeneratingPdf(true);
    setShareSuccess(null);
    try {
      const doc = await buildEventSummaryPdfDoc({
        event,
        stats: {
          salesTotal: totalSales,
          cashSalesTotal: cashSales,
          transferSalesTotal: transferSales,
          pettyCashTotal: initialPettyFund,
          expensesTotal: totalExpenses,
          pettyCashData: pettyCash
        },
        itemsSummary,
        expensesSummary: outcomes,
        mandatoryPendingList,
        mandatoryDebts,
        outcomes
      });

      const safeEventName = (event?.name || 'Evento').replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `Informe_Evento_${safeEventName}.pdf`;
      const title = `Informe del Evento: ${event?.name || 'Evento'}`;
      const text = `Adjunto el informe y balance financiero oficial del evento ${event?.name || ''} en PDF.`;

      const result = await shareOrDownloadEventPdf(doc, fileName, title, text);
      if (result.method === 'shared') {
        setShareSuccess('¡Compartido!');
      } else if (result.method === 'downloaded') {
        setShareSuccess('¡Descargado!');
      }
      setTimeout(() => setShareSuccess(null), 3000);
    } catch (err) {
      console.error("Error al generar o compartir PDF:", err);
      alert("Error al generar PDF: " + err.message);
    } finally {
      setGeneratingPdf(false);
    }
  };

  // Descargar PDF Directamente
  const handleDownloadPdf = async () => {
    setGeneratingPdf(true);
    try {
      const doc = await buildEventSummaryPdfDoc({
        event,
        stats: {
          salesTotal: totalSales,
          cashSalesTotal: cashSales,
          transferSalesTotal: transferSales,
          pettyCashTotal: initialPettyFund,
          expensesTotal: totalExpenses,
          pettyCashData: pettyCash
        },
        itemsSummary,
        expensesSummary: outcomes,
        mandatoryPendingList,
        mandatoryDebts,
        outcomes
      });

      const safeEventName = (event?.name || 'Evento').replace(/[^a-zA-Z0-9]/g, '_');
      doc.save(`Informe_Evento_${safeEventName}.pdf`);
    } catch (err) {
      console.error("Error al descargar PDF:", err);
      alert("Error al descargar PDF: " + err.message);
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (!isOpen) return null;

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
        maxWidth: '920px',
        maxHeight: '94vh',
        backgroundColor: '#0f172a',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: '16px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7)'
      }}>

        {/* Cabecera del Modal */}
        <div style={{
          padding: '1.25rem 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          background: 'rgba(255, 255, 255, 0.02)',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              backgroundColor: 'rgba(99, 102, 241, 0.2)',
              border: '1px solid var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)'
            }}>
              <FileText size={22} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#fff', fontWeight: 800 }}>
                Informe Financiero del Evento
              </h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {event?.name} • {event?.date ? new Date(event.date).toLocaleDateString('es-CL') : 'Fecha no definida'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleSharePdf}
              disabled={generatingPdf}
              className="btn btn-primary"
              style={{
                fontSize: '0.82rem',
                padding: '0.45rem 0.95rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                backgroundColor: '#0284c7',
                borderColor: '#0284c7',
                color: '#fff',
                fontWeight: 'bold'
              }}
              title="Compartir informe en PDF directamente por WhatsApp o aplicaciones del celular"
            >
              {shareSuccess ? <Check size={15} /> : <Share2 size={15} />}
              <span>{generatingPdf ? 'Generando...' : shareSuccess || 'Compartir PDF'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={generatingPdf}
              className="btn btn-outline"
              style={{
                fontSize: '0.82rem',
                padding: '0.45rem 0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
              title="Descargar archivo PDF al dispositivo"
            >
              <Download size={15} />
              <span>Descargar PDF</span>
            </button>

            <button
              type="button"
              onClick={handleCopyWhatsApp}
              className="btn btn-outline"
              style={{
                fontSize: '0.82rem',
                padding: '0.45rem 0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                borderColor: copiedWhatsApp ? '#10b981' : '#25D366',
                color: copiedWhatsApp ? '#10b981' : '#25D366'
              }}
              title="Copiar resumen en texto para WhatsApp"
            >
              {copiedWhatsApp ? <Check size={15} /> : <Copy size={15} />}
              <span>{copiedWhatsApp ? '¡Copiado!' : 'Texto WhatsApp'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="btn btn-outline"
              style={{ padding: '0.4rem', borderRadius: '50%', color: 'var(--text-muted)' }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Pestañas de Navegación del Informe */}
        <div 
          className="tabs-scroll"
          style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-x pan-y',
            maxWidth: '100%',
            width: '100%'
          }}
        >
          <button
            type="button"
            onClick={() => setActiveSubTab('summary')}
            style={{
              padding: '0.75rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontSize: '0.85rem',
              fontWeight: activeSubTab === 'summary' ? 700 : 500,
              color: activeSubTab === 'summary' ? '#fff' : 'var(--text-muted)',
              borderBottom: activeSubTab === 'summary' ? '2px solid var(--primary)' : '2px solid transparent',
              background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0
            }}
          >
            <TrendingUp size={16} color="var(--primary)" /> Resumen y Rentabilidad
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('items')}
            style={{
              padding: '0.75rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontSize: '0.85rem',
              fontWeight: activeSubTab === 'items' ? 700 : 500,
              color: activeSubTab === 'items' ? '#fff' : 'var(--text-muted)',
              borderBottom: activeSubTab === 'items' ? '2px solid #38bdf8' : '2px solid transparent',
              background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0
            }}
          >
            <ShoppingBag size={16} color="#38bdf8" /> Ventas por Artículos ({itemsSummary.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('debts')}
            style={{
              padding: '0.75rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontSize: '0.85rem',
              fontWeight: activeSubTab === 'debts' ? 700 : 500,
              color: activeSubTab === 'debts' ? '#fff' : 'var(--text-muted)',
              borderBottom: activeSubTab === 'debts' ? '2px solid #f59e0b' : '2px solid transparent',
              background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0
            }}
          >
            <Users size={16} color="#f59e0b" />
            Cuota Obligatoria
            {mandatoryPendingCount > 0 && (
              <span style={{
                backgroundColor: 'rgba(239, 68, 68, 0.25)',
                color: '#f87171',
                padding: '2px 7px',
                borderRadius: '10px',
                fontSize: '0.72rem',
                fontWeight: 'bold',
                marginLeft: '4px'
              }}>
                Faltan {mandatoryPendingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('expenses')}
            style={{
              padding: '0.75rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontSize: '0.85rem',
              fontWeight: activeSubTab === 'expenses' ? 700 : 500,
              color: activeSubTab === 'expenses' ? '#fff' : 'var(--text-muted)',
              borderBottom: activeSubTab === 'expenses' ? '2px solid #ef4444' : '2px solid transparent',
              background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0
            }}
          >
            <DollarSign size={16} color="#ef4444" /> Gastos del Evento ({outcomes.length})
          </button>
        </div>

        {/* Contenido con Scroll */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              Cargando datos consolidados del informe...
            </div>
          ) : (
            <>
              {/* VISTA 1: RESUMEN Y RENTABILIDAD */}
              {activeSubTab === 'summary' && (
                <div>
                  {/* Tarjetas Superiores de Balance Financiero */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '1rem',
                    marginBottom: '1.5rem'
                  }}>
                    {/* Total Ingresos */}
                    <div style={{
                      padding: '1.2rem',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      border: '1px solid rgba(59, 130, 246, 0.3)'
                    }}>
                      <span style={{ fontSize: '0.75rem', color: '#93c5fd', textTransform: 'uppercase', display: 'block' }}>
                        Total Ingresos Brutos
                      </span>
                      <strong style={{ fontSize: '1.4rem', color: '#fff', display: 'block', margin: '0.25rem 0' }}>
                        {formatMoney(totalIncomes)}
                      </strong>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        Ventas POS ({formatMoney(totalSales)}) + Cuotas ({formatMoney(mandatoryTotalPaid + fineTotalPaid)})
                      </span>
                    </div>

                    {/* Total Gastos */}
                    <div style={{
                      padding: '1.2rem',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)'
                    }}>
                      <span style={{ fontSize: '0.75rem', color: '#fca5a5', textTransform: 'uppercase', display: 'block' }}>
                        Total Gastos Registrados
                      </span>
                      <strong style={{ fontSize: '1.4rem', color: '#f87171', display: 'block', margin: '0.25rem 0' }}>
                        {formatMoney(totalExpenses)}
                      </strong>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        {outcomes.length} gasto(s) imputado(s) al evento
                      </span>
                    </div>

                    {/* Ganancia Neta Real */}
                    <div style={{
                      padding: '1.2rem',
                      borderRadius: '12px',
                      backgroundColor: netProfit >= 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                      border: `1px solid ${netProfit >= 0 ? '#10b981' : '#ef4444'}`
                    }}>
                      <span style={{ fontSize: '0.75rem', color: netProfit >= 0 ? '#6ee7b7' : '#fca5a5', textTransform: 'uppercase', display: 'block' }}>
                        Ganancia Neta (Fondo)
                      </span>
                      <strong style={{ fontSize: '1.4rem', color: netProfit >= 0 ? '#10b981' : '#ef4444', display: 'block', margin: '0.25rem 0' }}>
                        {formatMoney(netProfit)}
                      </strong>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        Ingresos totales menos gastos
                      </span>
                    </div>

                    {/* Porcentaje de Ganancias vs Gastos */}
                    <div style={{
                      padding: '1.2rem',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(99, 102, 241, 0.12)',
                      border: '1px solid rgba(99, 102, 241, 0.35)'
                    }}>
                      <span style={{ fontSize: '0.75rem', color: '#a5b4fc', textTransform: 'uppercase', display: 'block' }}>
                        Ganancia vs Gastos (% Rentabilidad)
                      </span>
                      <strong style={{ fontSize: '1.4rem', color: profitVsExpensesPct >= 0 ? '#818cf8' : '#f87171', display: 'block', margin: '0.25rem 0' }}>
                        {profitVsExpensesPct >= 0 ? '+' : ''}{profitVsExpensesPct.toFixed(1)}%
                      </strong>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        Margen s/ ingresos: {profitMarginPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Banner de Control de Cuota Obligatoria */}
                  <div style={{
                    padding: '1.1rem 1.35rem',
                    borderRadius: '12px',
                    backgroundColor: mandatoryPendingCount > 0 ? 'rgba(245, 158, 11, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                    border: `1px solid ${mandatoryPendingCount > 0 ? '#f59e0b' : '#10b981'}`,
                    marginBottom: '1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '1rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                      {mandatoryPendingCount > 0 ? (
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(245, 158, 11, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
                          <AlertCircle size={22} />
                        </div>
                      ) : (
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
                          <CheckCircle2 size={22} />
                        </div>
                      )}
                      <div>
                        <strong style={{ fontSize: '1rem', color: '#fff', display: 'block' }}>
                          {mandatoryPendingCount > 0 
                            ? `Faltan ${mandatoryPendingCount} papás por pagar la cuota obligatoria`
                            : '¡Todas las familias tienen la cuota obligatoria al día!'}
                        </strong>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          Cuota fijada: <strong>{formatMoney(event?.mandatoryAmount || 0)}</strong> por alumno • Pagadas: <strong>{mandatoryPaidCount}</strong> de <strong>{mandatoryDebts.length}</strong>
                        </span>
                      </div>
                    </div>

                    {mandatoryPendingCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveSubTab('debts')}
                        className="btn btn-outline"
                        style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem', borderColor: '#f59e0b', color: '#fcd34d' }}
                      >
                        Ver listado de morosos ({mandatoryPendingCount})
                      </button>
                    )}
                  </div>

                  {/* Detalle de Flujo de Efectivo en Caja y Transferencias */}
                  <div style={{
                    padding: '1.25rem',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    marginBottom: '1.5rem'
                  }}>
                    <h4 style={{ margin: '0 0 1rem 0', color: '#38bdf8', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Banknote size={18} /> Control de Medios de Pago y Efectivo Físico
                    </h4>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
                      {/* Efectivo POS */}
                      <div style={{ background: 'rgba(0,0,0,0.25)', padding: '0.9rem', borderRadius: '8px' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>
                          Efectivo Ganado en Ventas (POS)
                        </span>
                        <strong style={{ fontSize: '1.2rem', color: '#10b981' }}>{formatMoney(cashSales)}</strong>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                          Dinero en efectivo ingresado en gaveta
                        </span>
                      </div>

                      {/* Transferencias POS */}
                      <div style={{ background: 'rgba(0,0,0,0.25)', padding: '0.9rem', borderRadius: '8px' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>
                          Ingresos por Transferencias (POS)
                        </span>
                        <strong style={{ fontSize: '1.2rem', color: '#c084fc' }}>{formatMoney(transferSales)}</strong>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                          Dinero directo a la cuenta bancaria
                        </span>
                      </div>

                      {/* Fondo Inicial */}
                      <div style={{ background: 'rgba(0,0,0,0.25)', padding: '0.9rem', borderRadius: '8px' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>
                          Fondo Inicial (Caja Chica)
                        </span>
                        <strong style={{ fontSize: '1.2rem', color: '#fcd34d' }}>{formatMoney(initialPettyFund)}</strong>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                          Sencillo previo con que se abrió
                        </span>
                      </div>

                      {/* Total Esperado en Caja */}
                      <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', padding: '0.9rem', borderRadius: '8px' }}>
                        <span style={{ fontSize: '0.72rem', color: '#6ee7b7', display: 'block' }}>
                          (=) TOTAL FÍSICO ESPERADO EN CAJA
                        </span>
                        <strong style={{ fontSize: '1.25rem', color: '#10b981' }}>{formatMoney(initialPettyFund + cashSales)}</strong>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                          Fondo inicial + ventas efectivo
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Mini-tabla de Artículos Más Vendidos */}
                  {itemsSummary.length > 0 && (
                    <div style={{
                      padding: '1.25rem',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid rgba(255, 255, 255, 0.08)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                        <h4 style={{ margin: 0, color: 'var(--primary)', fontSize: '0.95rem' }}>
                          Top Artículos Más Vendidos
                        </h4>
                        <button
                          type="button"
                          onClick={() => setActiveSubTab('items')}
                          className="btn btn-outline"
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                        >
                          Ver catálogo completo ({itemsSummary.length})
                        </button>
                      </div>

                      <div className="table-responsive" style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', minWidth: '460px', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-muted)', textAlign: 'left' }}>
                              <th style={{ padding: '0.5rem' }}>Producto</th>
                              <th style={{ padding: '0.5rem', textAlign: 'center' }}>Unidades</th>
                              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Total Recaudado</th>
                              <th style={{ padding: '0.5rem', textAlign: 'right' }}>% Ventas</th>
                            </tr>
                          </thead>
                          <tbody>
                            {itemsSummary.slice(0, 5).map((item, idx) => (
                              <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                <td style={{ padding: '0.55rem 0.5rem' }}>
                                  <strong style={{ color: '#fff' }}>{item.name}</strong>
                                </td>
                                <td style={{ padding: '0.55rem 0.5rem', textAlign: 'center' }}>
                                  {item.qty} un.
                                </td>
                                <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right', color: 'var(--success)', fontWeight: 'bold' }}>
                                  {formatMoney(item.total)}
                                </td>
                                <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                                  {item.percentage.toFixed(1)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* VISTA 2: VENTAS POR ARTÍCULOS */}
              {activeSubTab === 'items' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '1.05rem', color: '#fff' }}>
                        Desglose Completo de Ventas por Artículos
                      </h4>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Total de artículos vendidos en el POS ordenados por recaudación
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Total Ventas POS:</span>
                      <strong style={{ fontSize: '1.2rem', color: 'var(--success)', display: 'block' }}>
                        {formatMoney(totalSales)}
                      </strong>
                    </div>
                  </div>

                  {itemsSummary.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                      No hay productos registrados en las ventas de este evento.
                    </div>
                  ) : (
                    <div className="table-responsive" style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px' }}>
                      <table style={{ width: '100%', minWidth: '650px', borderCollapse: 'collapse', fontSize: '0.88rem', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
                            <th style={{ padding: '0.75rem', width: '45px' }}>#</th>
                            <th style={{ padding: '0.75rem' }}>Artículo / Producto</th>
                            <th style={{ padding: '0.75rem', textAlign: 'center' }}>Unidades Vendidas</th>
                            <th style={{ padding: '0.75rem', textAlign: 'right' }}>Precio Unit.</th>
                            <th style={{ padding: '0.75rem', textAlign: 'right' }}>Total Recaudado</th>
                            <th style={{ padding: '0.75rem', textAlign: 'right' }}>% Participación</th>
                          </tr>
                        </thead>
                        <tbody>
                          {itemsSummary.map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                              <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>{idx + 1}</td>
                              <td style={{ padding: '0.75rem' }}>
                                <strong style={{ color: '#fff' }}>{item.name}</strong>
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 'bold' }}>
                                {item.qty} un.
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                                {formatMoney(item.unitPrice)}
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--success)', fontWeight: 'bold' }}>
                                {formatMoney(item.total)}
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem' }}>
                                  <div style={{ width: '50px', height: '6px', borderRadius: '3px', backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                                    <div style={{ width: `${item.percentage}%`, height: '100%', backgroundColor: 'var(--primary)' }} />
                                  </div>
                                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', minWidth: '35px' }}>
                                    {item.percentage.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* VISTA 3: CONTROL DE CUOTA OBLIGATORIA */}
              {activeSubTab === 'debts' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '1.05rem', color: '#fff' }}>
                        Control de Cuota Obligatoria
                      </h4>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Cuota base fijada: <strong>{formatMoney(event?.mandatoryAmount || 0)}</strong> por familia
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <div style={{ padding: '0.5rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}>
                        <span style={{ fontSize: '0.72rem', color: '#6ee7b7', display: 'block' }}>Pagadas al día</span>
                        <strong style={{ fontSize: '1.1rem', color: '#10b981' }}>{mandatoryPaidCount} alumnos</strong>
                      </div>
                      <div style={{ padding: '0.5rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                        <span style={{ fontSize: '0.72rem', color: '#fca5a5', display: 'block' }}>Pendientes de Pago</span>
                        <strong style={{ fontSize: '1.1rem', color: '#f87171' }}>{mandatoryPendingCount} papás</strong>
                      </div>
                    </div>
                  </div>

                  {mandatoryPendingCount === 0 ? (
                    <div style={{
                      padding: '2.5rem',
                      textAlign: 'center',
                      backgroundColor: 'rgba(16, 185, 129, 0.08)',
                      borderRadius: '12px',
                      border: '1px solid rgba(16, 185, 129, 0.3)'
                    }}>
                      <CheckCircle2 size={36} color="#10b981" style={{ margin: '0 auto 0.5rem' }} />
                      <h4 style={{ margin: 0, color: '#fff', fontSize: '1.1rem' }}>¡Todas las familias están al día!</h4>
                      <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        No hay papás con cuota obligatoria pendiente en este evento.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div style={{
                        padding: '0.85rem 1.15rem',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.25)',
                        marginBottom: '1rem',
                        fontSize: '0.85rem',
                        color: '#fca5a5'
                      }}>
                        ⚠️ <strong>{mandatoryPendingCount} apoderado(s)</strong> aún no registran el pago de la cuota obligatoria. Puedes usar sus correos para recordarles o enviar el resumen por WhatsApp.
                      </div>

                      <div className="table-responsive" style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px' }}>
                        <table style={{ width: '100%', minWidth: '580px', borderCollapse: 'collapse', fontSize: '0.88rem', textAlign: 'left' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
                              <th style={{ padding: '0.75rem', width: '40px' }}>#</th>
                              <th style={{ padding: '0.75rem' }}>Alumno(a)</th>
                              <th style={{ padding: '0.75rem' }}>Contacto / Correo Apoderado</th>
                              <th style={{ padding: '0.75rem', textAlign: 'center' }}>Estado</th>
                              <th style={{ padding: '0.75rem', textAlign: 'right' }}>Monto Pendiente</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mandatoryPendingList.map((p, idx) => (
                              <tr key={p.id || idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>{idx + 1}</td>
                                <td style={{ padding: '0.75rem' }}>
                                  <strong style={{ color: '#fff' }}>{p.studentName}</strong>
                                </td>
                                <td style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                                  {p.apoderadoEmails && p.apoderadoEmails.length > 0 
                                    ? p.apoderadoEmails.join(', ')
                                    : 'Sin correo registrado'}
                                </td>
                                <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                                  <span style={{
                                    fontSize: '0.75rem',
                                    padding: '2px 8px',
                                    borderRadius: '10px',
                                    fontWeight: 'bold',
                                    backgroundColor: p.status === 'review' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                    color: p.status === 'review' ? '#60a5fa' : '#f87171'
                                  }}>
                                    {p.status === 'review' ? 'En revisión' : 'Pendiente'}
                                  </span>
                                </td>
                                <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--danger)', fontWeight: 'bold' }}>
                                  {formatMoney(p.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* VISTA 4: GASTOS DEL EVENTO */}
              {activeSubTab === 'expenses' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '1.05rem', color: '#fff' }}>
                        Detalle de Gastos del Evento
                      </h4>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Egresos y compras imputadas al fondo del evento
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Total Gastos:</span>
                      <strong style={{ fontSize: '1.2rem', color: 'var(--danger)', display: 'block' }}>
                        {formatMoney(totalExpenses)}
                      </strong>
                    </div>
                  </div>

                  {outcomes.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                      No se han registrado gastos para este evento.
                    </div>
                  ) : (
                    <div className="table-responsive" style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px' }}>
                      <table style={{ width: '100%', minWidth: '650px', borderCollapse: 'collapse', fontSize: '0.88rem', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
                            <th style={{ padding: '0.75rem' }}>Fecha</th>
                            <th style={{ padding: '0.75rem' }}>Descripción / Concepto</th>
                            <th style={{ padding: '0.75rem' }}>Responsable</th>
                            <th style={{ padding: '0.75rem', textAlign: 'center' }}>Medio de Pago</th>
                            <th style={{ padding: '0.75rem', textAlign: 'right' }}>Monto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {outcomes.map((out, idx) => (
                            <tr key={out.id || idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <td style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                                {out.date ? new Date(out.date).toLocaleDateString('es-CL') : '—'}
                              </td>
                              <td style={{ padding: '0.75rem' }}>
                                <strong style={{ color: '#fff' }}>{out.title}</strong>
                              </td>
                              <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>
                                {out.responsable || out.createdBy || 'Tesorero/a'}
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                                <span style={{
                                  fontSize: '0.75rem',
                                  padding: '2px 8px',
                                  borderRadius: '10px',
                                  backgroundColor: out.paymentMethod === 'transfer' ? 'rgba(59,130,246,0.15)' : 'rgba(16,185,129,0.15)',
                                  color: out.paymentMethod === 'transfer' ? '#93c5fd' : '#6ee7b7'
                                }}>
                                  {out.paymentMethod === 'transfer' ? 'Transferencia' : 'Efectivo'}
                                </span>
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--danger)', fontWeight: 'bold' }}>
                                - {formatMoney(out.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

        </div>

        {/* Pie del Modal con Acciones */}
        <div style={{
          padding: '1rem 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          flexWrap: 'wrap',
          gap: '0.75rem'
        }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            AppCurso • Control y Transparencia Financiera Escolar
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={handleCopyWhatsApp}
              className="btn btn-outline"
              style={{ fontSize: '0.85rem', padding: '0.45rem 1rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Share2 size={15} color="#25D366" /> Copiar para WhatsApp
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={generatingPdf}
              className="btn btn-primary"
              style={{ fontSize: '0.85rem', padding: '0.45rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem', backgroundColor: 'var(--primary)' }}
            >
              <Download size={15} /> Descargar PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventReportModal;
