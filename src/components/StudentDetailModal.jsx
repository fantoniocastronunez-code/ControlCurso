import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, getDocs, doc, updateDoc, addDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { 
  X, User, AlertCircle, CheckCircle, Clock, Download, 
  Sparkles, Eye, FileText, AlertTriangle, Receipt, MinusCircle,
  Edit2, RotateCcw, XCircle, Check
} from 'lucide-react';
import { formatStudentName } from '../utils/nameUtils';
import { useModal } from '../context/ModalContext';
import { useAuth } from '../context/AuthContext';
import { useCourse } from '../context/CourseContext';
import { requestApproval } from '../services/approvalService';
import html2canvas from 'html2canvas';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import DiscountBalanceModal from './DiscountBalanceModal';

const formatDebtMoney = (amount) => {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
};

export const filterAndSortStudentDebts = (fetchedDebts) => {
  const sorted = [...fetchedDebts].sort((a, b) => {
    const order = { pending: 1, partial: 2, review: 3, paid: 4 };
    const orderA = order[a.status] || 5;
    const orderB = order[b.status] || 5;
    if (orderA !== orderB) return orderA - orderB;
    return new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0);
  });

  // Hide 'partial' debts ONLY if a '(Saldo Restante)' debt was manually created for THIS SPECIFIC debt title
  return sorted.filter(d => {
    const baseTitle = (d.title || '').replace('(Saldo Restante)', '').trim();

    if (d.status === 'partial') {
      const hasSpecificSaldoRestante = sorted.some(other =>
        (other.title || '').includes('(Saldo Restante)') && (other.title || '').includes(baseTitle)
      );
      if (hasSpecificSaldoRestante) return false;
    }

    if ((d.title || '').includes('(Saldo Restante)')) {
      const originalIsPaid = sorted.some(other =>
        (other.title || '').trim() === baseTitle && other.status === 'paid'
      );
      if (originalIsPaid) return false;
    }

    return true;
  });
};

export const syncExpenseStats = async (expenseId) => {
  if (!expenseId) return;
  try {
    const q = query(collection(db, 'debts'), where('expenseId', '==', expenseId));
    const snap = await getDocs(q);
    const updatedFullyPaidCount = snap.docs.filter(d => d.data().status === 'paid').length;
    const updatedTotalAmount = snap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0);

    const expenseRef = doc(db, 'expenses', expenseId);
    const expSnap = await getDoc(expenseRef);
    if (expSnap.exists()) {
      const expUpdates = { paidCount: updatedFullyPaidCount };
      if (expSnap.data().calculationMode !== 'divide' && updatedTotalAmount > 0) {
        expUpdates.totalAmount = updatedTotalAmount;
      }
      await updateDoc(expenseRef, expUpdates);
    }
  } catch (err) {
    console.warn("No se pudo sincronizar estadísticas de la cuota:", err);
  }
};

export const getRequiresApprovalForStudent = ({ role, userData, student, selectedCourse }) => {
  const effectiveCourseIdForRole = student?.courseId || selectedCourse?.id;
  const courseRole = (role === 'superadmin' || userData?.roles?.global === 'superadmin')
    ? 'superadmin'
    : (userData?.roles?.[effectiveCourseIdForRole] || null);
  return courseRole !== 'tesorero' && courseRole !== 'superadmin';
};

const getEffectivePrevPaid = (debt) => {
  if (debt.status === 'review') {
    if (debt.previousPaidAmount !== undefined && debt.previousPaidAmount !== null) {
      return Number(debt.previousPaidAmount) || 0;
    }
    if (debt.lastPaymentAmount !== undefined && debt.lastPaymentAmount !== null) {
      return Math.max(0, (Number(debt.paidAmount) || 0) - (Number(debt.lastPaymentAmount) || 0));
    }
    return 0;
  }
  return Number(debt.paidAmount) || 0;
};

export const executeMarkDebtPaid = async ({
  debt, student, method, isApproval = false, requiresApproval, user, selectedCourse, showPrompt, showAlert
}) => {
  let targetDebtAmount = Number(debt.amount) || 0;
  if (!isApproval && targetDebtAmount <= 0) {
    const promptAmtStr = await showPrompt("Este alumno tiene un monto a cobrar de $0. Ingresa el monto de la cuota ($) para registrar su pago:", "");
    if (promptAmtStr === null) return { updated: false };
    const parsedAmt = parseFloat(promptAmtStr);
    if (isNaN(parsedAmt) || parsedAmt <= 0) {
      await showAlert("Debes ingresar un monto válido mayor a $0.");
      return { updated: false };
    }
    targetDebtAmount = parsedAmt;
  }

  let finalTotalPaid = 0;
  let exactPaidNow = 0;

  if (isApproval) {
    const suggestedAmount = Number(debt.paidAmount) || targetDebtAmount;
    finalTotalPaid = suggestedAmount;
    exactPaidNow = Number(debt.lastPaymentAmount) || suggestedAmount;
  } else {
    const currentPaid = getEffectivePrevPaid(debt);
    const remaining = targetDebtAmount - currentPaid;
    exactPaidNow = remaining > 0 ? remaining : targetDebtAmount;
    finalTotalPaid = currentPaid + exactPaidNow;
  }

  let newStatus = 'pending';
  if (targetDebtAmount > 0 && finalTotalPaid >= targetDebtAmount) newStatus = 'paid';
  else if (finalTotalPaid > 0) newStatus = 'partial';

  const effectiveCourseId = debt.courseId || student?.courseId || selectedCourse?.id || '';
  const effectiveFundId = debt.fundId || 'general';
  const studentDisplayName = debt.studentName || student?.name || formatStudentName(student);

  if (requiresApproval) {
    let expensePaidCount;
    if (debt.expenseId) {
      const snap = await getDocs(query(collection(db, 'debts'), where('expenseId', '==', debt.expenseId)));
      const currentPaidCount = snap.docs.filter(d => d.data().status === 'paid').length;
      expensePaidCount = currentPaidCount + (newStatus === 'paid' && debt.status !== 'paid' ? 1 : 0);
    }
    const payload = {
      ...(debt.expenseId ? { expenseId: debt.expenseId, expensePaidCount } : {}),
      debtsToUpdate: [{
        debtId: debt.id,
        amountToLog: exactPaidNow,
        updates: {
          amount: targetDebtAmount,
          status: newStatus,
          paidAmount: finalTotalPaid,
          paymentMethod: method,
          courseId: effectiveCourseId,
          fundId: effectiveFundId,
          studentName: studentDisplayName,
          title: debt.title || 'Cuota'
        }
      }]
    };
    await requestApproval('REGISTER_PAYMENTS', `Pago: ${studentDisplayName} (${formatDebtMoney(finalTotalPaid)})`, payload, user, effectiveCourseId);
    await showAlert('Solicitud de pago enviada a la tesorera.');
    return { updated: true };
  }

  const approvedAtIso = new Date().toISOString();
  await updateDoc(doc(db, 'debts', debt.id), {
    amount: targetDebtAmount,
    status: newStatus,
    paidAmount: finalTotalPaid,
    paymentMethod: method,
    courseId: effectiveCourseId,
    fundId: effectiveFundId,
    approvedAt: approvedAtIso
  });

  if (exactPaidNow > 0) {
    await addDoc(collection(db, 'payments'), {
      debtId: debt.id,
      courseId: effectiveCourseId,
      fundId: effectiveFundId,
      amount: exactPaidNow,
      paymentMethod: method,
      studentName: studentDisplayName,
      title: debt.title || 'Cuota',
      status: newStatus,
      createdAt: approvedAtIso
    });
  }

  await syncExpenseStats(debt.expenseId);
  return { updated: true };
};

