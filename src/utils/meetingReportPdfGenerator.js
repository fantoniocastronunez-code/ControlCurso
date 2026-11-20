import { jsPDF } from 'jspdf';

export const formatMoney = (amount) => {
  const num = Number(amount);
  if (isNaN(num)) return '$0';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(num);
};

/**
 * Obtiene la clave del PDF para un alumno:
 * RUT del alumno sin puntos ni guion en mayúsculas (ej. "123456789" o "12345678K").
 * Si el alumno no tiene RUT registrado aún, genera una clave de respaldo predecible.
 */
export const getStudentPdfPassword = (student) => {
  const cleanRut = String(student?.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (cleanRut.length >= 4) {
    return cleanRut;
  }
  const fallbackSuffix = student?.listNumber
    ? String(student.listNumber)
    : String(student?.id || 'CURSO').slice(0, 5).toUpperCase();
  return `ALUMNO${fallbackSuffix}`;
};

/**
 * Construye el payload serializable del informe de reunión para guardar en Firestore
 * y poder generar PDFs personalizados (con marca de agua y clave por alumno) tanto al
 * enviar por correo como al descargar desde el Portal del Apoderado.
 */
export const buildMeetingReportPayload = ({
  meetingTitle,
  meetingDate,
  courseName,
  totalAvailable,
  totalCollected,
  totalIncomes,
  totalOutcomes,
  students,
  debts,
  expenses,
  outcomes,
  finalFundsMap,
  studentDebtStats,
  exportIncludeDetails,
  sigTreasurer,
  sigSecretary,
  sigPresident,
  sigTreasurerMeta,
  sigSecretaryMeta,
  sigPresidentMeta
}) => {
  const fundsList = Object.values(finalFundsMap || {}).map((f) => ({
    name: f.name || 'Fondo',
    totalIn: Number(f.totalIn) || 0,
    totalOut: Number(f.totalOut) || 0,
    balance: Number(f.balance) || 0
  }));

  const outcomesList = exportIncludeDetails
    ? (outcomes || []).map((o) => ({
        date: o.date || '-',
        title: o.title || '-',
        fundName: finalFundsMap?.[o.fundId]?.name || 'General',
        amount: Number(o.amount) || 0
      }))
    : [];

  const expensesSummaryList = (expenses || []).map((exp) => {
    const expDebts = (debts || []).filter((d) => d.expenseId === exp.id);
    const expCollected = expDebts.reduce(
      (sum, d) => sum + (d.status === 'paid' ? (Number(d.amount) || 0) : (Number(d.paidAmount) || 0)),
      0
    );

    const debtSum = expDebts.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
    const expExpected =
      debtSum > 0
        ? debtSum
        : Number(exp.totalAmount) || (Number(exp.amount) || 0) * (expDebts.length || (students || []).length || 1);
    const expPct = expExpected > 0 ? Math.min(100, Math.round((expCollected / expExpected) * 100)) : 0;

    const uniqueAmounts = [...new Set(expDebts.map((d) => Number(d.amount) || 0).filter((a) => a > 0))];
    let unitText;
    if (typeof exp.amountPerStudent === 'number' && !isNaN(exp.amountPerStudent) && exp.amountPerStudent > 0) {
      unitText = formatMoney(exp.amountPerStudent);
    } else if (uniqueAmounts.length === 1) {
      unitText = formatMoney(uniqueAmounts[0]);
    } else if (uniqueAmounts.length > 1 || exp.amountPerStudent === 'Variable') {
      unitText = 'Variable';
    } else {
      unitText = formatMoney(exp.amount || 0);
    }

    return {
      title: exp.title || 'Cuota',
      unitText,
      expCollected,
      expPct
    };
  });

  return {
    meetingTitle: meetingTitle || 'Informe Financiero - Reunión de Apoderados',
    meetingDate: meetingDate || new Date().toISOString().split('T')[0],
    courseName: courseName || '',
    totalAvailable: Number(totalAvailable) || 0,
    totalIncome: (Number(totalCollected) || 0) + (Number(totalIncomes) || 0),
    totalOutcomes: Number(totalOutcomes) || 0,
    studentsCount: (students || []).length,
    studentDebtStats: {
      countPaid: Number(studentDebtStats?.countPaid) || 0,
      countUnpaid: Number(studentDebtStats?.countUnpaid) || 0,
      paidPercentage: Number(studentDebtStats?.paidPercentage) || 0,
      unpaidPercentage: Number(studentDebtStats?.unpaidPercentage) || 0,
      totalUnpaidAmount: Number(studentDebtStats?.totalUnpaidAmount) || 0
    },
    includeDetails: Boolean(exportIncludeDetails),
    fundsList,
    outcomesList,
    expensesSummaryList,
    signatures: {
      sigTreasurer: sigTreasurer || null,
      sigSecretary: sigSecretary || null,
      sigPresident: sigPresident || null,
      treasurerName: sigTreasurerMeta?.signerName || null,
      secretaryName: sigSecretaryMeta?.signerName || null,
      presidentName: sigPresidentMeta?.signerName || null
    }
  };
};

/**
 * Estampa la marca de agua con el nombre del alumno en todas las páginas del PDF.
 */
const applyStudentWatermarkToAllPages = (doc, studentNameWatermark) => {
  if (!studentNameWatermark) return;
  const totalPages = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const watermarkUpper = String(studentNameWatermark).toUpperCase();

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);

    // 1. Marca de agua diagonal repetida en la página
    try {
      if (typeof doc.GState === 'function' && typeof doc.setGState === 'function') {
        doc.saveGraphicsState();
        doc.setGState(new doc.GState({ opacity: 0.13 }));
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.setTextColor(71, 85, 105);

        const yPositions = [88, 165, 242];
        yPositions.forEach((yPos) => {
          doc.text(watermarkUpper, pageWidth / 2, yPos, {
            align: 'center',
            angle: 28
          });
        });
        doc.restoreGraphicsState();
      } else {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.setTextColor(226, 232, 240);
        doc.text(watermarkUpper, pageWidth / 2, pageHeight / 2, {
          align: 'center',
          angle: 28
        });
      }
    } catch {
      // Fallback silencioso si GState falla en algún entorno
    }

    // 2. Pie de página de trazabilidad en cada hoja
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Copia personalizada perteneciente al alumno(a): ${studentNameWatermark}  •  Uso exclusivo de su apoderado  •  Pág. ${p} de ${totalPages}`,
      pageWidth / 2,
      pageHeight - 7,
      { align: 'center' }
    );
  }
};

/**
 * Genera una instancia jsPDF del Informe de Reunión, opcionalmente encriptada con
 * userPassword (RUT del alumno sin puntos ni guion) y con marca de agua del nombre del alumno.
 */
export const createMeetingReportJsPdf = (
  payload,
  { studentNameWatermark = '', userPassword = '' } = {}
) => {
  const pdfOptions = {
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  };

  if (userPassword) {
    pdfOptions.encryption = {
      userPassword: String(userPassword),
      ownerPassword: String(userPassword),
      userPermissions: ['print']
    };
  }

  const doc = new jsPDF(pdfOptions);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 15;

  const primaryColor = [99, 102, 241];
  const textMain = [30, 41, 59];
  const textMuted = [100, 116, 139];
  const successColor = [16, 185, 129];
  const dangerColor = [239, 68, 68];

  // Header Banner
  const bannerHeight = studentNameWatermark ? 33 : 28;
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(12, y, pageWidth - 24, bannerHeight, 3, 3, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15.5);
  doc.setFont('helvetica', 'bold');
  doc.text(payload.meetingTitle || 'Informe Financiero - Reunión de Apoderados', 18, y + 10.5);

  doc.setFontSize(8.8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Fecha del Informe: ${payload.meetingDate}  •  Generado automáticamente para la Reunión de Apoderados`,
    18,
    y + 18
  );

  if (studentNameWatermark) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(52, 211, 153);
    doc.text(`EJEMPLAR ASIGNADO AL ALUMNO(A): ${studentNameWatermark}`, 18, y + 26.5);
  }

  y += bannerHeight + 7;

  // Section 1: Resumen Financiero General
  doc.setTextColor(textMain[0], textMain[1], textMain[2]);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('1. Balance Financiero General', 14, y);
  y += 6;

  const boxW = (pageWidth - 28 - 9) / 4;
  const boxH = 20;

  const kpis = [
    { label: 'Fondo Disponible', value: formatMoney(payload.totalAvailable), color: successColor },
    { label: 'Total Recaudado', value: formatMoney(payload.totalIncome), color: primaryColor },
    { label: 'Gastos Realizados', value: formatMoney(payload.totalOutcomes), color: dangerColor },
    { label: '% Alumnos al Día', value: `${payload.studentDebtStats?.paidPercentage ?? 0}%`, color: successColor }
  ];

  kpis.forEach((kpi, idx) => {
    const bx = 14 + idx * (boxW + 3);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(bx, y, boxW, boxH, 2, 2, 'FD');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
    doc.text(kpi.label, bx + 4, y + 6);

    doc.setFontSize(10.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.value, bx + 4, y + 14);
  });

  y += boxH + 8;

  // Section 2: Distribución de Fondos
  doc.setTextColor(textMain[0], textMain[1], textMain[2]);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('2. Distribución por Fondos del Curso', 14, y);
  y += 5;

  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, pageWidth - 28, 7, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(textMain[0], textMain[1], textMain[2]);
  doc.text('Fondo / Categoría', 18, y + 5);
  doc.text('Total Ingresos', 90, y + 5, { align: 'right' });
  doc.text('Total Gastos', 135, y + 5, { align: 'right' });
  doc.text('Saldo Actual', pageWidth - 18, y + 5, { align: 'right' });
  y += 8;

  (payload.fundsList || []).forEach((f) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(textMain[0], textMain[1], textMain[2]);
    doc.text(f.name, 18, y + 4);
    doc.text(formatMoney(f.totalIn), 90, y + 4, { align: 'right' });
    doc.text(formatMoney(f.totalOut), 135, y + 4, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(
      f.balance >= 0 ? successColor[0] : dangerColor[0],
      f.balance >= 0 ? successColor[1] : dangerColor[1],
      f.balance >= 0 ? successColor[2] : dangerColor[2]
    );
    doc.text(formatMoney(f.balance), pageWidth - 18, y + 4, { align: 'right' });

    doc.setDrawColor(241, 245, 249);
    doc.line(14, y + 6, pageWidth - 14, y + 6);
    y += 7;
  });

  y += 6;
  let sectionCount = 3;

  // Section 3: Gastos Realizados (Opcional)
  if (payload.includeDetails && Array.isArray(payload.outcomesList)) {
    doc.setTextColor(textMain[0], textMain[1], textMain[2]);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text(`${sectionCount}. Lista Detallada de Gastos (${payload.outcomesList.length} registros)`, 14, y);
    y += 5;

    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, pageWidth - 28, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(textMain[0], textMain[1], textMain[2]);
    doc.text('Fecha', 18, y + 5);
    doc.text('Motivo / Descripción', 45, y + 5);
    doc.text('Fondo', 130, y + 5);
    doc.text('Monto', pageWidth - 18, y + 5, { align: 'right' });
    y += 8;

    payload.outcomesList.forEach((o) => {
      if (y > pageHeight - 30) {
        doc.addPage();
        y = 15;
        doc.setFillColor(241, 245, 249);
        doc.rect(14, y, pageWidth - 28, 7, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(textMain[0], textMain[1], textMain[2]);
        doc.text('Fecha', 18, y + 5);
        doc.text('Motivo / Descripción', 45, y + 5);
        doc.text('Fondo', 130, y + 5);
        doc.text('Monto', pageWidth - 18, y + 5, { align: 'right' });
        y += 8;
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(textMain[0], textMain[1], textMain[2]);
      doc.text(o.date || '-', 18, y + 4);

      const titleStr = o.title && o.title.length > 45 ? o.title.substring(0, 42) + '...' : (o.title || '-');
      doc.text(titleStr, 45, y + 4);
      doc.text(o.fundName || 'General', 130, y + 4);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(dangerColor[0], dangerColor[1], dangerColor[2]);
      doc.text(formatMoney(o.amount), pageWidth - 18, y + 4, { align: 'right' });

      doc.setDrawColor(241, 245, 249);
      doc.line(14, y + 6, pageWidth - 14, y + 6);
      y += 7;
    });

    y += 6;
    sectionCount++;
  }

  // Section 4: Estado de Cuotas Emitidas
  if (y > pageHeight - 65) {
    doc.addPage();
    y = 15;
  }

  doc.setTextColor(textMain[0], textMain[1], textMain[2]);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(`${sectionCount}. Estado de Cuotas Emitidas`, 14, y);
  sectionCount++;
  y += 5;

  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, pageWidth - 28, 7, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('Cuota', 18, y + 5);
  doc.text('Monto Unitario', 85, y + 5, { align: 'right' });
  doc.text('Recaudado', 130, y + 5, { align: 'right' });
  doc.text('% Cumplimiento', pageWidth - 18, y + 5, { align: 'right' });
  y += 8;

  (payload.expensesSummaryList || []).forEach((exp) => {
    if (y > pageHeight - 30) {
      doc.addPage();
      y = 15;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(textMain[0], textMain[1], textMain[2]);
    doc.text(exp.title || 'Cuota', 18, y + 4);
    doc.text(exp.unitText || '$0', 85, y + 4, { align: 'right' });
    doc.text(formatMoney(exp.expCollected), 130, y + 4, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(`${exp.expPct ?? 0}%`, pageWidth - 18, y + 4, { align: 'right' });

    doc.setDrawColor(241, 245, 249);
    doc.line(14, y + 6, pageWidth - 14, y + 6);
    y += 7;
  });

  y += 8;

  // Section 5: Resumen de Cumplimiento de Apoderados
  if (y > pageHeight - 50) {
    doc.addPage();
    y = 15;
  }

  doc.setTextColor(textMain[0], textMain[1], textMain[2]);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(`${sectionCount}. Resumen de Cumplimiento de Apoderados`, 14, y);
  y += 6;

  const stats = payload.studentDebtStats || {};
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`• Total de Alumnos Registrados: ${payload.studentsCount ?? 0}`, 18, y);
  y += 5;
  doc.text(`• Alumnos al Día (Sin deudas): ${stats.countPaid ?? 0} (${stats.paidPercentage ?? 0}%)`, 18, y);
  y += 5;
  doc.text(
    `• Alumnos con Deuda Pendiente: ${stats.countUnpaid ?? 0} (${stats.unpaidPercentage ?? 0}%)  -  Total Pendiente: ${formatMoney(stats.totalUnpaidAmount)}`,
    18,
    y
  );
  y += 12;

  // Signatures
  if (y > pageHeight - 38) {
    doc.addPage();
    y = 30;
  }

  const sigs = payload.signatures || {};
  doc.setDrawColor(203, 213, 225);
  const sigY = y + 15;
  const centerX = pageWidth / 2;
  doc.line(16, sigY, 66, sigY);
  doc.line(centerX - 25, sigY, centerX + 25, sigY);
  doc.line(pageWidth - 66, sigY, pageWidth - 16, sigY);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('Firma Tesorero(a)', 41, sigY + 5, { align: 'center' });
  doc.text('Firma Secretario(a)', centerX, sigY + 5, { align: 'center' });
  doc.text('Firma Presidente(a)', pageWidth - 41, sigY + 5, { align: 'center' });

  if (sigs.treasurerName) {
    doc.setFontSize(7.5);
    doc.text(String(sigs.treasurerName), 41, sigY + 9.5, { align: 'center' });
  }
  if (sigs.secretaryName) {
    doc.setFontSize(7.5);
    doc.text(String(sigs.secretaryName), centerX, sigY + 9.5, { align: 'center' });
  }
  if (sigs.presidentName) {
    doc.setFontSize(7.5);
    doc.text(String(sigs.presidentName), pageWidth - 41, sigY + 9.5, { align: 'center' });
  }

  if (sigs.sigTreasurer) {
    doc.addImage(sigs.sigTreasurer, 'PNG', 16, sigY - 20, 50, 18, undefined, 'FAST');
  }
  if (sigs.sigSecretary) {
    doc.addImage(sigs.sigSecretary, 'PNG', centerX - 25, sigY - 20, 50, 18, undefined, 'FAST');
  }
  if (sigs.sigPresident) {
    doc.addImage(sigs.sigPresident, 'PNG', pageWidth - 66, sigY - 20, 50, 18, undefined, 'FAST');
  }

  // Aplicar marca de agua del nombre del alumno en todas las páginas
  applyStudentWatermarkToAllPages(doc, studentNameWatermark);

  return doc;
};
