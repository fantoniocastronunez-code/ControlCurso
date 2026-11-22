import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { jsPDF } from 'jspdf';
import {
  X, Download, TrendingUp, TrendingDown, DollarSign, AlertCircle, CheckCircle,
  Calendar, Users, BarChart3, Eye, EyeOff, Copy, Check, RefreshCw, ShieldAlert, ChevronDown, ChevronUp
} from 'lucide-react';
import {
  formatCLP,
  formatEventDate,
  loadEventFinancialReportData,
  buildMandatoryFeeImpactNote
} from '../../utils/eventPdfService';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

const EventsGlobalReportModal = ({ isOpen, onClose, events = [], courseName = '', usersMap = {} }) => {
  useLockBodyScroll(isOpen);

  const [loading, setLoading] = useState(true);
  const [eventReports, setEventReports] = useState([]);
  const [includeTestEvents, setIncludeTestEvents] = useState(false);
  const [excludedEventIds, setExcludedEventIds] = useState(new Set());
  const [hideDebtorNames, setHideDebtorNames] = useState(false);
  const [pdfIncludeDebtorNames, setPdfIncludeDebtorNames] = useState(true);
  const [expandedEventIds, setExpandedEventIds] = useState(new Set());
  const [copiedWhatsapp, setCopiedWhatsapp] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;

    const fetchAllEventsFinancials = async () => {
      setLoading(true);
      try {
        const sortedEvents = [...events].sort(
          (a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0)
        );
        const results = await Promise.all(
          sortedEvents.map((ev) => loadEventFinancialReportData(ev).catch(() => null))
        );
        if (!isMounted) return;

        const enriched = results
          .filter(Boolean)
          .map((rep) => {
            const ev = rep.event || {};
            const fineDebts = rep.fineDebts || [];
            let fineTotalExpected = 0;
            const finePendingList = [];

            fineDebts.forEach((f) => {
              const amt = Number(f.amount) || 0;
              fineTotalExpected += amt;
              if (f.status !== 'paid') {
                const paidPart = Number(f.paidAmount) || 0;
                finePendingList.push({
                  id: f.id,
                  studentName: f.studentName || 'Alumno',
                  amount: Math.max(0, amt - paidPart),
                  status: f.status,
                  apoderadoEmails: f.apoderadoEmails || [],
                  type: 'fine'
                });
              }
            });
            finePendingList.sort((a, b) => (a.studentName || '').localeCompare(b.studentName || ''));

            const finePendingAmount = finePendingList.reduce((sum, item) => sum + item.amount, 0);
            const mandatoryPendingAmount = (rep.mandatoryPendingList || []).reduce(
              (sum, item) => sum + (Number(item.amount) || 0),
              0
            );

            // Rentabilidad % ingresos vs gastos CON y SIN cuota obligatoria
            const totalExpenses = Number(rep.totalExpenses) || 0;
            const netWithMandatory = Number(rep.netProfit) || 0;
            const netWithoutMandatory = Number(rep.netProfitWithoutMandatory) || 0;

            const roiWithMandatoryPct =
              totalExpenses > 0
                ? (netWithMandatory / totalExpenses) * 100
                : netWithMandatory > 0
                  ? 100
                  : 0;

            const roiWithoutMandatoryPct =
              totalExpenses > 0
                ? (netWithoutMandatory / totalExpenses) * 100
                : netWithoutMandatory > 0
                  ? 100
                  : 0;

            const allUnpaidItems = [
              ...(rep.mandatoryPendingList || []).map((item) => ({ ...item, type: 'mandatory' })),
              ...finePendingList
            ];

            return {
              ...rep,
              fineTotalExpected,
              finePendingList,
              finePendingAmount,
              mandatoryPendingAmount,
              totalPendingAmount: mandatoryPendingAmount + finePendingAmount,
              totalUnpaidRecordsCount: allUnpaidItems.length,
              allUnpaidItems,
              roiWithMandatoryPct,
              roiWithoutMandatoryPct
            };
          });

        setEventReports(enriched);
      } catch (err) {
        console.error('Error cargando informe global de eventos:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchAllEventsFinancials();
    return () => {
      isMounted = false;
    };
  }, [isOpen, events]);

  const visibleReports = useMemo(() => {
    return eventReports.filter((rep) => {
      if (!includeTestEvents && rep.event?.isTestEvent) return false;
      if (excludedEventIds.has(rep.event?.id)) return false;
      return true;
    });
  }, [eventReports, includeTestEvents, excludedEventIds]);

  const globalTotals = useMemo(() => {
    let mandatoryPaid = 0;
    let mandatoryExpected = 0;
    let finePaid = 0;
    let fineExpected = 0;
    let salesTotal = 0;
    let cashSales = 0;
    let transferSales = 0;
    let totalIncomes = 0;
    let totalExpenses = 0;
    let netWithMandatory = 0;
    let netWithoutMandatory = 0;
    let mandatoryPendingCount = 0;
    let mandatoryPendingAmount = 0;
    let finePendingCount = 0;
    let finePendingAmount = 0;
    let eventsThatWouldLoseWithoutQuota = 0;
    let eventsWithMandatoryQuota = 0;

    visibleReports.forEach((r) => {
      mandatoryPaid += Number(r.mandatoryTotalPaid) || 0;
      mandatoryExpected += Number(r.mandatoryTotalExpected) || 0;
      finePaid += Number(r.fineTotalPaid) || 0;
      fineExpected += Number(r.fineTotalExpected) || 0;
      salesTotal += Number(r.totalSales) || 0;
      cashSales += Number(r.cashSales) || 0;
      transferSales += Number(r.transferSales) || 0;
      totalIncomes += Number(r.totalIncomes) || 0;
      totalExpenses += Number(r.totalExpenses) || 0;
      netWithMandatory += Number(r.netProfit) || 0;
      netWithoutMandatory += Number(r.netProfitWithoutMandatory) || 0;
      mandatoryPendingCount += Number(r.mandatoryPendingCount) || 0;
      mandatoryPendingAmount += Number(r.mandatoryPendingAmount) || 0;
      finePendingCount += Number(r.finePendingCount) || 0;
      finePendingAmount += Number(r.finePendingAmount) || 0;

      if ((Number(r.mandatoryTotalExpected) || 0) > 0 || (Number(r.mandatoryTotalPaid) || 0) > 0) {
        eventsWithMandatoryQuota++;
        if ((Number(r.netProfitWithoutMandatory) || 0) <= 0 && (Number(r.netProfit) || 0) > 0) {
          eventsThatWouldLoseWithoutQuota++;
        }
      }
    });

    const roiWithMandatoryPct =
      totalExpenses > 0
        ? (netWithMandatory / totalExpenses) * 100
        : netWithMandatory > 0
          ? 100
          : 0;

    const roiWithoutMandatoryPct =
      totalExpenses > 0
        ? (netWithoutMandatory / totalExpenses) * 100
        : netWithoutMandatory > 0
          ? 100
          : 0;

    const mandatoryShareOfNetProfitPct =
      netWithMandatory > 0
        ? Math.min(100, Math.max(0, (mandatoryPaid / netWithMandatory) * 100))
        : 0;

    const mandatoryShareOfTotalIncomePct =
      totalIncomes > 0 ? (mandatoryPaid / totalIncomes) * 100 : 0;

    return {
      eventsCount: visibleReports.length,
      eventsWithMandatoryQuota,
      eventsThatWouldLoseWithoutQuota,
      mandatoryPaid,
      mandatoryExpected,
      finePaid,
      fineExpected,
      salesTotal,
      cashSales,
      transferSales,
      totalIncomes,
      totalExpenses,
      netWithMandatory,
      netWithoutMandatory,
      roiWithMandatoryPct,
      roiWithoutMandatoryPct,
      mandatoryShareOfNetProfitPct,
      mandatoryShareOfTotalIncomePct,
      mandatoryPendingCount,
      mandatoryPendingAmount,
      finePendingCount,
      finePendingAmount,
      totalPendingCount: mandatoryPendingCount + finePendingCount,
      totalPendingAmount: mandatoryPendingAmount + finePendingAmount
    };
  }, [visibleReports]);

  const toggleEventDetails = (eventId) => {
    setExpandedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const toggleIncludeEvent = (eventId) => {
    setExcludedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const handleCopyWhatsappSummary = () => {
    let text = `📊 *INFORME CONSOLIDADO DE EVENTOS DEL CURSO*${courseName ? ` (${courseName})` : ''}\n`;
    text += `Eventos analizados: *${globalTotals.eventsCount}*\n\n`;

    text += `💰 *DESGLOSE TOTAL DE INGRESOS:*\n`;
    text += `• Cuotas Obligatorias Recaudadas: *${formatCLP(globalTotals.mandatoryPaid)}* (de ${formatCLP(globalTotals.mandatoryExpected)})\n`;
    text += `• Cuotas de Inasistencia (Multas): *${formatCLP(globalTotals.finePaid)}*\n`;
    text += `• Ingresos por Ventas (POS): *${formatCLP(globalTotals.salesTotal)}*\n`;
    text += `• *TOTAL INGRESOS BRUTOS:* *${formatCLP(globalTotals.totalIncomes)}*\n`;
    text += `• *TOTAL GASTOS DE EVENTOS:* *${formatCLP(globalTotals.totalExpenses)}*\n\n`;

    text += `📈 *IMPACTO DE LA CUOTA OBLIGATORIA (CON vs SIN CUOTA):*\n`;
    text += `• ✅ *Ganancia Neta CON Cuota Obligatoria:* *${formatCLP(globalTotals.netWithMandatory)}* (Rentabilidad vs gastos: ${globalTotals.roiWithMandatoryPct >= 0 ? '+' : ''}${globalTotals.roiWithMandatoryPct.toFixed(1)}%)\n`;
    text += `• ⚠️ *Resultado SIN Cuota Obligatoria (Solo Ventas - Gastos):* *${formatCLP(globalTotals.netWithoutMandatory)}* (Rentabilidad: ${globalTotals.roiWithoutMandatoryPct >= 0 ? '+' : ''}${globalTotals.roiWithoutMandatoryPct.toFixed(1)}%)\n`;
    text += `• 💡 *Importancia de la Cuota:* La cuota obligatoria representa el *${globalTotals.mandatoryShareOfNetProfitPct.toFixed(1)}%* de la ganancia neta total obtenida en los eventos.\n\n`;

    text += `📋 *DETALLE POR EVENTO:*\n`;
    visibleReports.forEach((r, idx) => {
      const ev = r.event || {};
      text += `${idx + 1}. *${ev.name}* (${formatEventDate(ev.date)})\n`;
      text += `   - Cuota Oblig.: ${formatCLP(r.mandatoryTotalPaid)} | Multas: ${formatCLP(r.fineTotalPaid)} | Ventas: ${formatCLP(r.totalSales)}\n`;
      text += `   - Gastos: ${formatCLP(r.totalExpenses)}\n`;
      text += `   - Ganancia CON Cuota: *${formatCLP(r.netProfit)}* (${r.roiWithMandatoryPct >= 0 ? '+' : ''}${r.roiWithMandatoryPct.toFixed(1)}%) vs SIN Cuota: *${formatCLP(r.netProfitWithoutMandatory)}* (${r.roiWithoutMandatoryPct >= 0 ? '+' : ''}${r.roiWithoutMandatoryPct.toFixed(1)}%)\n`;
      if (r.totalUnpaidRecordsCount > 0) {
        text += `   - ⚠️ Impagos: ${r.mandatoryPendingCount} cuota(s) y ${r.finePendingCount} multa(s) pendientes (${formatCLP(r.totalPendingAmount)})\n`;
      } else {
        text += `   - ✅ Sin apoderados morosos\n`;
      }
    });

    if (globalTotals.totalPendingCount > 0) {
      text += `\n⚠️ *RESUMEN DE MOROSIDAD EN EVENTOS:*\n`;
      text += `• Cuotas obligatorias pendientes: ${globalTotals.mandatoryPendingCount} (${formatCLP(globalTotals.mandatoryPendingAmount)})\n`;
      text += `• Multas de inasistencia pendientes: ${globalTotals.finePendingCount} (${formatCLP(globalTotals.finePendingAmount)})\n`;
      text += `• *Total por cobrar en eventos:* *${formatCLP(globalTotals.totalPendingAmount)}*\n`;
    }

    navigator.clipboard.writeText(text);
    setCopiedWhatsapp(true);
    setTimeout(() => setCopiedWhatsapp(false), 2500);
  };

  const handleGenerateGlobalEventsPdf = () => {
    if (visibleReports.length === 0) return;
    setGeneratingPdf(true);
    try {
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
        compress: true
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let y = 14;

      const primary = [79, 70, 229];
      const success = [16, 185, 129];
      const danger = [220, 38, 38];
      const warning = [217, 119, 6];
      const textMain = [15, 23, 42];
      const textMuted = [100, 116, 139];

      // Header Banner
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(12, y, pageWidth - 24, 24, 3, 3, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text(
        `INFORME CONSOLIDADO DE EVENTOS Y RENTABILIDAD${courseName ? ` - ${courseName.toUpperCase()}` : ''}`,
        18,
        y + 10
      );
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Análisis comparativo de Ingresos (Cuotas Obligatorias, Inasistencias y Ventas), Gastos, Rentabilidad CON vs SIN Cuota Obligatoria y Morosidad  •  Eventos: ${globalTotals.eventsCount}`,
        18,
        y + 17.5
      );
      y += 30;

      // Section 1: KPI Cards (6 columns)
      const kpis = [
        {
          label: 'Cuotas Obligatorias',
          val: formatCLP(globalTotals.mandatoryPaid),
          sub: `Esperado: ${formatCLP(globalTotals.mandatoryExpected)}`,
          color: primary
        },
        {
          label: 'Multas Inasistencia',
          val: formatCLP(globalTotals.finePaid),
          sub: `Pendiente: ${formatCLP(globalTotals.finePendingAmount)}`,
          color: warning
        },
        {
          label: 'Ingresos por Ventas',
          val: formatCLP(globalTotals.salesTotal),
          sub: `Efec: ${formatCLP(globalTotals.cashSales)}`,
          color: [37, 99, 235]
        },
        {
          label: 'Total Gastos Eventos',
          val: formatCLP(globalTotals.totalExpenses),
          sub: `Ingresos Brutos: ${formatCLP(globalTotals.totalIncomes)}`,
          color: danger
        },
        {
          label: 'Ganancia CON Cuota',
          val: formatCLP(globalTotals.netWithMandatory),
          sub: `Rentab. vs Gastos: ${globalTotals.roiWithMandatoryPct >= 0 ? '+' : ''}${globalTotals.roiWithMandatoryPct.toFixed(1)}%`,
          color: success
        },
        {
          label: 'Resultado SIN Cuota',
          val: formatCLP(globalTotals.netWithoutMandatory),
          sub: `Rentab. sin Cuota: ${globalTotals.roiWithoutMandatoryPct >= 0 ? '+' : ''}${globalTotals.roiWithoutMandatoryPct.toFixed(1)}%`,
          color: globalTotals.netWithoutMandatory >= 0 ? warning : danger
        }
      ];

      const boxW = (pageWidth - 24 - 15) / 6;
      const boxH = 21;
      kpis.forEach((k, idx) => {
        const bx = 12 + idx * (boxW + 3);
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(bx, y, boxW, boxH, 2, 2, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.2);
        doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
        doc.text(k.label.toUpperCase(), bx + 3, y + 5.5);

        doc.setFontSize(10.5);
        doc.setTextColor(k.color[0], k.color[1], k.color[2]);
        doc.text(k.val, bx + 3, y + 12.5);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
        doc.text(k.sub, bx + 3, y + 18);
      });
      y += boxH + 5;

      // Highlight Banner: Demostración de la importancia de la Cuota Obligatoria
      doc.setFillColor(238, 242, 255);
      doc.setDrawColor(199, 210, 254);
      doc.roundedRect(12, y, pageWidth - 24, 14, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(49, 46, 129);
      doc.text(
        `IMPORTANCIA DE LA CUOTA OBLIGATORIA: De los ${formatCLP(globalTotals.netWithMandatory)} de ganancia total de los eventos, ${formatCLP(globalTotals.mandatoryPaid)} (${globalTotals.mandatoryShareOfNetProfitPct.toFixed(1)}%) provienen de la Cuota Obligatoria.`,
        16,
        y + 5.8
      );
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(
        `Sin la cuota obligatoria, la utilidad neta habría caído a ${formatCLP(globalTotals.netWithoutMandatory)} (${globalTotals.eventsThatWouldLoseWithoutQuota} de ${globalTotals.eventsWithMandatoryQuota || globalTotals.eventsCount} evento(s) con cuota habrían tenido pérdida o ganancia $0). Además, quedan ${formatCLP(globalTotals.totalPendingAmount)} pendientes por cobrar (${globalTotals.totalPendingCount} cobros impagos).`,
        16,
        y + 11.2
      );
      y += 19;

      // Section 2: Tabla Comparativa de Todos los Eventos
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(textMain[0], textMain[1], textMain[2]);
      doc.text('1. Tabla Comparativa de Ingresos, Gastos y Rentabilidad por Evento (Con vs Sin Cuota Obligatoria)', 12, y);
      y += 4;

      const drawComparisonHeader = (currY) => {
        doc.setFillColor(15, 23, 42);
        doc.rect(12, currY, pageWidth - 24, 8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.2);
        doc.setTextColor(255, 255, 255);
        doc.text('Evento / Fecha', 14, currY + 5.3);
        doc.text('Cuota Oblig.', 88, currY + 5.3, { align: 'right' });
        doc.text('Inasistencias', 114, currY + 5.3, { align: 'right' });
        doc.text('Ventas POS', 140, currY + 5.3, { align: 'right' });
        doc.text('Gastos', 165, currY + 5.3, { align: 'right' });
        doc.text('Ganancia CON Cuota', 198, currY + 5.3, { align: 'right' });
        doc.text('Resultado SIN Cuota', 231, currY + 5.3, { align: 'right' });
        doc.text('% Aporte Cuota', 255, currY + 5.3, { align: 'right' });
        doc.text('Impagos', pageWidth - 14, currY + 5.3, { align: 'right' });
        return currY + 8;
      };

      y = drawComparisonHeader(y);

      visibleReports.forEach((r, idx) => {
        if (y > pageHeight - 24) {
          doc.addPage();
          y = 15;
          y = drawComparisonHeader(y);
        }

        if (idx % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(12, y, pageWidth - 24, 8.5, 'F');
        }

        const ev = r.event || {};
        const evTitle = `${ev.name || 'Evento'} (${formatEventDate(ev.date)})`;
        const shortTitle = evTitle.length > 38 ? evTitle.slice(0, 35) + '...' : evTitle;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.4);
        doc.setTextColor(textMain[0], textMain[1], textMain[2]);
        doc.text(shortTitle, 14, y + 5.5);

        doc.setFont('helvetica', 'normal');
        doc.text(formatCLP(r.mandatoryTotalPaid), 88, y + 5.5, { align: 'right' });
        doc.text(formatCLP(r.fineTotalPaid), 114, y + 5.5, { align: 'right' });
        doc.text(formatCLP(r.totalSales), 140, y + 5.5, { align: 'right' });

        doc.setTextColor(danger[0], danger[1], danger[2]);
        doc.text(formatCLP(r.totalExpenses), 165, y + 5.5, { align: 'right' });

        // Ganancia CON Cuota
        doc.setFont('helvetica', 'bold');
        const netC = r.netProfit >= 0 ? success : danger;
        doc.setTextColor(netC[0], netC[1], netC[2]);
        doc.text(
          `${formatCLP(r.netProfit)} (${r.roiWithMandatoryPct >= 0 ? '+' : ''}${r.roiWithMandatoryPct.toFixed(0)}%)`,
          198,
          y + 5.5,
          { align: 'right' }
        );

        // Resultado SIN Cuota
        const sinC = r.netProfitWithoutMandatory > 0 ? warning : danger;
        doc.setTextColor(sinC[0], sinC[1], sinC[2]);
        doc.text(
          `${formatCLP(r.netProfitWithoutMandatory)} (${r.roiWithoutMandatoryPct >= 0 ? '+' : ''}${r.roiWithoutMandatoryPct.toFixed(0)}%)`,
          231,
          y + 5.5,
          { align: 'right' }
        );

        // % Aporte Cuota
        doc.setTextColor(primary[0], primary[1], primary[2]);
        doc.text(`${(r.mandatoryProfitSharePct || 0).toFixed(1)}%`, 255, y + 5.5, { align: 'right' });

        // Impagos
        if (r.totalUnpaidRecordsCount > 0) {
          doc.setTextColor(danger[0], danger[1], danger[2]);
          doc.text(`${r.totalUnpaidRecordsCount} (${formatCLP(r.totalPendingAmount)})`, pageWidth - 14, y + 5.5, { align: 'right' });
        } else {
          doc.setTextColor(success[0], success[1], success[2]);
          doc.text('Al día', pageWidth - 14, y + 5.5, { align: 'right' });
        }

        doc.setDrawColor(226, 232, 240);
        doc.line(12, y + 8.5, pageWidth - 12, y + 8.5);
        y += 8.5;
      });

      // Fila Totalizadora
      if (y > pageHeight - 20) {
        doc.addPage();
        y = 15;
      }
      doc.setFillColor(241, 245, 249);
      doc.rect(12, y, pageWidth - 24, 9, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.6);
      doc.setTextColor(textMain[0], textMain[1], textMain[2]);
      doc.text(`TOTAL CONSOLIDADO (${globalTotals.eventsCount} EVENTOS)`, 14, y + 6);
      doc.text(formatCLP(globalTotals.mandatoryPaid), 88, y + 6, { align: 'right' });
      doc.text(formatCLP(globalTotals.finePaid), 114, y + 6, { align: 'right' });
      doc.text(formatCLP(globalTotals.salesTotal), 140, y + 6, { align: 'right' });
      doc.setTextColor(danger[0], danger[1], danger[2]);
      doc.text(formatCLP(globalTotals.totalExpenses), 165, y + 6, { align: 'right' });
      doc.setTextColor(success[0], success[1], success[2]);
      doc.text(
        `${formatCLP(globalTotals.netWithMandatory)} (${globalTotals.roiWithMandatoryPct >= 0 ? '+' : ''}${globalTotals.roiWithMandatoryPct.toFixed(0)}%)`,
        198,
        y + 6,
        { align: 'right' }
      );
      const totalSinColor = globalTotals.netWithoutMandatory > 0 ? warning : danger;
      doc.setTextColor(totalSinColor[0], totalSinColor[1], totalSinColor[2]);
      doc.text(
        `${formatCLP(globalTotals.netWithoutMandatory)} (${globalTotals.roiWithoutMandatoryPct >= 0 ? '+' : ''}${globalTotals.roiWithoutMandatoryPct.toFixed(0)}%)`,
        231,
        y + 6,
        { align: 'right' }
      );
      doc.setTextColor(primary[0], primary[1], primary[2]);
      doc.text(`${globalTotals.mandatoryShareOfNetProfitPct.toFixed(1)}%`, 255, y + 6, { align: 'right' });
      doc.setTextColor(globalTotals.totalPendingCount > 0 ? danger[0] : success[0], globalTotals.totalPendingCount > 0 ? danger[1] : success[1], globalTotals.totalPendingCount > 0 ? danger[2] : success[2]);
      doc.text(
        globalTotals.totalPendingCount > 0
          ? `${globalTotals.totalPendingCount} (${formatCLP(globalTotals.totalPendingAmount)})`
          : 'Al día',
        pageWidth - 14,
        y + 6,
        { align: 'right' }
      );
      y += 14;

      // Section 3: Detalle de Morosidad y Análisis por Evento
      if (y > pageHeight - 35) {
        doc.addPage();
        y = 15;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(textMain[0], textMain[1], textMain[2]);
      doc.text('2. Análisis Individual por Evento y Estado de Apoderados Impagos', 12, y);
      y += 6;

      visibleReports.forEach((r, idx) => {
        if (y > pageHeight - 32) {
          doc.addPage();
          y = 15;
        }
        const ev = r.event || {};
        const impactNote = buildMandatoryFeeImpactNote({
          feeImpact: r.mandatoryFeeImpact,
          mandatoryTotalPaid: r.mandatoryTotalPaid,
          mandatoryTotalExpected: r.mandatoryTotalExpected
        });

        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(12, y, pageWidth - 24, 15, 2, 2, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(textMain[0], textMain[1], textMain[2]);
        doc.text(
          `${idx + 1}. ${ev.name || 'Evento'} (${formatEventDate(ev.date)})  —  Cuota: ${formatCLP(ev.mandatoryAmount)} | Multa Inasist.: ${formatCLP(ev.noShowAmount)}`,
          15,
          y + 5.5
        );

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.6);
        doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
        doc.text(`Conclusión: ${impactNote}`, 15, y + 11.2);
        y += 17;

        if (r.allUnpaidItems.length > 0) {
          if (pdfIncludeDebtorNames) {
            const unpaidTextList = r.allUnpaidItems.map((u) => {
              const label = u.type === 'fine' ? 'Multa Inasist.' : 'Cuota Oblig.';
              return `${u.studentName} (${label}: ${formatCLP(u.amount)})`;
            });
            const lines = doc.splitTextToSize(
              `Pendientes de pago (${r.allUnpaidItems.length} - Total ${formatCLP(r.totalPendingAmount)}): ${unpaidTextList.join('  •  ')}`,
              pageWidth - 30
            );
            if (y + lines.length * 4 > pageHeight - 15) {
              doc.addPage();
              y = 15;
            }
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.3);
            doc.setTextColor(danger[0], danger[1], danger[2]);
            doc.text(lines, 15, y + 3);
            y += lines.length * 4 + 3;
          } else {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(7.5);
            doc.setTextColor(danger[0], danger[1], danger[2]);
            doc.text(
              `Registros pendientes de pago: ${r.mandatoryPendingCount} cuota(s) obligatoria(s) (${formatCLP(r.mandatoryPendingAmount)}) y ${r.finePendingCount} multa(s) de inasistencia (${formatCLP(r.finePendingAmount)}).`,
              15,
              y + 3
            );
            y += 6;
          }
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(success[0], success[1], success[2]);
          doc.text('✓ Todos los apoderados al día en este evento (0 deudas pendientes).', 15, y + 3);
          y += 6;
        }
      });

      const dateStr = new Date().toISOString().split('T')[0];
      doc.save(`Informe_Consolidado_Eventos_${dateStr}.pdf`);
    } catch (err) {
      console.error('Error generando PDF global de eventos:', err);
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(6px)',
        zIndex: 10050,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '1rem 0.75rem 2rem',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch'
      }}
    >
      <div
        className="glass-panel animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '1180px',
          margin: '0.25rem auto',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-main)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '0.75rem',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)'
              }}
            >
              <BarChart3 size={24} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.3rem', color: 'var(--text-main)' }}>
                Informe Consolidado de Todos los Eventos Realizados
              </h2>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                Ingresos por Cuotas Obligatorias, Inasistencias, Ventas POS, Gastos, Rentabilidad CON vs SIN Cuota Obligatoria y Apoderados Impagos
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setHideDebtorNames(!hideDebtorNames)}
              className="btn btn-outline"
              style={{
                padding: '0.45rem 0.85rem',
                fontSize: '0.8rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                borderColor: hideDebtorNames ? 'var(--warning)' : 'var(--border-color)',
                color: hideDebtorNames ? 'var(--warning)' : 'var(--text-muted)'
              }}
              title="Ocultar o mostrar nombres de alumnos con deuda al proyectar"
            >
              {hideDebtorNames ? <EyeOff size={15} /> : <Eye size={15} />}
              {hideDebtorNames ? 'Modo Proyector Activo' : 'Modo Proyector'}
            </button>

            <button
              type="button"
              onClick={handleCopyWhatsappSummary}
              disabled={loading || visibleReports.length === 0}
              className="btn btn-outline"
              style={{
                padding: '0.45rem 0.85rem',
                fontSize: '0.8rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                borderColor: 'rgba(16, 185, 129, 0.45)',
                color: '#34d399'
              }}
            >
              {copiedWhatsapp ? <Check size={15} /> : <Copy size={15} />}
              {copiedWhatsapp ? '¡Copiado para WhatsApp!' : 'Copiar Resumen WhatsApp'}
            </button>

            <button
              type="button"
              onClick={handleGenerateGlobalEventsPdf}
              disabled={loading || generatingPdf || visibleReports.length === 0}
              className="btn btn-primary"
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.84rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem'
              }}
            >
              <Download size={16} />
              {generatingPdf ? 'Generando PDF...' : 'Descargar Informe PDF'}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="btn btn-outline"
              style={{ padding: '0.45rem 0.6rem' }}
              title="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
              <RefreshCw size={34} className="animate-spin" style={{ color: 'var(--primary)', margin: '0 auto 1rem' }} />
              <h3 style={{ margin: 0 }}>Analizando finanzas de todos los eventos del curso...</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Consolidando cuotas obligatorias, multas de inasistencia, ventas POS, gastos y morosidad.
              </p>
            </div>
          ) : eventReports.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
              No hay eventos registrados en este curso todavía.
            </div>
          ) : (
            <>
              {/* Barra de Filtros de Eventos Incluidos y Opciones de PDF */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  backgroundColor: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '1.25rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-muted)' }}>
                    Eventos incluidos ({visibleReports.length}):
                  </span>
                  {eventReports
                    .filter((r) => includeTestEvents || !r.event?.isTestEvent)
                    .map((r) => {
                      const ev = r.event || {};
                      const isIncluded = !excludedEventIds.has(ev.id);
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => toggleIncludeEvent(ev.id)}
                          style={{
                            padding: '0.22rem 0.6rem',
                            borderRadius: '999px',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            border: isIncluded
                              ? '1px solid rgba(99, 102, 241, 0.5)'
                              : '1px solid var(--border-color)',
                            backgroundColor: isIncluded
                              ? 'rgba(99, 102, 241, 0.16)'
                              : 'transparent',
                            color: isIncluded ? '#a5b4fc' : 'var(--text-muted)',
                            textDecoration: isIncluded ? 'none' : 'line-through'
                          }}
                          title="Clic para incluir u ocultar este evento del informe consolidado"
                        >
                          {ev.name}
                        </button>
                      );
                    })}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', fontSize: '0.78rem' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', color: 'var(--text-muted)' }}>
                    <input
                      type="checkbox"
                      checked={pdfIncludeDebtorNames}
                      onChange={(e) => setPdfIncludeDebtorNames(e.target.checked)}
                    />
                    Incluir nombres de impagos en el PDF
                  </label>

                  {eventReports.some((r) => r.event?.isTestEvent) && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', color: 'var(--warning)' }}>
                      <input
                        type="checkbox"
                        checked={includeTestEvents}
                        onChange={(e) => setIncludeTestEvents(e.target.checked)}
                      />
                      Incluir eventos de prueba
                    </label>
                  )}
                </div>
              </div>

              {/* 1. Tarjetas de Resumen Global (KPIs) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1.25rem'
                }}
              >
                <div className="glass-panel" style={{ padding: '1.1rem', borderLeft: '4px solid var(--primary)' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Ingresos Cuotas Obligatorias</span>
                  <h3 style={{ margin: '0.3rem 0', fontSize: '1.45rem', color: 'var(--primary)' }}>
                    {formatCLP(globalTotals.mandatoryPaid)}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    De {formatCLP(globalTotals.mandatoryExpected)} esperado ({globalTotals.mandatoryExpected > 0 ? Math.round((globalTotals.mandatoryPaid / globalTotals.mandatoryExpected) * 100) : 0}% cobrado)
                  </span>
                </div>

                <div className="glass-panel" style={{ padding: '1.1rem', borderLeft: '4px solid var(--warning)' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Ingresos Cuotas Inasistencia</span>
                  <h3 style={{ margin: '0.3rem 0', fontSize: '1.45rem', color: 'var(--warning)' }}>
                    {formatCLP(globalTotals.finePaid)}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Pendiente en multas: {formatCLP(globalTotals.finePendingAmount)} ({globalTotals.finePendingCount} impagas)
                  </span>
                </div>

                <div className="glass-panel" style={{ padding: '1.1rem', borderLeft: '4px solid #3b82f6' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Ingresos por Ventas (POS)</span>
                  <h3 style={{ margin: '0.3rem 0', fontSize: '1.45rem', color: '#60a5fa' }}>
                    {formatCLP(globalTotals.salesTotal)}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Efectivo: {formatCLP(globalTotals.cashSales)} • Transf.: {formatCLP(globalTotals.transferSales)}
                  </span>
                </div>

                <div className="glass-panel" style={{ padding: '1.1rem', borderLeft: '4px solid var(--danger)' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Gastos Totales de Eventos</span>
                  <h3 style={{ margin: '0.3rem 0', fontSize: '1.45rem', color: 'var(--danger)' }}>
                    {formatCLP(globalTotals.totalExpenses)}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Ingresos Brutos Totales: {formatCLP(globalTotals.totalIncomes)}
                  </span>
                </div>

                <div className="glass-panel" style={{ padding: '1.1rem', borderLeft: '4px solid var(--success)' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Por Cobrar (Apoderados Impagos)</span>
                  <h3 style={{ margin: '0.3rem 0', fontSize: '1.45rem', color: globalTotals.totalPendingAmount > 0 ? '#f87171' : 'var(--success)' }}>
                    {formatCLP(globalTotals.totalPendingAmount)}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {globalTotals.mandatoryPendingCount} cuota(s) + {globalTotals.finePendingCount} multa(s) pendientes
                  </span>
                </div>
              </div>

              {/* 2. Panel Comparativo Principal: CON Cuota Obligatoria vs SIN Cuota Obligatoria */}
              <div
                style={{
                  padding: '1.35rem 1.5rem',
                  borderRadius: '1rem',
                  background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.14) 0%, rgba(16, 185, 129, 0.1) 100%)',
                  border: '1px solid rgba(99, 102, 241, 0.35)',
                  marginBottom: '1.5rem'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <TrendingUp size={20} color="#34d399" /> Demostración del Impacto de la Cuota Obligatoria en la Rentabilidad
                    </h3>
                    <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                      Comparación directa entre el resultado real de los eventos y lo que habría ocurrido si solo se vendiera sin cobrar cuota obligatoria:
                    </p>
                  </div>
                  <span
                    style={{
                      padding: '0.35rem 0.85rem',
                      borderRadius: '999px',
                      backgroundColor: 'rgba(16, 185, 129, 0.18)',
                      border: '1px solid rgba(16, 185, 129, 0.4)',
                      color: '#34d399',
                      fontWeight: '800',
                      fontSize: '0.82rem'
                    }}
                  >
                    La Cuota aporta el {globalTotals.mandatoryShareOfNetProfitPct.toFixed(1)}% de la Ganancia Total
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                  {/* Escenario Real CON Cuota Obligatoria */}
                  <div
                    style={{
                      padding: '1.15rem',
                      borderRadius: '0.85rem',
                      backgroundColor: 'rgba(16, 185, 129, 0.1)',
                      border: '1px solid rgba(16, 185, 129, 0.35)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#34d399', textTransform: 'uppercase' }}>
                        ✅ Resultado Real CON Cuota Obligatoria
                      </span>
                      <span style={{ fontSize: '0.78rem', fontWeight: '800', color: '#34d399' }}>
                        Rentabilidad: {globalTotals.roiWithMandatoryPct >= 0 ? '+' : ''}{globalTotals.roiWithMandatoryPct.toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: '800', color: '#34d399' }}>
                      {formatCLP(globalTotals.netWithMandatory)}
                    </div>
                    <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Suma de Ventas ({formatCLP(globalTotals.salesTotal)}) + Cuotas Obligatorias ({formatCLP(globalTotals.mandatoryPaid)}) + Multas ({formatCLP(globalTotals.finePaid)}) menos Gastos ({formatCLP(globalTotals.totalExpenses)}).
                    </p>
                  </div>

                  {/* Escenario Hipotético SIN Cuota Obligatoria */}
                  <div
                    style={{
                      padding: '1.15rem',
                      borderRadius: '0.85rem',
                      backgroundColor: globalTotals.netWithoutMandatory <= 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.1)',
                      border: globalTotals.netWithoutMandatory <= 0 ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid rgba(245, 158, 11, 0.35)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: '700', color: globalTotals.netWithoutMandatory <= 0 ? '#f87171' : '#fbbf24', textTransform: 'uppercase' }}>
                        ⚠️ Resultado SIN Cuota Obligatoria
                      </span>
                      <span style={{ fontSize: '0.78rem', fontWeight: '800', color: globalTotals.netWithoutMandatory <= 0 ? '#f87171' : '#fbbf24' }}>
                        Rentabilidad: {globalTotals.roiWithoutMandatoryPct >= 0 ? '+' : ''}{globalTotals.roiWithoutMandatoryPct.toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: '800', color: globalTotals.netWithoutMandatory <= 0 ? '#f87171' : '#fbbf24' }}>
                      {formatCLP(globalTotals.netWithoutMandatory)}
                    </div>
                    <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Si solo se contabilizaran las Ventas + Multas menos los Gastos de insumos ({formatCLP(globalTotals.totalExpenses)}), el curso habría obtenido{' '}
                      <strong>{formatCLP(globalTotals.mandatoryPaid)} menos de utilidad</strong>.
                    </p>
                  </div>
                </div>
              </div>

              {/* 3. Tabla Comparativa de Todos los Eventos */}
              <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem', overflowX: 'auto' }}>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.08rem', color: 'var(--text-main)' }}>
                  Tabla Comparativa de Eventos Realizados
                </h3>
                <table style={{ width: '100%', minWidth: '920px', borderCollapse: 'collapse', fontSize: '0.84rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', fontSize: '0.76rem', textTransform: 'uppercase' }}>
                      <th style={{ padding: '0.75rem 0.65rem' }}>Evento / Fecha</th>
                      <th style={{ padding: '0.75rem 0.65rem', textAlign: 'right' }}>Cuota Oblig.</th>
                      <th style={{ padding: '0.75rem 0.65rem', textAlign: 'right' }}>Inasistencias</th>
                      <th style={{ padding: '0.75rem 0.65rem', textAlign: 'right' }}>Ventas POS</th>
                      <th style={{ padding: '0.75rem 0.65rem', textAlign: 'right' }}>Gastos</th>
                      <th style={{ padding: '0.75rem 0.65rem', textAlign: 'right' }}>Ganancia CON Cuota</th>
                      <th style={{ padding: '0.75rem 0.65rem', textAlign: 'right' }}>Resultado SIN Cuota</th>
                      <th style={{ padding: '0.75rem 0.65rem', textAlign: 'right' }}>% Aporte Cuota</th>
                      <th style={{ padding: '0.75rem 0.65rem', textAlign: 'center' }}>Apoderados Impagos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleReports.map((r) => {
                      const ev = r.event || {};
                      const isExpanded = expandedEventIds.has(ev.id);
                      const impactNote = buildMandatoryFeeImpactNote({
                        feeImpact: r.mandatoryFeeImpact,
                        mandatoryTotalPaid: r.mandatoryTotalPaid,
                        mandatoryTotalExpected: r.mandatoryTotalExpected
                      });

                      return (
                        <React.Fragment key={ev.id}>
                          <tr
                            onClick={() => toggleEventDetails(ev.id)}
                            style={{
                              borderBottom: '1px solid rgba(255,255,255,0.06)',
                              cursor: 'pointer',
                              backgroundColor: isExpanded ? 'rgba(99, 102, 241, 0.08)' : 'transparent'
                            }}
                          >
                            <td style={{ padding: '0.8rem 0.65rem' }}>
                              <div style={{ fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                {isExpanded ? <ChevronUp size={15} color="#818cf8" /> : <ChevronDown size={15} color="var(--text-muted)" />}
                                <span>{ev.name}</span>
                              </div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', paddingLeft: '1.3rem' }}>
                                {formatEventDate(ev.date)} • Cuota base: {formatCLP(ev.mandatoryAmount)} • Multa: {formatCLP(ev.noShowAmount)}
                              </div>
                            </td>

                            <td style={{ padding: '0.8rem 0.65rem', textAlign: 'right' }}>
                              <div style={{ fontWeight: '700', color: '#a5b4fc' }}>{formatCLP(r.mandatoryTotalPaid)}</div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>de {formatCLP(r.mandatoryTotalExpected)}</div>
                            </td>

                            <td style={{ padding: '0.8rem 0.65rem', textAlign: 'right' }}>
                              <div style={{ fontWeight: '700', color: '#fbbf24' }}>{formatCLP(r.fineTotalPaid)}</div>
                              {r.finePendingAmount > 0 && (
                                <div style={{ fontSize: '0.72rem', color: '#f87171' }}>Pend: {formatCLP(r.finePendingAmount)}</div>
                              )}
                            </td>

                            <td style={{ padding: '0.8rem 0.65rem', textAlign: 'right', fontWeight: '700', color: '#60a5fa' }}>
                              {formatCLP(r.totalSales)}
                            </td>

                            <td style={{ padding: '0.8rem 0.65rem', textAlign: 'right', fontWeight: '700', color: '#f87171' }}>
                              {formatCLP(r.totalExpenses)}
                            </td>

                            <td style={{ padding: '0.8rem 0.65rem', textAlign: 'right' }}>
                              <div style={{ fontWeight: '800', color: r.netProfit >= 0 ? '#34d399' : '#f87171' }}>
                                {formatCLP(r.netProfit)}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: r.roiWithMandatoryPct >= 0 ? '#34d399' : '#f87171' }}>
                                Rentab: {r.roiWithMandatoryPct >= 0 ? '+' : ''}{r.roiWithMandatoryPct.toFixed(1)}%
                              </div>
                            </td>

                            <td style={{ padding: '0.8rem 0.65rem', textAlign: 'right' }}>
                              <div style={{ fontWeight: '800', color: r.netProfitWithoutMandatory > 0 ? '#fbbf24' : '#f87171' }}>
                                {formatCLP(r.netProfitWithoutMandatory)}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: r.roiWithoutMandatoryPct > 0 ? '#fbbf24' : '#f87171' }}>
                                Rentab: {r.roiWithoutMandatoryPct >= 0 ? '+' : ''}{r.roiWithoutMandatoryPct.toFixed(1)}%
                              </div>
                            </td>

                            <td style={{ padding: '0.8rem 0.65rem', textAlign: 'right', fontWeight: '800', color: '#a5b4fc' }}>
                              {(r.mandatoryProfitSharePct || 0).toFixed(1)}%
                            </td>

                            <td style={{ padding: '0.8rem 0.65rem', textAlign: 'center' }}>
                              {r.totalUnpaidRecordsCount > 0 ? (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.3rem',
                                    padding: '0.25rem 0.6rem',
                                    borderRadius: '999px',
                                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                    border: '1px solid rgba(239, 68, 68, 0.35)',
                                    color: '#f87171',
                                    fontSize: '0.74rem',
                                    fontWeight: '700'
                                  }}
                                >
                                  <AlertCircle size={13} /> {r.totalUnpaidRecordsCount} ({formatCLP(r.totalPendingAmount)})
                                </span>
                              ) : (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem',
                                    padding: '0.22rem 0.6rem',
                                    borderRadius: '999px',
                                    backgroundColor: 'rgba(16, 185, 129, 0.14)',
                                    border: '1px solid rgba(16, 185, 129, 0.35)',
                                    color: '#34d399',
                                    fontSize: '0.74rem',
                                    fontWeight: '700'
                                  }}
                                >
                                  <CheckCircle size={13} /> Al día
                                </span>
                              )}
                            </td>
                          </tr>

                          {/* Fila Desplegable con Conclusión de Impacto y Lista de Apoderados Impagos */}
                          {isExpanded && (
                            <tr style={{ backgroundColor: 'rgba(15, 23, 42, 0.55)', borderBottom: '1px solid var(--border-color)' }}>
                              <td colSpan="9" style={{ padding: '1rem 1.25rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                                  <div
                                    style={{
                                      padding: '0.75rem 1rem',
                                      borderRadius: '0.65rem',
                                      backgroundColor: 'rgba(99, 102, 241, 0.1)',
                                      border: '1px solid rgba(99, 102, 241, 0.3)',
                                      fontSize: '0.83rem',
                                      color: 'var(--text-main)'
                                    }}
                                  >
                                    <strong style={{ color: '#a5b4fc' }}>💡 Análisis de Impacto de la Cuota en {ev.name}:</strong>{' '}
                                    {impactNote}
                                  </div>

                                  {r.allUnpaidItems.length > 0 ? (
                                    <div>
                                      <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#f87171', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <ShieldAlert size={15} />
                                        Detalle de Apoderados / Alumnos con Cobros Impagos en este Evento ({r.allUnpaidItems.length} pendientes — Total: {formatCLP(r.totalPendingAmount)}):
                                      </div>

                                      {hideDebtorNames ? (
                                        <div style={{ fontSize: '0.8rem', color: 'var(--warning)', fontStyle: 'italic' }}>
                                          Modo Proyector activo: {r.mandatoryPendingCount} cuota(s) obligatoria(s) ({formatCLP(r.mandatoryPendingAmount)}) y {r.finePendingCount} multa(s) de inasistencia ({formatCLP(r.finePendingAmount)}) pendientes. Desactiva el Modo Proyector arriba para ver los nombres.
                                        </div>
                                      ) : (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.5rem' }}>
                                          {r.allUnpaidItems.map((item) => {
                                            const apNames = (item.apoderadoEmails || [])
                                              .map((em) => usersMap[String(em).toLowerCase()] || em)
                                              .filter(Boolean);
                                            return (
                                              <div
                                                key={`${item.type}_${item.id}`}
                                                style={{
                                                  padding: '0.55rem 0.75rem',
                                                  borderRadius: '0.55rem',
                                                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                                                  border: '1px solid rgba(239, 68, 68, 0.25)',
                                                  display: 'flex',
                                                  justifyContent: 'space-between',
                                                  alignItems: 'center',
                                                  gap: '0.5rem'
                                                }}
                                              >
                                                <div style={{ minWidth: 0 }}>
                                                  <div style={{ fontWeight: '700', fontSize: '0.82rem', color: 'var(--text-main)' }}>
                                                    {item.studentName}
                                                  </div>
                                                  {apNames.length > 0 && (
                                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                      Apod.: {apNames.join(', ')}
                                                    </div>
                                                  )}
                                                  <span
                                                    style={{
                                                      display: 'inline-block',
                                                      marginTop: '0.15rem',
                                                      fontSize: '0.68rem',
                                                      padding: '0.08rem 0.4rem',
                                                      borderRadius: '4px',
                                                      backgroundColor: item.type === 'fine' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                                                      color: item.type === 'fine' ? '#fcd34d' : '#a5b4fc',
                                                      fontWeight: '700'
                                                    }}
                                                  >
                                                    {item.type === 'fine' ? 'Multa Inasistencia' : 'Cuota Obligatoria'}
                                                  </span>
                                                </div>
                                                <div style={{ fontWeight: '800', fontSize: '0.88rem', color: '#f87171', flexShrink: 0 }}>
                                                  {formatCLP(item.amount)}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: '0.82rem', color: '#34d399', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <CheckCircle size={15} /> Todos los participantes están al día con las cuotas y multas de este evento.
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
                  <tfoot>
                    <tr style={{ backgroundColor: 'rgba(255,255,255,0.05)', fontWeight: '800', borderTop: '2px solid var(--border-color)' }}>
                      <td style={{ padding: '0.85rem 0.65rem', color: 'var(--text-main)' }}>
                        TOTAL CONSOLIDADO ({globalTotals.eventsCount} EVENTOS)
                      </td>
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right', color: '#a5b4fc' }}>
                        {formatCLP(globalTotals.mandatoryPaid)}
                      </td>
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right', color: '#fbbf24' }}>
                        {formatCLP(globalTotals.finePaid)}
                      </td>
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right', color: '#60a5fa' }}>
                        {formatCLP(globalTotals.salesTotal)}
                      </td>
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right', color: '#f87171' }}>
                        {formatCLP(globalTotals.totalExpenses)}
                      </td>
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right', color: '#34d399' }}>
                        {formatCLP(globalTotals.netWithMandatory)} ({globalTotals.roiWithMandatoryPct >= 0 ? '+' : ''}{globalTotals.roiWithMandatoryPct.toFixed(1)}%)
                      </td>
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right', color: globalTotals.netWithoutMandatory > 0 ? '#fbbf24' : '#f87171' }}>
                        {formatCLP(globalTotals.netWithoutMandatory)} ({globalTotals.roiWithoutMandatoryPct >= 0 ? '+' : ''}{globalTotals.roiWithoutMandatoryPct.toFixed(1)}%)
                      </td>
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right', color: '#a5b4fc' }}>
                        {globalTotals.mandatoryShareOfNetProfitPct.toFixed(1)}%
                      </td>
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'center', color: globalTotals.totalPendingCount > 0 ? '#f87171' : '#34d399' }}>
                        {globalTotals.totalPendingCount > 0
                          ? `${globalTotals.totalPendingCount} (${formatCLP(globalTotals.totalPendingAmount)})`
                          : 'Todo al día'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <div style={{ marginTop: '0.6rem', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                  💡 Haz clic sobre cualquier fila de evento para desplegar la conclusión del impacto de la cuota obligatoria y la lista detallada de apoderados impagos.
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default EventsGlobalReportModal;
