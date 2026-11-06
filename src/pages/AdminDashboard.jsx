import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, Users, DollarSign, Activity, FileText, RefreshCw, Trash2, CreditCard, Search, Menu, X, PlusCircle, Settings, AlertTriangle, CheckCircle, Download, Eye, EyeOff } from 'lucide-react';
import { db } from '../firebase/config';
import { collection, getDocs, query, where, addDoc, doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useModal } from '../context/ModalContext';
import { ArrowDownRight, ArrowUpRight, ArrowRightLeft } from 'lucide-react';

import UserManagement from '../components/UserManagement';
import StudentManagement from '../components/StudentManagement';
import ExpenseManagement from '../components/ExpenseManagement';
import ExpenseDetail from '../components/ExpenseDetail';
import DebtorsManagement from '../components/DebtorsManagement';
import OutcomeManagement from '../components/OutcomeManagement';
import FundManagement from '../components/FundManagement';
import EventManagement from '../components/events/EventManagement';
import SettingsManagement from '../components/SettingsManagement';
import FundHistoryModal from '../components/FundHistoryModal';
import StudentSearchModal from '../components/StudentSearchModal';
import MeetingReport from '../components/MeetingReport';
import InstallAppGuide from '../components/InstallAppGuide';
import RegisteredApoderadosModal from '../components/RegisteredApoderadosModal';
import StudentsWithoutApoderadosModal from '../components/StudentsWithoutApoderadosModal';
import CourseManagement from '../components/CourseManagement';
import ApprovalsManagement from '../components/ApprovalsManagement';
import CuotaReportModal from '../components/CuotaReportModal';
import { useCourse } from '../context/CourseContext';

