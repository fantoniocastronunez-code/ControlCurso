import { jsPDF } from 'jspdf';
import { db } from '../firebase/config';
import { collection, doc as firestoreDoc, getDoc, getDocs, query, where } from 'firebase/firestore';

export const formatCLP = (amount) => {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0
  }).format(amount || 0);
};

/**
 * Formatea una fecha de evento sin desfase horario por zona UTC.
 * Si dateVal es '2026-10-30', se formatea directamente a '30/10/2026'
 * evitando que JavaScript reste un día por interpretar UTC medianoche.
 */
export const formatEventDate = (dateVal) => {
  if (!dateVal) return '';
  if (typeof dateVal === 'string') {
    const clean = dateVal.trim();
    // Si contiene hora en formato ISO 'T', extraer sólo la fecha
    const str = clean.includes('T') ? clean.split('T')[0] : clean;
    // Formato YYYY-MM-DD o YYYY/MM/DD
    const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (isoMatch) {
      return `${isoMatch[3].padStart(2, '0')}/${isoMatch[2].padStart(2, '0')}/${isoMatch[1]}`;
    }
    // Formato DD-MM-YYYY o DD/MM/YYYY
    const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmyMatch) {
      return `${dmyMatch[1].padStart(2, '0')}/${dmyMatch[2].padStart(2, '0')}/${dmyMatch[3]}`;
    }
  }
  try {
    const d = new Date(dateVal);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }
  } catch {
    // fallback
  }
  return String(dateVal);
};

/**
 * Carga centralizada y completa de todos los datos financieros de un evento:
 * - Ventas POS (efectivo, transferencia, productos y cajeros)
 * - Cuotas obligatorias y multas (debts)
 * - Gastos del evento (outcomes) vinculados por eventId y por fundId
 * - Caja chica y arqueo de gaveta (eventPettyCash)
 * - Balance de inventario (eventInventory)
 * - Cálculos matemáticos unificados (ROI, margen, balance neto)
 */
