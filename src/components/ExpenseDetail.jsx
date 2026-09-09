import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';
import { ArrowLeft, CheckCircle, Clock, XCircle, FileText, Download, Trash2, Edit2, Save, X, Calculator, CheckSquare, AlertTriangle, RotateCcw, Sparkles, Check } from 'lucide-react';
import { formatStudentName } from '../utils/nameUtils';
import { useModal } from '../context/ModalContext';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import { useCourse } from '../context/CourseContext';
import { useAuth } from '../context/AuthContext';
import { requestApproval } from '../services/approvalService';

const ExpenseDetail = ({ expenseId, onBack }) => {
  const { showAlert, showConfirm, showPrompt } = useModal();
  const { selectedCourse } = useCourse();
  const { user, role, userData } = useAuth();
  const courseRole = (role === 'superadmin' || userData?.roles?.global === 'superadmin')
    ? 'superadmin'
    : (userData?.roles?.[selectedCourse?.id] || null);
  const requiresApproval = courseRole !== 'tesorero' && courseRole !== 'superadmin';

  const [expense, setExpense] = useState(null);
  const [debts, setDebts] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Modo Auditoría
  const [isAuditMode, setIsAuditMode] = useState(false);
  const [auditChecks, setAuditChecks] = useState({}); // { [debtId]: boolean }
  const [auditManualAmounts, setAuditManualAmounts] = useState({}); // { [debtId]: string | number }
  
  // Para ver imagen en grande
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  useLockBodyScroll(!!selectedReceipt);

  // Estados de Edición
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({ title: '', totalAmount: '', accountId: '', fundId: '' });
  const [transferAccounts, setTransferAccounts] = useState([]);
  const [funds, setFunds] = useState([]);

  // Selección Múltiple
  const [selectedDebts, setSelectedDebts] = useState([]);

  // Acordeón para Mobile
  const [expandedDebts, setExpandedDebts] = useState([]);

  // Gestión de Alumnos
  const [isManagingStudents, setIsManagingStudents] = useState(false);
  const [selectedManageStudents, setSelectedManageStudents] = useState([]);
  const [manageStudentsSearch, setManageStudentsSearch] = useState('');

  const fetchDetail = useCallback(async () => {
    if (!selectedCourse) return;
    setLoading(true);
    try {
      // Obtener el gasto
      const expenseRef = doc(db, 'expenses', expenseId);
      const expenseSnap = await getDoc(expenseRef);
      if (expenseSnap.exists()) {
        setExpense({ id: expenseSnap.id, ...expenseSnap.data() });
      }

      // Obtener alumnos para el orden y saldos a favor
      const studentsSnap = await getDocs(query(collection(db, 'students'), where('courseId', '==', selectedCourse.id)));
      const studentsData = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStudents(studentsData);

      // Obtener cuentas de transferencia
      const settingsDocRef = doc(db, 'settings', selectedCourse.id);
      const settingsSnap = await getDoc(settingsDocRef);
      if (settingsSnap.exists()) {
        const data = settingsSnap.data();
        if (data.transferAccounts) {
          setTransferAccounts(data.transferAccounts);
        } else if (data.transferData) {
          setTransferAccounts([{ ...data.transferData, id: 'acc_legacy', alias: 'Cuenta Principal' }]);
        }
      }

      // Obtener fondos
      const fundsCollection = query(collection(db, 'funds'), where('courseId', '==', selectedCourse.id));
      const fundsSnapshot = await getDocs(fundsCollection);
      const fundsList = fundsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setFunds(fundsList);

      // Obtener las deudas de este gasto
      const q = query(collection(db, 'debts'), where('expenseId', '==', expenseId));
      const debtSnap = await getDocs(q);
      const debtsData = debtSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Ordenar estrictamente por el número de lista del alumno
      debtsData.sort((a, b) => {
         const studentA = studentsData.find(s => s.id === a.studentId);
         const studentB = studentsData.find(s => s.id === b.studentId);
         const aNum = studentA ? (parseInt(studentA.listNumber) || 999) : 999;
         const bNum = studentB ? (parseInt(studentB.listNumber) || 999) : 999;
         return aNum - bNum;
      });
      
      setDebts(debtsData);
    } catch (error) {
      console.error("Error fetching expense details:", error);
    } finally {
      setLoading(false);
    }
  }, [expenseId, selectedCourse]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const processPayment = async (debtId, method, defaultAmount, isApproval = false) => {
    const debtToPay = debts.find(d => d.id === debtId);
    
    let finalTotalPaid = 0;

    if (isApproval) {
      // En aprobaciones, el apoderado ya subió un comprobante y reportó un monto que reemplaza al actual (o es el primero).
      const suggestedAmount = debtToPay.paidAmount || debtToPay.amount;
      const amountStr = await showPrompt(
        `Confirma el MONTO TOTAL PAGADO en este comprobante:\n(Monto a cobrar: $${debtToPay.amount})`, 
        suggestedAmount
      );
      if (amountStr === null) return;
      const approvedAmount = parseFloat(amountStr);
      if (isNaN(approvedAmount) || approvedAmount <= 0) {
        await showAlert("Monto inválido.");
        return;
      }
      finalTotalPaid = approvedAmount;
    } else {
      // Pago manual (Efectivo/Transferencia) reportado por el admin.
      const currentPaid = debtToPay.paidAmount || 0;
      const remaining = debtToPay.amount - currentPaid;
      
      const amountStr = await showPrompt(
        currentPaid > 0 
          ? `Este alumno ya ha pagado $${currentPaid}.\nIngresa el MONTO A SUMAR (Restante para el total: $${remaining}):`
          : `Ingresa el monto pagado (Total a cobrar: $${debtToPay.amount}):`, 
        remaining > 0 ? remaining : 0
      );
      
      if (amountStr === null) return;
      const addedAmount = parseFloat(amountStr);
      if (isNaN(addedAmount) || addedAmount <= 0) {
        await showAlert("Monto inválido. Debe ser mayor a 0.");
        return;
      }
      
      // Sumamos al monto ya pagado
      finalTotalPaid = currentPaid + addedAmount;
    }

    try {
      const fundId = debtToPay.fundId || expense.fundId || 'general';
      const relatedFund = funds.find(f => f.id === fundId);
      
      if (relatedFund && relatedFund.isLocked) {
        const unlock = await showConfirm(`El fondo "${relatedFund.name}" asociado a esta cuota está bloqueado. ¿Quieres desbloquearlo para poder registrar el pago?`);
        if (!unlock) return; // Cancelar el pago
        
        // Desbloquear el fondo
        await updateDoc(doc(db, 'funds', relatedFund.id), { isLocked: false });
        setFunds(funds.map(f => f.id === relatedFund.id ? { ...f, isLocked: false } : f));
      }

      const debtRef = doc(db, 'debts', debtId);
      
      let newStatus = 'pending';
      if (finalTotalPaid >= debtToPay.amount) newStatus = 'paid';
      else if (finalTotalPaid > 0) newStatus = 'partial';

      const fullyPaidCount = (expense.paidCount || 0) + (newStatus === 'paid' && debtToPay.status !== 'paid' ? 1 : (newStatus !== 'paid' && debtToPay.status === 'paid' ? -1 : 0));

      if (requiresApproval) {
        const payload = {
          expenseId,
          expensePaidCount: fullyPaidCount,
          debtsToUpdate: [{
            debtId,
            updates: { status: newStatus, paidAmount: finalTotalPaid, paymentMethod: method }
          }]
        };
        await requestApproval('REGISTER_PAYMENTS', `Pago: ${debtToPay.studentName} ($${finalTotalPaid})`, payload, user, selectedCourse.id);
        await showAlert('Solicitud de pago enviada a la tesorera.');
        fetchDetail();
        return;
      }

      await updateDoc(debtRef, {
        status: newStatus,
        paidAmount: finalTotalPaid,
        paymentMethod: method,
        approvedAt: new Date().toISOString()
      });

      // Recalcular cuántos alumnos están completamente pagados
      const q = query(collection(db, 'debts'), where('expenseId', '==', expenseId));
      const snap = await getDocs(q);
      const updatedFullyPaidCount = snap.docs.filter(d => d.data().status === 'paid').length;
      
      const expenseRef = doc(db, 'expenses', expenseId);
      await updateDoc(expenseRef, {
        paidCount: updatedFullyPaidCount
      });

      fetchDetail();
    } catch (error) {
      console.error("Error al procesar pago:", error);
      await showAlert("Hubo un error al procesar el pago.");
    }
  };



  const handleEditDebtAmount = async (debtId) => {
    const debtToEdit = debts.find(d => d.id === debtId);
    if (!debtToEdit) return;

    const newAmountStr = await showPrompt("Ingresa el NUEVO Monto a Cobrar para este alumno:", debtToEdit.amount);
    if (newAmountStr === null) return;
    
    const newAmount = parseFloat(newAmountStr);
    if (isNaN(newAmount) || newAmount <= 0) {
      await showAlert("Monto inválido.");
      return;
    }

    setLoading(true);
    try {
      await updateDoc(doc(db, 'debts', debtId), {
        amount: newAmount
      });
      fetchDetail();
    } catch (error) {
      console.error("Error modificando deuda:", error);
      await showAlert("Error al modificar el monto.");
      setLoading(false);
    }
  };

  const handleEditPaidAmount = async (debtId) => {
    const debtToEdit = debts.find(d => d.id === debtId);
    if (!debtToEdit) return;

    const newAmountStr = await showPrompt("Ingresa el NUEVO Monto Informado (Pagado) para este alumno:", debtToEdit.paidAmount || 0);
    if (newAmountStr === null) return;
    
    const newAmount = parseFloat(newAmountStr);
    if (isNaN(newAmount) || newAmount < 0) {
      await showAlert("Monto inválido.");
      return;
    }

    setLoading(true);
    try {
      await updateDoc(doc(db, 'debts', debtId), {
        paidAmount: newAmount
      });
      fetchDetail();
    } catch (error) {
      console.error("Error modificando pago:", error);
      await showAlert("Error al modificar el monto pagado.");
      setLoading(false);
    }
  };

  const toggleAccordionRow = (id, e) => {
    // Evitar que el acordeón se active si se clickea un botón o checkbox interno
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.closest('button')) return;
    setExpandedDebts(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  };

  const handleApprovePayment = async (debtId) => {
    const debtToPay = debts.find(d => d.id === debtId);
    await processPayment(debtId, 'transfer', debtToPay.paidAmount || debtToPay.amount, true);
  };

  const handleManualPayment = async (debtId, method) => {
    const debtToPay = debts.find(d => d.id === debtId);
    await processPayment(debtId, method, debtToPay.amount, false);
  };

  const handleBulkPayment = async (method) => {
    if (selectedDebts.length === 0) return;
    if (!(await showConfirm(`¿Registrar pago masivo a ${selectedDebts.length} alumnos en ${method === 'cash' ? 'Efectivo' : 'Transferencia'}?`))) return;
    
    setLoading(true);
    try {
      let newlyPaidCount = 0;
      const debtsToUpdate = [];

      for (const debtId of selectedDebts) {
        const debtToPay = debts.find(d => d.id === debtId);
        debtsToUpdate.push({
          debtId,
          updates: { status: 'paid', paidAmount: debtToPay.amount, paymentMethod: method }
        });
        newlyPaidCount++;
      }

      const currentPaidCount = expense.paidCount || 0;

      if (requiresApproval) {
        const payload = {
          expenseId,
          expensePaidCount: currentPaidCount + newlyPaidCount,
          debtsToUpdate
        };
        await requestApproval('REGISTER_PAYMENTS', `Pago masivo (${selectedDebts.length} alumnos)`, payload, user, selectedCourse.id);
        await showAlert('Solicitud de pago masivo enviada a la tesorera.');
      } else {
        for (const update of debtsToUpdate) {
          await updateDoc(doc(db, 'debts', update.debtId), {
            ...update.updates,
            approvedAt: new Date().toISOString()
          });
        }
        await updateDoc(doc(db, 'expenses', expenseId), {
          paidCount: currentPaidCount + newlyPaidCount
        });
      }

      setSelectedDebts([]);
      fetchDetail();
    } catch (error) {
      console.error("Error al registrar pago masivo:", error);
      await showAlert("Error al registrar los pagos.");
      setLoading(false);
    }
  };

  const handlePayWithBalance = async (debtId) => {
    const debtToPay = debts.find(d => d.id === debtId);
    const student = students.find(s => s.id === debtToPay.studentId || s.name === debtToPay.studentName);
    
    if (!student) return;

    const currentPaid = debtToPay.paidAmount || 0;
    const remaining = debtToPay.amount - currentPaid;

    if (!student.balance || student.balance <= 0) {
      await showAlert("El alumno no tiene saldo a favor.");
      return;
    }

    const amountToUse = Math.min(student.balance, remaining);
    const newBalance = student.balance - amountToUse;
    const newPaidAmount = currentPaid + amountToUse;
    const isFullyPaid = newPaidAmount >= debtToPay.amount;

    if (!(await showConfirm(`¿Usar ${formatMoney(amountToUse)} del saldo a favor de ${student.name}? Le quedarán ${formatMoney(newBalance)} a favor.`))) return;
    
    setLoading(true);
    try {
      const isFullyPaid = newPaidAmount >= debtToPay.amount;
      const currentPaidCount = expense.paidCount || 0;
      const expensePaidCount = (isFullyPaid && debtToPay.status !== 'paid') ? currentPaidCount + 1 : currentPaidCount;

      if (requiresApproval) {
        const payload = {
          expenseId,
          expensePaidCount,
          debtsToUpdate: [{
            debtId,
            updates: { status: isFullyPaid ? 'paid' : 'partial', paidAmount: newPaidAmount, paymentMethod: 'balance' }
          }],
          studentBalances: [{
            studentId: student.id,
            newBalance
          }]
        };
        await requestApproval('REGISTER_PAYMENTS', `Pago con saldo: ${student.name}`, payload, user, selectedCourse.id);
        await showAlert('Solicitud de pago con saldo enviada a la tesorera.');
      } else {
        // 1. Actualizar deuda
        const debtRef = doc(db, 'debts', debtId);
        await updateDoc(debtRef, {
          status: isFullyPaid ? 'paid' : 'partial',
          paidAmount: newPaidAmount,
          paymentMethod: 'balance',
          approvedAt: new Date().toISOString()
        });

        // 2. Descontar saldo del estudiante
        const studentRef = doc(db, 'students', student.id);
        await updateDoc(studentRef, {
          balance: newBalance
        });

        // 3. Aumentar el contador del gasto (solo si se completó el pago)
        if (isFullyPaid && debtToPay.status !== 'paid') {
          const expenseRef = doc(db, 'expenses', expenseId);
          await updateDoc(expenseRef, {
            paidCount: expensePaidCount
          });
        }
      }

      fetchDetail();
    } catch (error) {
      console.error("Error al registrar pago con saldo:", error);
      await showAlert("Error al registrar el pago.");
      setLoading(false);
    }
  };

  const toggleSelectDebt = (id) => {
    setSelectedDebts(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    const pendings = debts.filter(d => d.status === 'pending' || d.status === 'partial').map(d => d.id);
    if (selectedDebts.length === pendings.length) {
      setSelectedDebts([]);
    } else {
      setSelectedDebts(pendings);
    }
  };

  const handleRejectPayment = async (debtId) => {
    if (!(await showConfirm('¿Seguro que deseas rechazar este comprobante? El apoderado tendrá que subir uno nuevo.'))) return;
    try {
      const debtRef = doc(db, 'debts', debtId);
      const debtToReject = debts.find(d => d.id === debtId);
      
      // Revert status to partial if they had a previous valid partial payment, else pending
      const previousValidPaidAmount = debtToReject.previousPaidAmount || 0;
      
      await updateDoc(debtRef, {
        status: previousValidPaidAmount > 0 ? 'partial' : 'pending',
        receiptUrl: null,
        paidAmount: previousValidPaidAmount
      });
      fetchDetail();
    } catch (error) {
      console.error("Error al rechazar pago:", error);
    }
  };



  const handleDeleteExpense = async () => {
    if (!(await showConfirm('¿Seguro que deseas ELIMINAR esta cuota? Se borrarán también todas las deudas de los alumnos y los pagos ya realizados desaparecerán del balance general.'))) return;
    setLoading(true);
    try {
      // 1. Borrar deudas
      for (const debt of debts) {
        await deleteDoc(doc(db, 'debts', debt.id));
      }
      // 2. Borrar cuota
      await deleteDoc(doc(db, 'expenses', expenseId));
      
      await showAlert('Cuota eliminada correctamente.');
      onBack();
    } catch (error) {
      console.error("Error eliminando cuota:", error);
      await showAlert('Hubo un error al eliminar la cuota.');
      setLoading(false);
    }
  };

  const handleStartEdit = () => {
    setEditData({ 
      title: expense.title, 
      totalAmount: expense.totalAmount,
      accountId: expense.transferData ? expense.transferData.id : (expense.transferData?.alias ? 'acc_legacy' : ''),
      fundId: expense.fundId || 'general'
    });
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!editData.title || !editData.totalAmount || !editData.fundId) return;
    setLoading(true);
    try {
      const newAmount = Number(editData.totalAmount);
      const selectedAccount = transferAccounts.find(a => a.id === editData.accountId) || null;
      
      // 1. Actualizar Cuota
      await updateDoc(doc(db, 'expenses', expenseId), {
        title: editData.title,
        totalAmount: newAmount,
        transferData: selectedAccount,
        fundId: editData.fundId
      });

      // 2. Actualizar monto, datos de transferencia y fondo en deudas
      for (const debt of debts) {
        const updates = {};
        if ((debt.status === 'pending' || debt.status === 'partial') && newAmount !== expense.totalAmount) {
          updates.amount = newAmount;
        }
        if (debt.status === 'pending' || debt.status === 'partial') {
          updates.transferData = selectedAccount;
        }
        if (editData.fundId !== expense.fundId) {
          updates.fundId = editData.fundId;
        }
        
        if (Object.keys(updates).length > 0) {
          await updateDoc(doc(db, 'debts', debt.id), updates);
        }
      }

      setExpense({ ...expense, title: editData.title, totalAmount: newAmount, transferData: selectedAccount, fundId: editData.fundId });
      setIsEditing(false);
      fetchDetail();
    } catch (error) {
      console.error("Error editando cuota:", error);
      await showAlert('Hubo un error al editar la cuota.');
      setLoading(false);
    }
  };

  const handleStartManageStudents = () => {
    setSelectedManageStudents(debts.map(d => d.studentId));
    setIsManagingStudents(true);
  };

  const handleSaveManageStudents = async () => {
    setLoading(true);
    try {
      const currentStudentIds = debts.map(d => d.studentId);
      const addedIds = selectedManageStudents.filter(id => !currentStudentIds.includes(id));
      const removedIds = currentStudentIds.filter(id => !selectedManageStudents.includes(id));

      // Validación para no borrar alumnos que ya pagaron
      for (const id of removedIds) {
        const debtToRemove = debts.find(d => d.studentId === id);
        if (debtToRemove && (debtToRemove.paidAmount > 0 || debtToRemove.status === 'paid' || debtToRemove.status === 'review')) {
          await showAlert(`No puedes quitar al alumno ${debtToRemove.studentName} porque ya tiene pagos registrados o en revisión.`);
          setLoading(false);
          return;
        }
      }

      // Eliminar alumnos
      let removedAmount = 0;
      for (const id of removedIds) {
        const debtToRemove = debts.find(d => d.studentId === id);
        if (debtToRemove) {
          removedAmount += debtToRemove.amount;
          await deleteDoc(doc(db, 'debts', debtToRemove.id));
        }
      }

      // Agregar alumnos
      let addedAmount = 0;
      const defaultAmount = typeof expense.amountPerStudent === 'number' ? expense.amountPerStudent : 0;
      for (const studentId of addedIds) {
        const student = students.find(s => s.id === studentId);
        const debtId = `debt_${expenseId}_${studentId}`;
        await setDoc(doc(db, 'debts', debtId), {
          expenseId,
          studentId,
          studentName: student.name,
          apoderadoEmails: student.apoderadoEmails || (student.apoderadoEmail ? [student.apoderadoEmail] : []),
          amount: defaultAmount,
          status: 'pending',
          paidAmount: 0,
          paymentMethod: null,
          approvedAt: null,
          title: expense.title,
          date: expense.date,
          fundId: expense.fundId || 'general',
          transferData: expense.transferData || null,
          createdAt: new Date().toISOString()
        });
        addedAmount += defaultAmount;
      }

      // Actualizar total y conteo en expense
      const newTotalAmount = (expense.totalAmount || 0) - removedAmount + addedAmount;
      const newStudentsCount = (expense.studentsCount || currentStudentIds.length) - removedIds.length + addedIds.length;

      await updateDoc(doc(db, 'expenses', expenseId), {
        totalAmount: newTotalAmount,
        studentsCount: newStudentsCount
      });

      setIsManagingStudents(false);
      fetchDetail();
      await showAlert('Alumnos gestionados correctamente.');
    } catch (error) {
      console.error("Error al gestionar alumnos:", error);
      await showAlert('Hubo un error al guardar los cambios.');
      setLoading(false);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  // Calculate statuses
  const studentStatusMap = {};
  debts.forEach(d => {
    if (!studentStatusMap[d.studentId]) {
      studentStatusMap[d.studentId] = { paid: 0, partial: 0, pending: 0, review: 0 };
    }
    studentStatusMap[d.studentId][d.status] = (studentStatusMap[d.studentId][d.status] || 0) + 1;
  });

  let fullyPaidCount = 0;
  let partialCount = 0;
  let unpaidCount = 0;

  Object.values(studentStatusMap).forEach(statusCounts => {
    if (statusCounts.partial > 0 || (statusCounts.pending > 0 && statusCounts.paid > 0)) {
       partialCount++;
    } else if (statusCounts.pending > 0 || statusCounts.review > 0) {
       unpaidCount++;
    } else if (statusCounts.paid > 0) {
       fullyPaidCount++;
    }
  });

  // Cálculos y Helpers del Modo Auditoría
  const systemTotalCollected = useMemo(() => {
    return debts.reduce((sum, d) => {
      if (d.status === 'paid') return sum + (typeof d.paidAmount === 'number' ? d.paidAmount : (d.amount || 0));
      if (d.status === 'partial') return sum + (d.paidAmount || 0);
      return sum;
    }, 0);
  }, [debts]);

  const auditTotalManual = useMemo(() => {
    return Object.entries(auditManualAmounts).reduce((sum, [, val]) => {
      const num = parseFloat(val);
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  }, [auditManualAmounts]);

  const auditTickedCount = useMemo(() => {
    return debts.filter(d => !!auditChecks[d.id]).length;
  }, [debts, auditChecks]);

  const auditDifference = auditTotalManual - systemTotalCollected;

  const handleToggleAuditCheck = (debtId) => {
    const isCurrentlyChecked = !!auditChecks[debtId];
    const newCheckState = !isCurrentlyChecked;
    
    setAuditChecks(prev => ({ ...prev, [debtId]: newCheckState }));

    // Si se activa y no hay monto manual ingresado, pre-cargar el valor del sistema para agilizar
    if (newCheckState && (auditManualAmounts[debtId] === undefined || auditManualAmounts[debtId] === '')) {
      const debt = debts.find(d => d.id === debtId);
      if (debt) {
        const sysVal = debt.status === 'paid' 
          ? (typeof debt.paidAmount === 'number' ? debt.paidAmount : (debt.amount || 0))
          : (debt.status === 'partial' ? (debt.paidAmount || 0) : 0);
        setAuditManualAmounts(prev => ({ ...prev, [debtId]: sysVal }));
      }
    }
  };

  const handleAuditManualAmountChange = (debtId, val) => {
    setAuditManualAmounts(prev => ({ ...prev, [debtId]: val }));
    // Si escribe un monto, marcar automáticamente el tick
    if (val !== '' && !auditChecks[debtId]) {
      setAuditChecks(prev => ({ ...prev, [debtId]: true }));
    }
  };

  const handleAutoFillAudit = () => {
    const newAmounts = {};
    const newChecks = {};
    debts.forEach(d => {
      const sysVal = d.status === 'paid'
        ? (typeof d.paidAmount === 'number' ? d.paidAmount : (d.amount || 0))
        : (d.status === 'partial' ? (d.paidAmount || 0) : 0);
      newAmounts[d.id] = sysVal;
      newChecks[d.id] = true;
    });
    setAuditManualAmounts(newAmounts);
    setAuditChecks(newChecks);
  };

  const handleToggleAllAuditChecks = () => {
    const allChecked = debts.every(d => auditChecks[d.id]);
    const newChecks = {};
    debts.forEach(d => {
      newChecks[d.id] = !allChecked;
    });
    setAuditChecks(newChecks);
  };

  const handleClearAudit = () => {
    setAuditChecks({});
    setAuditManualAmounts({});
  };

  const handleAcceptAllAudit = async () => {
    if (Object.keys(auditManualAmounts).length === 0) {
      await showAlert("No hay montos manuales ingresados. Ingresa al menos uno o usa 'Copiar del Sistema'.");
      return;
    }

    if (!(await showConfirm(`¿Estás seguro de reemplazar TODOS los montos en sistema por las sumas manuales auditadas?\n\n⚠️ ATENCIÓN: Cualquier alumno que NO tenga un monto manual ingresado quedará en $0 (Pendiente). La Suma Registrada en Sistema pasará a ser exactamente la Suma Manual Auditada.`))) return;

    setLoading(true);
    try {
      const debtsToUpdate = [];
      let updatedCount = 0;
      
      const fullyPaidCount = debts.filter(d => {
        const amtStr = auditManualAmounts[d.id];
        const amt = (amtStr !== undefined && amtStr !== '') ? parseFloat(amtStr) : 0;
        return amt >= d.amount;
      }).length;

      for (const debt of debts) {
        const manualAmtStr = auditManualAmounts[debt.id];
        
        let manualAmt = 0;
        if (manualAmtStr !== undefined && manualAmtStr !== '') {
          manualAmt = parseFloat(manualAmtStr);
          if (isNaN(manualAmt) || manualAmt < 0) manualAmt = 0;
        }

        let newStatus = 'pending';
        if (manualAmt >= debt.amount) newStatus = 'paid';
        else if (manualAmt > 0) newStatus = 'partial';

        debtsToUpdate.push({
          debtId: debt.id,
          updates: {
            paidAmount: manualAmt,
            status: newStatus,
            paymentMethod: manualAmt > 0 ? (debt.paymentMethod || 'cash') : null
          }
        });
        
        updatedCount++;
      }
      
      if (requiresApproval) {
        const payload = {
          expenseId,
          expensePaidCount: fullyPaidCount,
          debtsToUpdate
        };
        await requestApproval('REGISTER_PAYMENTS', `Auditoría masiva (${updatedCount} registros)`, payload, user, selectedCourse.id);
        await showAlert('Solicitud de auditoría enviada a la tesorera para su aprobación.');
      } else {
        for (const update of debtsToUpdate) {
          await updateDoc(doc(db, 'debts', update.debtId), {
            ...update.updates,
            approvedAt: update.updates.paidAmount > 0 ? new Date().toISOString() : null
          });
        }
        await updateDoc(doc(db, 'expenses', expenseId), {
          paidCount: fullyPaidCount
        });
        await showAlert(`Se ha reemplazado la suma del sistema con éxito. ${updatedCount} registros actualizados.`);
      }
      
      // Limpiar auditoría tras aplicar
      setAuditChecks({});
      setAuditManualAmounts({});
      
      fetchDetail();
    } catch (error) {
      console.error("Error al actualizar montos de auditoría masivos:", error);
      await showAlert("Error al guardar los montos auditados.");
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando detalle...</div>;
  }

  if (!expense) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <p>No se encontró la cuota.</p>
        <button onClick={onBack} className="btn btn-outline">Volver</button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Modal de Imagen */}
      {selectedReceipt && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem', flexDirection: 'column' }}>
           <img 
             src={selectedReceipt} 
             alt="Comprobante" 
             style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: 'var(--radius-sm)' }} 
           />
           <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
              <a href={selectedReceipt} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                <Download size={18} /> Abrir Original
              </a>
              <button onClick={() => setSelectedReceipt(null)} className="btn btn-outline">Cerrar</button>
           </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
            <ArrowLeft size={18} />
          </button>
          <h3 style={{ margin: 0 }}>Detalle de Cuota</h3>
        </div>

        {/* Botón de Modo Auditoría */}
        <button 
          onClick={() => setIsAuditMode(!isAuditMode)} 
          className="btn"
          style={{ 
            backgroundColor: isAuditMode ? '#8b5cf6' : 'rgba(139, 92, 246, 0.1)',
            borderColor: '#8b5cf6',
            color: isAuditMode ? 'white' : '#a78bfa',
            border: '1px solid #8b5cf6',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontWeight: '600',
            boxShadow: isAuditMode ? '0 0 20px rgba(139, 92, 246, 0.5)' : 'none',
            transition: 'all 0.2s ease'
          }}
          title="Activa el Modo Auditoría para verificar montos y cuadrar las cuentas con cálculo manual"
        >
          <Calculator size={18} />
          {isAuditMode ? 'Modo Auditoría: ACTIVADO' : 'Activar Modo Auditoría'}
        </button>
      </div>

      {/* Resumen del Gasto */}
      <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '2rem' }}>
        {isEditing ? (
          <div style={{ flex: 1 }}>
            <div className="input-group">
              <label className="input-label">Título de la Cuota</label>
              <input type="text" className="input-field" value={editData.title} onChange={e => setEditData({...editData, title: e.target.value})} />
            </div>
            <div className="input-group">
              <label className="input-label">Monto por Alumno ($)</label>
              <input type="number" className="input-field" value={editData.totalAmount} onChange={e => setEditData({...editData, totalAmount: e.target.value})} />
              <small style={{ color: 'var(--text-muted)' }}>Esto solo actualizará el cobro de los alumnos que aún no han pagado.</small>
            </div>
            <div className="input-group">
              <label className="input-label">Cuenta para Transferencias</label>
              <select 
                className="input-field"
                value={editData.accountId}
                onChange={(e) => setEditData({...editData, accountId: e.target.value})}
              >
                <option value="">No aplica (Solo efectivo / otro)</option>
                {transferAccounts.map(acc => (
                  <option key={acc.id} value={acc.id}>{acc.alias} ({acc.bank})</option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Fondo de Destino</label>
              <select 
                className="input-field"
                value={editData.fundId}
                onChange={(e) => setEditData({...editData, fundId: e.target.value})}
              >
                <option value="general">Fondo General</option>
                {funds.filter(f => !f.isLocked || f.id === editData.fundId).map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={handleSaveEdit} className="btn btn-primary" style={{ backgroundColor: 'var(--success)' }}><Save size={18}/> Guardar Cambios</button>
              <button onClick={() => setIsEditing(false)} className="btn btn-outline"><X size={18}/> Cancelar</button>
            </div>
          </div>
        ) : isManagingStudents ? (
          <div style={{ flex: 1 }}>
            <h4 style={{ color: 'var(--primary)', marginBottom: '1rem' }}>Agregar o Quitar Alumnos</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Selecciona los alumnos que deben pagar esta cuota. Los alumnos que ya tienen pagos registrados no pueden ser quitados.</p>
            
            <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <input 
                type="text" 
                className="input-field" 
                placeholder="Buscar alumno..." 
                value={manageStudentsSearch}
                onChange={e => setManageStudentsSearch(e.target.value)}
                style={{ flex: 1, marginBottom: 0 }}
              />
              <button 
                type="button" 
                className="btn btn-outline" 
                onClick={() => {
                  if (selectedManageStudents.length === students.length) setSelectedManageStudents([]);
                  else setSelectedManageStudents(students.map(s => s.id));
                }}
              >
                {selectedManageStudents.length === students.length ? 'Deseleccionar Todos' : 'Seleccionar Todos'}
              </button>
            </div>

            <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.5rem', marginBottom: '1.5rem', backgroundColor: 'rgba(0,0,0,0.1)' }}>
              {students.filter(s => s.name.toLowerCase().includes(manageStudentsSearch.toLowerCase())).map(s => {
                const existingDebt = debts.find(d => d.studentId === s.id);
                const cannotRemove = existingDebt && (existingDebt.paidAmount > 0 || existingDebt.status === 'paid' || existingDebt.status === 'review');
                
                return (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', cursor: cannotRemove ? 'not-allowed' : 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: cannotRemove && !selectedManageStudents.includes(s.id) ? 0.5 : 1 }}>
                    <input 
                      type="checkbox"
                      checked={selectedManageStudents.includes(s.id)}
                      disabled={cannotRemove}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedManageStudents([...selectedManageStudents, s.id]);
                        else setSelectedManageStudents(selectedManageStudents.filter(id => id !== s.id));
                      }}
                      style={{ accentColor: 'var(--primary)', width: '16px', height: '16px' }}
                    />
                    <div>
                      <span>{s.listNumber || '-'}. {formatStudentName(s)}</span>
                      {cannotRemove && <span style={{ fontSize: '0.75rem', color: 'var(--warning)', marginLeft: '0.5rem' }}>(Tiene pagos)</span>}
                    </div>
                  </label>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={handleSaveManageStudents} className="btn btn-primary" style={{ backgroundColor: 'var(--success)' }}><Save size={18}/> Guardar Alumnos</button>
              <button onClick={() => setIsManagingStudents(false)} className="btn btn-outline"><X size={18}/> Cancelar</button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <h2 style={{ color: 'var(--primary)', margin: 0 }}>{expense.title}</h2>
                <button onClick={handleStartEdit} className="btn btn-outline" style={{ padding: '0.3rem', borderColor: 'var(--primary)', color: 'var(--primary)' }} title="Editar Cuota"><Edit2 size={16}/></button>
                <button onClick={handleStartManageStudents} className="btn btn-outline" style={{ padding: '0.3rem', color: 'var(--text)' }} title="Agregar/Quitar Alumnos"><FileText size={16}/></button>
                <button onClick={handleDeleteExpense} className="btn btn-outline" style={{ padding: '0.3rem', borderColor: 'rgba(239, 68, 68, 0.3)', color: 'var(--danger)' }} title="Eliminar Cuota"><Trash2 size={16}/></button>
              </div>
              <p style={{ color: 'var(--text-muted)' }}>Emitido el: {expense.date}</p>
            </div>
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
              <p style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0 }}>Total a recaudar: {formatMoney(expense.totalAmount)}</p>
              
              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem', backgroundColor: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Pagados completo</p>
                  <p style={{ margin: 0, fontSize: '1.2rem', color: 'var(--success)', fontWeight: 'bold' }}>{fullyPaidCount}</p>
                </div>
                <div style={{ width: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Pago parcial</p>
                  <p style={{ margin: 0, fontSize: '1.2rem', color: '#eab308', fontWeight: 'bold' }}>{partialCount}</p>
                </div>
                <div style={{ width: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Impagos / Revisión</p>
                  <p style={{ margin: 0, fontSize: '1.2rem', color: 'var(--danger)', fontWeight: 'bold' }}>{unpaidCount}</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Panel de Auditoría y Cuadratura Manual */}
      {isAuditMode && (
        <div className="glass-panel animate-fade-in" style={{ padding: '1.5rem', marginBottom: '2rem', border: '1px solid rgba(139, 92, 246, 0.4)', background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(88, 28, 135, 0.2) 100%)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ backgroundColor: 'rgba(139, 92, 246, 0.25)', padding: '0.6rem', borderRadius: '10px', color: '#a78bfa' }}>
                <Calculator size={22} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#c4b5fd' }}>Panel de Auditoría y Cuadratura Manual</h3>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Tickea cada cuota e ingresa la suma manual real para verificar que no falte ni sobre ningún peso.
                </p>
              </div>
            </div>

            {/* Acciones Rápidas de Auditoría */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button 
                onClick={handleToggleAllAuditChecks}
                className="btn btn-outline"
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', borderColor: '#8b5cf6', color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <CheckSquare size={15} />
                {auditTickedCount === debts.length ? 'Desmarcar Todos' : 'Tickear Todos'}
              </button>
              <button 
                onClick={handleAutoFillAudit}
                className="btn btn-outline"
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', borderColor: 'var(--primary)', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                title="Copiar los montos del sistema a las casillas manuales para revisión rápida"
              >
                <Sparkles size={15} />
                Copiar del Sistema
              </button>
              <button 
                onClick={handleClearAudit}
                className="btn btn-outline"
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                title="Reiniciar ticks y montos ingresados manualmente"
              >
                <RotateCcw size={15} />
                Limpiar
              </button>
              <button 
                onClick={handleAcceptAllAudit}
                className="btn btn-primary"
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', backgroundColor: '#8b5cf6', border: 'none', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 'bold' }}
                title="Aceptar suma auditada y reemplazar la registrada en sistema"
                disabled={Object.keys(auditManualAmounts).length === 0}
              >
                <Save size={15} />
                Aceptar Suma Auditada
              </button>
            </div>
          </div>

          {/* Tarjetas de Cuadratura */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {/* Total Sistema */}
            <div style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Suma Registrada en Sistema</span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.35rem', color: 'var(--text-main)' }}>
                {formatMoney(systemTotalCollected)}
              </h3>
            </div>

            {/* Total Manual Auditado */}
            <div style={{ padding: '1rem', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
              <span style={{ fontSize: '0.8rem', color: '#c4b5fd' }}>Suma Manual Auditada</span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.35rem', color: '#a78bfa' }}>
                {formatMoney(auditTotalManual)}
              </h3>
            </div>

            {/* Diferencia / Cuadratura */}
            <div style={{ 
              padding: '1rem', 
              backgroundColor: auditDifference === 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.15)', 
              borderRadius: 'var(--radius-md)', 
              border: auditDifference === 0 ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.4)' 
            }}>
              <span style={{ fontSize: '0.8rem', color: auditDifference === 0 ? 'var(--success)' : 'var(--danger)' }}>
                Diferencia de Cuadratura
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.35rem', color: auditDifference === 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {auditDifference === 0 ? '$0 (Cuadrado)' : (auditDifference > 0 ? `+${formatMoney(auditDifference)}` : formatMoney(auditDifference))}
                </h3>
              </div>
            </div>

            {/* Progreso */}
            <div style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Progreso de Revisión</span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.35rem', color: 'var(--text-main)' }}>
                {auditTickedCount} de {debts.length} <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>({((auditTickedCount / (debts.length || 1)) * 100).toFixed(0)}%)</span>
              </h3>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h4 style={{ margin: 0 }}>
          {isAuditMode ? 'Lista de Alumnos (Modo Auditoría)' : 'Estado de los Alumnos'}
        </h4>
        {selectedDebts.length > 0 && !isAuditMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', backgroundColor: 'rgba(99,102,241,0.1)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)' }}>
            <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{selectedDebts.length} seleccionados</span>
            <div style={{ borderLeft: '1px solid rgba(255,255,255,0.2)', height: '20px' }}></div>
            <span style={{ fontSize: '0.9rem' }}>Marcar como pagado por:</span>
            <button onClick={() => handleBulkPayment('cash')} className="btn btn-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}>Efectivo</button>
            <button onClick={() => handleBulkPayment('transfer')} className="btn btn-outline" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', color: 'var(--primary)', borderColor: 'var(--primary)' }}>Transferencia</button>
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ overflowX: 'auto' }}>
        <table className={`mobile-accordion ${isAuditMode ? 'audit-mode' : ''}`} style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              {isAuditMode ? (
                <>
                  <th style={{ padding: '1rem', width: '50px', textAlign: 'center' }}>Audit.</th>
                  <th style={{ padding: '1rem' }}>Alumno</th>
                  <th style={{ padding: '1rem' }}>Estado</th>
                  <th style={{ padding: '1rem' }}>Monto Sistema</th>
                  <th style={{ padding: '1rem', width: '160px' }}>Monto Manual ($)</th>
                  <th style={{ padding: '1rem' }}>Cuadratura</th>
                  <th style={{ padding: '1rem' }}>Comprobante</th>
                  <th style={{ padding: '1rem' }}>Acciones</th>
                </>
              ) : (
                <>
                  <th style={{ padding: '1rem', width: '40px' }}>
                    <input 
                      type="checkbox" 
                      onChange={toggleSelectAll}
                      checked={debts.filter(d => d.status === 'pending' || d.status === 'partial').length > 0 && selectedDebts.length === debts.filter(d => d.status === 'pending' || d.status === 'partial').length}
                      disabled={debts.filter(d => d.status === 'pending' || d.status === 'partial').length === 0}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  <th style={{ padding: '1rem' }}>Alumno</th>
                  <th style={{ padding: '1rem' }}>Apoderado</th>
                  <th style={{ padding: '1rem' }}>Estado</th>
                  <th style={{ padding: '1rem' }}>Monto A Cobrar</th>
                  <th style={{ padding: '1rem' }}>Monto Informado</th>
                  <th style={{ padding: '1rem' }}>Comprobante</th>
                  <th style={{ padding: '1rem' }}>Acciones</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {debts.map(debt => {
              const isExpanded = expandedDebts.includes(debt.id);
              const isAudited = !!auditChecks[debt.id];
              const sysPaidAmt = debt.status === 'paid' 
                ? (typeof debt.paidAmount === 'number' ? debt.paidAmount : (debt.amount || 0))
                : (debt.status === 'partial' ? (debt.paidAmount || 0) : 0);

              const rowBgColor = isAuditMode 
                ? (isAudited ? 'rgba(139, 92, 246, 0.12)' : 'transparent')
                : (selectedDebts.includes(debt.id) 
                  ? 'rgba(99,102,241,0.1)' 
                  : debt.status === 'paid' 
                    ? (isExpanded ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.35)')
                    : debt.status === 'partial' 
                      ? (isExpanded ? 'rgba(234, 179, 8, 0.08)' : 'rgba(234, 179, 8, 0.35)')
                      : debt.status === 'pending'
                        ? (isExpanded ? 'rgba(239, 68, 68, 0.08)' : 'rgba(239, 68, 68, 0.35)')
                        : 'transparent');

              return (
              <tr 
                key={debt.id} 
                onClick={(e) => toggleAccordionRow(debt.id, e)}
                className={isExpanded ? 'expanded' : ''}
                style={{ 
                  borderBottom: '1px solid var(--border-color)', 
                  backgroundColor: rowBgColor, 
                  transition: 'background-color 0.2s',
                  borderLeft: isAuditMode && isAudited ? '4px solid #8b5cf6' : 'none'
                }}
              >
                {isAuditMode ? (
                  /* Celdas de Auditoría */
                  <>
                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                      <button 
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleToggleAuditCheck(debt.id); }}
                        style={{
                          background: isAudited ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255,255,255,0.05)',
                          border: isAudited ? '2px solid #8b5cf6' : '1px solid var(--border-color)',
                          color: isAudited ? '#c4b5fd' : 'var(--text-muted)',
                          borderRadius: '6px',
                          width: '30px',
                          height: '30px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        title={isAudited ? 'Desmarcar tick' : 'Marcar como verificado'}
                      >
                        {isAudited ? <Check size={18} /> : null}
                      </button>
                    </td>

                    <td style={{ padding: '1rem', fontWeight: '500' }}>
                      {(() => {
                        const student = students.find(s => s.id === debt.studentId);
                        return (
                          <div>
                            {student ? `${student.listNumber || '-'}. ${formatStudentName(student)}` : debt.studentName}
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                              {(() => {
                                const emails = student?.apoderadoEmails?.length > 0 ? student.apoderadoEmails : (student?.apoderadoEmail ? [student.apoderadoEmail] : (debt.apoderadoEmails?.length > 0 ? debt.apoderadoEmails : (debt.apoderadoEmail ? [debt.apoderadoEmail] : [])));
                                if (!emails || emails.length === 0) return 'Sin apoderado';
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                                    {emails.map((email, idx) => (
                                      <span key={idx}>{email}</span>
                                    ))}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })()}
                    </td>

                    <td style={{ padding: '1rem' }}>
                      {debt.status === 'paid' && (
                        <span style={{ padding: '0.2rem 0.6rem', borderRadius: '1rem', fontSize: '0.8rem', backgroundColor: 'rgba(16, 185, 129, 0.2)', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          <CheckCircle size={13}/> Pagado
                        </span>
                      )}
                      {debt.status === 'review' && (
                        <span style={{ padding: '0.2rem 0.6rem', borderRadius: '1rem', fontSize: '0.8rem', backgroundColor: 'rgba(245, 158, 11, 0.2)', color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Clock size={13}/> En Revisión
                        </span>
                      )}
                      {debt.status === 'partial' && (
                        <span style={{ padding: '0.2rem 0.6rem', borderRadius: '1rem', fontSize: '0.8rem', backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#eab308', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Clock size={13}/> Parcial
                        </span>
                      )}
                      {debt.status === 'pending' && (
                        <span style={{ padding: '0.2rem 0.6rem', borderRadius: '1rem', fontSize: '0.8rem', backgroundColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          <XCircle size={13}/> Pendiente
                        </span>
                      )}
                    </td>

                    <td style={{ padding: '1rem', fontWeight: 'bold', color: sysPaidAmt > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                      {formatMoney(sysPaidAmt)}
                    </td>

                    <td style={{ padding: '1rem' }}>
                      <input 
                        type="number"
                        className="input-field"
                        placeholder="$ 0"
                        value={auditManualAmounts[debt.id] ?? ''}
                        onChange={(e) => handleAuditManualAmountChange(debt.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          width: '120px',
                          padding: '0.4rem 0.6rem',
                          fontSize: '0.9rem',
                          fontWeight: 'bold',
                          borderColor: isAudited ? '#8b5cf6' : 'var(--border-color)',
                          backgroundColor: 'rgba(15, 23, 42, 0.8)'
                        }}
                      />
                    </td>

                    <td style={{ padding: '1rem' }}>
                      {(() => {
                        const manualVal = parseFloat(auditManualAmounts[debt.id]);
                        if (isNaN(manualVal)) {
                          return <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Sin ingresar</span>;
                        }
                        const diff = manualVal - sysPaidAmt;
                        if (diff === 0) {
                          return (
                            <span style={{ 
                              fontSize: '0.75rem', 
                              padding: '0.2rem 0.5rem', 
                              borderRadius: '10px', 
                              backgroundColor: 'rgba(16, 185, 129, 0.15)', 
                              color: 'var(--success)',
                              fontWeight: 'bold',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.2rem'
                            }}>
                              <Check size={13} /> OK ($0)
                            </span>
                          );
                        }
                        return (
                          <span style={{ 
                            fontSize: '0.75rem', 
                            padding: '0.2rem 0.5rem', 
                            borderRadius: '10px', 
                            backgroundColor: 'rgba(239, 68, 68, 0.2)', 
                            color: 'var(--danger)',
                            fontWeight: 'bold',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.2rem'
                          }}>
                            <AlertTriangle size={13} /> {diff > 0 ? `+${formatMoney(diff)}` : formatMoney(diff)}
                          </span>
                        );
                      })()}
                    </td>

                    <td style={{ padding: '1rem' }}>
                      {debt.receiptUrl ? (
                        <button 
                          onClick={(e) => { e.stopPropagation(); setSelectedReceipt(debt.receiptUrl); }} 
                          className="btn btn-outline" 
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                        >
                          <FileText size={13}/> Ver
                        </button>
                      ) : '-'}
                    </td>

                    <td style={{ padding: '1rem' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleAuditCheck(debt.id); }}
                        className="btn btn-outline"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', borderColor: isAudited ? 'var(--success)' : '#8b5cf6', color: isAudited ? 'var(--success)' : '#c4b5fd' }}
                      >
                        {isAudited ? '✔ Listo' : 'Verificar'}
                      </button>
                    </td>
                  </>
                ) : (
                  /* Celdas Estándar */
                  <>
                    <td style={{ padding: '1rem' }}>
                      {(debt.status === 'pending' || debt.status === 'partial') && (
                        <input 
                          type="checkbox" 
                          checked={selectedDebts.includes(debt.id)}
                          onChange={() => toggleSelectDebt(debt.id)}
                          style={{ cursor: 'pointer' }}
                        />
                      )}
                    </td>
                    <td style={{ padding: '1rem', fontWeight: '500' }}>
                      {(() => {
                        const student = students.find(s => s.id === debt.studentId);
                        return (
                          <div>
                            {student ? `${student.listNumber || '-'}. ${formatStudentName(student)}` : debt.studentName}
                            {student && student.balance > 0 && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--success)', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                <span>💰 Saldo a favor:</span>
                                <strong>{formatMoney(student.balance)}</strong>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>
                      {(() => {
                        const student = students.find(s => s.id === debt.studentId);
                        const emails = student?.apoderadoEmails?.length > 0 ? student.apoderadoEmails : (student?.apoderadoEmail ? [student.apoderadoEmail] : (debt.apoderadoEmails?.length > 0 ? debt.apoderadoEmails : (debt.apoderadoEmail ? [debt.apoderadoEmail] : [])));
                        if (!emails || emails.length === 0) return 'Sin apoderado';
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            {emails.map((email, idx) => (
                              <span key={idx} style={{ fontSize: '0.85rem' }}>{email}</span>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    
                    <td style={{ padding: '1rem' }}>
                      {debt.status === 'paid' && (
                        <span style={{ padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.85rem', backgroundColor: 'rgba(16, 185, 129, 0.2)', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                          <CheckCircle size={14}/> Pagado
                        </span>
                      )}
                      {debt.status === 'review' && (
                        <span style={{ padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.85rem', backgroundColor: 'rgba(245, 158, 11, 0.2)', color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                          <Clock size={14}/> En Revisión
                        </span>
                      )}
                      {debt.status === 'partial' && (
                        <span style={{ padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.85rem', backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#eab308', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}>
                          <Clock size={14}/> Pago Parcial
                        </span>
                      )}
                      {debt.status === 'pending' && (
                        <span style={{ padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.85rem', backgroundColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                          <XCircle size={14}/> Pendiente
                        </span>
                      )}
                    </td>

                    <td style={{ padding: '1rem', fontWeight: 'bold' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {formatMoney(debt.amount)}
                        <button 
                          onClick={() => handleEditDebtAmount(debt.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '0.2rem' }}
                          title="Modificar Monto A Cobrar"
                        >
                          <Edit2 size={14} />
                        </button>
                      </div>
                    </td>
                    
                    <td style={{ padding: '1rem', color: 'var(--success)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {debt.paidAmount ? `+${formatMoney(debt.paidAmount)}` : '-'}
                        {(debt.status === 'paid' || debt.status === 'partial' || debt.status === 'review') && (
                          <button 
                            onClick={() => handleEditPaidAmount(debt.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--success)', cursor: 'pointer', padding: '0.2rem' }}
                            title="Modificar Monto Informado"
                          >
                            <Edit2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>

                    <td style={{ padding: '1rem' }}>
                      {debt.receiptUrl ? (
                        <button 
                          onClick={() => setSelectedReceipt(debt.receiptUrl)} 
                          className="btn btn-outline" 
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
                        >
                          <FileText size={14}/> Ver Archivo
                        </button>
                      ) : '-'}
                    </td>

                    <td style={{ padding: '1rem' }}>
                      {debt.status === 'review' ? (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button 
                            onClick={() => handleApprovePayment(debt.id)}
                            className="btn btn-primary" 
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', backgroundColor: 'var(--success)' }}
                            title="Aprobar Pago"
                          >
                            <CheckCircle size={16} /> Aprobar
                          </button>
                          <button 
                            onClick={() => handleRejectPayment(debt.id)}
                            className="btn btn-outline" 
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                            title="Rechazar Comprobante"
                          >
                            <XCircle size={16} /> Rechazar
                          </button>
                        </div>
                      ) : (debt.status === 'pending' || debt.status === 'partial') ? (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <button 
                            onClick={() => handleManualPayment(debt.id, 'cash')}
                            className="btn btn-outline" 
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', color: 'var(--primary)', borderColor: 'rgba(99, 102, 241, 0.3)' }}
                            title="Pago Manual en Efectivo"
                          >
                             Efectivo
                          </button>
                          <button 
                            onClick={() => handleManualPayment(debt.id, 'transfer')}
                            className="btn btn-outline" 
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', color: 'var(--primary)', borderColor: 'rgba(99, 102, 241, 0.3)' }}
                            title="Pago Manual con Transferencia"
                          >
                             Transf.
                          </button>
                          {(() => {
                            const student = students.find(s => s.id === debt.studentId || s.name === debt.studentName);
                            if (student && student.balance > 0) {
                              return (
                                <button 
                                  onClick={() => handlePayWithBalance(debt.id)}
                                  className="btn btn-primary" 
                                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', backgroundColor: 'var(--success)', border: 'none' }}
                                  title={`Usar saldo a favor de ${formatMoney(student.balance)}`}
                                >
                                   Usar Saldo
                                </button>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button 
                            onClick={() => handleCancelPayment(debt.id)}
                            className="btn btn-outline" 
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                            title="Cancelar pago registrado"
                          >
                            Cancelar Pago
                          </button>
                        </div>
                      )}
                    </td>
                  </>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
        {debts.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No hay detalles para mostrar.
          </div>
        )}
      </div>
    </div>
  );
};

export default ExpenseDetail;