const AdminDashboard = () => {
  const { user, role, userData, logout } = useAuth();
  const { courses, selectedCourse, changeCourse } = useCourse();

  const courseRole = (role === 'superadmin' || userData?.roles?.global === 'superadmin')
    ? 'superadmin'
    : (userData?.roles?.[selectedCourse?.id] || null);
  const { showAlert, showPrompt, showConfirm } = useModal();
  const navigate = useNavigate();
  const [currentView, setCurrentView] = useState((!['superadmin', 'admin', 'presidente', 'tesorero'].includes(courseRole)) && userData?.canAccessEvents ? 'events' : 'dashboard');
  const [selectedExpenseId, setSelectedExpenseId] = useState(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [stats, setStats] = useState({
    activeStudents: 0,
    studentsWithApoderados: 0,
    registeredApoderados: 0,
    totalCollected: 0,
    totalExpected: 0,
    totalAvailable: 0,
    fundsBalances: [],
    allTransactions: [],
    realBankBalance: 0,
    registeredApoderadosList: [],
    studentsWithoutApoderadosList: [],
    pendingApprovalsCount: 0
  });

  const [selectedFundForHistory, setSelectedFundForHistory] = useState(null);
  const [isApoderadosModalOpen, setIsApoderadosModalOpen] = useState(false);
  const [isNoApoderadosModalOpen, setIsNoApoderadosModalOpen] = useState(false);
  const [showAllExpenses, setShowAllExpenses] = useState(false);
  const [isCuotaReportOpen, setIsCuotaReportOpen] = useState(false);

  // Lista de cuotas
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);





  const handleZeroOutFund = async (fundId, fundName, currentBalance) => {
    if (currentBalance === 0) return;
    if (!window.confirm(`¿Estás seguro de que quieres ajustar el ${fundName}? Se creará un ajuste interno para dejar su saldo en $0.`)) return;

    try {
      if (currentBalance < 0) {
        await addDoc(collection(db, 'incomes'), {
          amount: Math.abs(currentBalance),
          description: `Ajuste automático para balancear ${fundName}`,
          paymentMethod: 'cash',
          fundId: fundId,
          createdAt: new Date().toISOString()
        });
      } else {
        await addDoc(collection(db, 'outcomes'), {
          amount: currentBalance,
          description: `Ajuste automático para balancear ${fundName}`,
          paymentMethod: 'cash',
          fundId: fundId,
          createdAt: new Date().toISOString()
        });
      }
      fetchDashboardData();
      alert(`El ${fundName} ha sido ajustado a $0.`);
    } catch (error) {
      console.error(error);
      alert('Hubo un error al ajustar el fondo.');
    }
  };


  const fetchDashboardData = useCallback(async () => {
    if (!selectedCourse) return;
    setLoading(true);
    try {
      const studentsPromise = getDocs(query(collection(db, 'students'), where('courseId', '==', selectedCourse.id)));
      // Note: bankInfo might need to be isolated. For now we use the global settings document, but ideal to migrate to per-course
      const bankInfoPromise = getDoc(doc(db, 'settings', 'bankInfo'));
      const expensesPromise = getDocs(query(collection(db, 'expenses'), where('courseId', '==', selectedCourse.id)));
      const fundsPromise = getDocs(query(collection(db, 'funds'), where('courseId', '==', selectedCourse.id)));
      // Fetch all debts and filter/auto-repair locally so debts added without courseId are recovered
      const debtsPromise = getDocs(collection(db, 'debts'));
      const outcomesPromise = getDocs(query(collection(db, 'outcomes'), where('courseId', '==', selectedCourse.id)));
      const incomesPromise = getDocs(query(collection(db, 'incomes'), where('courseId', '==', selectedCourse.id)));
      const transfersPromise = getDocs(query(collection(db, 'fund_transfers'), where('courseId', '==', selectedCourse.id)));
      const paymentsPromise = getDocs(collection(db, 'payments'));

      const usersPromise = (role === 'superadmin' || role === 'admin')
        ? getDocs(collection(db, 'users'))
        : Promise.resolve({ docs: [], size: 0, forEach: () => { } });

      const [
        studentsSnap, bankInfoSnap, expensesSnap, fundsSnap,
        allDebtsSnap, outcomesSnap, incomesSnap, transfersSnap, usersSnap, paymentsSnap
      ] = await Promise.all([
        studentsPromise, bankInfoPromise, expensesPromise, fundsPromise,
        debtsPromise, outcomesPromise, incomesPromise, transfersPromise, usersPromise, paymentsPromise
      ]);

      let pendingApprovalsCount = 0;

      const courseExpenseIds = new Set(expensesSnap.docs.map(d => d.id));
      const courseStudentIds = new Set(studentsSnap.docs.map(d => d.id));
      const expensesDataMap = new Map(expensesSnap.docs.map(d => [d.id, d.data()]));

      // Filter debts belonging to this course and auto-repair missing courseId / paymentMethod / paidAmount
      const courseDebts = [];
      allDebtsSnap.docs.forEach(d => {
        const raw = { id: d.id, ...d.data() };
        const belongsToCourse = raw.courseId === selectedCourse.id ||
          (!raw.courseId && (courseExpenseIds.has(raw.expenseId) || courseStudentIds.has(raw.studentId)));
        if (!belongsToCourse) return;

        const parentExp = expensesDataMap.get(raw.expenseId);
        const repairUpdates = {};

        if (!raw.courseId) {
          raw.courseId = selectedCourse.id;
          repairUpdates.courseId = selectedCourse.id;
        }
        if (!raw.fundId && parentExp?.fundId) {
          raw.fundId = parentExp.fundId;
          repairUpdates.fundId = parentExp.fundId;
        }
        if (raw.status === 'paid' && (!raw.paidAmount || raw.paidAmount <= 0) && (raw.amount || 0) > 0) {
          raw.paidAmount = raw.amount;
          repairUpdates.paidAmount = raw.amount;
        }
        if ((raw.status === 'paid' || raw.status === 'partial') && (raw.paidAmount || 0) > 0 && !raw.paymentMethod) {
          raw.paymentMethod = 'transfer';
          repairUpdates.paymentMethod = 'transfer';
          if (!raw.approvedAt) {
            const approvedIso = raw.paidAt || raw.createdAt || new Date().toISOString();
            raw.approvedAt = approvedIso;
            repairUpdates.approvedAt = approvedIso;
          }
        }

        if (Object.keys(repairUpdates).length > 0) {
          updateDoc(doc(db, 'debts', d.id), repairUpdates).catch(err =>
            console.error("Error auto-reparando deuda en Dashboard:", err)
          );
        }

        courseDebts.push(raw);
      });

      // Filter debts by status locally
      const debtsDocs = courseDebts.filter(d => {
        if (d.status === 'review') {
          pendingApprovalsCount++;
        }
        return d.status === 'paid' || d.status === 'partial';
      });

      // 1. Alumnos Activos
      let activeStudentsCount = 0;
      let studentsWithApoderadosCount = 0;
      let studentsWithoutApoderadosList = [];

      studentsSnap.forEach(doc => {
        const data = doc.data();
        if (data.status === 'retirado') return;

        activeStudentsCount++;
        const emails = data.apoderadoEmails?.length > 0 ? data.apoderadoEmails : (data.apoderadoEmail ? [data.apoderadoEmail] : []);
        if (emails.length > 0) {
          studentsWithApoderadosCount++;
        } else {
          studentsWithoutApoderadosList.push({ id: doc.id, ...data });
        }
      });

      // 1.2 Real Bank Balance
      const realBankBalance = bankInfoSnap.exists() ? bankInfoSnap.data().realBalance || 0 : 0;

      // 1.5 Apoderados registrados
      let registeredApoderadosCount = 0;
      let registeredApoderadosList = [];
      if (role === 'superadmin' || role === 'admin') {
        usersSnap.forEach(doc => {
          const u = doc.data();
          if (u.roles && u.roles[selectedCourse.id]) {
            registeredApoderadosList.push({ id: doc.id, ...u });
          }
        });
        registeredApoderadosCount = registeredApoderadosList.length;
      }

      // 2. Cuotas / Gastos
      let expected = 0;
      const expensesList = [];
      expensesSnap.forEach(doc => {
        const data = doc.data();
        expected += (data.totalAmount || 0);
        expensesList.push({ id: doc.id, ...data });
      });
      // Ordenar localmente por fecha descendente
      expensesList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // 3. Fondos (Categorías)
      const fundsMap = new Map(); // id -> { name, balance }
      fundsSnap.forEach(doc => {
        fundsMap.set(doc.id, { id: doc.id, name: doc.data().name, balance: 0 });
      });
      // Asegurar que exista el Fondo General
      if (!fundsMap.has('general')) {
        fundsMap.set('general', { id: 'general', name: 'Fondo General', balance: 0 });
      }

      // 4. Cobros (Dinero realmente pagado) y desglose de pagos
      let collected = 0;
      let cashIn = 0;
      let transferIn = 0;
      const allTransactions = [];
      const expenseCollectedMap = {};

      const debtsWithPayments = new Set();
      const paymentsSumByDebt = new Map();
      const cashPaidByDebt = new Map();
      const bankPaidByDebt = new Map();
      const debtsMap = new Map();
      debtsDocs.forEach(d => debtsMap.set(d.id, d));
      const allCourseDebtsMap = new Map();
      courseDebts.forEach(d => allCourseDebtsMap.set(d.id, d));

      if (paymentsSnap) {
        paymentsSnap.forEach(docSnap => {
          const p = docSnap.data();
          const belongsToCourse = p.courseId === selectedCourse.id || (!p.courseId && allCourseDebtsMap.has(p.debtId));
          if (!belongsToCourse) return;

          if (!p.courseId) {
            updateDoc(doc(db, 'payments', docSnap.id), { courseId: selectedCourse.id }).catch(() => {});
          }

          const relatedDebt = allCourseDebtsMap.get(p.debtId);
          if (relatedDebt && (relatedDebt.status === 'pending' || (!relatedDebt.paidAmount && !relatedDebt.amount))) {
            return; // Ignorar pagos huérfanos de cuotas canceladas
          }
          const pAmt = Number(p.amount) || 0;
          if (pAmt <= 0) {
            return; // Ignorar pagos en $0
          }

          const effectivePayMethod = p.paymentMethod || relatedDebt?.paymentMethod || 'transfer';
          debtsWithPayments.add(p.debtId);
          paymentsSumByDebt.set(p.debtId, (paymentsSumByDebt.get(p.debtId) || 0) + pAmt);

          if (effectivePayMethod === 'cash') {
            cashPaidByDebt.set(p.debtId, (cashPaidByDebt.get(p.debtId) || 0) + pAmt);
          } else {
            bankPaidByDebt.set(p.debtId, (bankPaidByDebt.get(p.debtId) || 0) + pAmt);
          }

          const baseDesc = `Pago ${p.status === 'partial' ? 'parcial ' : ''}de ${p.studentName || relatedDebt?.studentName || ''}: ${p.title || relatedDebt?.title || 'Cuota'}`;
          allTransactions.push({
            id: docSnap.id,
            fundId: p.fundId || relatedDebt?.fundId || 'general',
            type: 'debt_payment',
            amount: pAmt,
            paymentMethod: effectivePayMethod,
            description: effectivePayMethod === 'balance' && !baseDesc.includes('Saldo a favor')
              ? `${baseDesc} (Saldo a favor)`
              : baseDesc,
            date: p.createdAt || relatedDebt?.approvedAt || relatedDebt?.createdAt
          });
        });
      }

      debtsDocs.forEach(data => {
        let fundId = data.fundId || 'general';

        // Si el fondo fue eliminado, ignorar el dinero por completo
        if (!fundsMap.has(fundId)) return;

        const amt = (typeof data.paidAmount === 'number' && data.paidAmount > 0)
          ? data.paidAmount
          : (data.status === 'paid' ? (data.amount || 0) : 0);
        const expected = data.amount || 0;

        const baseAmt = Math.min(amt, expected);
        const overpayAmt = Math.max(0, amt - expected);

        collected += amt;

        const effectiveMethod = data.paymentMethod || 'transfer';
        if (debtsWithPayments.has(data.id)) {
          let debtCash = cashPaidByDebt.get(data.id) || 0;
          let debtBank = bankPaidByDebt.get(data.id) || 0;
          const recordedTotal = debtCash + debtBank;
          if (amt > recordedTotal) {
            const diff = amt - recordedTotal;
            if (effectiveMethod === 'cash') debtCash += diff;
            else debtBank += diff;
          }
          const effectiveCashBase = Math.min(baseAmt, debtCash);
          const effectiveBankBase = Math.max(0, baseAmt - effectiveCashBase);
          cashIn += effectiveCashBase;
          transferIn += effectiveBankBase;
        } else {
          if (effectiveMethod === 'cash') cashIn += baseAmt;
          if (effectiveMethod === 'transfer' || effectiveMethod === 'balance') transferIn += baseAmt;
        }

        // El usuario solicitó que todo el saldo a favor (overpay) se cuente como transferencia
        transferIn += overpayAmt;

        // Sumar lo recaudado por cada cuota
        if (data.expenseId) {
          if (!expenseCollectedMap[data.expenseId]) expenseCollectedMap[data.expenseId] = 0;
          expenseCollectedMap[data.expenseId] += amt;
        }
      });

      // Contar estados y alumnos reales de cada cuota desde las deudas reales
      const expenseDebtsStatsMap = {};
      courseDebts.forEach(data => {
        if (data.expenseId) {
          if (!expenseDebtsStatsMap[data.expenseId]) {
            expenseDebtsStatsMap[data.expenseId] = { total: 0, paid: 0 };
          }
          expenseDebtsStatsMap[data.expenseId].total += 1;
          if (data.status === 'paid') {
            expenseDebtsStatsMap[data.expenseId].paid += 1;
          }
        }
      });

      // Asignar lo recaudado y conteos reales a cada cuota en la lista
      expensesList.forEach(exp => {
        exp.collectedAmount = expenseCollectedMap[exp.id] || 0;
        if (expenseDebtsStatsMap[exp.id] && expenseDebtsStatsMap[exp.id].total > 0) {
          exp.paidCount = expenseDebtsStatsMap[exp.id].paid;
          exp.studentsCount = expenseDebtsStatsMap[exp.id].total;
        }
      });

      // 5. Gastos Directiva (Egresos)
      const outcomesDocs = outcomesSnap.docs;
      let cashOut = 0;
      let transferOut = 0;
      outcomesDocs.forEach(doc => {
        const data = doc.data();
        let fundId = data.fundId || 'general';
        if (!fundsMap.has(fundId)) fundId = 'general';

        const amt = data.amount || 0;
        if (data.paymentMethod === 'cash') cashOut += amt;
        if (data.paymentMethod === 'transfer') transferOut += amt;
      });

      // 6. Ingresos Manuales (Saldos Iniciales/Extras)
      const incomesDocs = incomesSnap.docs;
      incomesDocs.forEach(docSnap => {
        const data = docSnap.data();

        // TEMPORAL: Eliminar registro fantasma de 33000
        if (data.amount === 33000 && data.description && data.description.includes('Ajuste automático')) {
          import('firebase/firestore').then(({ deleteDoc, doc: fsDoc }) => {
            deleteDoc(fsDoc(db, 'incomes', docSnap.id)).catch(console.error);
          });
          return; // Skip this one
        }

        // TEMPORAL: Mover Ingreso Rápido 101970 a banco
        if (data.amount === 101970 && data.title === 'Ingreso Rápido' && data.paymentMethod === 'cash') {
          import('firebase/firestore').then(({ updateDoc, doc: fsDoc }) => {
            updateDoc(fsDoc(db, 'incomes', docSnap.id), {
              paymentMethod: 'transfer',
              title: 'Saldo Año Anterior'
            }).catch(console.error);
          });
          data.paymentMethod = 'transfer';
          data.title = 'Saldo Año Anterior';
        }

        let fundId = data.fundId || 'general';
        if (!fundsMap.has(fundId)) return;

        const amt = data.amount || 0;
        if (data.paymentMethod === 'cash') cashIn += amt;
        if (data.paymentMethod === 'transfer') transferIn += amt;
      });

      // Calcular balances por fondo y completar transacciones faltantes
      debtsDocs.forEach(data => {
        let fundId = data.fundId || 'general';
        if (!fundsMap.has(fundId)) return;

        const amt = (typeof data.paidAmount === 'number' && data.paidAmount > 0)
          ? data.paidAmount
          : (data.status === 'paid' ? (data.amount || 0) : 0);

        fundsMap.get(fundId).balance += amt;

        const effectiveMethod = data.paymentMethod || 'transfer';
        const recordedPaid = paymentsSumByDebt.get(data.id) || 0;
        const txDate = data.approvedAt || data.paidAt || data.createdAt || new Date().toISOString();

        // Mostrar como movimiento si no tiene historial en la colección 'payments' o si hay diferencia no registrada
        if (!debtsWithPayments.has(data.id) && amt > 0) {
          const desc = effectiveMethod === 'balance'
            ? `Pago de ${data.studentName ? data.studentName : ''}: ${data.title || 'Cuota'} (Saldo a favor)`
            : `Pago de ${data.studentName ? data.studentName : ''}: ${data.title || 'Cuota'}`;
          allTransactions.push({
            id: data.id + (effectiveMethod === 'balance' ? '_add' : ''),
            fundId: fundId,
            type: 'debt_payment',
            amount: amt,
            paymentMethod: effectiveMethod,
            description: desc,
            date: txDate
          });
          // Autorreparar registro faltante en la colección 'payments' para persistir en el historial
          addDoc(collection(db, 'payments'), {
            debtId: data.id,
            courseId: selectedCourse.id,
            fundId: fundId,
            amount: amt,
            paymentMethod: effectiveMethod,
            studentName: data.studentName || '',
            title: data.title || 'Cuota',
            status: data.status,
            createdAt: txDate
          }).catch(err => console.error("Error auto-creando payment en Dashboard:", err));
        } else if (debtsWithPayments.has(data.id) && amt > recordedPaid) {
          const diffAmt = amt - recordedPaid;
          const desc = effectiveMethod === 'balance'
            ? `Pago de ${data.studentName ? data.studentName : ''}: ${data.title || 'Cuota'} (Saldo a favor)`
            : `Pago de ${data.studentName ? data.studentName : ''}: ${data.title || 'Cuota'}`;
          allTransactions.push({
            id: data.id + '_diff',
            fundId: fundId,
            type: 'debt_payment',
            amount: diffAmt,
            paymentMethod: effectiveMethod,
            description: desc,
            date: txDate
          });
        }
      });

      outcomesDocs.forEach(doc => {
        const data = doc.data();
        let fundId = data.fundId || 'general';
        if (!fundsMap.has(fundId)) fundId = 'general';

        const amt = data.amount || 0;
        fundsMap.get(fundId).balance -= amt;
        allTransactions.push({ id: doc.id, fundId: fundId, type: 'outcome', amount: -amt, paymentMethod: data.paymentMethod, description: data.title || data.description || 'Gasto', date: data.date || data.createdAt });
      });

      incomesDocs.forEach(docSnap => {
        const data = docSnap.data();

        if (data.amount === 33000 && data.description && data.description.includes('Ajuste automático')) {
          return; // Ignorar en historial
        }



        let fundId = data.fundId || 'general';
        if (!fundsMap.has(fundId)) return;

        const amt = data.amount || 0;
        fundsMap.get(fundId).balance += amt;
        allTransactions.push({ id: docSnap.id, fundId: fundId, type: 'income', amount: amt, paymentMethod: data.paymentMethod, description: data.title || data.description || 'Ingreso', date: data.createdAt });
      });

      // Transferencias entre fondos
      transfersSnap.forEach(doc => {
        const data = doc.data();
        const amt = data.amount || 0;
        let fromId = data.fromFundId;
        let toId = data.toFundId;

        if (fromId && !fundsMap.has(fromId)) fromId = 'general';
        if (toId && !fundsMap.has(toId)) toId = 'general';

        if (fromId && fundsMap.has(fromId)) {
          fundsMap.get(fromId).balance -= amt;
          allTransactions.push({ id: doc.id + '_out', fundId: fromId, type: 'transfer_out', amount: -amt, description: 'Transferencia saliente', date: data.createdAt });
        }
        if (toId && fundsMap.has(toId)) {
          fundsMap.get(toId).balance += amt;
          allTransactions.push({ id: doc.id + '_in', fundId: toId, type: 'transfer_in', amount: amt, description: 'Transferencia entrante', date: data.createdAt });
        }
      });

      // Calcular Fondo Saldos a Favor
      let totalFavorBalance = 0;
      const studentsWithBalance = [];
      studentsSnap.forEach(doc => {
        const data = doc.data();
        if (data.balance && parseFloat(data.balance) > 0) {
          totalFavorBalance += parseFloat(data.balance);
          studentsWithBalance.push({ id: doc.id, name: data.name, balance: parseFloat(data.balance), courseId: selectedCourse?.id });
        }
      });

      // El usuario solicitó que todo el saldo a favor manual esté físicamente en Transferencias
      transferIn += totalFavorBalance;

      if (totalFavorBalance > 0) {
        fundsMap.set('favor_balance', {
          id: 'favor_balance',
          name: 'Saldos a Favor (Alumnos)',
          balance: totalFavorBalance,
          studentsWithBalance
        });
      }

      const fundsBalances = Array.from(fundsMap.values());
      const totalAvailable = fundsBalances.reduce((sum, fund) => sum + fund.balance, 0);

      const calculatedCashBalance = cashIn - cashOut;
      const calculatedTransferBalance = totalAvailable - calculatedCashBalance;

      setStats({
        activeStudents: activeStudentsCount,
        studentsWithApoderados: studentsWithApoderadosCount,
        studentsWithoutApoderadosList,
        registeredApoderados: registeredApoderadosCount,
        totalCollected: collected,
        totalExpected: expected,
        totalAvailable,
        fundsBalances,
        allTransactions,
        cashBalance: calculatedCashBalance,
        transferBalance: calculatedTransferBalance,
        realBankBalance,
        registeredApoderadosList,
        pendingApprovalsCount
      });
      setExpenses(expensesList);


    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      showAlert(`Error al cargar datos del panel: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [role, selectedCourse]);

  useEffect(() => {
    if (currentView === 'dashboard') {
      fetchDashboardData();
    }
  }, [currentView, fetchDashboardData]);

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };


  const handleUpdateRealBankBalance = async () => {
    const amountStr = await showPrompt("Ingresa el monto real actual que tienes en la cuenta de banco:", stats.realBankBalance);
    if (amountStr === null) return;

    const amount = parseFloat(amountStr);
    if (isNaN(amount)) {
      await showAlert("Monto inválido.");
      return;
    }

    setLoading(true);
    try {
      await setDoc(doc(db, 'settings', 'bankInfo'), { realBalance: amount }, { merge: true });
      fetchDashboardData();
    } catch (error) {
      console.error(error);
      await showAlert("Error al actualizar el saldo.");
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsSidebarOpen(false);
    const confirmed = await showConfirm('¿Estás seguro de que deseas cerrar sesión?');
    if (confirmed) {
      logout();
    }
  };

  return (
    <>
      <div className={`sidebar-overlay ${isSidebarOpen ? 'open' : ''}`} onClick={() => setIsSidebarOpen(false)}></div>
      <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <button className="sidebar-close-btn" onClick={() => setIsSidebarOpen(false)}>
          <X size={24} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
          <img src="/LOGOAPPCURSO.jpg" alt="Logo" style={{ width: '50px', height: '50px', borderRadius: '8px', objectFit: 'cover' }} onError={(e) => e.target.style.display = 'none'} />
          <h3 style={{ margin: 0 }}>Menú</h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {['superadmin', 'admin', 'presidente', 'tesorero'].includes(courseRole) && (
            <>
              <button
                onClick={() => { setCurrentView('dashboard'); setIsSidebarOpen(false); }}
                className="btn btn-outline"
                style={{ justifyContent: 'flex-start', ...(currentView === 'dashboard' ? { borderColor: 'var(--border-color-focus)', backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-main)' } : {}) }}
              >
                <Activity size={18} /> Panel Principal
              </button>
              <button
                onClick={() => { setCurrentView('meeting_report'); setIsSidebarOpen(false); }}
                className="btn btn-outline"
                style={{ justifyContent: 'flex-start', ...(currentView === 'meeting_report' ? { borderColor: 'var(--border-color-focus)', backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-main)' } : {}) }}
              >
                <FileText size={18} /> Informe Reunión
              </button>
              <button
                onClick={() => { setCurrentView('outcomes'); setIsSidebarOpen(false); }}
                className="btn btn-outline"
                style={{ justifyContent: 'flex-start', ...(currentView === 'outcomes' ? { borderColor: 'var(--border-color-focus)', backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-main)' } : {}) }}
              >
                <DollarSign size={18} /> Historial Gastos
              </button>
              <button
                onClick={() => { setCurrentView('funds'); setIsSidebarOpen(false); }}
                className="btn btn-outline"
                style={{ justifyContent: 'flex-start', ...(currentView === 'funds' ? { borderColor: 'var(--border-color-focus)', backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-main)' } : {}) }}
              >
                <CreditCard size={18} /> Administrar Fondos
              </button>
            </>
          )}
          <button
            onClick={() => { setCurrentView('events'); setIsSidebarOpen(false); }}
            className="btn btn-outline"
            style={{ justifyContent: 'flex-start', ...(currentView === 'events' ? { borderColor: 'var(--border-color-focus)', backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-main)' } : {}) }}
          >
            <Activity size={18} /> Eventos y Ventas
          </button>
          {['superadmin', 'admin', 'presidente', 'tesorero'].includes(courseRole) && (
            <>
              <button
                onClick={() => { setCurrentView('expenses_add'); setIsSidebarOpen(false); }}
                className="btn btn-outline"
                style={{ justifyContent: 'flex-start', ...(currentView === 'expenses_add' ? { borderColor: 'var(--border-color-focus)', backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-main)' } : {}) }}
              >
                <PlusCircle size={18} /> Crear Cuota
              </button>
              <button
                onClick={() => { setCurrentView('debtors'); setIsSidebarOpen(false); }}
                className="btn btn-outline"
                style={{ justifyContent: 'flex-start', ...(currentView === 'debtors' ? { borderColor: 'var(--border-color-focus)', backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-main)' } : {}) }}
              >
                <AlertTriangle size={18} /> Deudas
              </button>
            </>
          )}
          {['superadmin', 'admin', 'presidente'].includes(courseRole) && (
            <button
              onClick={() => { setCurrentView('students'); setIsSidebarOpen(false); }}
              className="btn btn-outline"
              style={{ justifyContent: 'flex-start', ...(currentView === 'students' ? { borderColor: 'var(--border-color-focus)', backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-main)' } : {}) }}
            >
              <Users size={18} /> Alumnos
            </button>
          )}
          {courseRole === 'superadmin' || courseRole === 'tesorero' ? (
            <button
              onClick={() => { setCurrentView('approvals'); setIsSidebarOpen(false); }}
              className="btn btn-outline"
              style={{ justifyContent: 'space-between', ...(currentView === 'approvals' ? { borderColor: 'var(--border-color-focus)', backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-main)' } : {}) }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle size={18} /> Aprobaciones
              </div>
              {stats.pendingApprovalsCount > 0 && (
                <span style={{ backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color-focus)', color: 'var(--text-main)', padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontWeight: 'bold' }}>
                  {stats.pendingApprovalsCount}
                </span>
              )}
            </button>
          ) : null}
          {['superadmin', 'admin', 'presidente'].includes(courseRole) && (
            <button
              onClick={() => { setCurrentView('settings'); setIsSidebarOpen(false); }}
              className="btn btn-outline"
              style={{ justifyContent: 'flex-start', ...(currentView === 'settings' ? { borderColor: 'var(--border-color-focus)', backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-main)' } : {}) }}
            >
              <Settings size={18} /> Configuración del Curso
            </button>
          )}
          {courseRole === 'superadmin' && (
            <>
              <button
                onClick={() => { setCurrentView('admins'); setIsSidebarOpen(false); }}
                className="btn btn-outline"
                style={{ justifyContent: 'flex-start', ...(currentView === 'admins' ? { borderColor: 'var(--border-color-focus)', backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-main)' } : {}) }}
              >
                <Users size={18} /> Admins
              </button>
              <button
                onClick={() => { setCurrentView('users'); setIsSidebarOpen(false); }}
                className="btn btn-outline"
                style={{ justifyContent: 'flex-start', ...(currentView === 'users' ? { borderColor: 'var(--border-color-focus)', backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-main)' } : {}) }}
              >
                <Users size={18} /> Usuarios
              </button>
              <button
                onClick={() => { setCurrentView('courses'); setIsSidebarOpen(false); }}
                className="btn btn-outline"
                style={{ justifyContent: 'flex-start', ...(currentView === 'courses' ? { borderColor: 'var(--border-color-focus)', backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-main)' } : {}) }}
              >
                <Activity size={18} /> Cursos
              </button>
            </>
          )}

          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
            <button
              onClick={handleLogout}
              className="btn btn-outline"
              style={{ justifyContent: 'flex-start', width: '100%', color: 'var(--danger)', borderColor: 'var(--border-color)' }}
            >
              <LogOut size={18} /> Cerrar Sesión
            </button>
          </div>
        </div>
      </div>

      <div className="container animate-fade-in">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button onClick={() => setIsSidebarOpen(true)} className="hamburger-btn">
              <Menu size={24} />
            </button>
            <img
              src="/LOGOAPPCURSO.jpg"
              alt="Logo"
              style={{ width: '75px', height: '75px', borderRadius: '8px', objectFit: 'cover', backgroundColor: 'white', padding: 0, border: '1px solid rgba(255,255,255,0.1)' }}
              onError={(e) => e.target.style.display = 'none'}
            />
            <div>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                Panel {role === 'superadmin' ? 'SuperAdmin' : 'Admin'}
              </h2>
              {courses.length > 1 || role === 'superadmin' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                  <select
                    value={selectedCourse?.id || ''}
                    onChange={(e) => changeCourse(e.target.value)}
                    style={{
                      padding: '0.2rem 0.5rem',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      color: 'var(--text-main)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      fontSize: '0.9rem'
                    }}
                  >
                    {courses.map(c => (
                      <option key={c.id} value={c.id} style={{ color: '#000' }}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>{selectedCourse?.name || 'Cargando curso...'}</p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {['superadmin', 'admin', 'presidente', 'tesorero'].includes(courseRole) && (
              <>
                {/* Barra de búsqueda interactiva */}
                <div
                  onClick={() => setIsSearchOpen(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.55rem 1rem',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    transition: 'all 0.15s ease',
                    minWidth: '240px'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                    e.currentTarget.style.borderColor = 'var(--border-color-focus)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                  }}
                >
                  <Search size={17} style={{ color: 'var(--primary)' }} />
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-main)', opacity: 0.8 }}>Buscar alumno o apoderado...</span>
                </div>

                <button onClick={() => setCurrentView('meeting_report')} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }} title="Generar informe y PDF para la reunión de apoderados">
                  <FileText size={17} />
                  Reunión Apoderados
                </button>
                <button onClick={() => navigate('/apoderado')} className="btn btn-outline" title="Ver cómo se ve la app para un apoderado">
                  Vista Apoderado
                </button>
              </>
            )}
            <button onClick={() => window.location.reload()} className="btn btn-outline" title="Forzar recarga de la página">
              <RefreshCw size={18} />
              Actualizar
            </button>
            <InstallAppGuide />
          </div>
        </header>

        {currentView === 'dashboard' ? (
          <>
            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando datos...</div>
            ) : (
              <>
                {stats.pendingApprovalsCount > 0 && (
                  <div
                    className="glass-panel"
                    style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid var(--warning)', padding: '1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', cursor: 'pointer', transition: 'all 0.2s ease' }}
                    onClick={() => setCurrentView('approvals')}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: 'var(--warning)' }}>
                      <AlertTriangle size={24} />
                      <div>
                        <h4 style={{ margin: 0, fontWeight: 'bold' }}>¡Atención requerida!</h4>
                        <p style={{ margin: 0, fontSize: '0.9rem' }}>Tienes {stats.pendingApprovalsCount} {stats.pendingApprovalsCount === 1 ? 'comprobante de pago pendiente' : 'comprobantes de pago pendientes'} de revisión.</p>
                      </div>
                    </div>
                    <button className="btn btn-primary" style={{ backgroundColor: 'var(--warning)', borderColor: 'var(--warning)', color: '#000', whiteSpace: 'nowrap' }}>
                      Revisar ahora
                    </button>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                  <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ width: '42px', height: '42px', minWidth: '42px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--primary)' }}>
                      <Users size={22} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{stats.activeStudents}</h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Alumnos Activos</p>
                    </div>
                  </div>

                  <div
                    className="glass-panel"
                    style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'all 0.2s ease' }}
                    onClick={() => setIsNoApoderadosModalOpen(true)}
                    title="Ver lista de alumnos sin apoderado"
                  >
                    <div style={{ width: '42px', height: '42px', minWidth: '42px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                      <Users size={22} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{stats.studentsWithApoderados}</h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Alumnos con Apoderados</p>
                    </div>
                  </div>

                  {role === 'superadmin' && (
                    <div
                      className="glass-panel"
                      style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'all 0.2s ease' }}
                      onClick={() => setIsApoderadosModalOpen(true)}
                      title="Ver lista de apoderados registrados"
                    >
                      <div style={{ width: '42px', height: '42px', minWidth: '42px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                        <Users size={22} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{stats.registeredApoderados}</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Apoderados Registrados</p>
                      </div>
                    </div>
                  )}

                  <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', gridColumn: '1 / -1' }}>
                    <div style={{ width: '48px', height: '48px', minWidth: '48px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--primary)' }}>
                      <FileText size={26} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '2rem', margin: 0, fontWeight: '700' }}>{formatMoney(stats.totalAvailable)}</h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>Fondo Total Disponible (Suma de todos los fondos)</p>
                    </div>
                  </div>

                  <div
                    className="glass-panel"
                    onClick={() => setSelectedFundForHistory({ id: 'cash_history', name: 'Historial de Efectivo (Caja)', balance: stats.cashBalance || 0 })}
                    style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  >
                    <div style={{ width: '42px', height: '42px', minWidth: '42px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                      <DollarSign size={22} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{formatMoney(stats.cashBalance || 0)}</h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>En Efectivo (Caja)</p>
                    </div>
                  </div>

                  <div
                    className="glass-panel"
                    onClick={() => setSelectedFundForHistory({ id: 'transfer_history', name: 'Historial de Banco (Transferencias)', balance: stats.transferBalance || 0 })}
                    style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  >
                    <div style={{ width: '42px', height: '42px', minWidth: '42px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                      <CreditCard size={22} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{formatMoney(stats.transferBalance || 0)}</h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>En Banco (Transferencias)</p>
                    </div>
                  </div>

                  <div
                    className="glass-panel"
                    onClick={handleUpdateRealBankBalance}
                    style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'all 0.2s ease' }}
                    title="Haz clic para actualizar tu saldo real del banco"
                  >
                    <div style={{ width: '42px', height: '42px', minWidth: '42px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                      <CreditCard size={22} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{formatMoney(stats.realBankBalance)}</h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Dinero Real (Banco)</p>
                    </div>
                  </div>

                  <div
                    className="glass-panel"
                    style={{
                      padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem',
                      border: stats.realBankBalance - (stats.transferBalance || 0) === 0 ? '1px solid var(--border-color)' : '1px solid var(--warning)'
                    }}
                  >
                    <div style={{
                      width: '42px', height: '42px', minWidth: '42px', borderRadius: 'var(--radius-sm)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)',
                      color: stats.realBankBalance - (stats.transferBalance || 0) === 0 ? 'var(--success)' : 'var(--warning)'
                    }}>
                      <Activity size={22} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.5rem', margin: 0 }}>
                        {formatMoney(stats.realBankBalance - (stats.transferBalance || 0))}
                      </h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Diferencia a Cuadrar</p>
                    </div>
                  </div>
                </div>

                {stats.fundsBalances.length > 0 && (
                  <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
                    <h4 style={{ marginBottom: '1rem', color: 'var(--primary)', margin: 0 }}>Distribución por Fondos</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                      {stats.fundsBalances.map(fb => (
                        <div
                          key={fb.id}
                          style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', position: 'relative', cursor: 'pointer', transition: 'all 0.2s' }}
                          onClick={() => setSelectedFundForHistory(fb)}
                          className="fund-card-hover"
                        >
                          {fb.id === 'general' && fb.balance !== 0 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleZeroOutFund(fb.id, fb.name, fb.balance); }}
                              style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.7 }}
                              title="Borrar fondo (ajustar a $0)"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0 0 0.5rem 0', paddingRight: '1.5rem' }}>{fb.name}</p>
                          <h4 style={{ margin: 0 }}>{formatMoney(fb.balance)}</h4>
                        </div>
                      ))}
                    </div>
                  </div>
                )}



                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem' }}>
                  <div className="glass-panel" style={{ padding: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                      <h3 style={{ margin: 0 }}>Últimas Cuotas Emitidas</h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <button
                          onClick={() => setIsCuotaReportOpen(true)}
                          className="btn btn-outline"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            padding: '0.35rem 0.75rem',
                            fontSize: '0.85rem'
                          }}
                          title="Descargar reporte de cuotas en PDF (Estilo Excel)"
                        >
                          <Download size={15} /> Reporte PDF
                        </button>
                        {expenses.length > 5 && (
                          <button
                            onClick={() => setShowAllExpenses(!showAllExpenses)}
                            style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: '500', textDecoration: 'underline', padding: 0 }}
                          >
                            {showAllExpenses ? "Ver menos" : "Ver todas"}
                          </button>
                        )}
                      </div>
                    </div>
                    {expenses.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>No hay cuotas emitidas todavía.</p>
                    ) : (
                      <div style={{ display: 'grid', gap: '1rem' }}>
                        {[...expenses]
                          .sort((a, b) => (a.paidCount >= a.studentsCount) - (b.paidCount >= b.studentsCount))
                          .slice(0, showAllExpenses ? expenses.length : 5)
                          .map(exp => (
                            <div
                              key={exp.id}
                              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'all 0.2s' }}
                              onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
                              onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
                              onClick={() => {
                                setSelectedExpenseId(exp.id);
                                setCurrentView('expense_detail');
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div style={{ width: '40px', height: '40px', minWidth: '40px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--primary)' }}>
                                  <FileText size={18} />
                                </div>
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <h4 style={{ margin: 0 }}>{exp.title}</h4>
                                    {exp.visibleInPortal === false && (
                                      <span style={{
                                        fontSize: '0.7rem',
                                        padding: '0.1rem 0.4rem',
                                        borderRadius: '4px',
                                        backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                        color: '#f87171',
                                        border: '1px solid rgba(239, 68, 68, 0.3)',
                                        fontWeight: '600'
                                      }}>
                                        Oculta en Portal
                                      </span>
                                    )}
                                  </div>
                                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>Emitido: {exp.date} • {exp.studentsCount} Alumnos</p>
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <p style={{ fontWeight: 'bold', margin: 0, color: 'var(--success)' }}>{formatMoney(exp.collectedAmount || 0)}</p>
                                <p style={{ fontSize: '0.85rem', color: exp.paidCount === exp.studentsCount ? 'var(--success)' : 'var(--warning)', margin: 0 }}>
                                  {exp.paidCount || 0} de {exp.studentsCount} pagadas
                                </p>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  <div className="glass-panel" style={{ padding: '2rem' }}>
                    <h3 style={{ marginBottom: '1.5rem' }}>Últimos Movimientos</h3>
                    {stats.allTransactions.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>No hay movimientos recientes.</p>
                    ) : (
                      <div style={{ display: 'grid', gap: '1rem' }}>
                        {[...stats.allTransactions]
                          .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
                          .slice(0, 6)
                          .map(t => {
                            const isIncome = t.amount > 0;
                            const isTransfer = t.type === 'transfer_in' || t.type === 'transfer_out';
                            return (
                              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                  <div style={{
                                    width: '36px',
                                    height: '36px',
                                    minWidth: '36px',
                                    borderRadius: 'var(--radius-sm)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: 'var(--bg-card-hover)',
                                    border: '1px solid var(--border-color)',
                                    color: isTransfer ? 'var(--primary)' : (isIncome ? 'var(--success)' : 'var(--danger)')
                                  }}>
                                    {isTransfer ? <ArrowRightLeft size={16} /> : (isIncome ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />)}
                                  </div>
                                  <div>
                                    <p style={{ margin: 0, fontWeight: '500', fontSize: '0.9rem' }}>{t.description}</p>
                                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                      {new Date(t.date).toLocaleDateString()} • {t.paymentMethod === 'cash' ? 'Efectivo' : t.paymentMethod === 'transfer' ? 'Transferencia' : t.paymentMethod === 'balance' ? 'Saldo' : 'Otro'}
                                    </p>
                                  </div>
                                </div>
                                <span style={{ fontWeight: 'bold', color: isTransfer ? '#3b82f6' : (isIncome ? 'var(--success)' : 'var(--danger)') }}>
                                  {isIncome ? '+' : ''}{formatMoney(t.amount)}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        ) : currentView === 'courses' ? (
          <CourseManagement onBack={() => setCurrentView('dashboard')} />
        ) : currentView === 'users' ? (
          <UserManagement viewMode="users" onBack={() => setCurrentView('dashboard')} />
        ) : currentView === 'admins' ? (
          <UserManagement viewMode="admins" onBack={() => setCurrentView('dashboard')} />
        ) : currentView === 'students' ? (
          <StudentManagement onBack={() => setCurrentView('dashboard')} />
        ) : currentView === 'expenses_add' ? (
          <ExpenseManagement onBack={() => setCurrentView('dashboard')} />
        ) : currentView === 'debtors' ? (
          <DebtorsManagement onBack={() => setCurrentView('dashboard')} />
        ) : currentView === 'outcomes' ? (
          <OutcomeManagement onBack={() => setCurrentView('dashboard')} />
        ) : currentView === 'funds' ? (
          <FundManagement onBack={() => setCurrentView('dashboard')} />
        ) : currentView === 'events' ? (
          <EventManagement onBack={() => setCurrentView('dashboard')} />
        ) : currentView === 'settings' ? (
          <SettingsManagement onBack={() => setCurrentView('dashboard')} />
        ) : currentView === 'meeting_report' ? (
          <MeetingReport onBack={() => setCurrentView('dashboard')} />
        ) : currentView === 'approvals' ? (
          <ApprovalsManagement onBack={() => setCurrentView('dashboard')} />
        ) : currentView === 'expense_detail' && selectedExpenseId ? (
          <ExpenseDetail expenseId={selectedExpenseId} onBack={() => setCurrentView('dashboard')} />
        ) : null}

      </div>

      {/* Modals are rendered outside the container to avoid positioning issues with transform/animations */}
      {selectedFundForHistory && (
        <FundHistoryModal
          fund={selectedFundForHistory}
          transactions={stats.allTransactions}
          onClose={() => setSelectedFundForHistory(null)}
          onRefresh={fetchDashboardData}
        />
      )}

      <RegisteredApoderadosModal
        isOpen={isApoderadosModalOpen}
        onClose={() => setIsApoderadosModalOpen(false)}
        apoderados={stats.registeredApoderadosList || []}
      />

      <StudentsWithoutApoderadosModal
        isOpen={isNoApoderadosModalOpen}
        onClose={() => setIsNoApoderadosModalOpen(false)}
        students={stats.studentsWithoutApoderadosList || []}
      />

      {isSearchOpen && (
        <StudentSearchModal
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
        />
      )}

      <CuotaReportModal
        isOpen={isCuotaReportOpen}
        onClose={() => setIsCuotaReportOpen(false)}
        selectedCourse={selectedCourse}
        preloadedExpenses={expenses}
      />

      {/* Liquid Bottom Navigation */}
      <nav className="bottom-nav">
        {(() => {
          const navItems = [];
          if (['superadmin', 'admin', 'presidente', 'tesorero'].includes(courseRole)) {
            navItems.push({ id: 'expenses_add', icon: PlusCircle, label: 'Crear Cuota' });
            navItems.push({ id: 'debtors', icon: AlertTriangle, label: 'Deudas' });
          }
          if (['superadmin', 'admin', 'presidente'].includes(courseRole)) {
            navItems.push({ id: 'students', icon: Users, label: 'Alumnos' });
            navItems.push({ id: 'settings', icon: Settings, label: 'Config' });
          }

          const activeIndex = navItems.findIndex(item => item.id === currentView);

          const widthPercent = 100 / navItems.length;
          const indicatorStyle = {
            left: activeIndex >= 0 ? `calc(${activeIndex * widthPercent}% + ${widthPercent / 2}% - 25px)` : '-100px'
          };

          return (
            <>
              <div className="liquid-indicator" style={indicatorStyle}></div>
              {navItems.map((item) => (
                <button
                  key={item.id}
                  className={`bottom-nav-item ${currentView === item.id ? 'active' : ''}`}
                  onClick={() => setCurrentView(item.id)}
                >
                  <item.icon size={22} className="nav-icon" />
                  <span className="nav-text">{item.label}</span>
                </button>
              ))}
            </>
          );
        })()}
      </nav>
    </>
  );
};

export default AdminDashboard;
