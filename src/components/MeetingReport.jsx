import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs } from 'firebase/firestore';
import { 
  ArrowLeft, Download, PieChart, TrendingUp, TrendingDown, 
  Users, CheckCircle, Calendar, DollarSign, Eye, EyeOff, 
  Share2, Search, RefreshCw
} from 'lucide-react';
import { formatStudentName } from '../utils/nameUtils';
import { useModal } from '../context/ModalContext';
import StudentDetailModal from './StudentDetailModal';
import SignaturePad from './SignaturePad';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { addDoc } from 'firebase/firestore';

const MeetingReport = ({ onBack }) => {
  const { showAlert } = useModal();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('resumen'); // 'resumen' | 'gastos' | 'cuotas' | 'morosos'
  const [meetingTitle] = useState('Informe Financiero - Reunión de Apoderados');
  const [meetingDate, setMeetingDate] = useState(new Date().toISOString().split('T')[0]);
  const [hideSensitiveNames, setHideSensitiveNames] = useState(false); // Modo Proyector
  
  // Data states
  const [students, setStudents] = useState([]);
  const [usersMap, setUsersMap] = useState({});
  const [debts, setDebts] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [funds, setFunds] = useState([]);
  const [outcomes, setOutcomes] = useState([]);
  const [incomes, setIncomes] = useState([]);

  // Filters
  const [outcomeFilterFund, setOutcomeFilterFund] = useState('all');
  const [outcomeSearch, setOutcomeSearch] = useState('');
  const [debtorSearch, setDebtorSearch] = useState('');
  const [debtorFilterStatus, setDebtorFilterStatus] = useState('all'); // 'all' | 'unpaid' | 'paid' | 'partial'

  // Selected Student for payment detail
  const [selectedStudentForDetail, setSelectedStudentForDetail] = useState(null);
  
  // Generating states
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  
  // Signatures
  const [sigTreasurer, setSigTreasurer] = useState(null);
  const [sigPresident, setSigPresident] = useState(null);

  const reportRef = useRef(null);

  useEffect(() => {
    const fetchAllMeetingData = async () => {
      setLoading(true);
      try {
        const [
          usersSnap, studentsSnap, debtsSnap, expensesSnap, 
          fundsSnap, outcomesSnap, incomesSnap
        ] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'students')),
          getDocs(collection(db, 'debts')),
          getDocs(collection(db, 'expenses')),
          getDocs(collection(db, 'funds')),
          getDocs(collection(db, 'outcomes')),
          getDocs(collection(db, 'incomes'))
        ]);

        const uMap = {};
        usersSnap.forEach(d => {
          const data = d.data();
          uMap[d.id] = data.formalName || data.displayName || data.email;
          if (data.email) uMap[data.email.toLowerCase()] = data.formalName || data.displayName || data.email;
        });
        setUsersMap(uMap);

        const sList = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.status !== 'retirado');
        sList.sort((a, b) => (parseInt(a.listNumber) || 999) - (parseInt(b.listNumber) || 999));
        setStudents(sList);

        const dList = debtsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setDebts(dList);

        const expList = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        expList.sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
        setExpenses(expList);

        const fList = fundsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!fList.some(f => f.id === 'general')) {
          fList.unshift({ id: 'general', name: 'Fondo General' });
        }
        setFunds(fList);

        const oList = outcomesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        oList.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
        setOutcomes(oList);

        const incList = incomesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setIncomes(incList);

      } catch (error) {
        console.error("Error al cargar datos del informe:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchAllMeetingData();
  }, []);

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
  };

  // -------------------------------------------------------------
  // Calculations & Analytics
  // -------------------------------------------------------------
  const fundsMap = useMemo(() => {
    const map = {};
    funds.forEach(f => {
      map[f.id] = { id: f.id, name: f.name, totalIn: 0, totalOut: 0, balance: 0 };
    });
    if (!map['general']) {
      map['general'] = { id: 'general', name: 'Fondo General', totalIn: 0, totalOut: 0, balance: 0 };
    }
    return map;
  }, [funds]);

  // Calculate totals and fund balances
  const { totalCollected, totalOutcomes, totalIncomes, cashIn, cashOut, finalFundsMap } = useMemo(() => {
    let collected = 0;
    let cIn = 0;
    let tIn = 0;
    let cOut = 0;
    let tOut = 0;
    let incTotal = 0;

    // Deep clone fundsMap to avoid mutating a React dependency (which causes doubling in Strict Mode)
    const currentFunds = JSON.parse(JSON.stringify(fundsMap));

    // From Debts (Pagos recibidos)
    debts.forEach(d => {
      const fundId = d.fundId || 'general';
      if (!currentFunds[fundId]) return;

      if (d.status === 'paid' || d.status === 'partial') {
        const amt = typeof d.paidAmount === 'number' ? d.paidAmount : (d.amount || 0);
        collected += amt;
        const expected = d.amount || 0;
        const baseAmt = Math.min(amt, expected);
        const overpayAmt = Math.max(0, amt - expected);

        if (d.paymentMethod === 'cash') cIn += baseAmt;
        if (d.paymentMethod === 'transfer') tIn += baseAmt;
        tIn += overpayAmt;

        currentFunds[fundId].totalIn += amt;
      }
    });

    // From Incomes (Ingresos manuales)
    incomes.forEach(inc => {
      const fundId = inc.fundId || 'general';
      if (!currentFunds[fundId]) return;

      const amt = inc.amount || 0;
      incTotal += amt;
      if (inc.paymentMethod === 'cash') cIn += amt;
      if (inc.paymentMethod === 'transfer') tIn += amt;

      currentFunds[fundId].totalIn += amt;
    });

    // From Outcomes (Egresos / Gastos)
    outcomes.forEach(out => {
      const fundId = out.fundId || 'general';
      if (!currentFunds[fundId]) return;

      const amt = out.amount || 0;
      if (out.paymentMethod === 'cash') cOut += amt;
      if (out.paymentMethod === 'transfer') tOut += amt;

      currentFunds[fundId].totalOut += amt;
    });

    // Calculate balance per fund
    Object.values(currentFunds).forEach(f => {
      f.balance = f.totalIn - f.totalOut;
    });

    const totalOut = outcomes.reduce((sum, o) => sum + (o.amount || 0), 0);

    return {
      totalCollected: collected,
      totalIncomes: incTotal,
      totalOutcomes: totalOut,
      cashIn: cIn,
      transferIn: tIn,
      cashOut: cOut,
      transferOut: tOut,
      finalFundsMap: currentFunds
    };
  }, [debts, incomes, outcomes, fundsMap]);

  const totalAvailable = Object.values(finalFundsMap).reduce((sum, f) => sum + f.balance, 0);
  const cashBalance = cashIn - cashOut;
  const transferBalance = totalAvailable - cashBalance;

  // Student Debt Stats
  const studentDebtStats = useMemo(() => {
    const map = {};
    students.forEach(s => {
      map[s.id] = {
        student: s,
        pendingCount: 0,
        pendingAmount: 0,
        paidCount: 0,
        paidAmount: 0,
        partialCount: 0,
        status: 'paid', // 'paid' | 'partial' | 'unpaid'
        debts: []
      };
    });

    debts.forEach(d => {
      if (!d.studentId || !map[d.studentId]) return;
      const st = map[d.studentId];
      st.debts.push(d);

      const amt = d.amount || 0;
      const paidAmt = typeof d.paidAmount === 'number' ? d.paidAmount : (d.status === 'paid' ? amt : 0);

      if (d.status === 'paid') {
        st.paidCount += 1;
        st.paidAmount += amt;
      } else if (d.status === 'partial') {
        st.partialCount += 1;
        st.paidAmount += paidAmt;
        st.pendingAmount += Math.max(0, amt - paidAmt);
      } else if (d.status === 'pending' || d.status === 'review') {
        st.pendingCount += 1;
        st.pendingAmount += amt;
      }
    });

    let countPaid = 0;
    let countUnpaid = 0;
    let countPartial = 0;
    let totalUnpaidAmount = 0;

    Object.values(map).forEach(st => {
      if (st.pendingAmount === 0) {
        st.status = 'paid';
        countPaid += 1;
      } else if (st.paidAmount > 0 && st.pendingAmount > 0) {
        st.status = 'partial';
        countPartial += 1;
        countUnpaid += 1;
        totalUnpaidAmount += st.pendingAmount;
      } else {
        st.status = 'unpaid';
        countUnpaid += 1;
        totalUnpaidAmount += st.pendingAmount;
      }
    });

    const totalStudents = students.length || 1;
    const paidPercentage = ((countPaid / totalStudents) * 100).toFixed(1);
    const unpaidPercentage = ((countUnpaid / totalStudents) * 100).toFixed(1);

    return {
      studentMap: map,
      countPaid,
      countUnpaid,
      countPartial,
      totalUnpaidAmount,
      paidPercentage: Number(paidPercentage),
      unpaidPercentage: Number(unpaidPercentage)
    };
  }, [students, debts]);

  // Filtered Outcomes
  const filteredOutcomes = useMemo(() => {
    return outcomes.filter(o => {
      const matchFund = outcomeFilterFund === 'all' || (o.fundId || 'general') === outcomeFilterFund;
      const matchSearch = !outcomeSearch.trim() || (
        (o.title || '').toLowerCase().includes(outcomeSearch.toLowerCase()) ||
        (o.description || '').toLowerCase().includes(outcomeSearch.toLowerCase())
      );
      return matchFund && matchSearch;
    });
  }, [outcomes, outcomeFilterFund, outcomeSearch]);

  // Filtered Debtors list
  const filteredStudentDebts = useMemo(() => {
    const list = Object.values(studentDebtStats.studentMap);
    return list.filter(item => {
      const s = item.student;
      const formattedName = formatStudentName(s).toLowerCase();
      const rawName = (s.name || '').toLowerCase();
      const rut = (s.rut || '').toLowerCase();
      const listNum = (s.listNumber || '').toString();
      const emails = (s.apoderadoEmails || (s.apoderadoEmail ? [s.apoderadoEmail] : [])).map(e => e.toLowerCase());
      const apNames = emails.map(e => (usersMap[e] || '').toLowerCase());

      const term = debtorSearch.toLowerCase().trim();
      const matchSearch = !term || (
        formattedName.includes(term) ||
        rawName.includes(term) ||
        rut.includes(term) ||
        listNum === term ||
        emails.some(e => e.includes(term)) ||
        apNames.some(a => a.includes(term))
      );

      const matchStatus = debtorFilterStatus === 'all' || 
        (debtorFilterStatus === 'paid' && item.status === 'paid') ||
        (debtorFilterStatus === 'unpaid' && (item.status === 'unpaid' || item.status === 'partial')) ||
        (debtorFilterStatus === 'partial' && item.status === 'partial');

      return matchSearch && matchStatus;
    });
  }, [studentDebtStats, debtorSearch, debtorFilterStatus, usersMap]);

  // -------------------------------------------------------------
  // PDF Document Generation
  // -------------------------------------------------------------
  const generatePDFReport = async () => {
    setGeneratingPdf(true);
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let y = 15;

      // Primary Brand Colors
      const primaryColor = [99, 102, 241];
      const textMain = [30, 41, 59];
      const textMuted = [100, 116, 139];
      const successColor = [16, 185, 129];
      const dangerColor = [239, 68, 68];

      // Header Banner
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(12, y, pageWidth - 24, 28, 3, 3, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(meetingTitle, 18, y + 11);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text(`Fecha del Informe: ${meetingDate}  •  Generado automáticamente para la Reunión de Apoderados`, 18, y + 19);

      y += 35;

      // Section 1: Resumen Financiero General
      doc.setTextColor(textMain[0], textMain[1], textMain[2]);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('1. Balance Financiero General', 14, y);
      y += 6;

      // KPI Boxes (4 columns)
      const boxW = (pageWidth - 28 - 9) / 4;
      const boxH = 20;

      const kpis = [
        { label: 'Fondo Disponible', value: formatMoney(totalAvailable), color: successColor },
        { label: 'Total Recaudado', value: formatMoney(totalCollected + totalIncomes), color: primaryColor },
        { label: 'Gastos Realizados', value: formatMoney(totalOutcomes), color: dangerColor },
        { label: '% Alumnos al Día', value: `${studentDebtStats.paidPercentage}%`, color: successColor }
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

      // Table Header for Funds
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

      Object.values(finalFundsMap).forEach((f) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(textMain[0], textMain[1], textMain[2]);
        doc.text(f.name, 18, y + 4);
        doc.text(formatMoney(f.totalIn), 90, y + 4, { align: 'right' });
        doc.text(formatMoney(f.totalOut), 135, y + 4, { align: 'right' });
        
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(f.balance >= 0 ? successColor[0] : dangerColor[0], f.balance >= 0 ? successColor[1] : dangerColor[1], f.balance >= 0 ? successColor[2] : dangerColor[2]);
        doc.text(formatMoney(f.balance), pageWidth - 18, y + 4, { align: 'right' });

        doc.setDrawColor(241, 245, 249);
        doc.line(14, y + 6, pageWidth - 14, y + 6);
        y += 7;
      });

      y += 6;

      // Section 3: Gastos Realizados
      doc.setTextColor(textMain[0], textMain[1], textMain[2]);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text(`3. Lista Detallada de Gastos (${outcomes.length} registros)`, 14, y);
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

      outcomes.forEach((o) => {
        // Check page overflow
        if (y > pageHeight - 30) {
          doc.addPage();
          y = 15;
          // Header on new page
          doc.setFillColor(241, 245, 249);
          doc.rect(14, y, pageWidth - 28, 7, 'F');
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.text('Fecha', 18, y + 5);
          doc.text('Motivo / Descripción', 45, y + 5);
          doc.text('Fondo', 130, y + 5);
          doc.text('Monto', pageWidth - 18, y + 5, { align: 'right' });
          y += 8;
        }

        const fundName = finalFundsMap[o.fundId]?.name || 'General';
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(textMain[0], textMain[1], textMain[2]);
        doc.text(o.date || '-', 18, y + 4);
        
        const titleStr = o.title && o.title.length > 45 ? o.title.substring(0, 42) + '...' : (o.title || '-');
        doc.text(titleStr, 45, y + 4);
        doc.text(fundName, 130, y + 4);
        
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(dangerColor[0], dangerColor[1], dangerColor[2]);
        doc.text(formatMoney(o.amount), pageWidth - 18, y + 4, { align: 'right' });

        doc.setDrawColor(241, 245, 249);
        doc.line(14, y + 6, pageWidth - 14, y + 6);
        y += 7;
      });

      y += 6;

      // Check page overflow for Cuotas & Debtors
      if (y > pageHeight - 65) {
        doc.addPage();
        y = 15;
      }

      // Section 4: Estado de Cuotas
      doc.setTextColor(textMain[0], textMain[1], textMain[2]);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('4. Estado de Cuotas Emitidas', 14, y);
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

      expenses.forEach((exp) => {
        if (y > pageHeight - 30) {
          doc.addPage();
          y = 15;
        }

        const expDebts = debts.filter(d => d.expenseId === exp.id);
        const expCollected = expDebts.reduce((sum, d) => sum + (d.status === 'paid' ? (d.amount || 0) : (d.paidAmount || 0)), 0);
        const expExpected = (exp.amountPerStudent || exp.amount || 0) * (expDebts.length || students.length || 1);
        const expPct = expExpected > 0 ? ((expCollected / expExpected) * 100).toFixed(0) : 0;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(textMain[0], textMain[1], textMain[2]);
        doc.text(exp.title || 'Cuota', 18, y + 4);
        doc.text(formatMoney(exp.amountPerStudent || exp.amount || 0), 85, y + 4, { align: 'right' });
        doc.text(formatMoney(expCollected), 130, y + 4, { align: 'right' });
        doc.setFont('helvetica', 'bold');
        doc.text(`${expPct}%`, pageWidth - 18, y + 4, { align: 'right' });

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
      doc.text('5. Resumen de Cumplimiento de Apoderados', 14, y);
      y += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`• Total de Alumnos Registrados: ${students.length}`, 18, y);
      y += 5;
      doc.text(`• Alumnos al Día (Sin deudas): ${studentDebtStats.countPaid} (${studentDebtStats.paidPercentage}%)`, 18, y);
      y += 5;
      doc.text(`• Alumnos con Deuda Pendiente: ${studentDebtStats.countUnpaid} (${studentDebtStats.unpaidPercentage}%)  -  Total Pendiente: ${formatMoney(studentDebtStats.totalUnpaidAmount)}`, 18, y);
      y += 12;

      // Signatures
      if (y > pageHeight - 35) {
        doc.addPage();
        y = 30;
      }

      doc.setDrawColor(203, 213, 225);
      const sigY = y + 15;
      doc.line(25, sigY, 80, sigY);
      doc.line(pageWidth - 80, sigY, pageWidth - 25, sigY);

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
      doc.text('Firma Tesorero(a)', 52.5, sigY + 5, { align: 'center' });
      doc.text('Firma Presidente(a)', pageWidth - 52.5, sigY + 5, { align: 'center' });

      if (sigTreasurer) {
        doc.addImage(sigTreasurer, 'PNG', 25, sigY - 20, 55, 18);
      }
      if (sigPresident) {
        doc.addImage(sigPresident, 'PNG', pageWidth - 80, sigY - 20, 55, 18);
      }

      // 1. Descargar PDF localmente
      doc.save(`Informe_Reunion_Apoderados_${meetingDate}.pdf`);
      
      // 2. Preparar el envío automático de correos (Trigger Email)
      setSendingEmail(true);
      const pdfBase64 = doc.output('datauristring').split(',')[1];
      
      const allEmails = new Set();
      students.forEach(s => {
        if (s.apoderadoEmails && s.apoderadoEmails.length > 0) {
          s.apoderadoEmails.forEach(e => allEmails.add(e));
        } else if (s.apoderadoEmail) {
          allEmails.add(s.apoderadoEmail);
        }
      });
      
      const emailList = Array.from(allEmails);
      
      if (emailList.length > 0) {
        const logoUrl = `${window.location.origin}/LOGOAPPCURSO.jpg`;
        
        const emailHtml = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
            <div style="background-color: #1e1e2f; padding: 20px; text-align: center;">
              <img src="${logoUrl}" alt="Control Curso" style="max-height: 70px; margin-bottom: 15px; border-radius: 8px; object-fit: cover;" />
              <h2 style="color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 0.5px;">Informe Financiero Oficial</h2>
            </div>
            <div style="padding: 30px; background-color: #ffffff;">
              <p style="font-size: 16px; color: #333333; margin-top: 0;">Estimados Apoderados,</p>
              <p style="font-size: 15px; color: #555555; line-height: 1.5;">Adjuntamos a este correo el <strong>informe financiero oficial y estado de cuenta actualizado</strong>, correspondiente a la reunión del <strong>${meetingDate}</strong>.</p>
              
              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 15px; border-radius: 6px; margin: 25px 0;">
                <p style="margin: 0; font-size: 14px; color: #166534; text-align: center;">
                  Este informe cuenta con las firmas digitales de la Directiva del curso, validando su autenticidad.
                </p>
              </div>
              
              <p style="font-size: 14px; color: #888888; margin-top: 30px; margin-bottom: 0;">Atentamente,</p>
              <p style="font-size: 15px; color: #333333; font-weight: bold; margin-top: 5px;">La Tesorería del Curso</p>
            </div>
            <div style="background-color: #f8f9fa; padding: 15px; text-align: center; border-top: 1px solid #eaeaea;">
              <p style="font-size: 12px; color: #999999; margin: 0;">Este es un mensaje automático generado por la plataforma del curso. Por favor no responda a este correo.</p>
            </div>
          </div>
        `;

        await addDoc(collection(db, 'mail'), {
          to: emailList,
          message: {
            subject: `Informe Financiero Oficial - Reunión de Apoderados (${meetingDate})`,
            html: emailHtml,
            attachments: [
              {
                filename: `Informe_Reunion_${meetingDate}.pdf`,
                content: pdfBase64,
                encoding: 'base64'
              }
            ]
          }
        });
        await showAlert("¡PDF Oficial generado, descargado y ENVIADO por correo a todos los apoderados!");
      } else {
        await showAlert("¡PDF generado y descargado! No se enviaron correos porque no hay apoderados registrados con email.");
      }
      
    } catch (error) {
      console.error("Error al generar PDF:", error);
      await showAlert("Hubo un error al generar el PDF.");
    } finally {
      setGeneratingPdf(false);
      setSendingEmail(false);
    }
  };

  // Image Export for WhatsApp
  const handleShareImage = async () => {
    setGeneratingImage(true);
    try {
      if (!reportRef.current) return;

      const actionsBar = document.getElementById('report-actions-bar');
      if (actionsBar) actionsBar.style.display = 'none';

      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: '#0f172a',
        scale: 2
      });

      if (actionsBar) actionsBar.style.display = 'flex';

      const image = canvas.toDataURL("image/png");
      const res = await fetch(image);
      const blob = await res.blob();
      const file = new File([blob], `informe_reunion_${meetingDate}.png`, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: meetingTitle,
          text: `Informe Financiero de la Reunión de Apoderados (${meetingDate}).`
        });
      } else {
        const link = document.createElement('a');
        link.href = image;
        link.download = `informe_reunion_${meetingDate}.png`;
        link.click();
        await showAlert("Imagen del informe descargada para enviar por WhatsApp.");
      }
    } catch (error) {
      console.error("Error al compartir imagen:", error);
      await showAlert("Error al generar la imagen.");
    } finally {
      setGeneratingImage(false);
    }
  };

  if (loading) {
    return (
      <div className="container animate-fade-in" style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <RefreshCw size={36} className="animate-spin" style={{ color: 'var(--primary)', margin: '0 auto 1rem auto' }} />
        <h3 style={{ margin: 0 }}>Preparando datos para la Reunión de Apoderados...</h3>
        <p style={{ color: 'var(--text-muted)' }}>Consolidando cuotas, gastos, fondos y estadísticas en tiempo real.</p>
      </div>
    );
  }

  return (
    <div className="container animate-fade-in" style={{ paddingBottom: '4rem' }}>
      
      {/* Top Header & Actions Bar */}
      <div id="report-actions-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <button onClick={onBack} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ArrowLeft size={18} /> Volver al Panel
        </button>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Privacy Toggle (Modo Proyector) */}
          <button 
            onClick={() => setHideSensitiveNames(!hideSensitiveNames)}
            className="btn btn-outline"
            style={{ 
              borderColor: hideSensitiveNames ? 'var(--warning)' : 'var(--border-color)',
              color: hideSensitiveNames ? 'var(--warning)' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.85rem'
            }}
            title="Oculta o muestra nombres en pantalla si estás proyectando frente a apoderados"
          >
            {hideSensitiveNames ? <EyeOff size={16} /> : <Eye size={16} />}
            {hideSensitiveNames ? 'Modo Proyector Activo' : 'Modo Proyector'}
          </button>

          {/* Export WhatsApp Image */}
          <button 
            onClick={handleShareImage}
            disabled={generatingImage}
            className="btn btn-outline"
            style={{ borderColor: '#25D366', color: '#25D366', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Share2 size={16} />
            {generatingImage ? 'Generando...' : 'Exportar Imagen'}
          </button>

          {/* Export PDF Button */}
          <button 
            onClick={generatePDFReport}
            disabled={generatingPdf || sendingEmail}
            className="btn btn-primary"
            style={{ backgroundColor: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.4rem', boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)' }}
          >
            <Download size={16} />
            {(generatingPdf || sendingEmail) ? 'Generando y Enviando...' : 'Descargar y Enviar a Apoderados'}
          </button>
        </div>
      </div>

      {/* Main Report Container */}
      <div ref={reportRef}>

        {/* Meeting Header Banner */}
        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', border: '1px solid rgba(99, 102, 241, 0.4)', background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div style={{ flex: '1 1 350px' }}>
              <span style={{ 
                fontSize: '0.75rem', 
                fontWeight: '700', 
                padding: '0.25rem 0.75rem', 
                borderRadius: '20px', 
                backgroundColor: 'rgba(99, 102, 241, 0.2)', 
                color: 'var(--primary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                Rendición de Cuentas Oficial
              </span>
              <h1 style={{ fontSize: '1.8rem', margin: '0.5rem 0 0.25rem 0', color: 'var(--text-main)' }}>
                {meetingTitle}
              </h1>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                Resumen ejecutivo y estado financiero completo preparado para los apoderados del curso.
              </p>
            </div>

            {/* Date & Title Inputs */}
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'rgba(255,255,255,0.05)', padding: '0.5rem 0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <Calendar size={16} style={{ color: 'var(--primary)' }} />
                <input 
                  type="date" 
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontFamily: 'inherit', fontSize: '0.9rem', outline: 'none' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Top KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
          
          {/* Fondo Total Disponible */}
          <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid var(--success)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Fondo Total Disponible</span>
              <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.2)', padding: '0.5rem', borderRadius: '50%', color: 'var(--success)' }}>
                <DollarSign size={20} />
              </div>
            </div>
            <h2 style={{ margin: 0, fontSize: '1.8rem', color: 'var(--success)' }}>{formatMoney(totalAvailable)}</h2>
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Efectivo: {formatMoney(cashBalance)} • Banco: {formatMoney(transferBalance)}
            </p>
          </div>

          {/* Total Ingresos / Recaudación */}
          <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid var(--primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total Recaudado (Ingresos)</span>
              <div style={{ backgroundColor: 'rgba(99, 102, 241, 0.2)', padding: '0.5rem', borderRadius: '50%', color: 'var(--primary)' }}>
                <TrendingUp size={20} />
              </div>
            </div>
            <h2 style={{ margin: 0, fontSize: '1.8rem', color: 'var(--primary)' }}>{formatMoney(totalCollected + totalIncomes)}</h2>
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Cuotas: {formatMoney(totalCollected)} • Extras: {formatMoney(totalIncomes)}
            </p>
          </div>

          {/* Total Gastos */}
          <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid var(--danger)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total Gastos Realizados</span>
              <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', padding: '0.5rem', borderRadius: '50%', color: 'var(--danger)' }}>
                <TrendingDown size={20} />
              </div>
            </div>
            <h2 style={{ margin: 0, fontSize: '1.8rem', color: 'var(--danger)' }}>{formatMoney(totalOutcomes)}</h2>
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {outcomes.length} gastos justificados en acta
            </p>
          </div>

          {/* % Cumplimiento de Apoderados */}
          <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #8b5cf6' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Cumplimiento de Pagos</span>
              <div style={{ backgroundColor: 'rgba(139, 92, 246, 0.2)', padding: '0.5rem', borderRadius: '50%', color: '#8b5cf6' }}>
                <Users size={20} />
              </div>
            </div>
            <h2 style={{ margin: 0, fontSize: '1.8rem', color: '#8b5cf6' }}>{studentDebtStats.paidPercentage}%</h2>
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {studentDebtStats.countPaid} de {students.length} alumnos al día
            </p>
          </div>

        </div>

        {/* Interactive Visual Graphs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
          
          {/* Gráfico 1: Cumplimiento de Pagos (Al Día vs Con Deuda) */}
          <div className="glass-panel" style={{ padding: '1.75rem' }}>
            <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <PieChart size={18} style={{ color: 'var(--primary)' }} /> Estado de Apoderados (Al Día vs Morosidad)
            </h4>

            {/* Visual Progress Bar Chart */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                <span style={{ color: 'var(--success)', fontWeight: '600' }}>
                  ● Al día: {studentDebtStats.countPaid} alumnos ({studentDebtStats.paidPercentage}%)
                </span>
                <span style={{ color: 'var(--danger)', fontWeight: '600' }}>
                  ● Con deuda: {studentDebtStats.countUnpaid} alumnos ({studentDebtStats.unpaidPercentage}%)
                </span>
              </div>
              <div style={{ width: '100%', height: '14px', backgroundColor: 'rgba(239, 68, 68, 0.3)', borderRadius: '10px', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${studentDebtStats.paidPercentage}%`, backgroundColor: 'var(--success)', height: '100%', transition: 'width 0.5s ease' }} />
                <div style={{ width: `${studentDebtStats.unpaidPercentage}%`, backgroundColor: 'var(--danger)', height: '100%', transition: 'width 0.5s ease' }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div style={{ padding: '0.75rem', backgroundColor: 'rgba(16, 185, 129, 0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                <p style={{ margin: '0 0 0.2rem 0', color: 'var(--text-muted)' }}>Alumnos al Día</p>
                <h3 style={{ margin: 0, color: 'var(--success)' }}>{studentDebtStats.countPaid}</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>Sin deudas pendientes</span>
              </div>
              <div style={{ padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                <p style={{ margin: '0 0 0.2rem 0', color: 'var(--text-muted)' }}>Monto Total Moroso</p>
                <h3 style={{ margin: 0, color: 'var(--danger)' }}>{formatMoney(studentDebtStats.totalUnpaidAmount)}</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>{studentDebtStats.countUnpaid} alumnos pendientes</span>
              </div>
            </div>
          </div>

          {/* Gráfico 2: Flujo de Caja (Ingresos vs Egresos vs Disponible) */}
          <div className="glass-panel" style={{ padding: '1.75rem' }}>
            <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={18} style={{ color: 'var(--success)' }} /> Flujo General: Ingresos vs Egresos
            </h4>

            {(() => {
              const maxVal = Math.max((totalCollected + totalIncomes), totalOutcomes, 1);
              const inPct = (((totalCollected + totalIncomes) / maxVal) * 100).toFixed(0);
              const outPct = ((totalOutcomes / maxVal) * 100).toFixed(0);
              const availPct = Math.max(0, ((totalAvailable / maxVal) * 100)).toFixed(0);

              return (
                <div style={{ display: 'grid', gap: '0.85rem' }}>
                  {/* Ingresos */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Total Ingresos Recaudados</span>
                      <strong style={{ color: 'var(--primary)' }}>{formatMoney(totalCollected + totalIncomes)}</strong>
                    </div>
                    <div style={{ width: '100%', height: '8px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '6px', overflow: 'hidden' }}>
                      <div style={{ width: `${inPct}%`, backgroundColor: 'var(--primary)', height: '100%' }} />
                    </div>
                  </div>

                  {/* Egresos */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Total Gastos / Egresos</span>
                      <strong style={{ color: 'var(--danger)' }}>{formatMoney(totalOutcomes)}</strong>
                    </div>
                    <div style={{ width: '100%', height: '8px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '6px', overflow: 'hidden' }}>
                      <div style={{ width: `${outPct}%`, backgroundColor: 'var(--danger)', height: '100%' }} />
                    </div>
                  </div>

                  {/* Disponible */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Saldo Neto Disponible</span>
                      <strong style={{ color: 'var(--success)' }}>{formatMoney(totalAvailable)}</strong>
                    </div>
                    <div style={{ width: '100%', height: '8px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '6px', overflow: 'hidden' }}>
                      <div style={{ width: `${availPct}%`, backgroundColor: 'var(--success)', height: '100%' }} />
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

        </div>

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
          <button 
            onClick={() => setActiveTab('resumen')}
            className="btn"
            style={{ 
              backgroundColor: activeTab === 'resumen' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'resumen' ? 'white' : 'var(--text-muted)',
              border: activeTab === 'resumen' ? 'none' : '1px solid var(--border-color)',
              fontSize: '0.9rem'
            }}
          >
            📊 Fondos de Curso ({Object.keys(finalFundsMap).length})
          </button>
          <button 
            onClick={() => setActiveTab('gastos')}
            className="btn"
            style={{ 
              backgroundColor: activeTab === 'gastos' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'gastos' ? 'white' : 'var(--text-muted)',
              border: activeTab === 'gastos' ? 'none' : '1px solid var(--border-color)',
              fontSize: '0.9rem'
            }}
          >
            💸 Lista de Gastos ({outcomes.length})
          </button>
          <button 
            onClick={() => setActiveTab('cuotas')}
            className="btn"
            style={{ 
              backgroundColor: activeTab === 'cuotas' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'cuotas' ? 'white' : 'var(--text-muted)',
              border: activeTab === 'cuotas' ? 'none' : '1px solid var(--border-color)',
              fontSize: '0.9rem'
            }}
          >
            📋 Cuotas Emitidas ({expenses.length})
          </button>
          <button 
            onClick={() => setActiveTab('morosos')}
            className="btn"
            style={{ 
              backgroundColor: activeTab === 'morosos' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'morosos' ? 'white' : 'var(--text-muted)',
              border: activeTab === 'morosos' ? 'none' : '1px solid var(--border-color)',
              fontSize: '0.9rem'
            }}
          >
            👥 Estado de Apoderados ({students.length})
          </button>
        </div>

        {/* Tab 1: Fondos de Curso */}
        {activeTab === 'resumen' && (
          <div className="glass-panel" style={{ padding: '1.75rem' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#c4b5fd' }}>
              📊 Fondos de Curso ({Object.keys(finalFundsMap).length})
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              {Object.values(finalFundsMap).map(f => (
                <div 
                  key={f.id}
                  style={{
                    padding: '1.25rem',
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ margin: 0, fontSize: '1.1rem' }}>{f.name}</h4>
                    <span style={{ 
                      fontSize: '0.75rem', 
                      padding: '0.15rem 0.5rem', 
                      borderRadius: '10px', 
                      backgroundColor: f.balance >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                      color: f.balance >= 0 ? 'var(--success)' : 'var(--danger)'
                    }}>
                      {f.balance >= 0 ? 'Superávit' : 'Déficit'}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Ingresos:</span>
                      <p style={{ margin: '0.1rem 0 0 0', fontWeight: '600', color: 'var(--primary)' }}>{formatMoney(f.totalIn)}</p>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Gastos:</span>
                      <p style={{ margin: '0.1rem 0 0 0', fontWeight: '600', color: 'var(--danger)' }}>{formatMoney(f.totalOut)}</p>
                    </div>
                  </div>

                  <div style={{ paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Saldo Disponible:</span>
                    <strong style={{ fontSize: '1.15rem', color: f.balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {formatMoney(f.balance)}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 2: Lista Inteligente de Gastos Realizados */}
        {activeTab === 'gastos' && (
          <div className="glass-panel" style={{ padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--danger)' }}>Lista Detallada de Gastos Realizados</h3>
                <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Transparencia total de los egresos ejecutados por la directiva del curso
                </p>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <select 
                  value={outcomeFilterFund} 
                  onChange={(e) => setOutcomeFilterFund(e.target.value)}
                  className="input-field"
                  style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                >
                  <option value="all">Todos los fondos</option>
                  {funds.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>

                <div style={{ position: 'relative' }}>
                  <input 
                    type="text" 
                    placeholder="Buscar motivo..."
                    value={outcomeSearch}
                    onChange={(e) => setOutcomeSearch(e.target.value)}
                    className="input-field"
                    style={{ padding: '0.5rem 0.5rem 0.5rem 2rem', fontSize: '0.85rem', width: '180px' }}
                  />
                  <Search size={14} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                </div>
              </div>
            </div>

            {filteredOutcomes.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>No hay gastos que coincidan con el filtro.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {filteredOutcomes.map(o => {
                  const fundName = finalFundsMap[o.fundId]?.name || 'General';
                  const methodLabel = o.paymentMethod === 'transfer' ? 'Transferencia (Banco)' : 'Efectivo (Caja)';

                  return (
                    <div 
                      key={o.id}
                      style={{
                        padding: '1rem 1.25rem',
                        backgroundColor: 'rgba(255,255,255,0.02)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.75rem'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-muted)' }}>{o.date}</span>
                          <span style={{ 
                            fontSize: '0.75rem', 
                            padding: '0.15rem 0.5rem', 
                            borderRadius: '10px', 
                            backgroundColor: 'rgba(99, 102, 241, 0.15)',
                            color: 'var(--primary)'
                          }}>
                            {fundName}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>• {methodLabel}</span>
                        </div>
                        <h4 style={{ margin: '0.35rem 0 0 0', fontSize: '1rem' }}>{o.title}</h4>
                        {o.description && o.description !== o.title && (
                          <p style={{ margin: '0.2rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{o.description}</p>
                        )}
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--danger)' }}>
                          {formatMoney(o.amount)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Resumen de Cuotas Emitidas */}
        {activeTab === 'cuotas' && (
          <div className="glass-panel" style={{ padding: '1.75rem' }}>
            <h3 style={{ margin: '0 0 1.25rem 0', color: 'var(--primary)' }}>Rendimiento de Cuotas Emitidas</h3>
            
            {expenses.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>No hay cuotas emitidas registradas.</p>
            ) : (
              <div style={{ display: 'grid', gap: '1rem' }}>
                {expenses.map(exp => {
                  const expDebts = debts.filter(d => d.expenseId === exp.id);
                  const paidCount = expDebts.filter(d => d.status === 'paid').length;
                  const partialCount = expDebts.filter(d => d.status === 'partial').length;
                  const pendingCount = expDebts.filter(d => d.status === 'pending' || d.status === 'review').length;
                  const totalCount = expDebts.length || students.length || 1;

                  const collected = expDebts.reduce((sum, d) => sum + (d.status === 'paid' ? (d.amount || 0) : (d.paidAmount || 0)), 0);
                  const expected = (exp.amountPerStudent || exp.amount || 0) * totalCount;
                  const pct = expected > 0 ? ((collected / expected) * 100).toFixed(0) : 0;

                  return (
                    <div 
                      key={exp.id}
                      style={{
                        padding: '1.25rem',
                        backgroundColor: 'rgba(255,255,255,0.02)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '1.1rem' }}>{exp.title}</h4>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Valor Cuota: {formatMoney(exp.amountPerStudent || exp.amount || 0)} • Emitida: {exp.date || '-'}
                          </span>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '1.2rem', fontWeight: '700', color: 'var(--success)' }}>
                            {formatMoney(collected)}
                          </span>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block' }}>
                            de {formatMoney(expected)} ({pct}%)
                          </span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div style={{ width: '100%', height: '8px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, backgroundColor: Number(pct) >= 80 ? 'var(--success)' : Number(pct) >= 50 ? 'var(--warning)' : 'var(--danger)', height: '100%' }} />
                      </div>

                      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--success)' }}>✔ {paidCount} Pagadas</span>
                        {partialCount > 0 && <span style={{ color: '#f59e0b' }}>⚡ {partialCount} Parciales</span>}
                        {pendingCount > 0 && <span style={{ color: 'var(--danger)' }}>✖ {pendingCount} Pendientes</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Estado de Apoderados & Morosidad */}
        {activeTab === 'morosos' && (
          <div className="glass-panel" style={{ padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Estado de Apoderados y Cumplimiento</h3>
                <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {hideSensitiveNames ? '🔒 Modo Proyector activo (nombres protegidos)' : 'Haz clic en un alumno para ver su detalle de pagos'}
                </p>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <select 
                  value={debtorFilterStatus}
                  onChange={(e) => setDebtorFilterStatus(e.target.value)}
                  className="input-field"
                  style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                >
                  <option value="all">Todos ({students.length})</option>
                  <option value="paid">Al día ({studentDebtStats.countPaid})</option>
                  <option value="unpaid">Con deuda ({studentDebtStats.countUnpaid})</option>
                </select>

                <div style={{ position: 'relative' }}>
                  <input 
                    type="text" 
                    placeholder="Buscar alumno..."
                    value={debtorSearch}
                    onChange={(e) => setDebtorSearch(e.target.value)}
                    className="input-field"
                    style={{ padding: '0.5rem 0.5rem 0.5rem 2rem', fontSize: '0.85rem', width: '180px' }}
                  />
                  <Search size={14} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                </div>
              </div>
            </div>

            {/* List */}
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {filteredStudentDebts.map(item => {
                const s = item.student;
                const isPaid = item.status === 'paid';
                const displayName = hideSensitiveNames ? `Alumno N° ${s.listNumber || '-'}` : formatStudentName(s);

                return (
                  <div 
                    key={s.id}
                    onClick={() => setSelectedStudentForDetail(s)}
                    style={{
                      padding: '1rem 1.25rem',
                      backgroundColor: 'rgba(255,255,255,0.02)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      borderLeft: `4px solid ${isPaid ? 'var(--success)' : 'var(--danger)'}`,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '0.75rem',
                      transition: 'all 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)'}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: '700', padding: '0.15rem 0.45rem', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.08)' }}>
                          N° {s.listNumber || '-'}
                        </span>
                        <h4 style={{ margin: 0, fontSize: '1rem' }}>{displayName}</h4>
                      </div>
                      
                      {!hideSensitiveNames && s.apoderadoEmails && (
                        <p style={{ margin: '0.2rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          Apoderado: {s.apoderadoEmails.map(e => usersMap[e] || e).join(', ')}
                        </p>
                      )}
                    </div>

                    <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div>
                        {isPaid ? (
                          <span style={{ 
                            fontSize: '0.85rem', 
                            fontWeight: '600', 
                            color: 'var(--success)', 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            gap: '0.3rem' 
                          }}>
                            <CheckCircle size={15} /> Al día
                          </span>
                        ) : (
                          <div>
                            <span style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--danger)' }}>
                              Debe: {formatMoney(item.pendingAmount)}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                              ({item.pendingCount + item.partialCount} cuotas pendientes)
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
      
      {/* Signatures Section at the bottom */}
      <div className="glass-panel" style={{ padding: '1.75rem', marginTop: '1.5rem', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
        <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-main)' }}>Firmas Digitales de la Directiva</h3>
        <p style={{ margin: '0 0 1.5rem 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Firmen en los recuadros a continuación. Estas firmas se adjuntarán automáticamente al final del informe en PDF antes de ser enviado a los apoderados.
        </p>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
          <SignaturePad 
            title="Firma Tesorero(a)" 
            onSave={(b64) => setSigTreasurer(b64)}
            onClear={() => setSigTreasurer(null)}
          />
          <SignaturePad 
            title="Firma Presidente(a)" 
            onSave={(b64) => setSigPresident(b64)}
            onClear={() => setSigPresident(null)}
          />
        </div>
      </div>

      {/* Complete Student Payment Detail Modal */}
      {selectedStudentForDetail && (
        <StudentDetailModal 
          student={selectedStudentForDetail}
          usersMap={usersMap}
          isModal={true}
          onClose={() => setSelectedStudentForDetail(null)}
        />
      )}
    </div>
  );
};

export default MeetingReport;