export const executePayAllPending = async ({
  debts, student, method, requiresApproval, user, selectedCourse, showConfirm, showAlert
}) => {
  const rawPendings = debts.filter(d => d.status === 'pending' || d.status === 'partial');
  if (rawPendings.length === 0) return { updated: false };

  const targets = rawPendings.filter(d => (Number(d.amount) || 0) > 0);
  if (targets.length === 0) {
    await showAlert("Las cuotas pendientes tienen monto $0. Ingresa el monto pagando cada cuota individualmente.");
    return { updated: false };
  }

  const totalToPay = targets.reduce((sum, d) => sum + Math.max(0, (Number(d.amount) || 0) - (Number(d.paidAmount) || 0)), 0);
  const methodLabel = method === 'cash' ? 'Efectivo' : 'Transferencia';
  if (!(await showConfirm(`¿Marcar como pagadas ${targets.length} cuota(s) de ${formatStudentName(student)} por ${formatDebtMoney(totalToPay)} en ${methodLabel}?`))) {
    return { updated: false };
  }

  const effectiveCourseIdDefault = student?.courseId || selectedCourse?.id || '';
  const studentDisplayName = student?.name || formatStudentName(student);

  if (requiresApproval) {
    const debtsToUpdate = targets.map(d => {
      const targetAmt = Number(d.amount) || 0;
      const currentPaid = Number(d.paidAmount) || 0;
      const remaining = Math.max(0, targetAmt - currentPaid);
      const finalPaid = currentPaid + remaining;
      return {
        debtId: d.id,
        amountToLog: remaining,
        updates: {
          amount: targetAmt,
          status: 'paid',
          paidAmount: finalPaid,
          paymentMethod: method,
          courseId: d.courseId || effectiveCourseIdDefault,
          fundId: d.fundId || 'general',
          studentName: d.studentName || studentDisplayName,
          title: d.title || 'Cuota'
        }
      };
    });
    const uniqueExpIds = [...new Set(targets.map(d => d.expenseId).filter(Boolean))];
    let extraExpensePayload = {};
    if (uniqueExpIds.length === 1) {
      const snap = await getDocs(query(collection(db, 'debts'), where('expenseId', '==', uniqueExpIds[0])));
      const alreadyPaid = snap.docs.filter(d => d.data().status === 'paid').length;
      extraExpensePayload = { expenseId: uniqueExpIds[0], expensePaidCount: alreadyPaid + targets.length };
    }
    await requestApproval(
      'REGISTER_PAYMENTS',
      `Pago masivo (${targets.length} cuotas) - ${studentDisplayName}`,
      { ...extraExpensePayload, debtsToUpdate },
      user,
      effectiveCourseIdDefault
    );
    await showAlert('Solicitud de pago enviada a la tesorera.');
    return { updated: true };
  }

  const approvedAtIso = new Date().toISOString();
  const expenseIdsToSync = new Set();

  for (const d of targets) {
    const targetAmt = Number(d.amount) || 0;
    const currentPaid = Number(d.paidAmount) || 0;
    const remaining = Math.max(0, targetAmt - currentPaid);
    const finalPaid = currentPaid + remaining;
    const effectiveCourseId = d.courseId || effectiveCourseIdDefault;
    const effectiveFundId = d.fundId || 'general';

    await updateDoc(doc(db, 'debts', d.id), {
      amount: targetAmt,
      status: 'paid',
      paidAmount: finalPaid,
      paymentMethod: method,
      courseId: effectiveCourseId,
      fundId: effectiveFundId,
      approvedAt: approvedAtIso
    });

    if (remaining > 0) {
      await addDoc(collection(db, 'payments'), {
        debtId: d.id,
        courseId: effectiveCourseId,
        fundId: effectiveFundId,
        amount: remaining,
        paymentMethod: method,
        studentName: d.studentName || studentDisplayName,
        title: d.title || 'Cuota',
        status: 'paid',
        createdAt: approvedAtIso
      });
    }

    if (d.expenseId) expenseIdsToSync.add(d.expenseId);
  }

  await Promise.all([...expenseIdsToSync].map(id => syncExpenseStats(id)));
  await showAlert(`¡Se marcaron ${targets.length} cuota(s) como pagadas en ${methodLabel}!`);
  return { updated: true };
};

export const executeRejectReviewDebt = async ({ debt, showConfirm, showAlert }) => {
  if (!(await showConfirm('¿Seguro que deseas rechazar este comprobante? El apoderado tendrá que subir uno nuevo.'))) {
    return { updated: false };
  }
  const previousValidPaidAmount = getEffectivePrevPaid(debt);
  await updateDoc(doc(db, 'debts', debt.id), {
    status: previousValidPaidAmount > 0 ? 'partial' : 'pending',
    receiptUrl: null,
    paidAmount: previousValidPaidAmount
  });
  await syncExpenseStats(debt.expenseId);
  await showAlert('Comprobante rechazado.');
  return { updated: true };
};

