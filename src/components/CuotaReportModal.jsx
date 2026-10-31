import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../firebase/config';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { X, Download, CheckCircle, AlertTriangle, Users, Layers, Table, Loader2 } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { formatStudentName } from '../utils/nameUtils';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';

const formatMoney = (amount) => {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
};

const CuotaReportModal = ({
  isOpen,
  onClose,
  selectedCourse,
  initialExpenseId = null,
  preloadedExpenses = null,
  preloadedStudents = null,
  preloadedDebts = null
}) => {
  useLockBodyScroll(isOpen);

  // Estados de datos
  const [loading, setLoading] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [students, setStudents] = useState([]);
  const [debts, setDebts] = useState([]);

  // Estados de configuración del reporte
  // scope: 'all' (Cuotas Totales Consolidadas) o ID de una cuota específica
  const [scope, setScope] = useState(initialExpenseId || 'all');
  // filter: 'all' (Totales), 'unpaid' (Impagos), 'paid' (Pagados)
  const [filter, setFilter] = useState('all');
  // columnMode: 'classic' (N° Lista, Alumno, Monto Pagado) o 'detailed' (con Total y Deuda)
  const [columnMode, setColumnMode] = useState('classic');

  // Actualizar scope si initialExpenseId cambia al abrirse
  useEffect(() => {
    if (initialExpenseId) {
      setScope(initialExpenseId);
    } else {
      setScope('all');
    }
  }, [initialExpenseId, isOpen]);

  // Carga de datos necesarios si no vienen precargados
  const fetchData = useCallback(async () => {
    if (!selectedCourse?.id || !isOpen) return;

    if (preloadedExpenses && preloadedStudents && preloadedDebts) {
      setExpenses(preloadedExpenses);
      setStudents(preloadedStudents);
      setDebts(preloadedDebts);
      return;
    }

    setLoading(true);
    try {
      const expensesPromise = preloadedExpenses 
        ? Promise.resolve({ docs: preloadedExpenses.map(e => ({ id: e.id, data: () => e })) })
        : getDocs(query(collection(db, 'expenses'), where('courseId', '==', selectedCourse.id)));

      const studentsPromise = preloadedStudents
        ? Promise.resolve({ docs: preloadedStudents.map(s => ({ id: s.id, data: () => s })) })
        : getDocs(query(collection(db, 'students'), where('courseId', '==', selectedCourse.id)));

      const debtsPromise = preloadedDebts
        ? Promise.resolve({ docs: preloadedDebts.map(d => ({ id: d.id, data: () => d })) })
        : getDocs(query(collection(db, 'debts'), where('courseId', '==', selectedCourse.id)));

      const [expSnap, stuSnap, debSnap] = await Promise.all([
        expensesPromise,
        studentsPromise,
        debtsPromise
      ]);

      const expList = expSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      expList.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

      const stuList = stuSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.status !== 'retirado');
      stuList.sort((a, b) => {
        const aNum = parseInt(a.listNumber, 10) || 999;
        const bNum = parseInt(b.listNumber, 10) || 999;
        return aNum - bNum;
      });

      const debList = debSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      setExpenses(expList);
      setStudents(stuList);
      setDebts(debList);
    } catch (error) {
      console.error("Error al cargar datos para reporte de cuotas:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedCourse, isOpen, preloadedExpenses, preloadedStudents, preloadedDebts]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Cuota actualmente seleccionada (si aplica)
  const currentExpense = useMemo(() => {
    if (scope === 'all') return null;
    return expenses.find(e => e.id === scope) || null;
  }, [scope, expenses]);

  // Cálculo consolidado de alumnos y sus pagos/deudas según el scope seleccionado
  const computedList = useMemo(() => {
    if (!students || students.length === 0) return [];

    return students.map(student => {
      let expected = 0;
      let paid = 0;
      let status = 'paid';

      if (scope === 'all') {
        // Consolidado de todas las cuotas del curso
        const studentDebts = debts.filter(d => d.studentId === student.id);
        studentDebts.forEach(d => {
          const debtAmt = d.amount || 0;
          expected += debtAmt;

          if (d.status === 'paid') {
            paid += typeof d.paidAmount === 'number' ? d.paidAmount : debtAmt;
          } else if (d.status === 'partial') {
            paid += d.paidAmount || 0;
          }
        });
      } else {
        // Cuota individual específica
        const debt = debts.find(d => d.expenseId === scope && d.studentId === student.id);
        if (debt) {
          expected = debt.amount || currentExpense?.totalAmount || 0;
          if (debt.status === 'paid') {
            paid = typeof debt.paidAmount === 'number' ? debt.paidAmount : expected;
          } else if (debt.status === 'partial') {
            paid = debt.paidAmount || 0;
          }
        } else {
          expected = currentExpense?.totalAmount || 0;
          paid = 0;
        }
      }

      const pending = Math.max(0, expected - paid);

      if (expected === 0 && paid === 0) {
        status = 'neutral';
      } else if (pending === 0) {
        status = 'paid';
      } else if (paid > 0 && pending > 0) {
        status = 'partial';
      } else {
        status = 'unpaid';
      }

      return {
        student,
        listNumber: student.listNumber || '-',
        name: formatStudentName(student),
        expected,
        paid,
        pending,
        status // 'paid' | 'partial' | 'unpaid' | 'neutral'
      };
    });
  }, [students, debts, scope, currentExpense]);

  // Contadores según el filtro
  const counts = useMemo(() => {
    let paidCount = 0;
    let unpaidCount = 0;
    let totalCount = computedList.length;

    computedList.forEach(item => {
      if (item.status === 'paid') paidCount++;
      else if (item.status === 'unpaid' || item.status === 'partial') unpaidCount++;
    });

    return {
      total: totalCount,
      paid: paidCount,
      unpaid: unpaidCount
    };
  }, [computedList]);

  // Lista filtrada que irá al PDF
  const filteredList = useMemo(() => {
    return computedList.filter(item => {
      if (filter === 'all') return true;
      if (filter === 'paid') return item.status === 'paid';
      if (filter === 'unpaid') return item.status === 'unpaid' || item.status === 'partial';
      return true;
    });
  }, [computedList, filter]);

  // Totales financieros de la lista filtrada
  const summaryTotals = useMemo(() => {
    let totalExpected = 0;
    let totalPaid = 0;
    let totalPending = 0;

    filteredList.forEach(item => {
      totalExpected += item.expected;
      totalPaid += item.paid;
      totalPending += item.pending;
    });

    return { totalExpected, totalPaid, totalPending };
  }, [filteredList]);

  // =========================================================================
  // GENERACIÓN DEL PDF EN FORMATO ESTILO EXCEL
  // =========================================================================
  const handleGeneratePDF = async () => {
    if (filteredList.length === 0) {
      alert("No hay alumnos que coincidan con el filtro seleccionado.");
      return;
    }

    setGeneratingPdf(true);
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 14;
      const printableWidth = pageWidth - (margin * 2); // 182 mm
      let y = margin;

      const excelGreen = [16, 124, 65];   // #107C41 (Verde Excel)
      const textMain = [30, 41, 59];       // #1E293B
      const textMuted = [100, 116, 139];   // #64748B
      const borderColor = [203, 213, 225]; // #CBD5E1 (Líneas Excel)
      const zebraColor = [248, 250, 252];  // #F8FAFC

      const todayStr = new Date().toLocaleDateString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      const filterLabel = filter === 'all'
        ? 'TOTALES (TODOS LOS ALUMNOS)'
        : filter === 'paid'
        ? 'SOLO ALUMNOS PAGADOS (AL DÍA)'
        : 'SOLO ALUMNOS IMPAGOS (CON DEUDA)';

      const reportTitle = scope === 'all'
        ? 'REPORTE CONSOLIDADO DE CUOTAS TOTALES'
        : `REPORTE DE CUOTA: ${(currentExpense?.title || 'CUOTA').toUpperCase()}`;

      // 1. Banner Superior Estilo Excel
      doc.setFillColor(excelGreen[0], excelGreen[1], excelGreen[2]);
      doc.roundedRect(margin, y, printableWidth, 23, 2, 2, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13.5);
      doc.text(reportTitle, margin + 6, y + 8.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(220, 252, 231); // Verde menta claro
      const subtitle = `Curso: ${selectedCourse?.name || 'Curso'}   •   Filtro: ${filterLabel}   •   Fecha: ${todayStr}`;
      doc.text(subtitle, margin + 6, y + 16.5);

      y += 28;

      // 2. Tarjetas KPI / Celdas de Resumen Superior Estilo Excel
      const kpis = [
        { label: 'Alumnos en Listado', val: `${filteredList.length} alumnos` },
        { label: 'Total Recaudado (Pagado)', val: formatMoney(summaryTotals.totalPaid), color: [16, 124, 65] },
        { label: 'Saldo Deuda Pendiente', val: formatMoney(summaryTotals.totalPending), color: summaryTotals.totalPending > 0 ? [220, 38, 38] : [100, 116, 139] },
        { 
          label: '% Cumplimiento', 
          val: `${summaryTotals.totalExpected > 0 ? Math.round((summaryTotals.totalPaid / summaryTotals.totalExpected) * 100) : 100}%` 
        }
      ];

      const kpiW = printableWidth / kpis.length;
      const kpiH = 13.5;

      kpis.forEach((kpi, idx) => {
        const kx = margin + (idx * kpiW);
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
        doc.setLineWidth(0.2);
        doc.rect(kx, y, kpiW, kpiH, 'FD');

        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
        doc.text(kpi.label, kx + 3.5, y + 4.5);

        doc.setFontSize(9.5);
        doc.setFont('helvetica', 'bold');
        if (kpi.color) {
          doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
        } else {
          doc.setTextColor(textMain[0], textMain[1], textMain[2]);
        }
        doc.text(kpi.val, kx + 3.5, y + 10.5);
      });

      y += kpiH + 6;

      // 3. Definición de Columnas según el modo seleccionado
      // Modo 'classic': N° Lista, Alumno, Monto Pagado (exactamente lo solicitado)
      // Modo 'detailed': N° Lista, Alumno, Total Cuota, Monto Pagado, Saldo Deuda, Estado
      const cols = columnMode === 'classic' ? [
        { key: 'list', title: 'N° Lista', width: 24, align: 'center' },
        { key: 'name', title: 'Alumno (Apellidos y Nombres)', width: 104, align: 'left' },
        { key: 'paid', title: 'Monto Pagado', width: 54, align: 'right' }
      ] : [
        { key: 'list', title: 'N° Lista', width: 18, align: 'center' },
        { key: 'name', title: 'Alumno (Apellidos y Nombres)', width: 68, align: 'left' },
        { key: 'expected', title: 'Total Cuota', width: 26, align: 'right' },
        { key: 'paid', title: 'Monto Pagado', width: 26, align: 'right' },
        { key: 'pending', title: 'Saldo Deuda', width: 24, align: 'right' },
        { key: 'status', title: 'Estado', width: 20, align: 'center' }
      ];

      // Función auxiliar para dibujar el encabezado de la tabla Excel
      const drawTableHeader = (posY) => {
        const headerH = 7.5;
        let cx = margin;

        cols.forEach(col => {
          doc.setFillColor(excelGreen[0], excelGreen[1], excelGreen[2]);
          doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
          doc.setLineWidth(0.2);
          doc.rect(cx, posY, col.width, headerH, 'FD');

          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(255, 255, 255);

          if (col.align === 'center') {
            doc.text(col.title, cx + (col.width / 2), posY + 5, { align: 'center' });
          } else if (col.align === 'right') {
            doc.text(col.title, cx + col.width - 3, posY + 5, { align: 'right' });
          } else {
            doc.text(col.title, cx + 3, posY + 5);
          }

          cx += col.width;
        });

        return posY + headerH;
      };

      // Dibujar cabecera inicial
      y = drawTableHeader(y);

      // 4. Filas de Alumnos (Estilo Cuadrícula Excel)
      const rowH = 6.8;

      filteredList.forEach((item, index) => {
        // Control de salto de página
        if (y + rowH > pageHeight - 22) {
          doc.addPage();
          y = margin;
          y = drawTableHeader(y);
        }

        const isEven = index % 2 === 0;
        let cx = margin;

        // Dibujar cada celda individualmente con borde para el look Excel
        cols.forEach(col => {
          if (isEven) {
            doc.setFillColor(255, 255, 255);
          } else {
            doc.setFillColor(zebraColor[0], zebraColor[1], zebraColor[2]);
          }

          doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
          doc.setLineWidth(0.15);
          doc.rect(cx, y, col.width, rowH, 'FD');

          doc.setFontSize(7.8);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(textMain[0], textMain[1], textMain[2]);

          if (col.key === 'list') {
            doc.text(String(item.listNumber), cx + (col.width / 2), y + 4.6, { align: 'center' });
          } else if (col.key === 'name') {
            const maxChars = columnMode === 'classic' ? 48 : 32;
            const truncatedName = item.name.length > maxChars 
              ? item.name.substring(0, maxChars - 3) + '...' 
              : item.name;
            doc.text(truncatedName, cx + 3, y + 4.6);
          } else if (col.key === 'expected') {
            doc.text(formatMoney(item.expected), cx + col.width - 2.5, y + 4.6, { align: 'right' });
          } else if (col.key === 'paid') {
            doc.setFont('helvetica', 'bold');
            if (item.paid > 0) {
              doc.setTextColor(16, 124, 65); // Verde Excel
            } else {
              doc.setTextColor(148, 163, 184); // Gris apagado para $0
            }
            doc.text(formatMoney(item.paid), cx + col.width - 2.5, y + 4.6, { align: 'right' });
          } else if (col.key === 'pending') {
            doc.setFont('helvetica', 'bold');
            if (item.pending > 0) {
              doc.setTextColor(220, 38, 38); // Rojo deuda
              doc.text(formatMoney(item.pending), cx + col.width - 2.5, y + 4.6, { align: 'right' });
            } else {
              doc.setTextColor(16, 185, 129); // Verde $0
              doc.text('$0', cx + col.width - 2.5, y + 4.6, { align: 'right' });
            }
          } else if (col.key === 'status') {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7);
            if (item.status === 'paid') {
              doc.setTextColor(16, 185, 129);
              doc.text('Al Día', cx + (col.width / 2), y + 4.6, { align: 'center' });
            } else if (item.status === 'partial') {
              doc.setTextColor(234, 179, 8);
              doc.text('Parcial', cx + (col.width / 2), y + 4.6, { align: 'center' });
            } else {
              doc.setTextColor(239, 68, 68);
              doc.text('Impago', cx + (col.width / 2), y + 4.6, { align: 'center' });
            }
          }

          cx += col.width;
        });

        y += rowH;
      });

      // 5. Fila de Total General Estilo Contable Excel (con doble subrayado)
      if (y + 10 > pageHeight - 20) {
        doc.addPage();
        y = margin;
      }

      const totalRowH = 8;
      let cx = margin;

      cols.forEach(col => {
        doc.setFillColor(241, 245, 249); // Fondo gris suave de totales
        doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
        doc.setLineWidth(0.2);
        doc.rect(cx, y, col.width, totalRowH, 'FD');

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(textMain[0], textMain[1], textMain[2]);

        if (col.key === 'list') {
          doc.text('Σ', cx + (col.width / 2), y + 5.2, { align: 'center' });
        } else if (col.key === 'name') {
          doc.text(`TOTAL (${filteredList.length} ALUMNOS)`, cx + 3, y + 5.2);
        } else if (col.key === 'expected') {
          doc.text(formatMoney(summaryTotals.totalExpected), cx + col.width - 2.5, y + 5.2, { align: 'right' });
        } else if (col.key === 'paid') {
          doc.setTextColor(16, 124, 65);
          doc.text(formatMoney(summaryTotals.totalPaid), cx + col.width - 2.5, y + 5.2, { align: 'right' });
        } else if (col.key === 'pending') {
          doc.setTextColor(summaryTotals.totalPending > 0 ? 220 : 16, summaryTotals.totalPending > 0 ? 38 : 185, summaryTotals.totalPending > 0 ? 38 : 129);
          doc.text(formatMoney(summaryTotals.totalPending), cx + col.width - 2.5, y + 5.2, { align: 'right' });
        } else if (col.key === 'status') {
          doc.text('-', cx + (col.width / 2), y + 5.2, { align: 'center' });
        }

        cx += col.width;
      });

      // Línea doble contable inferior
      doc.setDrawColor(71, 85, 105);
      doc.setLineWidth(0.3);
      doc.line(margin, y + totalRowH, margin + printableWidth, y + totalRowH);
      doc.line(margin, y + totalRowH + 0.8, margin + printableWidth, y + totalRowH + 0.8);

      // 6. Pie de Página con Numeración en todas las hojas
      const totalPages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
        doc.setLineWidth(0.2);
        doc.line(margin, pageHeight - 11, margin + printableWidth, pageHeight - 11);

        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
        doc.text(
          `AppCurso - Control Financiero Escolar   •   Reporte Estilo Excel   •   Página ${i} de ${totalPages}`,
          pageWidth / 2,
          pageHeight - 6.5,
          { align: 'center' }
        );
      }

      // Nombre de archivo limpio
      const safeCourseName = (selectedCourse?.name || 'Curso').replace(/[^a-zA-Z0-9]/g, '_');
      const safeFilterName = filter === 'all' ? 'Totales' : filter === 'paid' ? 'Pagados' : 'Impagos';
      const safeScopeName = scope === 'all' ? 'Cuotas_Totales' : (currentExpense?.title || 'Cuota').replace(/[^a-zA-Z0-9]/g, '_');
      const dateIso = new Date().toISOString().split('T')[0];

      doc.save(`Reporte_${safeScopeName}_${safeCourseName}_${safeFilterName}_${dateIso}.pdf`);
      onClose();
    } catch (err) {
      console.error("Error al generar PDF de cuotas:", err);
      alert("Hubo un error al generar el PDF: " + err.message);
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="modal-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '0.75rem 0.5rem 2rem',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch'
      }}
    >
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '560px',
        maxHeight: '92vh',
        backgroundColor: '#0f172a',
        border: '1px solid rgba(16, 124, 65, 0.35)',
        display: 'flex',
        marginTop: '0.25rem',
        flexDirection: 'column',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 25px rgba(16, 124, 65, 0.15)',
        overflow: 'hidden'
      }}>
        {/* Cabecera del Modal */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'linear-gradient(135deg, rgba(16, 124, 65, 0.15) 0%, rgba(15, 23, 42, 0) 100%)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: 'rgba(16, 124, 65, 0.2)',
              border: '1px solid rgba(16, 124, 65, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#34d399'
            }}>
              <Table size={22} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', fontWeight: '700' }}>
                Descargar Reporte de Cuotas
              </h3>
              <p style={{ margin: '0.15rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Formato PDF listado estilo Excel con número de lista, alumno y montos
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0.4rem',
              borderRadius: '6px'
            }}
            title="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Contenido del Modal */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 0', color: 'var(--text-muted)' }}>
              <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto 0.75rem auto', color: '#107C41' }} />
              <p>Cargando datos del curso y cuotas...</p>
            </div>
          ) : (
            <>
              {/* Selector 1: Ámbito del Reporte (Cuotas Totales o Cuota Específica) */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                  1. Cuota a reportar
                </label>
                <div style={{ position: 'relative' }}>
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    className="input-field"
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      fontSize: '0.9rem',
                      backgroundColor: 'rgba(255,255,255,0.05)',
                      color: '#fff',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 'var(--radius-md)'
                    }}
                  >
                    <option value="all" style={{ backgroundColor: '#1e293b', color: '#fff' }}>
                      📚 Todas las Cuotas (Consolidado de Cuotas Totales)
                    </option>
                    {expenses.map(exp => (
                      <option key={exp.id} value={exp.id} style={{ backgroundColor: '#1e293b', color: '#fff' }}>
                        📌 {exp.title} ({exp.date ? `Emitido: ${exp.date}` : 'Sin fecha'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Selector 2: Filtro de Alumnos (lo medular del pedido: impagos, pagados o totales) */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                  2. ¿Qué alumnos deseas incluir en el reporte?
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                  {/* Opción A: Totales */}
                  <button
                    type="button"
                    onClick={() => setFilter('all')}
                    style={{
                      padding: '0.85rem 0.6rem',
                      borderRadius: 'var(--radius-md)',
                      border: filter === 'all' ? '2px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                      backgroundColor: filter === 'all' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.03)',
                      color: filter === 'all' ? '#93c5fd' : 'var(--text-main)',
                      cursor: 'pointer',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.35rem',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <Users size={20} style={{ color: filter === 'all' ? '#3b82f6' : 'var(--text-muted)' }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Totales</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {counts.total} alumnos
                    </span>
                  </button>

                  {/* Opción B: Impagos */}
                  <button
                    type="button"
                    onClick={() => setFilter('unpaid')}
                    style={{
                      padding: '0.85rem 0.6rem',
                      borderRadius: 'var(--radius-md)',
                      border: filter === 'unpaid' ? '2px solid #ef4444' : '1px solid rgba(255,255,255,0.1)',
                      backgroundColor: filter === 'unpaid' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.03)',
                      color: filter === 'unpaid' ? '#fca5a5' : 'var(--text-main)',
                      cursor: 'pointer',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.35rem',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <AlertTriangle size={20} style={{ color: filter === 'unpaid' ? '#ef4444' : 'var(--text-muted)' }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Impagos</span>
                    <span style={{ fontSize: '0.75rem', color: filter === 'unpaid' ? '#fca5a5' : 'var(--text-muted)' }}>
                      {counts.unpaid} alumnos
                    </span>
                  </button>

                  {/* Opción C: Pagados */}
                  <button
                    type="button"
                    onClick={() => setFilter('paid')}
                    style={{
                      padding: '0.85rem 0.6rem',
                      borderRadius: 'var(--radius-md)',
                      border: filter === 'paid' ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                      backgroundColor: filter === 'paid' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.03)',
                      color: filter === 'paid' ? '#6ee7b7' : 'var(--text-main)',
                      cursor: 'pointer',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.35rem',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <CheckCircle size={20} style={{ color: filter === 'paid' ? '#10b981' : 'var(--text-muted)' }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Pagados</span>
                    <span style={{ fontSize: '0.75rem', color: filter === 'paid' ? '#6ee7b7' : 'var(--text-muted)' }}>
                      {counts.paid} alumnos
                    </span>
                  </button>
                </div>
              </div>

              {/* Selector 3: Formato de Columnas Excel */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                  3. Columnas del listado estilo Excel
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={() => setColumnMode('classic')}
                    style={{
                      padding: '0.75rem',
                      borderRadius: 'var(--radius-md)',
                      border: columnMode === 'classic' ? '1px solid #107C41' : '1px solid rgba(255,255,255,0.1)',
                      backgroundColor: columnMode === 'classic' ? 'rgba(16, 124, 65, 0.15)' : 'rgba(255,255,255,0.02)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      color: 'var(--text-main)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'bold', fontSize: '0.85rem', color: columnMode === 'classic' ? '#34d399' : 'inherit' }}>
                      <Table size={16} /> Clásico (3 Columnas)
                    </div>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      N° Lista • Alumno • Monto Pagado
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setColumnMode('detailed')}
                    style={{
                      padding: '0.75rem',
                      borderRadius: 'var(--radius-md)',
                      border: columnMode === 'detailed' ? '1px solid #107C41' : '1px solid rgba(255,255,255,0.1)',
                      backgroundColor: columnMode === 'detailed' ? 'rgba(16, 124, 65, 0.15)' : 'rgba(255,255,255,0.02)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      color: 'var(--text-main)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'bold', fontSize: '0.85rem', color: columnMode === 'detailed' ? '#34d399' : 'inherit' }}>
                      <Layers size={16} /> Detallado (Completo)
                    </div>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      + Total Asignado, Saldo Deuda y Estado
                    </p>
                  </button>
                </div>
              </div>

              {/* Vista Previa de Resumen */}
              <div style={{
                padding: '0.85rem 1rem',
                backgroundColor: 'rgba(255,255,255,0.02)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
                fontSize: '0.85rem'
              }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Se incluirán: </span>
                  <strong style={{ color: '#fff' }}>{filteredList.length} alumnos</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Total Pagado: </span>
                  <strong style={{ color: 'var(--success)' }}>{formatMoney(summaryTotals.totalPaid)}</strong>
                </div>
                {summaryTotals.totalPending > 0 && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Total Deuda: </span>
                    <strong style={{ color: 'var(--danger)' }}>{formatMoney(summaryTotals.totalPending)}</strong>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Pie de Acciones */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.75rem',
          padding: '1.25rem 1.5rem',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          backgroundColor: 'rgba(0,0,0,0.2)'
        }}>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-outline"
            disabled={generatingPdf}
            style={{ padding: '0.55rem 1.25rem', fontSize: '0.9rem' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleGeneratePDF}
            disabled={generatingPdf || loading || filteredList.length === 0}
            className="btn btn-primary"
            style={{
              padding: '0.55rem 1.4rem',
              fontSize: '0.9rem',
              backgroundColor: '#107C41',
              borderColor: '#107C41',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 14px rgba(16, 124, 65, 0.4)'
            }}
          >
            {generatingPdf ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Generando PDF...
              </>
            ) : (
              <>
                <Download size={18} />
                Descargar PDF ({filteredList.length})
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CuotaReportModal;
