import { db } from '../firebase/config';
import { collection, addDoc, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, query, where } from 'firebase/firestore';

// Solicitar una aprobación (crear registro en pending_actions)
export const requestApproval = async (type, summary, payload, user, courseId) => {
  const pendingActionRef = collection(db, 'pending_actions');
  await addDoc(pendingActionRef, {
    type,
    summary,
    payload,
    requestedBy: user.uid,
    requestedByName: user.displayName || user.email,
    courseId,
    status: 'pending',
    createdAt: new Date().toISOString()
  });
};

// Ejecutar una acción una vez aprobada por tesorería
export const executeApproval = async (actionId, actionData, reviewedBy) => {
  const { type, payload } = actionData;
  
  try {
    switch (type) {
      case 'CREATE_EXPENSE':
        await executeCreateExpense(payload);
        break;
      case 'CREATE_OUTCOME':
        await executeCreateOutcome(payload);
        break;
      case 'REGISTER_PAYMENTS':
        await executeRegisterPayments(payload);
        break;
      default:
        throw new Error('Tipo de acción desconocida');
    }

    // Actualizar el estado de la solicitud
    await updateDoc(doc(db, 'pending_actions', actionId), {
      status: 'approved',
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewedBy.uid
    });
    
    return { success: true };
  } catch (error) {
    console.error("Error ejecutando acción:", error);
    return { success: false, error: error.message };
  }
};

// Rechazar una solicitud
export const rejectApproval = async (actionId, reviewedBy) => {
  await updateDoc(doc(db, 'pending_actions', actionId), {
    status: 'rejected',
    reviewedAt: new Date().toISOString(),
    reviewedBy: reviewedBy.uid
  });
};

// --- Funciones de Ejecución Específicas ---

const executeCreateOutcome = async (payload) => {
  const outcomeId = payload.outcomeId || ('out_' + Date.now().toString());
  await setDoc(doc(db, 'outcomes', outcomeId), payload.outcomeData);
};

const executeRegisterPayments = async (payload) => {
  // payload.debtsToUpdate is an array of { debtId, updates: { paidAmount, status, paymentMethod } }
  // payload.expenseId is optional, to update expense paidCount
  // payload.studentBalances is optional array of { studentId, newBalance }
  
  if (payload.debtsToUpdate) {
    for (const debtUpdate of payload.debtsToUpdate) {
      const approvedAtIso = new Date().toISOString();
      await updateDoc(doc(db, 'debts', debtUpdate.debtId), {
        ...debtUpdate.updates,
        approvedAt: approvedAtIso
      });
      const paidNow = debtUpdate.amountToLog || debtUpdate.updates?.paidAmount || 0;
      if (paidNow > 0) {
        await addDoc(collection(db, 'payments'), {
          debtId: debtUpdate.debtId,
          courseId: debtUpdate.updates?.courseId || '',
          fundId: debtUpdate.updates?.fundId || 'general',
          amount: paidNow,
          paymentMethod: debtUpdate.updates?.paymentMethod || 'transfer',
          studentName: debtUpdate.updates?.studentName || '',
          title: debtUpdate.updates?.title || 'Cuota',
          status: debtUpdate.updates?.status || 'paid',
          createdAt: approvedAtIso
        });
      }
    }
  }

  if (payload.studentBalances && payload.studentBalances.length > 0) {
    for (const studentUpdate of payload.studentBalances) {
      await updateDoc(doc(db, 'students', studentUpdate.studentId), {
        balance: studentUpdate.newBalance
      });
    }
  }

  if (payload.expenseId && payload.expensePaidCount !== undefined) {
    await updateDoc(doc(db, 'expenses', payload.expenseId), {
      paidCount: payload.expensePaidCount
    });
  }
};

const executeCreateExpense = async (payload) => {
  // Extract data needed from payload
  const { 
    expenseId, expenseData, debtsData, 
    autoFundId, autoFundData,
    studentBalances
  } = payload;

  if (autoFundId && autoFundData) {
    await setDoc(doc(db, 'funds', autoFundId), autoFundData);
  }

  await setDoc(doc(db, 'expenses', expenseId), expenseData);

  for (const debt of debtsData) {
    await setDoc(doc(db, 'debts', debt.debtId), debt.debtData);
    if (debt.debtData?.paidAmount > 0) {
      await addDoc(collection(db, 'payments'), {
        debtId: debt.debtId,
        courseId: debt.debtData.courseId || expenseData?.courseId || '',
        fundId: debt.debtData.fundId || expenseData?.fundId || 'general',
        amount: debt.debtData.paidAmount,
        paymentMethod: debt.debtData.paymentMethod || 'balance',
        studentName: debt.debtData.studentName || '',
        title: debt.debtData.title || expenseData?.title || 'Cuota',
        status: debt.debtData.status || 'paid',
        createdAt: debt.debtData.approvedAt || new Date().toISOString()
      });
    }
  }

  if (studentBalances && studentBalances.length > 0) {
    for (const studentUpdate of studentBalances) {
      await updateDoc(doc(db, 'students', studentUpdate.studentId), {
        balance: studentUpdate.newBalance
      });
    }
  }
};
