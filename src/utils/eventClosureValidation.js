import { db } from '../firebase/config';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

/**
 * Formatea un número a moneda chilena CLP ($X.XXX)
 */
export const formatMoneyCLP = (amount) => {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
};

/**
 * Valida de forma estricta si un evento está listo para ser marcado como
 * "Terminado y Cuadrado".
 * 
 * Requisitos indispensables para cerrar:
 * 1. Que no existan cuotas obligatorias pendientes por pagar.
 * 2. Que se haya realizado el arqueo de cierre de caja (closingAudit).
 * 3. Que la caja esté perfectamente cuadrada (diferencia == $0).
 */
export async function checkEventClosureReadiness(event) {
  if (!event || !event.id) {
    return {
      canClose: false,
      blockingReasons: ['Evento inválido o no encontrado.'],
      totalQuotas: 0,
      pendingQuotas: 0,
      pendingQuotasAmount: 0,
      pendingFines: 0,
      pendingFinesAmount: 0,
      hasClosingAudit: false,
      auditDifference: null,
      isCashBalanced: false,
      closingAudit: null
    };
  }

  const isTest = Boolean(event.isTestEvent);
  const eventId = event.id;

  // 1. Obtener deudas vinculadas al evento
  let debts = [];
  try {
    const qDebts = query(collection(db, 'debts'), where('eventId', '==', eventId));
    const snapDebts = await getDocs(qDebts);
    debts = snapDebts.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("Error consultando deudas del evento:", err);
  }

  // Separar cuotas obligatorias vs multas
  const mandatoryDebts = debts.filter(d => {
    const title = (d.title || '').toLowerCase();
    const expId = d.expenseId || '';
    return !title.includes('multa') && !expId.includes('_fine_');
  });

  const fineDebts = debts.filter(d => {
    const title = (d.title || '').toLowerCase();
    const expId = d.expenseId || '';
    return title.includes('multa') || expId.includes('_fine_');
  });

  const pendingQuotasList = mandatoryDebts.filter(d => d.status !== 'paid');
  const pendingQuotas = pendingQuotasList.length;
  const pendingQuotasAmount = pendingQuotasList.reduce((sum, d) => {
    const total = Number(d.amount) || 0;
    const paid = Number(d.paidAmount) || 0;
    return sum + (total - paid);
  }, 0);

  const pendingFinesList = fineDebts.filter(d => d.status !== 'paid');
  const pendingFines = pendingFinesList.length;
  const pendingFinesAmount = pendingFinesList.reduce((sum, d) => {
    const total = Number(d.amount) || 0;
    const paid = Number(d.paidAmount) || 0;
    return sum + (total - paid);
  }, 0);

  // 2. Obtener caja chica y arqueo de cierre
  let closingAudit = null;
  try {
    const pettySnap = await getDoc(doc(db, 'eventPettyCash', `petty_${eventId}`));
    if (pettySnap.exists()) {
      const pData = pettySnap.data();
      closingAudit = pData?.closingAudit || null;
    }
  } catch (err) {
    console.warn("Error consultando caja chica del evento:", err);
  }

  const hasClosingAudit = Boolean(closingAudit);
  const auditDifference = closingAudit ? Number(closingAudit.difference || 0) : null;
  const isCashBalanced = hasClosingAudit && auditDifference === 0;

  // 3. Evaluar motivos de bloqueo
  const blockingReasons = [];

  if (!isTest && pendingQuotas > 0) {
    blockingReasons.push(
      `Existen ${pendingQuotas} cuota(s) obligatoria(s) sin pagar por un total pendiente de ${formatMoneyCLP(pendingQuotasAmount)}.`
    );
  }

  if (!isTest && pendingFines > 0) {
    blockingReasons.push(
      `Existen ${pendingFines} multa(s) de inasistencia sin cobrar por un total de ${formatMoneyCLP(pendingFinesAmount)}.`
    );
  }

  if (!hasClosingAudit) {
    blockingReasons.push(
      'La caja del evento no ha sido arqueada ni cuadrada (falta realizar el arqueo de cierre).'
    );
  } else if (auditDifference !== 0) {
    const diffText = auditDifference > 0
      ? `sobrante de +${formatMoneyCLP(auditDifference)}`
      : `faltante de -${formatMoneyCLP(Math.abs(auditDifference))}`;
    blockingReasons.push(
      `La caja presenta un descuadre (${diffText}). La diferencia en el arqueo debe ser exactamente $0 para poder cerrar el evento.`
    );
  }

  const canClose = blockingReasons.length === 0;

  return {
    canClose,
    blockingReasons,
    totalQuotas: mandatoryDebts.length,
    pendingQuotas,
    pendingQuotasAmount,
    totalFines: fineDebts.length,
    pendingFines,
    pendingFinesAmount,
    hasClosingAudit,
    closingAudit,
    auditDifference,
    isCashBalanced
  };
}