export async function loadEventFinancialReportData(eventInput) {
  if (!eventInput || (!eventInput.id && !eventInput)) return null;

  let event = { ...(eventInput || {}) };
  const eventId = event.id;

  // 1. Obtener documento del evento desde Firestore si falta información crítica
  if (eventId && (!event.fundId || !event.name || !event.courseId)) {
    try {
      const evSnap = await getDoc(firestoreDoc(db, 'events', eventId));
      if (evSnap.exists()) {
        event = { id: evSnap.id, ...evSnap.data(), ...event };
      }
    } catch (e) {
      console.warn("Error cargando doc de evento en loadEventFinancialReportData:", e);
    }
  }

  // 2. Obtener Nombre del Curso si se cuenta con courseId
  let courseName = event.courseName || '';
  if (!courseName && event.courseId) {
    try {
      const cSnap = await getDoc(firestoreDoc(db, 'courses', event.courseId));
      if (cSnap.exists()) {
        courseName = cSnap.data().name || '';
      }
    } catch (e) {
      console.warn("Error cargando nombre del curso:", e);
    }
  }

  // 3. Ventas POS (eventSales)
  let salesList = [];
  try {
    const qSales = query(collection(db, 'eventSales'), where('eventId', '==', eventId));
    const salesSnap = await getDocs(qSales);
    salesList = salesSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(s => s.status !== 'cancelled' && s.status !== 'anulada');
  } catch (e) {
    console.error("Error cargando ventas del evento:", e);
  }

  let totalSales = 0;
  let cashSales = 0;
  let transferSales = 0;
  const itemsMap = new Map();
  const cashiersMap = new Map();

  salesList.forEach(sale => {
    const amount = Number(sale.total) || 0;
    totalSales += amount;
    if (sale.paymentMethod === 'cash') {
      cashSales += amount;
    } else {
      transferSales += amount;
    }

    // Rendición por cajero
    const cashierName = (sale.cashierName || sale.createdBy || 'Cajero General').trim();
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
    cEntry.total += amount;
    if (sale.paymentMethod === 'cash') {
      cEntry.cashTotal += amount;
    } else {
      cEntry.transferTotal += amount;
    }

    // Desglose de artículos
    if (sale.items && Array.isArray(sale.items)) {
      sale.items.forEach(item => {
        let name = item.name || 'Producto';
        if (item.selectedSubproducts && item.selectedSubproducts.length > 0) {
          const spNames = item.selectedSubproducts.map(s => s.name).join(', ');
          name = `${item.name} (+${spNames})`;
        }
        const qty = Number(item.quantity) || 1;
        const price = Number(item.unitPrice || item.price) || 0;
        const subtotal = price * qty;

        if (!itemsMap.has(name)) {
          itemsMap.set(name, { name, qty: 0, total: 0, unitPrice: price });
        }
        const curr = itemsMap.get(name);
        curr.qty += qty;
        curr.total += subtotal;

        cEntry.productsMap.set(name, (cEntry.productsMap.get(name) || 0) + qty);
      });
    }
  });

  const itemsSummary = Array.from(itemsMap.values())
    .map(item => ({
      ...item,
      percentage: totalSales > 0 ? (item.total / totalSales) * 100 : 0
    }))
    .sort((a, b) => b.total - a.total);

  const top5Items = itemsSummary.slice(0, 5);

  const cashiersSummary = Array.from(cashiersMap.values())
    .map(c => ({
      ...c,
      productsList: Array.from(c.productsMap.entries()).map(([name, qty]) => ({ name, qty }))
    }))
    .sort((a, b) => b.total - a.total);

  // 4. Cuotas Obligatorias y Multas (debts)
  let debtsList = [];
  try {
    const qDebts = query(collection(db, 'debts'), where('eventId', '==', eventId));
    const debtsSnap = await getDocs(qDebts);
    debtsList = debtsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error("Error cargando deudas del evento:", e);
  }

  const fineExpenseId = `exp_evt_fine_${eventId}`;
  const mandatoryDebts = debtsList.filter(d => d.expenseId !== fineExpenseId && !d.isMandatoryFine && !d.isAttendanceFine);
  const fineDebts = debtsList.filter(d => d.expenseId === fineExpenseId || d.isMandatoryFine || d.isAttendanceFine);

  let mandatoryTotalExpected = 0;
  let mandatoryTotalPaid = 0;
  let mandatoryPaidCount = 0;
  const mandatoryPendingList = [];

  mandatoryDebts.forEach(d => {
    const amount = Number(d.amount) || 0;
    mandatoryTotalExpected += amount;
    if (d.status === 'paid') {
      mandatoryTotalPaid += amount;
      mandatoryPaidCount++;
    } else {
      const paidPart = Number(d.paidAmount) || 0;
      mandatoryTotalPaid += paidPart;
      mandatoryPendingList.push({
        id: d.id,
        studentName: d.studentName || 'Alumno',
        amount: amount - paidPart,
        status: d.status,
        apoderadoEmails: d.apoderadoEmails || []
      });
    }
  });
  mandatoryPendingList.sort((a, b) => (a.studentName || '').localeCompare(b.studentName || ''));

  let fineTotalPaid = 0;
  let finePendingCount = 0;
  fineDebts.forEach(f => {
    if (f.status === 'paid') {
      fineTotalPaid += (Number(f.amount) || 0);
    } else {
      finePendingCount++;
    }
  });

  // 5. Gastos del Evento (outcomes) - Búsqueda robusta por eventId Y por fundId para nunca perder gastos
  const outcomesMap = new Map();
  if (eventId) {
    try {
      const qByEvent = query(collection(db, 'outcomes'), where('eventId', '==', eventId));
      const snapByEvent = await getDocs(qByEvent);
      snapByEvent.docs.forEach(d => outcomesMap.set(d.id, { id: d.id, ...d.data() }));
    } catch (e) {
      console.warn("Error consultando gastos por eventId:", e);
    }
  }
  if (event.fundId) {
    try {
      const qByFund = query(collection(db, 'outcomes'), where('fundId', '==', event.fundId));
      const snapByFund = await getDocs(qByFund);
      snapByFund.docs.forEach(d => outcomesMap.set(d.id, { id: d.id, ...d.data() }));
    } catch (e) {
      console.warn("Error consultando gastos por fundId:", e);
    }
  }

  const outcomesList = Array.from(outcomesMap.values()).map(o => ({
    id: o.id,
    title: o.title || o.description || 'Gasto registrado',
    amount: Number(o.amount) || 0,
    date: o.date || (o.createdAt ? o.createdAt.split('T')[0] : ''),
    responsable: o.responsable || o.createdBy || 'Tesorero',
    paymentMethod: o.paymentMethod || 'cash',
    ...o
  }));
  outcomesList.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const totalExpenses = outcomesList.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);

  // 6. Caja Chica y Arqueo (eventPettyCash)
  let pettyCashData = null;
  let initialPettyFund = 0;
  try {
    const pettyDoc = await getDoc(firestoreDoc(db, 'eventPettyCash', `petty_${eventId}`));
    if (pettyDoc.exists()) {
      pettyCashData = pettyDoc.data();
      initialPettyFund = (pettyCashData.total !== undefined && Number(pettyCashData.total) > 0)
        ? Number(pettyCashData.total)
        : (pettyCashData.closingAudit?.initialPettyCash !== undefined && Number(pettyCashData.closingAudit.initialPettyCash) > 0)
          ? Number(pettyCashData.closingAudit.initialPettyCash)
          : Number(pettyCashData.total ?? pettyCashData.totalAmount ?? 0);
    }
  } catch (e) {
    console.warn("Error cargando caja chica:", e);
  }

  const closingAudit = pettyCashData?.closingAudit || null;

  // 7. Inventario del Evento (eventInventory)
  let inventorySummary = [];
  try {
    const qInv = query(collection(db, 'eventInventory'), where('eventId', '==', eventId));
    const snapInv = await getDocs(qInv);
    inventorySummary = snapInv.docs.map(d => ({ id: d.id, ...d.data() }));
    inventorySummary.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch (e) {
    console.warn("Error cargando inventario:", e);
  }

  // 8. Totales Financieros Centralizados
  const totalIncomes = totalSales + mandatoryTotalPaid + fineTotalPaid;
  const netProfit = totalIncomes - totalExpenses;

  // Rentabilidad (ROI sobre gastos)
  const profitVsExpensesPct = totalExpenses > 0
    ? (netProfit / totalExpenses) * 100
    : (netProfit > 0 ? 100 : 0);

  // Margen de ganancia sobre ingresos brutos
  const profitMarginPct = totalIncomes > 0
    ? (netProfit / totalIncomes) * 100
    : 0;

  return {
    event,
    courseName,
    salesList,
    totalSales,
    salesTotal: totalSales,
    cashSales,
    cashSalesTotal: cashSales,
    transferSales,
    transferSalesTotal: transferSales,
    itemsSummary,
    top5Items,
    cashiersSummary,
    debtsList,
    mandatoryDebts,
    mandatoryTotalExpected,
    mandatoryTotalPaid,
    mandatoryPaidCount,
    mandatoryPendingCount: mandatoryPendingList.length,
    mandatoryPendingList,
    fineDebts,
    fineTotalPaid,
    finePendingCount,
    outcomes: outcomesList,
    expensesSummary: outcomesList,
    totalExpenses,
    expensesTotal: totalExpenses,
    pettyCashData,
    initialPettyFund,
    pettyCashTotal: initialPettyFund,
    closingAudit,
    inventorySummary,
    totalIncomes,
    netProfit,
    profitVsExpensesPct,
    profitMarginPct,
    stats: {
      salesTotal: totalSales,
      cashSalesTotal: cashSales,
      transferSalesTotal: transferSales,
      pettyCashTotal: initialPettyFund,
      pettyCashData,
      expensesTotal: totalExpenses,
      netProfit,
      paidQuotas: mandatoryTotalPaid,
      totalQuotas: mandatoryTotalExpected,
      expectedCashTotal: initialPettyFund + cashSales
    }
  };
}