export const executeEditDebtAmount = async ({ debt, student, selectedCourse, showPrompt, showAlert }) => {
  const newAmountStr = await showPrompt(`Ingresa el NUEVO Monto a Cobrar ($) para la cuota "${debt.title}":`, debt.amount || 0);
  if (newAmountStr === null) return { updated: false };

  const newAmount = parseFloat(newAmountStr);
  if (isNaN(newAmount) || newAmount <= 0) {
    await showAlert("Monto inválido.");
    return { updated: false };
  }

  const effectiveCourseId = debt.courseId || student?.courseId || selectedCourse?.id || '';
  const effectiveFundId = debt.fundId || 'general';
  const wasPaidWithZero = debt.status === 'paid' && (!debt.paidAmount || debt.paidAmount <= 0);
  let balanceToDeductOnEdit = 0;
  let newStudentBalance = null;

  if (wasPaidWithZero && debt.paymentMethod === 'balance' && student?.id) {
    const freshSnap = await getDoc(doc(db, 'students', student.id));
    const currentBal = freshSnap.exists() ? (Number(freshSnap.data().balance) || 0) : (Number(student.balance) || 0);
    if (currentBal > 0) {
      balanceToDeductOnEdit = Math.min(currentBal, newAmount);
      newStudentBalance = Math.max(0, currentBal - balanceToDeductOnEdit);
    }
  }

  const updatedPaidAmount = wasPaidWithZero
    ? (debt.paymentMethod === 'balance' && balanceToDeductOnEdit > 0 ? balanceToDeductOnEdit : newAmount)
    : (Number(debt.paidAmount) || 0);

  let newStatus = debt.status;
  if (wasPaidWithZero || updatedPaidAmount > 0) {
    newStatus = updatedPaidAmount >= newAmount ? 'paid' : 'partial';
  } else if (debt.status !== 'review') {
    newStatus = 'pending';
  }

  const effectiveMethod = updatedPaidAmount > 0 ? (debt.paymentMethod || 'transfer') : null;
  const effectiveApprovedAt = updatedPaidAmount > 0 ? (debt.approvedAt || new Date().toISOString()) : null;

  await updateDoc(doc(db, 'debts', debt.id), {
    amount: newAmount,
    paidAmount: updatedPaidAmount,
    status: newStatus,
    paymentMethod: effectiveMethod,
    approvedAt: effectiveApprovedAt,
    courseId: effectiveCourseId,
    fundId: effectiveFundId
  });

  if (newStudentBalance !== null && student?.id) {
    await updateDoc(doc(db, 'students', student.id), { balance: newStudentBalance });
  }

  if (wasPaidWithZero && updatedPaidAmount > 0) {
    const paymentsSnap = await getDocs(query(collection(db, 'payments'), where('debtId', '==', debt.id)));
    for (const pDoc of paymentsSnap.docs) {
      await deleteDoc(doc(db, 'payments', pDoc.id));
    }
    await addDoc(collection(db, 'payments'), {
      debtId: debt.id,
      courseId: effectiveCourseId,
      fundId: effectiveFundId,
      amount: updatedPaidAmount,
      paymentMethod: effectiveMethod,
      studentName: debt.studentName || student?.name || formatStudentName(student),
      title: debt.title || 'Cuota',
      status: newStatus,
      createdAt: effectiveApprovedAt
    });
  }

  await syncExpenseStats(debt.expenseId);
  return { updated: true, ...(newStudentBalance !== null ? { newBalance: newStudentBalance } : {}) };
};

export const executeEditPaidAmount = async ({ debt, student, selectedCourse, showPrompt, showAlert }) => {
  const currentEffectivePaid = getEffectivePrevPaid(debt);
  const newAmountStr = await showPrompt(
    `Ingresa el Monto Pagado / Abonado ($) para "${debt.title}" (Total cuota: ${formatDebtMoney(debt.amount)}):`,
    currentEffectivePaid
  );
  if (newAmountStr === null) return { updated: false };

  const newAmount = parseFloat(newAmountStr);
  if (isNaN(newAmount) || newAmount < 0) {
    await showAlert("Monto inválido.");
    return { updated: false };
  }

  const effectiveCourseId = debt.courseId || student?.courseId || selectedCourse?.id || '';
  const effectiveFundId = debt.fundId || 'general';
  const existingAmount = Number(debt.amount) || 0;
  const updatedDebtAmount = existingAmount > 0 ? existingAmount : (newAmount > 0 ? newAmount : 0);

  let newStatus = 'pending';
  if (newAmount > 0 && updatedDebtAmount > 0 && newAmount >= updatedDebtAmount) newStatus = 'paid';
  else if (newAmount > 0) newStatus = 'partial';

  const effectiveMethod = newAmount > 0 ? (debt.paymentMethod || 'transfer') : null;
  const effectiveApprovedAt = newAmount > 0 ? (debt.approvedAt || new Date().toISOString()) : null;

  await updateDoc(doc(db, 'debts', debt.id), {
    amount: updatedDebtAmount,
    paidAmount: newAmount,
    status: newStatus,
    paymentMethod: effectiveMethod,
    approvedAt: effectiveApprovedAt,
    courseId: effectiveCourseId,
    fundId: effectiveFundId
  });

  const paymentsSnap = await getDocs(query(collection(db, 'payments'), where('debtId', '==', debt.id)));
  for (const pDoc of paymentsSnap.docs) {
    await deleteDoc(doc(db, 'payments', pDoc.id));
  }

  if (newAmount > 0) {
    await addDoc(collection(db, 'payments'), {
      debtId: debt.id,
      courseId: effectiveCourseId,
      fundId: effectiveFundId,
      amount: newAmount,
      paymentMethod: effectiveMethod,
      studentName: debt.studentName || student?.name || formatStudentName(student),
      title: debt.title || 'Cuota',
      status: newStatus,
      createdAt: effectiveApprovedAt
    });
  }

  await syncExpenseStats(debt.expenseId);
  return { updated: true };
};

export const executeTogglePaymentMethod = async ({ debt, showAlert }) => {
  if (debt.paymentMethod === 'balance') {
    await showAlert("Esta cuota fue pagada con Saldo a Favor. Si deseas cambiar el medio de pago, primero cancela el pago para devolver el saldo.");
    return { updated: false };
  }
  const nextMethod = debt.paymentMethod === 'cash' ? 'transfer' : 'cash';
  await updateDoc(doc(db, 'debts', debt.id), { paymentMethod: nextMethod });

  const paymentsSnap = await getDocs(query(collection(db, 'payments'), where('debtId', '==', debt.id)));
  for (const pDoc of paymentsSnap.docs) {
    await updateDoc(doc(db, 'payments', pDoc.id), { paymentMethod: nextMethod });
  }
  return { updated: true };
};

export const executeCancelPayment = async ({ debt, student, showConfirm }) => {
  if (!(await showConfirm(`¿Estás seguro de que deseas cancelar el pago de "${debt.title}"? El registro volverá a estar Pendiente.`))) {
    return { updated: false };
  }

  await updateDoc(doc(db, 'debts', debt.id), {
    status: 'pending',
    paidAmount: 0,
    paymentMethod: null,
    receiptUrl: null,
    approvedAt: null
  });

  const paymentsSnap = await getDocs(query(collection(db, 'payments'), where('debtId', '==', debt.id)));
  let balanceRefund = 0;
  for (const pDoc of paymentsSnap.docs) {
    const pData = pDoc.data();
    if (pData.paymentMethod === 'balance' && Number(pData.amount) > 0) {
      balanceRefund += Number(pData.amount);
    }
    await deleteDoc(doc(db, 'payments', pDoc.id));
  }

  if (balanceRefund === 0 && debt.paymentMethod === 'balance' && Number(debt.paidAmount) > 0) {
    balanceRefund = Number(debt.paidAmount);
  }

  let restoredBalance = null;
  if (balanceRefund > 0 && student?.id) {
    const studentRef = doc(db, 'students', student.id);
    const freshStudent = await getDoc(studentRef);
    const currentBal = freshStudent.exists() ? (Number(freshStudent.data().balance) || 0) : (Number(student.balance) || 0);
    restoredBalance = currentBal + balanceRefund;
    await updateDoc(studentRef, { balance: restoredBalance });
  }

  await syncExpenseStats(debt.expenseId);
  return { updated: true, ...(restoredBalance !== null ? { newBalance: restoredBalance } : {}) };
};

