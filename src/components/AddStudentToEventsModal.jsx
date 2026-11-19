import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../firebase/config';
import {
  collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, addDoc
} from 'firebase/firestore';
import {
  X, Calendar, FileText, CheckCircle, PlusCircle, Search, DollarSign, CreditCard, Clock
} from 'lucide-react';
import { formatStudentName } from '../utils/nameUtils';
import { formatEventDate } from '../utils/eventPdfService';
import { useCourse } from '../context/CourseContext';
import { useModal } from '../context/ModalContext';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';

const formatMoney = (amount) => {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
};

export const syncExpenseTotals = async (expenseId) => {
  if (!expenseId) return { studentsCount: 0, paidCount: 0, totalAmount: 0 };
  const debtsSnap = await getDocs(query(collection(db, 'debts'), where('expenseId', '==', expenseId)));
  const studentsCount = debtsSnap.size;
  const paidCount = debtsSnap.docs.filter(d => d.data().status === 'paid').length;
  const totalAmount = debtsSnap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0);
  return { studentsCount, paidCount, totalAmount };
};

export const addStudentsToEvent = async ({
  event,
  studentsToAdd,
  initialStatus = 'pending',
  courseId,
  fallbackExistingIds = [],
  initializeParticipantsIfMissing = false
}) => {
  if (!event?.id || !studentsToAdd || studentsToAdd.length === 0) return;

  const nowIso = new Date().toISOString();
  const evRef = doc(db, 'events', event.id);
  const evSnap = await getDoc(evRef);
  const evData = evSnap.exists() ? { id: evSnap.id, ...evSnap.data() } : event;
  const effectiveCourseId = courseId || evData.courseId || studentsToAdd[0]?.courseId || '';
  const newIds = studentsToAdd.map(s => s.id);

  // 1. Si no es evento de prueba y tiene cuota obligatoria > $0, generar deudas individuales y sincronizar la cuota del evento
  let syncedExpenseStats = null;
  if (!evData.isTestEvent && (Number(evData.mandatoryAmount) || 0) > 0) {
    const expenseId = `exp_evt_${event.id}`;
    const amount = Number(evData.mandatoryAmount) || 0;
    const isPaid = initialStatus === 'cash' || initialStatus === 'transfer';

    const existingDebtsSnap = await getDocs(query(collection(db, 'debts'), where('expenseId', '==', expenseId)));
    const existingDebtStudentIds = new Set(existingDebtsSnap.docs.map(d => d.data().studentId));

    for (const student of studentsToAdd) {
      if (existingDebtStudentIds.has(student.id)) continue;

      const debtId = `debt_${expenseId}_${student.id}`;
      const studentDisplayName = formatStudentName(student);
      const quotaTitle = `Cuota Obligatoria: ${(evData.name || '').trim()}`;

      await setDoc(doc(db, 'debts', debtId), {
        expenseId,
        studentId: student.id,
        studentName: studentDisplayName,
        apoderadoEmails: student.apoderadoEmails || (student.apoderadoEmail ? [student.apoderadoEmail] : []),
        amount,
        status: isPaid ? 'paid' : 'pending',
        paidAmount: isPaid ? amount : 0,
        paymentMethod: isPaid ? initialStatus : null,
        approvedAt: isPaid ? nowIso : null,
        paidAt: isPaid ? nowIso : null,
        title: quotaTitle,
        date: evData.date || '',
        fundId: evData.fundId || 'general',
        courseId: effectiveCourseId,
        eventId: event.id,
        createdAt: nowIso
      });

      if (isPaid && amount > 0) {
        await addDoc(collection(db, 'payments'), {
          debtId,
          courseId: effectiveCourseId,
          fundId: evData.fundId || 'general',
          amount,
          paymentMethod: initialStatus,
          studentName: studentDisplayName,
          title: quotaTitle,
          status: 'paid',
          createdAt: nowIso
        });
      }
    }

    syncedExpenseStats = await syncExpenseTotals(expenseId);
    const expRef = doc(db, 'expenses', expenseId);
    const expSnap = await getDoc(expRef);
    if (expSnap.exists()) {
      await updateDoc(expRef, {
        studentsCount: syncedExpenseStats.studentsCount,
        paidCount: syncedExpenseStats.paidCount,
        totalAmount: syncedExpenseStats.totalAmount
      });
    } else {
      await setDoc(expRef, {
        title: `Cuota Obligatoria: ${(evData.name || '').trim()}`,
        date: evData.date || '',
        totalAmount: syncedExpenseStats.totalAmount,
        amountPerStudent: amount,
        studentsCount: syncedExpenseStats.studentsCount,
        paidCount: syncedExpenseStats.paidCount,
        fundId: evData.fundId || 'general',
        courseId: effectiveCourseId,
        eventId: event.id,
        createdAt: nowIso
      });
    }
  }

  // 2. Actualizar participantes y conteo en el documento del evento
  const hasParticipantsList = Array.isArray(evData.participantStudentIds);
  if (hasParticipantsList || initializeParticipantsIfMissing || evData.isTestEvent) {
    const baseIds = hasParticipantsList ? evData.participantStudentIds : fallbackExistingIds;
    const updatedParticipants = Array.from(new Set([...baseIds, ...newIds]));
    await updateDoc(evRef, {
      participantStudentIds: updatedParticipants,
      studentsCount: updatedParticipants.length
    });
  } else {
    const fallbackCount = syncedExpenseStats
      ? syncedExpenseStats.studentsCount
      : ((Number(evData.studentsCount) || 0) + newIds.length);
    await updateDoc(evRef, {
      studentsCount: fallbackCount
    });
  }
};