/**
 * Genera el mensaje formateado para portapapeles y WhatsApp.
 * - Incluye gastos reales, balance y rentabilidad
 * - NO incluye nombres de apoderados morosos, solo la cantidad que debe
 * - Incluye Top 5 de artículos vendidos
 */
export function buildEventClipboardReport(data) {
  if (!data) return '';
  const event = data.event || {};
  const cashSalesTotal = Number(data.cashSalesTotal ?? data.cashSales ?? 0);
  const transferSalesTotal = Number(data.transferSalesTotal ?? data.transferSales ?? 0);
  const salesTotal = Number(data.salesTotal ?? data.totalSales ?? 0);
  const mandatoryTotalExpected = Number(data.mandatoryTotalExpected || 0);
  const mandatoryTotalPaid = Number(data.mandatoryTotalPaid || 0);
  const fineTotalPaid = Number(data.fineTotalPaid || 0);
  const totalIncomes = Number(data.totalIncomes || 0);
  const totalExpenses = Number(data.totalExpenses ?? data.expensesTotal ?? 0);
  const netProfit = Number(data.netProfit || 0);
  const profitVsExpensesPct = Number(data.profitVsExpensesPct || 0);
  const profitMarginPct = Number(data.profitMarginPct || 0);
  const mandatoryDebts = data.mandatoryDebts || [];
  const mandatoryPaidCount = Number(data.mandatoryPaidCount || 0);
  const mandatoryPendingCount = Number(data.mandatoryPendingCount || 0);
  const top5Items = (data.top5Items && data.top5Items.length > 0)
    ? data.top5Items
    : (data.itemsSummary || []).slice(0, 5);

  const isEventCompleted = Boolean(event?.isCompleted || event?.status === 'completed' || event?.status === 'closed');
  let msg = `*INFORME FINANCIERO - ${(event?.name || 'EVENTO').toUpperCase()}*\n`;
  msg += `*Estado:* ${isEventCompleted ? '[Completado y Cuadrado]' : '[En Curso]'}\n`;
  msg += `*Fecha:* ${formatEventDate(event?.date) || 'Hoy'}\n\n`;

  msg += `*RESUMEN DE INGRESOS:*\n`;
  msg += `• Ventas POS en Efectivo: ${formatCLP(cashSalesTotal)}\n`;
  msg += `• Ventas POS por Transferencia: ${formatCLP(transferSalesTotal)}\n`;
  msg += `• Total Ventas POS: ${formatCLP(salesTotal)}\n`;
  if (mandatoryTotalExpected > 0) {
    msg += `• Cuotas Obligatorias Recaudadas: ${formatCLP(mandatoryTotalPaid)} (de ${formatCLP(mandatoryTotalExpected)})\n`;
  }
  if (fineTotalPaid > 0) {
    msg += `• Multas de Inasistencia Recaudadas: ${formatCLP(fineTotalPaid)}\n`;
  }
  msg += `• *TOTAL INGRESOS BRUTOS:* ${formatCLP(totalIncomes)}\n\n`;

  msg += `*GASTOS DEL EVENTO:*\n`;
  msg += `• Total Gastos Realizados: ${formatCLP(totalExpenses)}\n\n`;

  msg += `*BALANCE FINAL Y RENTABILIDAD:*\n`;
  msg += `• *GANANCIA NETA REAL:* ${formatCLP(netProfit)}\n`;
  msg += `• Rentabilidad vs Gastos: ${profitVsExpensesPct >= 0 ? '+' : ''}${profitVsExpensesPct.toFixed(1)}%\n`;
  msg += `• Margen de Ganancia: ${profitMarginPct.toFixed(1)}%\n\n`;

  if (mandatoryDebts && mandatoryDebts.length > 0) {
    msg += `*CONTROL CUOTA OBLIGATORIA:*\n`;
    msg += `• Familias al día: ${mandatoryPaidCount} de ${mandatoryDebts.length}\n`;
    if (mandatoryPendingCount > 0) {
      msg += `• Faltan por pagar: ${mandatoryPendingCount} apoderado(s)\n`;
    } else {
      msg += `• Todas las familias están al día con la cuota.\n`;
    }
    msg += `\n`;
  }

  if (top5Items.length > 0) {
    msg += `*TOP 5 ARTÍCULOS MÁS VENDIDOS:*\n`;
    top5Items.forEach((item, idx) => {
      msg += `  ${idx + 1}. ${item.name}: ${item.qty} un. (${formatCLP(item.total)})\n`;
    });
    msg += `\n`;
  }

  msg += `_Informe emitido automáticamente desde AppCurso._`;
  return msg;
}