export const executePayDebtWithBalance = async ({ debt, student, selectedCourse, showConfirm, showAlert }) => {
  if (!student?.id) return { updated: false };
  const studentRef = doc(db, 'students', student.id);
  const freshSnap = await getDoc(studentRef);
  const currentBalance = freshSnap.exists() ? (Number(freshSnap.data().balance) || 0) : (Number(student.balance) || 0);

  if (currentBalance <= 0) {
    await showAlert("El alumno no tiene saldo a favor disponible.");
    return { updated: false };
  }

  const debtAmount = Number(debt.amount) || 0;
  if (debtAmount <= 0) {
    await showAlert("Esta cuota tiene monto $0. Primero modifica el monto a cobrar antes de aplicar saldo a favor.");
    return { updated: false };
  }

  const currentPaid = getEffectivePrevPaid(debt);
  const remaining = Math.max(0, debtAmount - currentPaid);
  if (remaining <= 0) return { updated: false };

  const amountToUse = Math.min(currentBalance, remaining);
  const newBalance = currentBalance - amountToUse;
  const newPaidAmount = currentPaid + amountToUse;
  const isFullyPaid = newPaidAmount >= debtAmount;

  if (!(await showConfirm(`¿Usar ${formatDebtMoney(amountToUse)} del saldo a favor de ${formatStudentName(student)} para la cuota "${debt.title}"? Le quedarán ${formatDebtMoney(newBalance)} a favor.`))) {
    return { updated: false };
  }

  const effectiveCourseId = debt.courseId || student.courseId || selectedCourse?.id || '';
  const effectiveFundId = debt.fundId || 'general';
  const approvedAtIso = new Date().toISOString();

  await updateDoc(doc(db, 'debts', debt.id), {
    status: isFullyPaid ? 'paid' : 'partial',
    paidAmount: newPaidAmount,
    paymentMethod: 'balance',
    courseId: effectiveCourseId,
    fundId: effectiveFundId,
    approvedAt: approvedAtIso
  });

  await addDoc(collection(db, 'payments'), {
    debtId: debt.id,
    courseId: effectiveCourseId,
    fundId: effectiveFundId,
    amount: amountToUse,
    paymentMethod: 'balance',
    studentName: debt.studentName || student.name || formatStudentName(student),
    title: debt.title || 'Cuota',
    status: isFullyPaid ? 'paid' : 'partial',
    createdAt: approvedAtIso
  });

  await updateDoc(studentRef, { balance: newBalance });
  await syncExpenseStats(debt.expenseId);
  await showAlert(`¡Se aplicó ${formatDebtMoney(amountToUse)} de saldo a favor exitosamente!`);
  return { updated: true, newBalance };
};

