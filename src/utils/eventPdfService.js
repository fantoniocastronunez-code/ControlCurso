import { jsPDF } from 'jspdf';
import { db } from '../firebase/config';
import { collection, doc as firestoreDoc, getDoc, getDocs, query, where } from 'firebase/firestore';

const formatCLP = (amount) => {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0
  }).format(amount || 0);
};

/**
 * Genera el documento jsPDF con el resumen completo y formal del evento.
 */
export async function buildEventSummaryPdfDoc({
  event,
  courseName: initialCourseName,
  stats,
  itemsSummary = [],
  expensesSummary = [],
  inventorySummary = [],
  cashiersSummary = [],
  mandatoryPendingList: initialPendingList,
  mandatoryDebts: initialMandatoryDebts,
  outcomes: initialOutcomes
}) {
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

  // 1. Resolver Curso si no se pasó
  let courseName = initialCourseName || '';
  if (!courseName && event?.courseId) {
    try {
      const courseSnap = await getDoc(firestoreDoc(db, 'courses', event.courseId));
      if (courseSnap.exists()) {
        courseName = courseSnap.data().name || '';
      }
    } catch {
      // Ignorar fallback
    }
  }

  // 2. Resolver Cuotas y Alumnos Pendientes si no se pasaron
  let mandatoryDebts = initialMandatoryDebts || [];
  let mandatoryPendingList = initialPendingList || [];
  let mandatoryTotalExpected = 0;
  let mandatoryTotalPaid = 0;

  if (!initialMandatoryDebts || initialMandatoryDebts.length === 0) {
    try {
      const qDebts = query(collection(db, 'debts'), where('eventId', '==', event.id));
      const snapDebts = await getDocs(qDebts);
      const debtsArr = [];
      snapDebts.forEach(d => debtsArr.push({ id: d.id, ...d.data() }));

      const mandatoryOnly = debtsArr.filter(d => !d.isMandatoryFine && !d.isAttendanceFine);
      mandatoryDebts = mandatoryOnly;
      mandatoryPendingList = mandatoryOnly.filter(d => d.status === 'pending' || d.status === 'partial' || d.status === 'review');

      mandatoryOnly.forEach(d => {
        mandatoryTotalExpected += d.amount || 0;
        mandatoryTotalPaid += d.paidAmount || (d.status === 'paid' ? d.amount : 0) || 0;
      });
    } catch {
      // Ignorar fallback
    }
  } else {
    mandatoryDebts.forEach(d => {
      mandatoryTotalExpected += d.amount || 0;
      mandatoryTotalPaid += d.paidAmount || (d.status === 'paid' ? d.amount : 0) || 0;
    });
  }

  // 3. Resolver Gastos si no se pasaron
  let outcomes = initialOutcomes || expensesSummary || [];
  if (outcomes.length === 0 && event?.id) {
    try {
      const qOut = query(collection(db, 'outcomes'), where('eventId', '==', event.id));
      const snapOut = await getDocs(qOut);
      const outs = [];
      snapOut.forEach(o => outs.push({ id: o.id, ...o.data() }));
      outcomes = outs;
    } catch {
      // Ignorar fallback
    }
  }

  // 4. Cálculos Financieros Consolidados
  const totalSales = Number(stats?.salesTotal || 0);
  const cashSales = Number(stats?.cashSalesTotal || 0);
  const transferSales = Number(stats?.transferSalesTotal || 0);
  const pettyCashTotal = Number(
    stats?.pettyCashTotal || 
    stats?.pettyCashData?.total || 
    stats?.pettyCashData?.closingAudit?.initialPettyCash || 
    0
  );
  const totalExpenses = Number(stats?.expensesTotal || outcomes.reduce((s, o) => s + (o.amount || 0), 0));
  const totalIncomes = totalSales + mandatoryTotalPaid;
  const netProfit = totalIncomes - totalExpenses;

  // Rentabilidad % vs Gastos
  const profitVsExpensesPct = totalExpenses > 0 
    ? (netProfit / totalExpenses) * 100 
    : (netProfit > 0 ? 100 : 0);

  // Margen % sobre Ingresos
  const profitMarginPct = totalIncomes > 0 
    ? (netProfit / totalIncomes) * 100 
    : 0;

  // Cuadratura de caja
  const closingAudit = stats?.pettyCashData?.closingAudit || null;

  // Control de Cuota Obligatoria
  const mandatoryPaidCount = mandatoryDebts.filter(d => d.status === 'paid').length;
  const mandatoryPendingCount = mandatoryPendingList.length;

  // Helper para verificar salto de página
  const checkPageBreak = (neededHeight) => {
    if (y + neededHeight > pageHeight - margin - 12) {
      doc.addPage();
      y = margin;
      // Pequeño encabezado secundario en páginas siguientes
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, y, printableWidth, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(`RESUMEN DEL EVENTO: ${(event?.name || '').toUpperCase()}`, margin + 3, y + 5.5);
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
  const eventTitle = `RESUMEN DE EVENTO: ${(event?.name || 'EVENTO').toUpperCase()}`;
  doc.text(eventTitle, margin + 6, y + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  const dateStr = event?.date ? new Date(event.date).toLocaleDateString('es-CL') : 'Sin fecha';
  const genStr = new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  const metaCourse = courseName ? `Curso: ${courseName}   •   ` : '';
  doc.text(`${metaCourse}Fecha Evento: ${dateStr}   •   Generado: ${genStr}`, margin + 6, y + 17);

  // Badge Estado
  const isClosed = event?.status === 'closed';
  doc.setFillColor(isClosed ? 16 : 99, isClosed ? 185 : 102, isClosed ? 129 : 241);
  doc.roundedRect(margin + 6, y + 20, 24, 4.5, 1, 1, 'F');
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(isClosed ? 'FINALIZADO' : 'EN CURSO', margin + 18, y + 23.3, { align: 'center' });

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

  // Panel 1: Desglose de Ingresos y Flujo de Fondos
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, y, printableWidth, 24, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text('DESGLOSE DE INGRESOS Y EFECTIVO EN CAJA', margin + 4, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(`• Ventas Efectivo (POS): ${formatCLP(cashSales)}`, margin + 4, y + 12);
  doc.text(`• Ventas Transferencia: ${formatCLP(transferSales)}`, margin + 65, y + 12);
  doc.text(`• Cuotas Recaudadas: ${formatCLP(mandatoryTotalPaid)}`, margin + 126, y + 12);

  doc.text(`• Fondo Inicial (Caja Chica): ${formatCLP(pettyCashTotal)}`, margin + 4, y + 18.5);
  doc.text(`• Efectivo Total Gaveta: ${formatCLP(pettyCashTotal + cashSales)}`, margin + 65, y + 18.5);
  doc.text(`• Margen de Ganancia: ${profitMarginPct.toFixed(1)}%`, margin + 126, y + 18.5);

  y += 28;

  // Panel 2: Cuadratura de Cierre de Caja (si existe)
  if (closingAudit) {
    const isExact = closingAudit.difference === 0;
    const isSurplus = closingAudit.difference > 0;
    const boxColor = isExact ? [236, 253, 245] : isSurplus ? [239, 246, 255] : [254, 242, 242];
    const borderColor = isExact ? [16, 185, 129] : isSurplus ? [59, 130, 246] : [239, 68, 68];
    const statusText = isExact 
      ? 'CUADRATURA EXACTA ($0 diferencia)' 
      : isSurplus 
        ? `SOBRANTE (+${formatCLP(closingAudit.difference)})` 
        : `FALTANTE (${formatCLP(closingAudit.difference)})`;

    doc.setFillColor(boxColor[0], boxColor[1], boxColor[2]);
    doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
    doc.roundedRect(margin, y, printableWidth, 23, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(borderColor[0], borderColor[1], borderColor[2]);
    doc.text(`ESTADO DE CUADRATURA DE CAJA: ${statusText}`, margin + 4, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(71, 85, 105);
    const countedCash = closingAudit.finalCashCounted || 0;
    const initialCash = closingAudit.initialPettyCash || pettyCashTotal;
    const netCounted = countedCash - initialCash;
    doc.text(`• Efectivo Real Contado: ${formatCLP(countedCash)}`, margin + 4, y + 12);
    doc.text(`• Fondo Inicial Descontado: -${formatCLP(initialCash)}`, margin + 65, y + 12);
    doc.text(`• Efectivo Neto Vendido: ${formatCLP(netCounted)}`, margin + 126, y + 12);

    doc.text(`• Ventas Efectivo en Sistema: ${formatCLP(closingAudit.systemCashSales || cashSales)}`, margin + 4, y + 18);
    doc.text(`• Diferencia Final: ${formatCLP(closingAudit.difference)}`, margin + 65, y + 18);
    doc.text(`• Fecha Cuadratura: ${closingAudit.auditedAt ? new Date(closingAudit.auditedAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : 'Registrada'}`, margin + 126, y + 18);

    y += 27;
  }

  // Panel 3: Control de Cuota Obligatoria
  if (mandatoryDebts.length > 0) {
    const allPaid = mandatoryPendingCount === 0;
    doc.setFillColor(allPaid ? 240 : 254, allPaid ? 253 : 242, allPaid ? 244 : 242);
    doc.setDrawColor(allPaid ? 134 : 252, allPaid ? 239 : 165, allPaid ? 172 : 165);
    
    // Altura dinámica según si se listan alumnos pendientes
    const showPendingList = mandatoryPendingCount > 0;
    const maxShowPending = Math.min(6, mandatoryPendingList.length);
    const boxH = showPendingList ? 26 + Math.ceil(maxShowPending / 2) * 4.5 : 18;

    checkPageBreak(boxH);
    doc.roundedRect(margin, y, printableWidth, boxH, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(allPaid ? 21 : 185, allPaid ? 128 : 28, allPaid ? 61 : 28);
    doc.text(`CONTROL DE CUOTA OBLIGATORIA (${formatCLP(event?.mandatoryAmount || 0)} por alumno)`, margin + 4, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(allPaid ? 22 : 127, allPaid ? 101 : 29, allPaid ? 52 : 29);
    const statusSummary = allPaid 
      ? `✓ ¡Excelente! El 100% de los alumnos (${mandatoryPaidCount} familias) tienen su cuota pagada al día.` 
      : `⚠️ ATENCIÓN: Faltan ${mandatoryPendingCount} apoderado(s) por pagar la cuota obligatoria. Al día: ${mandatoryPaidCount} de ${mandatoryDebts.length} alumnos.`;
    doc.text(statusSummary, margin + 4, y + 12);

    if (showPendingList) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(153, 27, 27);
      doc.text('Alumnos con cuota pendiente:', margin + 4, y + 17.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      const colW = printableWidth / 2;
      let pY = y + 22;

      for (let i = 0; i < maxShowPending; i++) {
        const p = mandatoryPendingList[i];
        const colX = (i % 2 === 0) ? margin + 4 : margin + colW;
        doc.text(`• ${p.studentName}: ${formatCLP(p.amount)} (${p.status === 'review' ? 'En revisión' : 'Pendiente'})`, colX, pY);
        if (i % 2 !== 0 || i === maxShowPending - 1) {
          pY += 4.5;
        }
      }

      if (mandatoryPendingList.length > maxShowPending) {
        doc.setFont('helvetica', 'italic');
        doc.text(`... y ${mandatoryPendingList.length - maxShowPending} alumno(s) más pendientes (revisar en el sistema).`, margin + 4, pY);
      }
    }

    y += boxH + 5;
  }

  // ==========================================
  // PÁGINA 2 / SECCIÓN: VENTAS POR ARTÍCULOS
  // ==========================================
  if (itemsSummary.length > 0) {
    checkPageBreak(40);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text('VENTAS TOTALES POR ARTÍCULOS / PRODUCTOS', margin, y);
    y += 4;

    // Header Tabla
    doc.setFillColor(226, 232, 240);
    doc.rect(margin, y, printableWidth, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);

    doc.text('#', margin + 2, y + 4.2);
    doc.text('Producto / Artículo', margin + 9, y + 4.2);
    doc.text('Unidades', margin + 95, y + 4.2, { align: 'right' });
    doc.text('Precio Unit.', margin + 128, y + 4.2, { align: 'right' });
    doc.text('Total Recaudado', margin + 162, y + 4.2, { align: 'right' });
    doc.text('% Ventas', margin + printableWidth - 2, y + 4.2, { align: 'right' });

    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);

    itemsSummary.forEach((item, idx) => {
      checkPageBreak(6);
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, printableWidth, 5.2, 'F');
      }
      doc.setTextColor(51, 65, 85);
      doc.text(`${idx + 1}`, margin + 2, y + 3.8);
      doc.text((item.name || '').substring(0, 48), margin + 9, y + 3.8);
      doc.text(`${item.qty} un.`, margin + 95, y + 3.8, { align: 'right' });
      doc.text(formatCLP(item.unitPrice || 0), margin + 128, y + 3.8, { align: 'right' });
      doc.text(formatCLP(item.total || 0), margin + 162, y + 3.8, { align: 'right' });
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
      const outDate = out.date ? new Date(out.date).toLocaleDateString('es-CL') : '—';
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
    doc.text(`AppCurso - Control Financiero y Gestión Escolar   •   Página ${p} de ${totalPages}`, margin, pageHeight - 6);
    doc.text(`Resumen Oficial Emitido para la Directiva y Apoderados`, margin + printableWidth, pageHeight - 6, { align: 'right' });
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

  // 1. Intentar Web Share API con archivos (Soportado en Android Chrome, Safari iOS, etc.)
  if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: shareTitle || 'Resumen de Evento',
        text: shareText || 'Adjunto el informe y resumen financiero del evento en formato PDF.',
        files: [file]
      });
      return { success: true, method: 'shared' };
    } catch (err) {
      if (err.name === 'AbortError') {
        // El usuario canceló la hoja de compartir
        return { success: true, method: 'aborted' };
      }
      console.warn('Error en navigator.share, procediendo a descarga directa:', err);
    }
  }

  // 2. Si no soporta compartir archivos o falló, descargar directamente
  doc.save(safeFileName);
  return { success: true, method: 'downloaded' };
}