/**
 * Genera el documento jsPDF con el informe completo y formal del evento.
 * Tanto "Compartir Resumen (PDF)" como "Generar Informe de Evento" utilizan esta misma función
 * con los mismos datos centralizados, mostrando únicamente el Top 5 de ventas.
 */
export async function buildEventSummaryPdfDoc({
  event,
  data: preloadedData,
  courseName: initialCourseName,
  stats,
  itemsSummary: initialItemsSummary,
  expensesSummary: initialExpensesSummary,
  inventorySummary: initialInventorySummary,
  cashiersSummary: initialCashiersSummary,
  mandatoryPendingList: initialPendingList,
  mandatoryDebts: initialMandatoryDebts,
  outcomes: initialOutcomes
}) {
  // Asegurar que contamos con los datos centralizados consolidados
  let reportData = preloadedData;
  if (!reportData) {
    reportData = await loadEventFinancialReportData(event);
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const printableWidth = pageWidth - margin * 2;
  let y = margin;

  // Variables consolidadas
  const activeEvent = reportData?.event || event || {};
  const courseName = reportData?.courseName || initialCourseName || '';
  const totalSales = Number(reportData?.salesTotal ?? stats?.salesTotal ?? 0);
  const cashSales = Number(reportData?.cashSalesTotal ?? stats?.cashSalesTotal ?? 0);
  const transferSales = Number(reportData?.transferSalesTotal ?? stats?.transferSalesTotal ?? 0);
  const pettyCashTotal = Number(reportData?.pettyCashTotal ?? stats?.pettyCashTotal ?? 0);
  const closingAudit = reportData?.closingAudit ?? stats?.pettyCashData?.closingAudit ?? null;
  const totalExpenses = Number(reportData?.totalExpenses ?? stats?.expensesTotal ?? 0);
  const totalIncomes = Number(reportData?.totalIncomes ?? (totalSales + (reportData?.mandatoryTotalPaid || 0) + (reportData?.fineTotalPaid || 0)));
  const netProfit = Number(reportData?.netProfit ?? (totalIncomes - totalExpenses));
  const profitVsExpensesPct = Number(reportData?.profitVsExpensesPct ?? (totalExpenses > 0 ? (netProfit / totalExpenses) * 100 : (netProfit > 0 ? 100 : 0)));

  const mandatoryDebts = reportData?.mandatoryDebts || initialMandatoryDebts || [];
  const mandatoryTotalPaid = Number(reportData?.mandatoryTotalPaid || 0);
  const mandatoryPaidCount = Number(reportData?.mandatoryPaidCount || mandatoryDebts.filter(d => d.status === 'paid').length);
  const mandatoryPendingCount = Number(reportData?.mandatoryPendingCount || (reportData?.mandatoryPendingList?.length ?? initialPendingList?.length ?? 0));

  // Top 5 de ventas por artículos
  const allItems = reportData?.itemsSummary || initialItemsSummary || [];
  const top5Items = (reportData?.top5Items && reportData.top5Items.length > 0)
    ? reportData.top5Items
    : allItems.slice(0, 5);

  const cashiersSummary = reportData?.cashiersSummary || initialCashiersSummary || [];
  const outcomes = reportData?.outcomes || initialOutcomes || initialExpensesSummary || [];
  const inventorySummary = reportData?.inventorySummary || initialInventorySummary || [];

  // Helper para verificar salto de página
  const checkPageBreak = (neededHeight) => {
    if (y + neededHeight > pageHeight - margin - 12) {
      doc.addPage();
      y = margin;
      // Encabezado secundario en páginas siguientes
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, y, printableWidth, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(`INFORME DEL EVENTO: ${(activeEvent?.name || '').toUpperCase()}`, margin + 3, y + 5.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(203, 213, 225);
      doc.text(courseName ? `Curso: ${courseName}` : '', margin + printableWidth - 3, y + 5.5, { align: 'right' });
      y += 12;
    }
  };

  // ==========================================
  // PÁGINA 1: ENCABEZADO Y RESUMEN EJECUTIVO
  // ==========================================

  // Banner Principal
  doc.setFillColor(15, 23, 42); // Slate 900
  doc.roundedRect(margin, y, printableWidth, 27, 2, 2, 'F');

  // Acento de color superior (Indigo)
  doc.setFillColor(99, 102, 241);
  doc.rect(margin, y, printableWidth, 2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  const eventTitle = `INFORME FINANCIERO: ${(activeEvent?.name || 'EVENTO').toUpperCase()}`;
  doc.text(eventTitle, margin + 6, y + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  const dateStr = formatEventDate(activeEvent?.date) || 'Sin fecha';
  const genStr = new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  const metaCourse = courseName ? `Curso: ${courseName}   |   ` : '';
  doc.text(`${metaCourse}Fecha Evento: ${dateStr}   |   Generado: ${genStr}`, margin + 6, y + 17);

  // Badge Estado
  const isCompletedEvent = Boolean(activeEvent?.isCompleted || activeEvent?.status === 'completed' || activeEvent?.status === 'closed');
  doc.setFillColor(isCompletedEvent ? 16 : 99, isCompletedEvent ? 185 : 102, isCompletedEvent ? 129 : 241);
  const badgeWidth = isCompletedEvent ? 42 : 24;
  doc.roundedRect(margin + 6, y + 20, badgeWidth, 4.5, 1, 1, 'F');
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(isCompletedEvent ? 'TERMINADO Y CUADRADO' : 'EN CURSO', margin + 6 + (badgeWidth / 2), y + 23.3, { align: 'center' });

  y += 32;

  // 4 Tarjetas KPI Superiores
  const kpis = [
    { label: 'VENTAS POS TOTALES', val: formatCLP(totalSales), color: [16, 185, 129] },
    { label: 'GASTOS DEL EVENTO', val: formatCLP(totalExpenses), color: [239, 68, 68] },
    { label: 'GANANCIA NETA REAL', val: formatCLP(netProfit), color: netProfit >= 0 ? [16, 185, 129] : [239, 68, 68] },
    { label: 'RENTABILIDAD (ROI)', val: `${profitVsExpensesPct >= 0 ? '+' : ''}${profitVsExpensesPct.toFixed(1)}%`, color: [99, 102, 241] }
  ];

  const kpiW = (printableWidth - 6) / 4;
  kpis.forEach((kpi, idx) => {
    const kX = margin + idx * (kpiW + 2);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(kX, y, kpiW, 18, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, kX + 3.5, y + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.val, kX + 3.5, y + 13.5);
  });

  y += 23;

  // Panel Unificado: Resumen de Fondos, Ventas y Arqueo de Caja
  const boxH = 25;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, y, printableWidth, boxH, 1.5, 1.5, 'FD');

  // Barra de título del panel
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, y, printableWidth, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  doc.text('RESUMEN DE FONDOS, VENTAS Y ARQUEO DE CAJA', margin + 4, y + 4.2);

  // Columna Izquierda: Ingresos y Medios de Pago
  const col1X = margin + 4;
  const col2X = margin + (printableWidth / 2) + 2;
  const startY = y + 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(71, 85, 105);

  doc.text('Ventas POS en Efectivo:', col1X, startY);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(formatCLP(cashSales), col1X + 48, startY);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Ventas POS Transferencia:', col1X, startY + 4.8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(formatCLP(transferSales), col1X + 48, startY + 4.8);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Fondo Inicial (Caja Chica):', col1X, startY + 9.6);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(formatCLP(pettyCashTotal), col1X + 48, startY + 9.6);

  // Columna Derecha: Arqueo y Cierre
  const expectedCash = pettyCashTotal + cashSales;
  const countedCash = closingAudit ? (closingAudit.finalCashCounted || 0) : expectedCash;
  const auditDiff = closingAudit ? (closingAudit.difference || 0) : 0;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Efectivo Esperado en Gaveta:', col2X, startY);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(formatCLP(expectedCash), col2X + 48, startY);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Efectivo Real Contado:', col2X, startY + 4.8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(formatCLP(countedCash), col2X + 48, startY + 4.8);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Resultado Cuadratura:', col2X, startY + 9.6);
  doc.setFont('helvetica', 'bold');

  if (!closingAudit) {
    doc.setTextColor(100, 116, 139);
    doc.text('Sin cuadratura registrada', col2X + 48, startY + 9.6);
  } else if (auditDiff === 0) {
    doc.setTextColor(16, 185, 129);
    doc.text('Cuadratura Exacta ($0)', col2X + 48, startY + 9.6);
  } else if (auditDiff > 0) {
    doc.setTextColor(59, 130, 246);
    doc.text(`Sobrante (+${formatCLP(auditDiff)})`, col2X + 48, startY + 9.6);
  } else {
    doc.setTextColor(220, 38, 38);
    doc.text(`Faltante (${formatCLP(auditDiff)})`, col2X + 48, startY + 9.6);
  }

  y += boxH + 4;

  // Panel: Control de Cuota Obligatoria (Sólo cantidad de familias, sin nombres individuales)
  if (mandatoryDebts.length > 0) {
    const allPaid = mandatoryPendingCount === 0;
    const cuotaBoxH = 17;
    checkPageBreak(cuotaBoxH);

    doc.setFillColor(allPaid ? 240 : 254, allPaid ? 253 : 242, allPaid ? 244 : 242);
    doc.setDrawColor(allPaid ? 134 : 252, allPaid ? 239 : 165, allPaid ? 172 : 165);
    doc.roundedRect(margin, y, printableWidth, cuotaBoxH, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(allPaid ? 21 : 185, allPaid ? 128 : 28, allPaid ? 61 : 28);
    const cuotaTitle = `CONTROL DE CUOTA OBLIGATORIA (${formatCLP(activeEvent?.mandatoryAmount || 0)} por alumno)`;
    doc.text(cuotaTitle, margin + 4, y + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(allPaid ? 22 : 127, allPaid ? 101 : 29, allPaid ? 52 : 29);

    const line1 = `Familias al dia: ${mandatoryPaidCount} de ${mandatoryDebts.length} alumnos (${formatCLP(mandatoryTotalPaid)} recaudado).`;
    const line2 = allPaid
      ? 'Estado: 100% de las familias al dia con la cuota obligatoria.'
      : `Familias pendientes: ${mandatoryPendingCount} apoderado(s) por regularizar cuota.`;

    doc.text(line1, margin + 4, y + 10.5);
    doc.text(line2, margin + 4, y + 15);

    y += cuotaBoxH + 5;
  }

  // ==========================================
  // TOP 5 ARTÍCULOS MÁS VENDIDOS
  // ==========================================
  if (top5Items.length > 0) {
    checkPageBreak(35);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text('TOP 5 ARTÍCULOS MÁS VENDIDOS', margin, y);
    y += 4;

    // Header Tabla
    doc.setFillColor(226, 232, 240);
    doc.rect(margin, y, printableWidth, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);

    doc.text('#', margin + 2, y + 4.2);
    doc.text('Producto / Artículo', margin + 8, y + 4.2);
    doc.text('Unidades', margin + 124, y + 4.2, { align: 'right' });
    doc.text('Precio Unit.', margin + 146, y + 4.2, { align: 'right' });
    doc.text('Total Recaudado', margin + 170, y + 4.2, { align: 'right' });
    doc.text('% Ventas', margin + printableWidth - 2, y + 4.2, { align: 'right' });

    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);

    top5Items.forEach((item, idx) => {
      checkPageBreak(6);
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, printableWidth, 5.2, 'F');
      }
      doc.setTextColor(51, 65, 85);
      doc.text(`${idx + 1}`, margin + 2, y + 3.8);

      // Mayor ancho disponible para el producto (102 mm) sin cortar texto
      const maxProductNameWidth = 102;
      let productName = item.name || '';
      if (doc.getTextWidth(productName) > maxProductNameWidth) {
        while (productName.length > 0 && doc.getTextWidth(productName + '...') > maxProductNameWidth) {
          productName = productName.slice(0, -1);
        }
        productName += '...';
      }

      doc.text(productName, margin + 8, y + 3.8);
      doc.text(`${item.qty} un.`, margin + 124, y + 3.8, { align: 'right' });
      doc.text(formatCLP(item.unitPrice || 0), margin + 146, y + 3.8, { align: 'right' });
      doc.text(formatCLP(item.total || 0), margin + 170, y + 3.8, { align: 'right' });
      const pct = totalSales > 0 ? ((item.total || 0) / totalSales) * 100 : 0;
      doc.text(`${pct.toFixed(1)}%`, margin + printableWidth - 2, y + 3.8, { align: 'right' });
      y += 5.2;
    });

    y += 5;
  }

  // ==========================================
  // RENDICIÓN DE CAJEROS
  // ==========================================
  if (cashiersSummary.length > 0) {
    checkPageBreak(30);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text('RENDICIÓN DE VENTAS POR CAJERO(A)', margin, y);
    y += 4;

    doc.setFillColor(226, 232, 240);
    doc.rect(margin, y, printableWidth, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);

    doc.text('Cajero(a)', margin + 3, y + 4.2);
    doc.text('N° Ventas', margin + 70, y + 4.2, { align: 'center' });
    doc.text('Efectivo', margin + 105, y + 4.2, { align: 'right' });
    doc.text('Transferencia', margin + 145, y + 4.2, { align: 'right' });
    doc.text('Total Recaudado', margin + printableWidth - 2, y + 4.2, { align: 'right' });

    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);

    cashiersSummary.forEach((c, idx) => {
      checkPageBreak(6);
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, printableWidth, 5.2, 'F');
      }
      doc.setTextColor(51, 65, 85);
      doc.text(c.name || 'Cajero', margin + 3, y + 3.8);
      doc.text(`${c.salesCount || 0}`, margin + 70, y + 3.8, { align: 'center' });
      doc.text(formatCLP(c.cashTotal || 0), margin + 105, y + 3.8, { align: 'right' });
      doc.text(formatCLP(c.transferTotal || 0), margin + 145, y + 3.8, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.text(formatCLP(c.total || 0), margin + printableWidth - 2, y + 3.8, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      y += 5.2;
    });

    y += 5;
  }

  // ==========================================
  // DETALLE DE GASTOS DEL EVENTO
  // ==========================================
  if (outcomes.length > 0) {
    checkPageBreak(30);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text(`GASTOS DEL EVENTO (Total: ${formatCLP(totalExpenses)})`, margin, y);
    y += 4;

    doc.setFillColor(226, 232, 240);
    doc.rect(margin, y, printableWidth, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);

    doc.text('Fecha', margin + 3, y + 4.2);
    doc.text('Descripción / Concepto', margin + 28, y + 4.2);
    doc.text('Responsable', margin + 115, y + 4.2);
    doc.text('Medio', margin + 150, y + 4.2);
    doc.text('Monto', margin + printableWidth - 2, y + 4.2, { align: 'right' });

    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);

    outcomes.forEach((out, idx) => {
      checkPageBreak(6);
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, printableWidth, 5.2, 'F');
      }
      doc.setTextColor(51, 65, 85);
      const outDate = formatEventDate(out.date) || '—';
      doc.text(outDate, margin + 3, y + 3.8);
      doc.text((out.title || out.description || 'Gasto').substring(0, 45), margin + 28, y + 3.8);
      doc.text((out.responsable || 'General').substring(0, 18), margin + 115, y + 3.8);
      doc.text(out.paymentMethod === 'cash' ? 'Efectivo' : 'Transf.', margin + 150, y + 3.8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(220, 38, 38);
      doc.text(`-${formatCLP(out.amount || 0)}`, margin + printableWidth - 2, y + 3.8, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      y += 5.2;
    });

    y += 5;
  }

  // ==========================================
  // BALANCE DE INVENTARIO Y SOBRANTES
  // ==========================================
  if (inventorySummary.length > 0) {
    checkPageBreak(30);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text('BALANCE DE INVENTARIO Y SOBRANTES FÍSICOS', margin, y);
    y += 4;

    doc.setFillColor(226, 232, 240);
    doc.rect(margin, y, printableWidth, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);

    doc.text('Insumo', margin + 3, y + 4.2);
    doc.text('Comprado', margin + 65, y + 4.2, { align: 'center' });
    doc.text('Consumido POS', margin + 98, y + 4.2, { align: 'center' });
    doc.text('Teórico Restante', margin + 132, y + 4.2, { align: 'center' });
    doc.text('Sobrante Real', margin + 162, y + 4.2, { align: 'center' });
    doc.text('Diferencia', margin + printableWidth - 2, y + 4.2, { align: 'right' });

    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);

    inventorySummary.forEach((item, idx) => {
      checkPageBreak(6);
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, printableWidth, 5.2, 'F');
      }
      const purchased = item.totalPurchased || item.initialQuantity || 0;
      const current = item.currentStock !== undefined ? item.currentStock : purchased;
      const consumed = Math.max(0, purchased - current);
      const hasPhysical = item.finalCount !== undefined && item.finalCount !== null;
      const diff = hasPhysical ? (item.finalCount - current) : 0;

      doc.setTextColor(51, 65, 85);
      doc.text((item.name || '').substring(0, 30), margin + 3, y + 3.8);
      doc.text(`${purchased}`, margin + 65, y + 3.8, { align: 'center' });
      doc.text(`${consumed}`, margin + 98, y + 3.8, { align: 'center' });
      doc.text(`${current}`, margin + 132, y + 3.8, { align: 'center' });
      doc.text(hasPhysical ? `${item.finalCount}` : '—', margin + 162, y + 3.8, { align: 'center' });

      if (hasPhysical) {
        doc.setFont('helvetica', 'bold');
        if (diff === 0) {
          doc.setTextColor(16, 185, 129);
          doc.text('Exacto', margin + printableWidth - 2, y + 3.8, { align: 'right' });
        } else if (diff > 0) {
          doc.setTextColor(59, 130, 246);
          doc.text(`+${diff} sob.`, margin + printableWidth - 2, y + 3.8, { align: 'right' });
        } else {
          doc.setTextColor(239, 68, 68);
          doc.text(`${diff} merma`, margin + printableWidth - 2, y + 3.8, { align: 'right' });
        }
        doc.setFont('helvetica', 'normal');
      } else {
        doc.text('—', margin + printableWidth - 2, y + 3.8, { align: 'right' });
      }
      y += 5.2;
    });

    y += 5;
  }

  // ==========================================
  // PIE DE PÁGINA EN TODAS LAS PÁGINAS
  // ==========================================
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`AppCurso - Control Financiero y Gestion Escolar   |   Pagina ${p} de ${totalPages}`, margin, pageHeight - 6);
    doc.text(`Informe Oficial Emitido para la Directiva y Apoderados`, margin + printableWidth, pageHeight - 6, { align: 'right' });
  }

  return doc;
}

/**
 * Función universal para compartir o descargar el PDF:
 * - En celulares (Android/iOS): abre el menú nativo de Compartir con el archivo PDF adjunto (WhatsApp, Drive, Gmail, etc.)
 * - En PC o navegadores sin Web Share con archivos: descarga el PDF directamente.
 */
export async function shareOrDownloadEventPdf(doc, baseFileName, shareTitle, shareText) {
  const safeFileName = baseFileName.toLowerCase().endsWith('.pdf') ? baseFileName : `${baseFileName}.pdf`;
  const pdfBlob = doc.output('blob');
  const file = new File([pdfBlob], safeFileName, { type: 'application/pdf' });

  // 1. Intentar Web Share API con archivos (Soportado en celulares modernos)
  if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: shareTitle || 'Informe de Evento',
        text: shareText || 'Adjunto el informe y balance financiero oficial del evento en formato PDF.',
        files: [file]
      });
      return { success: true, method: 'shared' };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { success: true, method: 'aborted' };
      }
      console.warn('Error en navigator.share, procediendo a descarga directa:', err);
    }
  }

  // 2. Si no soporta compartir archivos o falló, descargar directamente
  doc.save(safeFileName);
  return { success: true, method: 'downloaded' };
}