const StudentDetailModal = ({ student, usersMap = {}, onClose, isModal = false, onUpdate }) => {
  const { showAlert, showConfirm, showPrompt } = useModal();
  const { user, role, userData } = useAuth();
  const { selectedCourse } = useCourse();
  const requiresApproval = getRequiresApprovalForStudent({ role, userData, student, selectedCourse });

  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [previewReceipt, setPreviewReceipt] = useState(null);
  const [expensesEnabled, setExpensesEnabled] = useState(Boolean(student?.showExpensesInPortal));
  const [togglingExpenses, setTogglingExpenses] = useState(false);
  const [applyingBalance, setApplyingBalance] = useState(false);
  const [processingDebtId, setProcessingDebtId] = useState(null);
  const [studentBalance, setStudentBalance] = useState(Number(student?.balance) || 0);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const detailRef = useRef(null);

  useLockBodyScroll(isModal);

  useEffect(() => {
    setExpensesEnabled(Boolean(student?.showExpensesInPortal));
  }, [student?.showExpensesInPortal]);

  const handleToggleExpensesInPortal = async () => {
    if (!student?.id || togglingExpenses) return;
    setTogglingExpenses(true);
    try {
      const nextStatus = !expensesEnabled;
      await updateDoc(doc(db, 'students', student.id), {
        showExpensesInPortal: nextStatus
      });
      student.showExpensesInPortal = nextStatus;
      setExpensesEnabled(nextStatus);
      await showAlert(`Vista de gastos en portal ${nextStatus ? 'habilitada' : 'deshabilitada'} para este alumno.`);
    } catch (err) {
      console.error("Error toggling expenses view:", err);
      await showAlert("Error al cambiar la visualización de gastos.");
    } finally {
      setTogglingExpenses(false);
    }
  };

  const fetchDebts = useCallback(async () => {
    if (!student?.id) return;
    setLoading(true);
    try {
      const [snap, studentSnap] = await Promise.all([
        getDocs(query(collection(db, 'debts'), where('studentId', '==', student.id))),
        getDoc(doc(db, 'students', student.id))
      ]);
      const fetchedDebts = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      setDebts(filterAndSortStudentDebts(fetchedDebts));
      if (studentSnap.exists()) {
        setStudentBalance(Number(studentSnap.data().balance) || 0);
      }
    } catch (error) {
      console.error("Error fetching debts:", error);
    } finally {
      setLoading(false);
    }
  }, [student?.id]);

  useEffect(() => {
    fetchDebts();
  }, [fetchDebts]);

  const formatMoney = (amount) => formatDebtMoney(amount);

  const pendingDebts = debts.filter(d => d.status === 'pending' || d.status === 'review' || d.status === 'partial');
  const payablePendingDebts = pendingDebts.filter(d => d.status === 'pending' || d.status === 'partial');
  const paidDebts = debts.filter(d => d.status === 'paid');

  const runDebtAction = async (debtId, actionFn) => {
    if (processingDebtId) return;
    setProcessingDebtId(debtId);
    try {
      const result = await actionFn();
      if (result?.updated) {
        if (result.newBalance !== undefined) {
          setStudentBalance(result.newBalance);
        }
        await fetchDebts();
        onUpdate?.();
      }
    } catch (err) {
      console.error("Error procesando acción de cuota:", err);
      await showAlert("Ocurrió un error al procesar la operación.");
    } finally {
      setProcessingDebtId(null);
    }
  };

  const handleMarkDebtPaid = (debt, method, isApproval = false) =>
    runDebtAction(debt.id, () =>
      executeMarkDebtPaid({
        debt,
        student: { ...student, balance: studentBalance },
        method,
        isApproval,
        requiresApproval,
        user,
        selectedCourse,
        showPrompt,
        showAlert
      })
    );

  const handlePayAllPending = (method) =>
    runDebtAction('all', () =>
      executePayAllPending({
        debts,
        student: { ...student, balance: studentBalance },
        method,
        requiresApproval,
        user,
        selectedCourse,
        showConfirm,
        showAlert
      })
    );

  const handleRejectReviewDebt = (debt) =>
    runDebtAction(debt.id, () =>
      executeRejectReviewDebt({ debt, showConfirm, showAlert })
    );

  const handleEditDebtAmount = (debt) =>
    runDebtAction(debt.id, () =>
      executeEditDebtAmount({
        debt,
        student: { ...student, balance: studentBalance },
        selectedCourse,
        showPrompt,
        showAlert
      })
    );

  const handleEditPaidAmount = (debt) =>
    runDebtAction(debt.id, () =>
      executeEditPaidAmount({
        debt,
        student: { ...student, balance: studentBalance },
        selectedCourse,
        showPrompt,
        showAlert
      })
    );

  const handleTogglePaymentMethod = (debt) =>
    runDebtAction(debt.id, () =>
      executeTogglePaymentMethod({ debt, showAlert })
    );

  const handleCancelPayment = (debt) =>
    runDebtAction(debt.id, () =>
      executeCancelPayment({
        debt,
        student: { ...student, balance: studentBalance },
        showConfirm
      })
    );

  const handlePayDebtWithBalance = async (debt) => {
    if (applyingBalance || processingDebtId) return;
    setApplyingBalance(true);
    try {
      const result = await executePayDebtWithBalance({
        debt,
        student: { ...student, balance: studentBalance },
        selectedCourse,
        showConfirm,
        showAlert
      });
      if (result?.updated) {
        if (result.newBalance !== undefined) {
          setStudentBalance(result.newBalance);
        }
        await fetchDebts();
        onUpdate?.();
      }
    } catch (err) {
      console.error("Error al aplicar saldo a favor:", err);
      await showAlert("Error al registrar el pago con saldo a favor.");
    } finally {
      setApplyingBalance(false);
    }
  };

  const handleApplyBalanceToAllDebts = async () => {
    if (!student?.id || studentBalance <= 0) {
      await showAlert("El alumno no tiene saldo a favor disponible.");
      return;
    }

    const pendings = debts.filter(d => d.status === 'pending' || d.status === 'partial');
    if (pendings.length === 0) {
      await showAlert("El alumno no tiene cuotas pendientes.");
      return;
    }

    let currentBal = studentBalance;
    const plan = [];
    let totalDiscount = 0;

    for (const d of pendings) {
      if (currentBal <= 0) break;
      const currentPaid = d.paidAmount || 0;
      const remaining = Math.max(0, (d.amount || 0) - currentPaid);
      if (remaining <= 0) continue;

      const amountToUse = Math.min(currentBal, remaining);
      const newBal = currentBal - amountToUse;
      const newPaidAmount = currentPaid + amountToUse;
      const isFullyPaid = newPaidAmount >= d.amount;

      currentBal = newBal;
      totalDiscount += amountToUse;
      plan.push({ debt: d, amountToUse, newBalance: newBal, newPaidAmount, isFullyPaid });
    }

    if (plan.length === 0) {
      await showAlert("No hay saldo a favor disponible para aplicar a las cuotas pendientes.");
      return;
    }

    const confirmMsg = `¿Descontar ${formatMoney(totalDiscount)} del saldo a favor de ${formatStudentName(student)} para pagar ${plan.length} cuota(s) pendiente(s)? Le quedarán ${formatMoney(currentBal)} a favor.`;
    if (!(await showConfirm(confirmMsg))) return;

    setApplyingBalance(true);
    try {
      const expenseIdsToSync = new Set();
      for (const p of plan) {
        const effectiveCourseId = p.debt.courseId || student.courseId || selectedCourse?.id || '';
        const effectiveFundId = p.debt.fundId || 'general';
        const approvedAtIso = new Date().toISOString();

        await updateDoc(doc(db, 'debts', p.debt.id), {
          status: p.isFullyPaid ? 'paid' : 'partial',
          paidAmount: p.newPaidAmount,
          paymentMethod: 'balance',
          courseId: effectiveCourseId,
          fundId: effectiveFundId,
          approvedAt: approvedAtIso
        });

        await addDoc(collection(db, 'payments'), {
          debtId: p.debt.id,
          courseId: effectiveCourseId,
          fundId: effectiveFundId,
          amount: p.amountToUse,
          paymentMethod: 'balance',
          studentName: student.name,
          title: p.debt.title,
          status: p.isFullyPaid ? 'paid' : 'partial',
          createdAt: approvedAtIso
        });

        if (p.debt.expenseId) expenseIdsToSync.add(p.debt.expenseId);
      }

      await updateDoc(doc(db, 'students', student.id), {
        balance: currentBal
      });
      await Promise.all([...expenseIdsToSync].map(id => syncExpenseStats(id)));
      setStudentBalance(currentBal);

      await fetchDebts();
      onUpdate?.();
      await showAlert(`¡Se descontó ${formatMoney(totalDiscount)} de saldo a favor exitosamente!`);
    } catch (err) {
      console.error("Error al descontar saldos a favor:", err);
      await showAlert("Error al registrar los pagos con saldo a favor.");
    } finally {
      setApplyingBalance(false);
    }
  };

  // Calculations
  const totalPaid = debts.reduce((sum, d) => {
    if (d.status === 'paid') {
      return sum + ((typeof d.paidAmount === 'number' && d.paidAmount > 0) ? d.paidAmount : (d.amount || 0));
    }
    if (d.status === 'partial') {
      return sum + (d.paidAmount || 0);
    }
    return sum;
  }, 0);

  const totalPending = debts.reduce((sum, d) => {
    if (d.status === 'pending' || d.status === 'review') {
      return sum + (d.amount || 0);
    }
    if (d.status === 'partial') {
      return sum + Math.max(0, (d.amount || 0) - (d.paidAmount || 0));
    }
    return sum;
  }, 0);

  const emails = student.apoderadoEmails || (student.apoderadoEmail ? [student.apoderadoEmail] : []);

  const handleShare = async () => {
    setSharing(true);
    setIsCapturing(true);

    // Damos un breve tiempo para que React re-renderice quitando el scroll
    await new Promise(resolve => setTimeout(resolve, 60));

    try {
      if (!detailRef.current) return;
      
      // Ocultar botones temporalmente para la captura limpia
      const actionsDiv = document.getElementById(`actions-${student.id}`);
      if (actionsDiv) actionsDiv.style.display = 'none';

      const canvas = await html2canvas(detailRef.current, {
        backgroundColor: '#ffffff', // Fondo blanco limpio y formal (Opción A)
        scale: 2,
        useCORS: true,
        logging: false,
        windowHeight: detailRef.current.scrollHeight,
        onclone: (clonedDoc) => {
          const card = clonedDoc.getElementById(`student-detail-card-${student.id}`);
          if (card) {
            card.classList.add('receipt-export-light');
            card.classList.remove('glass-panel', 'animate-fade-in');
            
            // Ocultar botones interactivos (como "Ver comprobante") pero conservar badge de método de pago
            const buttons = card.querySelectorAll('button');
            buttons.forEach(b => {
              if (!b.classList.contains('receipt-payment-badge')) {
                b.style.display = 'none';
              }
            });
            
            // Encabezado institucional de la ficha
            const headerBanner = clonedDoc.createElement('div');
            headerBanner.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;margin-bottom:18px;border-bottom:2px solid #e2e8f0;';
            headerBanner.innerHTML = `
              <div>
                <span style="font-size:11px;font-weight:700;color:#4f46e5;text-transform:uppercase;letter-spacing:0.5px;">CONTROL CURSO • ESTADO DE CUENTA</span>
                <h4 style="margin:2px 0 0 0;font-size:15px;color:#1e293b;font-weight:700;">Ficha Individual de Alumno</h4>
              </div>
              <div style="text-align:right;font-size:11px;color:#64748b;">
                Fecha: ${new Date().toLocaleDateString('es-CL')}
              </div>
            `;
            card.insertBefore(headerBanner, card.firstChild);
            
            // Pie de página institucional
            const footerBanner = clonedDoc.createElement('div');
            footerBanner.style.cssText = 'text-align:center;margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;';
            footerBanner.innerHTML = 'Documento informativo generado por Control Curso • Válido al día de emisión';
            card.appendChild(footerBanner);
          }
        }
      });
      
      if (actionsDiv) actionsDiv.style.display = 'flex';

      const image = canvas.toDataURL("image/png");
      const res = await fetch(image);
      const blob = await res.blob();
      const safeName = (student.name || 'alumno').replace(/[^a-zA-Z0-9]/g, '_');
      const file = new File([blob], `historial_${safeName}.png`, { type: 'image/png' });

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

      if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Historial de ${formatStudentName(student)}`,
          text: `Detalle completo de pagos y estado de cuenta de ${formatStudentName(student)}.`
        });
      } else {
        const link = document.createElement('a');
        link.href = image;
        link.download = `historial_${safeName}.png`;
        link.click();
        await showAlert("Ficha descargada exitosamente.");
      }
      if (actionsDiv) actionsDiv.style.display = 'flex';
    } catch (error) {
      console.error("Error al generar imagen:", error);
      await showAlert("Hubo un error al generar la imagen de la ficha.");
    } finally {
      setIsCapturing(false);
      setSharing(false);
    }
  };

  const content = (
    <div 
      ref={detailRef} 
      id={`student-detail-card-${student.id}`}
      className={`glass-panel ${isCapturing ? '' : 'animate-fade-in'}`}
      style={{ 
        width: '100%', 
        maxWidth: isModal ? '850px' : '100%',
        padding: '1.75rem', 
        backgroundColor: 'var(--bg-main)',
        border: '1px solid rgba(99, 102, 241, 0.3)',
        boxShadow: isModal ? '0 25px 50px -12px rgba(0, 0, 0, 0.6)' : 'none',
        position: 'relative'
      }}
    >
      {/* Header Ficha */}
      <div className="receipt-border-b" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
            <span className="receipt-student-badge" style={{ 
              fontSize: '0.8rem', 
              fontWeight: '700', 
              padding: '0.2rem 0.6rem', 
              borderRadius: '6px', 
              backgroundColor: 'rgba(99, 102, 241, 0.2)',
              color: 'var(--primary)'
            }}>
              N° {student.listNumber || '-'}
            </span>
            <h2 className="receipt-student-name" style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.4rem' }}>
              {formatStudentName(student)}
            </h2>
          </div>
          <p className="receipt-subtext" style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            {student.rut ? `RUT: ${student.rut}` : 'Sin RUT registrado'}
          </p>
        </div>

        <div id={`actions-${student.id}`} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {role === 'superadmin' && (
            <button 
              onClick={handleToggleExpensesInPortal}
              disabled={togglingExpenses}
              className="btn btn-outline" 
              style={{ 
                padding: '0.5rem 0.85rem', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.4rem', 
                borderColor: expensesEnabled ? 'rgba(16, 185, 129, 0.5)' : 'var(--border-color)', 
                color: expensesEnabled ? '#10b981' : 'var(--text-muted)',
                backgroundColor: expensesEnabled ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                fontSize: '0.85rem'
              }}
              title={expensesEnabled ? "Deshabilitar vista de gastos en portal de este alumno" : "Habilitar vista de gastos en portal para este alumno"}
            >
              <Receipt size={16} /> {expensesEnabled ? 'Gastos Portal: Habilitado' : 'Gastos Portal: Deshabilitado'}
            </button>
          )}
          <button 
            onClick={handleShare} 
            disabled={sharing} 
            className="btn btn-outline" 
            style={{ padding: '0.5rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderColor: '#25D366', color: '#25D366' }}
            title="Descargar o compartir comprobante por WhatsApp"
          >
            <Download size={16} /> {sharing ? 'Generando...' : 'Compartir / Guardar'}
          </button>
          <button 
            onClick={onClose} 
            className="btn btn-outline" 
            style={{ padding: '0.5rem', borderRadius: '50%', minWidth: '36px', height: '36px' }} 
            title="Cerrar Ficha"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* KPI Financial Summary Cards */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', 
        gap: '0.75rem', 
        marginBottom: '1.5rem' 
      }}>
        {/* Total Pagado */}
        <div className="receipt-kpi-paid" style={{ padding: '1rem', backgroundColor: 'rgba(16, 185, 129, 0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
          <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <CheckCircle size={14} style={{ color: 'var(--success)' }} /> Total Pagado
          </p>
          <h3 style={{ margin: 0, color: 'var(--success)', fontSize: '1.25rem' }}>{formatMoney(totalPaid)}</h3>
        </div>

        {/* Total Pendiente */}
        <div className={totalPending > 0 ? 'receipt-kpi-pending-danger' : 'receipt-kpi-pending-clean'} style={{ padding: '1rem', backgroundColor: totalPending > 0 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: totalPending > 0 ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid var(--border-color)' }}>
          <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <AlertCircle size={14} style={{ color: totalPending > 0 ? 'var(--danger)' : 'var(--text-muted)' }} /> Por Pagar / Pendiente
          </p>
          <h3 style={{ margin: 0, color: totalPending > 0 ? 'var(--danger)' : 'var(--text-main)', fontSize: '1.25rem' }}>
            {formatMoney(totalPending)}
          </h3>
        </div>

        {/* Saldo a Favor */}
        <div className={studentBalance > 0 ? 'receipt-kpi-balance-active' : 'receipt-kpi-balance-neutral'} style={{ padding: '1rem', backgroundColor: studentBalance > 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: studentBalance > 0 ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border-color)' }}>
          <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Sparkles size={14} style={{ color: 'var(--success)' }} /> Saldo a Favor
          </p>
          <h3 style={{ margin: 0, color: studentBalance > 0 ? 'var(--success)' : 'var(--text-muted)', fontSize: '1.25rem' }}>
            {formatMoney(studentBalance)}
          </h3>
          {studentBalance > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.6rem' }}>
              <button
                type="button"
                onClick={() => setShowDiscountModal(true)}
                className="btn btn-outline"
                style={{
                  padding: '0.35rem 0.6rem',
                  fontSize: '0.75rem',
                  width: '100%',
                  borderColor: 'rgba(245, 158, 11, 0.5)',
                  color: '#f59e0b',
                  backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                  fontWeight: '600'
                }}
                title="Descontar una parte o la totalidad de este saldo a favor (sin asociar a cuotas)"
              >
                <MinusCircle size={13} /> Descontar Saldo
              </button>
              {pendingDebts.length > 0 && (
                <button
                  type="button"
                  onClick={handleApplyBalanceToAllDebts}
                  disabled={applyingBalance}
                  className="btn btn-primary"
                  style={{
                    padding: '0.35rem 0.6rem',
                    fontSize: '0.75rem',
                    width: '100%',
                    backgroundColor: 'var(--success)',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem'
                  }}
                  title="Descontar saldo a favor de las cuotas pendientes de este alumno"
                >
                  <Sparkles size={13} /> {applyingBalance ? 'Procesando...' : 'Aplicar a Cuotas'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Cuotas Registradas */}
        <div className="receipt-kpi-total" style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <FileText size={14} /> Total Cuotas
          </p>
          <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.25rem' }}>
            {debts.length}
          </h3>
        </div>
      </div>

      {/* Sección Apoderados */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h4 className="receipt-parent-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--text-muted)' }}>
          <User size={16} /> Apoderados Vinculados
        </h4>
        {emails.length === 0 ? (
          <p className="receipt-subtext" style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem' }}>No hay apoderados vinculados a este alumno.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {emails.map((email, idx) => {
              const apName = usersMap[email.toLowerCase()] || usersMap[email];
              return (
                <div className="receipt-parent-card" key={idx} style={{ padding: '0.75rem 1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                  <p style={{ fontWeight: '600', margin: '0 0 0.15rem 0', fontSize: '0.95rem', color: 'var(--text-main)' }}>
                    {apName || 'Nombre no registrado'}
                  </p>
                  <p className="receipt-subtext" style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8rem' }}>{email}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Grid: Por Pagar vs Pagados */}
      <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        
        {/* Deudas Pendientes / Por Pagar */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <h4 className="receipt-section-pending-title" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontSize: '1rem' }}>
              <AlertCircle size={18} /> Por Pagar / En Revisión ({pendingDebts.length})
            </h4>
            {payablePendingDebts.length > 1 && (
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => handlePayAllPending('cash')}
                  disabled={Boolean(processingDebtId)}
                  className="btn btn-outline"
                  style={{
                    padding: '0.2rem 0.5rem',
                    fontSize: '0.72rem',
                    borderColor: 'rgba(16, 185, 129, 0.45)',
                    color: 'var(--success)',
                    backgroundColor: 'rgba(16, 185, 129, 0.08)'
                  }}
                  title="Marcar todas las cuotas pendientes como pagadas en Efectivo"
                >
                  Pagar Todas (Efectivo)
                </button>
                <button
                  type="button"
                  onClick={() => handlePayAllPending('transfer')}
                  disabled={Boolean(processingDebtId)}
                  className="btn btn-outline"
                  style={{
                    padding: '0.2rem 0.5rem',
                    fontSize: '0.72rem',
                    borderColor: 'rgba(99, 102, 241, 0.45)',
                    color: 'var(--primary)',
                    backgroundColor: 'rgba(99, 102, 241, 0.08)'
                  }}
                  title="Marcar todas las cuotas pendientes como pagadas por Transferencia"
                >
                  Pagar Todas (Transf.)
                </button>
              </div>
            )}
          </div>
          
          {loading ? (
            <p className="receipt-subtext" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando cuotas...</p>
          ) : pendingDebts.length === 0 ? (
            <div className="receipt-clean-banner" style={{ padding: '1.5rem', textAlign: 'center', backgroundColor: 'rgba(16, 185, 129, 0.04)', borderRadius: 'var(--radius-md)', border: '1px dashed rgba(16, 185, 129, 0.3)', color: 'var(--success)' }}>
              <CheckCircle size={24} style={{ margin: '0 auto 0.5rem auto' }} />
              <p style={{ margin: 0, fontWeight: '600' }}>¡Al día!</p>
              <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.85 }}>No tiene cuotas pendientes por pagar.</p>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem', maxHeight: (isModal && !isCapturing) ? '380px' : 'none', overflowY: (isModal && !isCapturing) ? 'auto' : 'visible' }}>
              {pendingDebts.map(d => {
                const isPartial = d.status === 'partial';
                const isReview = d.status === 'review';
                const debtAmount = d.amount || 0;
                const paidAmount = d.paidAmount || 0;
                const remaining = isPartial ? Math.max(0, debtAmount - paidAmount) : debtAmount;
                const isBusy = processingDebtId === d.id || processingDebtId === 'all';

                return (
                  <li 
                    key={d.id} 
                    className="receipt-item-pending"
                    style={{ 
                      padding: '0.85rem 1rem', 
                      backgroundColor: 'rgba(255,255,255,0.02)', 
                      borderRadius: 'var(--radius-sm)', 
                      borderLeft: `4px solid ${isReview ? 'var(--warning)' : isPartial ? '#f59e0b' : 'var(--danger)'}`,
                      border: '1px solid var(--border-color)',
                      borderLeftWidth: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.35rem', gap: '0.5rem' }}>
                      <span className="receipt-debt-title" style={{ fontWeight: '600', color: 'var(--text-main)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {d.title}
                        {d.visibleInPortal === false && (
                          <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', fontWeight: '600' }}>
                            Oculta en portal
                          </span>
                        )}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                        <span className="receipt-debt-amount" style={{ fontWeight: '700', color: 'var(--danger)', fontSize: '1rem', whiteSpace: 'nowrap' }}>
                          {formatMoney(remaining)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleEditDebtAmount(d)}
                          disabled={isBusy}
                          style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '0.15rem', display: 'inline-flex', alignItems: 'center' }}
                          title="Modificar monto a cobrar"
                        >
                          <Edit2 size={13} />
                        </button>
                      </div>
                    </div>

                    {isPartial && (
                      <div style={{ fontSize: '0.8rem', color: '#f59e0b', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <AlertTriangle size={13} />
                        Pago parcial: {formatMoney(paidAmount)} pagados de {formatMoney(debtAmount)}
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <span className="receipt-debt-sub">Emitido: {d.date || (d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '-')}</span>
                      
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {isReview && (
                          <span style={{ color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontWeight: '500' }}>
                            <Clock size={13} /> En Revisión
                          </span>
                        )}

                        {d.receiptUrl && (
                          <button
                            type="button"
                            onClick={() => setPreviewReceipt(d.receiptUrl)}
                            className="btn-view-receipt"
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--primary)',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              fontSize: '0.8rem',
                              padding: 0
                            }}
                          >
                            <Eye size={13} /> Ver Comprobante
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Acciones de pago y modificación */}
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', paddingTop: '0.45rem', borderTop: '1px dashed rgba(255,255,255,0.08)' }}>
                      {isReview && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleMarkDebtPaid(d, 'transfer', true)}
                            disabled={isBusy}
                            className="btn btn-primary"
                            style={{ padding: '0.25rem 0.55rem', fontSize: '0.74rem', backgroundColor: 'var(--success)', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                            title="Aprobar comprobante"
                          >
                            <Check size={12} /> Aprobar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectReviewDebt(d)}
                            disabled={isBusy}
                            className="btn btn-outline"
                            style={{ padding: '0.25rem 0.55rem', fontSize: '0.74rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.4)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                            title="Rechazar comprobante"
                          >
                            <XCircle size={12} /> Rechazar
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => handleMarkDebtPaid(d, 'cash')}
                        disabled={isBusy}
                        className="btn btn-outline"
                        style={{ padding: '0.25rem 0.55rem', fontSize: '0.74rem', color: 'var(--primary)', borderColor: 'rgba(99, 102, 241, 0.35)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        title="Marcar como pagada en Efectivo"
                      >
                        Efectivo
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMarkDebtPaid(d, 'transfer')}
                        disabled={isBusy}
                        className="btn btn-outline"
                        style={{ padding: '0.25rem 0.55rem', fontSize: '0.74rem', color: 'var(--primary)', borderColor: 'rgba(99, 102, 241, 0.35)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        title="Marcar como pagada por Transferencia"
                      >
                        Transf.
                      </button>

                      <button
                        type="button"
                        onClick={() => handleEditPaidAmount(d)}
                        disabled={isBusy}
                        className="btn btn-outline"
                        style={{ padding: '0.25rem 0.55rem', fontSize: '0.74rem', color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.4)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        title="Ingresar o modificar monto abonado / parcial"
                      >
                        <Edit2 size={12} /> Abonar / Modificar
                      </button>

                      {studentBalance > 0 && (
                        <button
                          type="button"
                          onClick={() => handlePayDebtWithBalance(d)}
                          disabled={applyingBalance || isBusy}
                          className="btn btn-outline"
                          style={{
                            padding: '0.25rem 0.55rem',
                            fontSize: '0.74rem',
                            color: 'var(--success)',
                            borderColor: 'rgba(16, 185, 129, 0.4)',
                            backgroundColor: 'rgba(16, 185, 129, 0.08)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            borderRadius: 'var(--radius-sm)'
                          }}
                          title={`Usar saldo a favor de ${formatMoney(studentBalance)} para esta cuota`}
                        >
                          <Sparkles size={12} /> Usar Saldo
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Historial de Pagos Realizados */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h4 className="receipt-section-paid-title" style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '1rem' }}>
            <CheckCircle size={18} /> Pagos Realizados ({paidDebts.length})
          </h4>
          
          {loading ? (
            <p className="receipt-subtext" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando historial...</p>
          ) : paidDebts.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-color)', color: 'var(--text-muted)' }}>
              <p className="receipt-subtext" style={{ margin: 0 }}>No tiene pagos registrados todavía.</p>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem', maxHeight: (isModal && !isCapturing) ? '380px' : 'none', overflowY: (isModal && !isCapturing) ? 'auto' : 'visible' }}>
              {paidDebts.map(d => {
                const methodLabel = d.paymentMethod === 'transfer' ? 'Transferencia' : d.paymentMethod === 'cash' ? 'Efectivo' : d.paymentMethod === 'balance' ? 'Saldo a Favor' : 'Pagado';
                const paidDate = d.paidAt ? new Date(d.paidAt).toLocaleDateString() : d.date || '-';
                const isBusy = processingDebtId === d.id || processingDebtId === 'all';
                
                return (
                  <li 
                    key={d.id} 
                    className="receipt-item-paid"
                    style={{ 
                      padding: '0.85rem 1rem', 
                      backgroundColor: 'rgba(255,255,255,0.02)', 
                      borderRadius: 'var(--radius-sm)', 
                      borderLeft: '4px solid var(--success)',
                      border: '1px solid var(--border-color)',
                      borderLeftWidth: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.35rem', gap: '0.5rem' }}>
                      <span className="receipt-debt-title" style={{ fontWeight: '600', color: 'var(--text-main)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {d.title}
                        {d.visibleInPortal === false && (
                          <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', fontWeight: '600' }}>
                            Oculta en portal
                          </span>
                        )}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                        <span className="receipt-debt-amount" style={{ fontWeight: '700', color: 'var(--success)', fontSize: '1rem', whiteSpace: 'nowrap' }}>
                          {formatMoney(d.paidAmount || d.amount)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleEditPaidAmount(d)}
                          disabled={isBusy}
                          style={{ background: 'none', border: 'none', color: 'var(--success)', cursor: 'pointer', padding: '0.15rem', display: 'inline-flex', alignItems: 'center' }}
                          title="Modificar monto pagado"
                        >
                          <Edit2 size={13} />
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <span className="receipt-debt-sub">Fecha pago: {paidDate}</span>
                        <span className="receipt-debt-sub" style={{ opacity: 0.7 }}>• Cuota: {formatMoney(d.amount)}</span>
                        <button
                          type="button"
                          onClick={() => handleEditDebtAmount(d)}
                          disabled={isBusy}
                          style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '0.1rem', display: 'inline-flex', alignItems: 'center' }}
                          title="Modificar monto base de la cuota"
                        >
                          <Edit2 size={11} />
                        </button>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => handleTogglePaymentMethod(d)}
                          disabled={isBusy}
                          className="receipt-payment-badge"
                          style={{ 
                            fontSize: '0.75rem', 
                            padding: '0.15rem 0.5rem', 
                            borderRadius: '12px', 
                            backgroundColor: 'rgba(16, 185, 129, 0.1)', 
                            color: 'var(--success)',
                            border: '1px solid rgba(16, 185, 129, 0.25)',
                            cursor: d.paymentMethod === 'balance' ? 'default' : 'pointer'
                          }}
                          title={d.paymentMethod === 'balance' ? 'Pagado con Saldo a Favor' : 'Clic para cambiar entre Efectivo y Transferencia'}
                        >
                          {methodLabel}
                        </button>

                        {d.receiptUrl && (
                          <button
                            type="button"
                            onClick={() => setPreviewReceipt(d.receiptUrl)}
                            className="btn-view-receipt"
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--primary)',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              fontSize: '0.8rem',
                              padding: 0
                            }}
                          >
                            <Eye size={13} /> Ver Comprobante
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleCancelPayment(d)}
                          disabled={isBusy}
                          className="btn btn-outline"
                          style={{
                            padding: '0.2rem 0.5rem',
                            fontSize: '0.72rem',
                            color: 'var(--danger)',
                            borderColor: 'rgba(239, 68, 68, 0.35)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem'
                          }}
                          title="Cancelar pago y volver a estado Pendiente"
                        >
                          <RotateCcw size={12} /> Cancelar Pago
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Lightbox Comprobante */}
      {previewReceipt && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            zIndex: 1100,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '1rem'
          }}
          onClick={() => setPreviewReceipt(null)}
        >
          <div 
            style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewReceipt(null)}
              style={{
                position: 'absolute',
                top: '-2.5rem',
                right: 0,
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <X size={18} />
            </button>
            <img 
              src={previewReceipt} 
              alt="Comprobante de pago" 
              style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: '8px', objectFit: 'contain' }} 
            />
          </div>
        </div>
      )}

      {showDiscountModal && (
        <DiscountBalanceModal
          student={{ ...student, balance: studentBalance }}
          onClose={() => setShowDiscountModal(false)}
          onSuccess={(newBal) => {
            setStudentBalance(newBal);
            fetchDebts();
            onUpdate?.();
          }}
        />
      )}
    </div>
  );

  if (isModal) {
    return (
      <div 
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 1000,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '1rem',
          overflowY: 'auto'
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div style={{ marginTop: '2rem', marginBottom: '2rem', width: '100%', maxWidth: '850px' }}>
          {content}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '1rem', borderTop: 'none', borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(0,0,0,0.2)' }}>
      {content}
    </div>
  );
};

export default StudentDetailModal;