const AddStudentToEventsModal = ({ student, isOpen, onClose, onSuccess }) => {
  const { selectedCourse } = useCourse();
  const { showAlert, showPrompt } = useModal();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('events'); // 'events' | 'expenses'
  const [availableEvents, setAvailableEvents] = useState([]);
  const [availableExpenses, setAvailableExpenses] = useState([]);
  const [selectedEventIds, setSelectedEventIds] = useState(new Set());
  const [selectedExpenseIds, setSelectedExpenseIds] = useState(new Set());
  const [customExpenseAmounts, setCustomExpenseAmounts] = useState({});
  const [initialStatus, setInitialStatus] = useState('pending'); // 'pending' | 'cash' | 'transfer'
  const [searchTerm, setSearchTerm] = useState('');

  useLockBodyScroll(isOpen);

  const fetchAvailableItems = useCallback(async () => {
    if (!isOpen || !student?.id) return;
    const courseId = student.courseId || selectedCourse?.id;
    if (!courseId) return;

    setLoading(true);
    try {
      const [eventsSnap, expensesSnap, studentDebtsSnap] = await Promise.all([
        getDocs(query(collection(db, 'events'), where('courseId', '==', courseId))),
        getDocs(query(collection(db, 'expenses'), where('courseId', '==', courseId))),
        getDocs(query(collection(db, 'debts'), where('studentId', '==', student.id)))
      ]);

      const studentDebts = studentDebtsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const studentExpenseIds = new Set(studentDebts.map(d => d.expenseId).filter(Boolean));

      // 1. Eventos disponibles donde falta el alumno
      const allEvents = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const missingEvents = allEvents.filter(ev => {
        if (ev.isTestEvent || (Number(ev.mandatoryAmount) || 0) <= 0) {
          return !Array.isArray(ev.participantStudentIds) || !ev.participantStudentIds.includes(student.id);
        }
        const mainExpId = `exp_evt_${ev.id}`;
        const hasMainDebt = studentExpenseIds.has(mainExpId);
        const inParticipants = !Array.isArray(ev.participantStudentIds) || ev.participantStudentIds.includes(student.id);
        return !hasMainDebt || !inParticipants;
      });
      missingEvents.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

      // 2. Otras cuotas generales del curso donde falta el alumno
      const allExpenses = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const missingExpenses = allExpenses.filter(exp => {
        if (exp.eventId || exp.id.startsWith('exp_evt_')) return false;
        return !studentExpenseIds.has(exp.id);
      });
      missingExpenses.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

      setAvailableEvents(missingEvents);
      setAvailableExpenses(missingExpenses);
      setSelectedEventIds(new Set());
      setSelectedExpenseIds(new Set());
      setCustomExpenseAmounts({});
      setSearchTerm('');
      setInitialStatus('pending');
      setActiveTab(missingEvents.length > 0 ? 'events' : (missingExpenses.length > 0 ? 'expenses' : 'events'));
    } catch (err) {
      console.error("Error cargando eventos y cuotas disponibles:", err);
      await showAlert("Error al cargar los eventos y cuotas disponibles.");
    } finally {
      setLoading(false);
    }
  }, [isOpen, student?.id, student?.courseId, selectedCourse?.id, showAlert]);

  useEffect(() => {
    if (isOpen && student?.id) {
      fetchAvailableItems();
    }
  }, [isOpen, student?.id, fetchAvailableItems]);

  const filteredEvents = useMemo(() => {
    if (!searchTerm.trim()) return availableEvents;
    const t = searchTerm.toLowerCase();
    return availableEvents.filter(ev =>
      (ev.name || '').toLowerCase().includes(t) || (ev.date || '').includes(t)
    );
  }, [availableEvents, searchTerm]);

  const filteredExpenses = useMemo(() => {
    if (!searchTerm.trim()) return availableExpenses;
    const t = searchTerm.toLowerCase();
    return availableExpenses.filter(exp =>
      (exp.title || '').toLowerCase().includes(t) || (exp.date || '').includes(t)
    );
  }, [availableExpenses, searchTerm]);

  const totalSelectedCount = selectedEventIds.size + selectedExpenseIds.size;

  const toggleEventSelection = (evId) => {
    setSelectedEventIds(prev => {
      const next = new Set(prev);
      if (next.has(evId)) next.delete(evId);
      else next.add(evId);
      return next;
    });
  };

  const toggleExpenseSelection = (expId) => {
    setSelectedExpenseIds(prev => {
      const next = new Set(prev);
      if (next.has(expId)) next.delete(expId);
      else next.add(expId);
      return next;
    });
  };

  const handleToggleSelectAllVisible = () => {
    if (activeTab === 'events') {
      const visibleIds = filteredEvents.map(e => e.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedEventIds.has(id));
      setSelectedEventIds(prev => {
        const next = new Set(prev);
        if (allSelected) visibleIds.forEach(id => next.delete(id));
        else visibleIds.forEach(id => next.add(id));
        return next;
      });
    } else {
      const visibleIds = filteredExpenses.map(e => e.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedExpenseIds.has(id));
      setSelectedExpenseIds(prev => {
        const next = new Set(prev);
        if (allSelected) visibleIds.forEach(id => next.delete(id));
        else visibleIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const handleSave = async () => {
    if (totalSelectedCount === 0 || saving) return;
    const courseId = student.courseId || selectedCourse?.id || '';

    // Pre-resolver montos de cuotas variables si no se ingresaron inline
    const resolvedExpenseAmounts = {};
    for (const expId of selectedExpenseIds) {
      const exp = availableExpenses.find(e => e.id === expId);
      if (!exp) continue;

      if (typeof exp.amountPerStudent === 'number' && !isNaN(exp.amountPerStudent) && exp.amountPerStudent >= 0) {
        resolvedExpenseAmounts[expId] = exp.amountPerStudent;
      } else {
        const manualVal = customExpenseAmounts[expId];
        if (manualVal !== undefined && manualVal !== '' && !isNaN(parseFloat(manualVal)) && parseFloat(manualVal) >= 0) {
          resolvedExpenseAmounts[expId] = parseFloat(manualVal);
        } else {
          // Buscar monto de otra deuda de esta cuota
          const existingSnap = await getDocs(query(collection(db, 'debts'), where('expenseId', '==', expId)));
          const positiveAmounts = [...new Set(existingSnap.docs.map(d => Number(d.data().amount) || 0).filter(a => a > 0))];
          if (positiveAmounts.length === 1) {
            resolvedExpenseAmounts[expId] = positiveAmounts[0];
          } else {
            const promptStr = await showPrompt(
              `Ingresa el Monto a Cobrar ($) para la cuota "${exp.title}" para ${formatStudentName(student)}:`,
              ''
            );
            if (promptStr === null) return;
            const parsed = parseFloat(promptStr);
            if (isNaN(parsed) || parsed < 0) {
              await showAlert("Ingresa un monto válido (0 o mayor).");
              return;
            }
            resolvedExpenseAmounts[expId] = parsed;
          }
        }
      }
    }

    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const isPaid = initialStatus === 'cash' || initialStatus === 'transfer';
      const studentDisplayName = formatStudentName(student);

      // 1. Procesar eventos seleccionados
      for (const evId of selectedEventIds) {
        const ev = availableEvents.find(e => e.id === evId);
        if (!ev) continue;
        await addStudentsToEvent({
          event: ev,
          studentsToAdd: [student],
          initialStatus,
          courseId
        });
      }

      // 2. Procesar cuotas generales seleccionadas
      for (const expId of selectedExpenseIds) {
        const exp = availableExpenses.find(e => e.id === expId);
        if (!exp) continue;

        const amount = resolvedExpenseAmounts[expId] ?? 0;
        const debtId = `debt_${exp.id}_${student.id}`;

        await setDoc(doc(db, 'debts', debtId), {
          expenseId: exp.id,
          studentId: student.id,
          studentName: studentDisplayName,
          apoderadoEmails: student.apoderadoEmails || (student.apoderadoEmail ? [student.apoderadoEmail] : []),
          amount,
          status: isPaid ? 'paid' : 'pending',
          paidAmount: isPaid ? amount : 0,
          paymentMethod: isPaid ? initialStatus : null,
          approvedAt: isPaid ? nowIso : null,
          paidAt: isPaid ? nowIso : null,
          title: exp.title,
          date: exp.date || '',
          fundId: exp.fundId || 'general',
          courseId,
          transferData: exp.transferData || null,
          visibleInPortal: exp.visibleInPortal !== false,
          createdAt: nowIso
        });

        if (isPaid && amount > 0) {
          await addDoc(collection(db, 'payments'), {
            debtId,
            courseId,
            fundId: exp.fundId || 'general',
            amount,
            paymentMethod: initialStatus,
            studentName: studentDisplayName,
            title: exp.title,
            status: 'paid',
            createdAt: nowIso
          });
        }

        const stats = await syncExpenseTotals(exp.id);
        await updateDoc(doc(db, 'expenses', exp.id), {
          studentsCount: stats.studentsCount,
          paidCount: stats.paidCount,
          totalAmount: stats.totalAmount
        });
      }

      await showAlert(
        `¡${studentDisplayName} fue agregado correctamente a ${totalSelectedCount} ${totalSelectedCount === 1 ? 'registro' : 'registros'}!`
      );
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error("Error agregando alumno a eventos/cuotas pasadas:", err);
      await showAlert("Error al agregar el alumno: " + (err.message || "Intenta nuevamente."));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !student) return null;

  const visibleList = activeTab === 'events' ? filteredEvents : filteredExpenses;
  const visibleIds = visibleList.map(item => item.id);
  const currentSelectedSet = activeTab === 'events' ? selectedEventIds : selectedExpenseIds;
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => currentSelectedSet.has(id));

  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
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
        padding: '1.25rem 0.75rem 2rem',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch'
      }}
    >
      <div
        className="glass-panel animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '640px',
          maxHeight: 'min(90vh, 760px)',
          margin: '0.5rem auto',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1.15rem 1.5rem',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-main)',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)'
            }}>
              <PlusCircle size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)', fontWeight: '700' }}>
                Agregar a Eventos o Cuotas Pasadas
              </h3>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Alumno: <strong style={{ color: 'var(--text-main)' }}>{formatStudentName(student)}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="btn btn-outline"
            style={{ padding: '0.35rem 0.5rem', borderColor: 'var(--border-color)' }}
            title="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs & Search */}
        <div style={{ padding: '1rem 1.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setActiveTab('events')}
              className={`btn ${activeTab === 'events' ? 'btn-primary' : 'btn-outline'}`}
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Calendar size={15} />
              Eventos Pasados ({availableEvents.length})
              {selectedEventIds.size > 0 && (
                <span style={{ backgroundColor: 'rgba(255,255,255,0.2)', padding: '0.05rem 0.4rem', borderRadius: '10px', fontSize: '0.72rem' }}>
                  {selectedEventIds.size}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('expenses')}
              className={`btn ${activeTab === 'expenses' ? 'btn-primary' : 'btn-outline'}`}
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <FileText size={15} />
              Otras Cuotas ({availableExpenses.length})
              {selectedExpenseIds.size > 0 && (
                <span style={{ backgroundColor: 'rgba(255,255,255,0.2)', padding: '0.05rem 0.4rem', borderRadius: '10px', fontSize: '0.72rem' }}>
                  {selectedExpenseIds.size}
                </span>
              )}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
              <input
                type="text"
                className="input-field"
                placeholder={activeTab === 'events' ? 'Buscar evento por nombre o fecha...' : 'Buscar cuota por nombre o fecha...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: '100%', padding: '0.45rem 0.65rem 0.45rem 2rem', fontSize: '0.85rem' }}
              />
              <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            </div>

            {visibleList.length > 0 && (
              <button
                type="button"
                onClick={handleToggleSelectAllVisible}
                className="btn btn-outline"
                style={{ fontSize: '0.78rem', padding: '0.45rem 0.75rem' }}
              >
                {allVisibleSelected ? 'Deseleccionar Todos' : 'Seleccionar Todos'}
              </button>
            )}
          </div>
        </div>

        {/* Scrollable List */}
        <div style={{ padding: '1rem 1.5rem', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
              Buscando eventos y cuotas donde falta este alumno...
            </div>
          ) : visibleList.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '2.25rem 1rem',
              backgroundColor: 'rgba(16, 185, 129, 0.05)',
              borderRadius: 'var(--radius-md)',
              border: '1px dashed rgba(16, 185, 129, 0.3)',
              color: 'var(--text-muted)'
            }}>
              <CheckCircle size={28} style={{ color: 'var(--success)', margin: '0 auto 0.5rem' }} />
              <p style={{ margin: '0 0 0.25rem', color: 'var(--text-main)', fontWeight: '600' }}>
                {searchTerm
                  ? 'No hay coincidencias con la búsqueda'
                  : activeTab === 'events'
                    ? 'Ya está incluido en todos los eventos del curso'
                    : 'Ya tiene asignadas todas las cuotas del curso'}
              </p>
              <p style={{ margin: 0, fontSize: '0.8rem' }}>
                {!searchTerm && (activeTab === 'events'
                  ? 'Revisa la pestaña "Otras Cuotas" si deseas agregar cuotas generales.'
                  : 'Revisa la pestaña "Eventos Pasados" para agregarlo a eventos.')}
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {activeTab === 'events' ? filteredEvents.map(ev => {
                const isSelected = selectedEventIds.has(ev.id);
                const isDone = Boolean(ev.isCompleted || ev.status === 'completed');
                return (
                  <div
                    key={ev.id}
                    onClick={() => toggleEventSelection(ev.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      padding: '0.75rem 0.9rem',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border-color)'}`,
                      backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255,255,255,0.02)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleEventSelection(ev.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: '17px', height: '17px', accentColor: 'var(--primary)', cursor: 'pointer', flexShrink: 0 }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: '600', fontSize: '0.92rem', color: 'var(--text-main)' }}>
                            {ev.name}
                          </span>
                          {isDone ? (
                            <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '10px', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)', fontWeight: '600' }}>
                              Terminado
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '10px', backgroundColor: 'rgba(37, 99, 235, 0.15)', color: '#93c5fd', fontWeight: '600' }}>
                              En Curso
                            </span>
                          )}
                          {ev.isTestEvent && (
                            <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: '10px', backgroundColor: 'var(--warning)', color: '#000', fontWeight: '700' }}>
                              PRUEBA
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          Fecha: {formatEventDate(ev.date) || '-'}
                        </span>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {ev.isTestEvent || (Number(ev.mandatoryAmount) || 0) <= 0 ? (
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Sin cuota</span>
                      ) : (
                        <>
                          <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>Cuota obligatoria</span>
                          <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>
                            {formatMoney(ev.mandatoryAmount)}
                          </strong>
                        </>
                      )}
                    </div>
                  </div>
                );
              }) : filteredExpenses.map(exp => {
                const isSelected = selectedExpenseIds.has(exp.id);
                const hasNumericAmount = typeof exp.amountPerStudent === 'number' && !isNaN(exp.amountPerStudent);
                return (
                  <div
                    key={exp.id}
                    onClick={() => toggleExpenseSelection(exp.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      padding: '0.75rem 0.9rem',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border-color)'}`,
                      backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255,255,255,0.02)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleExpenseSelection(exp.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: '17px', height: '17px', accentColor: 'var(--primary)', cursor: 'pointer', flexShrink: 0 }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: '600', fontSize: '0.92rem', color: 'var(--text-main)' }}>
                          {exp.title}
                        </span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          Fecha: {formatEventDate(exp.date) || exp.date || '-'}
                        </span>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                      {hasNumericAmount ? (
                        <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>
                          {formatMoney(exp.amountPerStudent)}
                        </strong>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Monto $:</span>
                          <input
                            type="number"
                            min="0"
                            placeholder="Variable"
                            value={customExpenseAmounts[exp.id] ?? ''}
                            onChange={(e) => {
                              setCustomExpenseAmounts(prev => ({ ...prev, [exp.id]: e.target.value }));
                              if (!isSelected && e.target.value !== '') toggleExpenseSelection(exp.id);
                            }}
                            className="input-field"
                            style={{ width: '95px', padding: '0.25rem 0.45rem', fontSize: '0.82rem' }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer: Estado inicial y Guardar */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-main)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem'
        }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.45rem', fontWeight: '600' }}>
              Estado inicial de la cuota que se generará:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '0.45rem' }}>
              {[
                { id: 'pending', label: 'Pendiente de pago', icon: <Clock size={14} />, color: 'var(--warning)' },
                { id: 'cash', label: 'Pagada (Efectivo)', icon: <DollarSign size={14} />, color: 'var(--success)' },
                { id: 'transfer', label: 'Pagada (Transf.)', icon: <CreditCard size={14} />, color: 'var(--primary)' }
              ].map(opt => {
                const active = initialStatus === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setInitialStatus(opt.id)}
                    style={{
                      padding: '0.45rem 0.65rem',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${active ? opt.color : 'var(--border-color)'}`,
                      backgroundColor: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                      color: active ? opt.color : 'var(--text-muted)',
                      fontSize: '0.78rem',
                      fontWeight: active ? '600' : '500',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem'
                    }}
                  >
                    {opt.icon} {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="btn btn-outline"
              style={{ padding: '0.5rem 1.15rem' }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || totalSelectedCount === 0}
              className="btn btn-primary"
              style={{ padding: '0.5rem 1.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <PlusCircle size={16} />
              {saving ? 'Agregando...' : `Agregar Alumno (${totalSelectedCount})`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AddStudentToEventsModal;
