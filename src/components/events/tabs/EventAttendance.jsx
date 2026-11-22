import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../../../firebase/config';
import { collection, getDocs, query, where, doc, updateDoc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import {
  CheckSquare, Square, Search, RefreshCw, AlertCircle, Save, CheckCircle2,
  DollarSign, Users, UserX, Edit3, UserPlus, X, Clock, CreditCard, CheckCircle
} from 'lucide-react';
import { useModal } from '../../../context/ModalContext';
import { formatStudentName } from '../../../utils/nameUtils';
import { useLockBodyScroll } from '../../../hooks/useLockBodyScroll';
import { addStudentsToEvent } from '../../AddStudentToEventsModal';

const EventAttendance = ({ event, onEventUpdated }) => {
  const { showAlert } = useModal();
  const [localDebts, setLocalDebts] = useState([]);
  const [allCourseStudents, setAllCourseStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modal para agregar alumnos faltantes al evento
  const [showAddStudentsModal, setShowAddStudentsModal] = useState(false);
  const [addSearchTerm, setAddSearchTerm] = useState('');
  const [selectedNewStudentIds, setSelectedNewStudentIds] = useState(new Set());
  const [newStudentsPaymentStatus, setNewStudentsPaymentStatus] = useState('pending');
  const [addingStudents, setAddingStudents] = useState(false);
  useLockBodyScroll(showAddStudentsModal);
  
  // Monto de la multa por inasistencia
  const [fineAmountInput, setFineAmountInput] = useState(String(event.noShowAmount || 0));
  const [isEditingFineAmount, setIsEditingFineAmount] = useState(false);

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
  };

  const fetchDebts = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Obtener todos los alumnos del curso
      const studentsSnap = await getDocs(collection(db, 'students'));
      const studentsMap = new Map();
      const courseStudents = [];
      studentsSnap.docs.forEach(d => {
        const sData = { id: d.id, ...d.data() };
        studentsMap.set(d.id, sData);
        if (sData.courseId === event.courseId && sData.status !== 'retirado') {
          courseStudents.push(sData);
        }
      });
      courseStudents.sort((a, b) => {
        const aNum = parseInt(a.listNumber, 10) || 999;
        const bNum = parseInt(b.listNumber, 10) || 999;
        return aNum - bNum;
      });
      setAllCourseStudents(courseStudents);

      // Si el evento tiene selección personalizada de alumnos
      const participantIds = event.participantStudentIds && Array.isArray(event.participantStudentIds) && event.participantStudentIds.length > 0
        ? new Set(event.participantStudentIds)
        : null;

      const targetStudents = participantIds 
        ? courseStudents.filter(s => participantIds.has(s.id))
        : courseStudents;

      // 2. Obtener las deudas existentes para este evento (por eventId, expenseId y fundId)
      const mainExpId = `exp_evt_${event.id}`;
      const fineExpId = `exp_evt_fine_${event.id}`;
      const debtQueries = [
        getDocs(query(collection(db, 'debts'), where('eventId', '==', event.id))).catch(() => null),
        getDocs(query(collection(db, 'debts'), where('expenseId', '==', mainExpId))).catch(() => null),
        getDocs(query(collection(db, 'debts'), where('expenseId', '==', fineExpId))).catch(() => null)
      ];
      if (event.fundId && event.fundId !== 'general') {
        debtQueries.push(getDocs(query(collection(db, 'debts'), where('fundId', '==', event.fundId))).catch(() => null));
      }
      const debtSnaps = await Promise.all(debtQueries);
      const uniqueDebtDocsMap = new Map();
      debtSnaps.forEach(s => {
        if (!s) return;
        s.docs.forEach(d => {
          if (!uniqueDebtDocsMap.has(d.id)) {
            uniqueDebtDocsMap.set(d.id, d);
          }
        });
      });
      const allDebtDocs = Array.from(uniqueDebtDocsMap.values());

      // Auto-reparar si alguna deuda del evento no tenía courseId o eventId
      for (const d of allDebtDocs) {
        const data = d.data();
        const repair = {};
        if (!data.eventId) repair.eventId = event.id;
        if (!data.courseId || data.courseId !== event.courseId) repair.courseId = event.courseId;
        if (Object.keys(repair).length > 0) {
          await updateDoc(d.ref, repair).catch(() => {});
        }
      }

      // Auto-reparar si el gasto de cuota de inasistencia existe y no tenía courseId
      const fineExpenseRef = doc(db, 'expenses', `exp_evt_fine_${event.id}`);
      const fineSnap = await getDoc(fineExpenseRef);
      if (fineSnap.exists() && (!fineSnap.data().courseId || fineSnap.data().courseId !== event.courseId)) {
        await updateDoc(fineExpenseRef, { courseId: event.courseId });
      }

      // 3. Mapear deudas por alumno
      const debtsByStudent = {};
      targetStudents.forEach(st => {
        debtsByStudent[st.id] = {
          studentId: st.id,
          studentName: formatStudentName(st),
          apoderadoEmails: st.apoderadoEmails || (st.apoderadoEmail ? [st.apoderadoEmail] : []),
          mainDebt: null,
          fineDebt: null,
          notAttended: false
        };
      });

      allDebtDocs.forEach(d => {
        const data = d.data();
        if (!debtsByStudent[data.studentId]) {
          debtsByStudent[data.studentId] = {
            studentId: data.studentId,
            studentName: studentsMap.get(data.studentId) ? formatStudentName(studentsMap.get(data.studentId)) : (data.studentName || 'Alumno'),
            apoderadoEmails: data.apoderadoEmails || [],
            mainDebt: null,
            fineDebt: null,
            notAttended: false
          };
        }
        
        if (data.expenseId === `exp_evt_${event.id}`) {
          debtsByStudent[data.studentId].mainDebt = { id: d.id, ...data };
        } else if (data.expenseId === `exp_evt_fine_${event.id}`) {
          debtsByStudent[data.studentId].fineDebt = { id: d.id, ...data };
          debtsByStudent[data.studentId].notAttended = true;
        }
      });
      
      const list = Object.values(debtsByStudent);
      list.sort((a, b) => a.studentName.localeCompare(b.studentName));
      setLocalDebts(list);
      setHasChanges(false);
    } catch (error) {
      console.error("Error fetching attendance:", error);
    } finally {
      setLoading(false);
    }
  }, [event.id, event.courseId, event.participantStudentIds]);

  useEffect(() => {
    fetchDebts();
  }, [fetchDebts]);

  const toggleAttendance = (studentData) => {
    const willBeNotAttended = !studentData.notAttended;
    setLocalDebts(prev => prev.map(s => 
      s.studentId === studentData.studentId 
        ? { ...s, notAttended: willBeNotAttended, _modified: true } 
        : s
    ));
    setHasChanges(true);
  };

  const markAllAttended = () => {
    setLocalDebts(prev => prev.map(s => ({
      ...s,
      notAttended: false,
      _modified: true
    })));
    setHasChanges(true);
  };

  const markAllAbsent = () => {
    setLocalDebts(prev => prev.map(s => ({
      ...s,
      notAttended: true,
      _modified: true
    })));
    setHasChanges(true);
  };

  const handleSaveFineAmountConfig = async () => {
    const parsed = Math.max(0, parseInt(fineAmountInput.replace(/\D/g, ''), 10) || 0);
    try {
      await updateDoc(doc(db, 'events', event.id), {
        noShowAmount: parsed
      });
      event.noShowAmount = parsed;
      setIsEditingFineAmount(false);
      showAlert(`Monto de multa por inasistencia actualizado a ${formatMoney(parsed)}.`);
      setHasChanges(true);
    } catch (err) {
      console.error("Error actualizando monto de multa:", err);
      showAlert("Error al actualizar monto de multa: " + err.message);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fineExpenseId = `exp_evt_fine_${event.id}`;
      const effectiveFineAmount = Math.max(0, parseInt(fineAmountInput.replace(/\D/g, ''), 10) || Number(event.noShowAmount) || 0);

      let absentCount = 0;
      for (const s of localDebts) {
        if (s.notAttended) absentCount++;
      }

      // 1. Agregar o remover deudas de multa para cada alumno
      for (const s of localDebts) {
        if (s.notAttended && effectiveFineAmount > 0) {
          const newDebtId = `debt_${fineExpenseId}_${s.studentId}`;
          const mainDebt = s.mainDebt;
          const emails = (s.apoderadoEmails && s.apoderadoEmails.length > 0)
            ? s.apoderadoEmails
            : (mainDebt?.apoderadoEmails || []);

          await setDoc(doc(db, 'debts', newDebtId), {
            expenseId: fineExpenseId,
            studentId: s.studentId,
            studentName: s.studentName,
            apoderadoEmails: emails,
            amount: effectiveFineAmount,
            status: s.fineDebt?.status || 'pending',
            title: `Multa Inasistencia: ${event.name}`,
            date: event.date,
            fundId: event.fundId || 'general',
            courseId: event.courseId, // <--- CRÍTICO: Debe tener courseId para vincularse al curso y mostrarse en Cuotas y Morosos
            eventId: event.id,
            isEventFine: true,
            visibleInPortal: true,
            createdAt: s.fineDebt?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } else {
          // Si está marcado como asistente pero tenía multa previa, eliminarla
          // Si está marcado como asistente o la multa es $0 pero tenía multa previa, eliminarla
          if (s.fineDebt) {
            await deleteDoc(doc(db, 'debts', s.fineDebt.id));
          }
        }
      }
      
      // 2. Actualizar o crear la Cuota General (Expense) en la colección 'expenses'
      const fineExpenseRef = doc(db, 'expenses', fineExpenseId);
      const fineSnap = await getDoc(fineExpenseRef);
      
      if (absentCount > 0 && effectiveFineAmount > 0) {
        const fineDebtsSnap = await getDocs(query(collection(db, 'debts'), where('expenseId', '==', fineExpenseId)));
        const currentPaidCount = fineDebtsSnap.docs.filter(d => d.data().status === 'paid').length;

        const expensePayload = {
          title: `Multa Inasistencia: ${event.name}`,
          description: `Cuota generada por inasistencia al evento ${event.name}`,
          date: event.date,
          totalAmount: absentCount * effectiveFineAmount,
          amountPerStudent: effectiveFineAmount,
          studentsCount: absentCount,
          paidCount: currentPaidCount,
          fundId: event.fundId || 'general',
          courseId: event.courseId, // <--- CRÍTICO: Debe tener courseId para que aparezca en el panel de Cuotas del curso
          eventId: event.id,
          isEventFine: true,
          updatedAt: new Date().toISOString()
        };

        if (fineSnap.exists()) {
          await updateDoc(fineExpenseRef, expensePayload);
        } else {
          expensePayload.createdAt = new Date().toISOString();
          await setDoc(fineExpenseRef, expensePayload);
        }
      } else if (fineSnap.exists()) {
        await updateDoc(fineExpenseRef, {
          studentsCount: 0,
          totalAmount: 0,
          courseId: event.courseId,
          updatedAt: new Date().toISOString()
        });
      }

      // 3. Persistir en el evento el monto de multa configurado
      if (effectiveFineAmount !== event.noShowAmount) {
        await updateDoc(doc(db, 'events', event.id), {
          noShowAmount: effectiveFineAmount
        });
        event.noShowAmount = effectiveFineAmount;
      }

      setHasChanges(false);
      await showAlert(
        effectiveFineAmount > 0
          ? `¡Asistencia guardada con éxito! Se registraron ${absentCount} alumno(s) inasistente(s) con una multa de ${formatMoney(effectiveFineAmount)} cada uno. La cuota ya está disponible en el panel de Cuotas y Morosos.`
          : 'Asistencia guardada. Como la multa es $0, no se generaron cobros de multa.'
      );
      fetchDebts(); // Refrescar datos desde la base de datos

    } catch (error) {
      console.error("Error saving attendance:", error);
      await showAlert("Error al actualizar la asistencia: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const requiresMainQuota = !event.isTestEvent && (Number(event.mandatoryAmount) || 0) > 0;

  const missingStudents = useMemo(() => {
    return allCourseStudents.filter(s => {
      const existing = localDebts.find(d => d.studentId === s.id);
      if (!existing) return true;
      if (requiresMainQuota && !existing.mainDebt) return true;
      return false;
    });
  }, [allCourseStudents, localDebts, requiresMainQuota]);

  const filteredMissingStudents = useMemo(() => {
    if (!addSearchTerm.trim()) return missingStudents;
    const t = addSearchTerm.toLowerCase();
    return missingStudents.filter(s =>
      formatStudentName(s).toLowerCase().includes(t) ||
      String(s.listNumber || '').includes(t) ||
      (s.rut || '').toLowerCase().includes(t)
    );
  }, [missingStudents, addSearchTerm]);

  const handleOpenAddStudentsModal = () => {
    setAddSearchTerm('');
    setSelectedNewStudentIds(new Set());
    setNewStudentsPaymentStatus('pending');
    setShowAddStudentsModal(true);
  };

  const handleToggleNewStudent = (studentId) => {
    setSelectedNewStudentIds(prev => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const handleToggleAllFilteredNewStudents = () => {
    const visibleIds = filteredMissingStudents.map(s => s.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedNewStudentIds.has(id));
    setSelectedNewStudentIds(prev => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  };

  const handleSaveAddStudents = async () => {
    const studentsToAdd = missingStudents.filter(s => selectedNewStudentIds.has(s.id));
    if (studentsToAdd.length === 0 || addingStudents) return;

    setAddingStudents(true);
    try {
      const fallbackExistingIds = !requiresMainQuota
        ? localDebts.map(d => d.studentId)
        : localDebts.filter(d => d.mainDebt || d.fineDebt).map(d => d.studentId);

      await addStudentsToEvent({
        event,
        studentsToAdd,
        initialStatus: newStudentsPaymentStatus,
        courseId: event.courseId,
        fallbackExistingIds,
        initializeParticipantsIfMissing: true
      });

      setShowAddStudentsModal(false);
      if (onEventUpdated) {
        await onEventUpdated();
      }
      await fetchDebts();
      await showAlert(`¡Se agregaron ${studentsToAdd.length} alumno(s) al evento correctamente!`);
    } catch (err) {
      console.error("Error agregando alumnos al evento:", err);
      await showAlert("Error al agregar alumnos al evento: " + (err.message || "Intenta nuevamente."));
    } finally {
      setAddingStudents(false);
    }
  };

  const filteredDebts = localDebts.filter(d => d.studentName.toLowerCase().includes(searchTerm.toLowerCase()));
  const totalStudents = localDebts.length;
  const absentCount = localDebts.filter(s => s.notAttended).length;
  const attendedCount = totalStudents - absentCount;
  const effectiveFine = Math.max(0, parseInt(fineAmountInput.replace(/\D/g, ''), 10) || Number(event.noShowAmount) || 0);

  if (loading) return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando lista de asistencia...</div>;

  return (
    <div className="glass-panel" style={{ padding: '2rem' }}>
      
      {/* Cabecera y Barra de Búsqueda */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={22} /> Control de Asistencia y Cuota de Inasistentes
          </h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Marca o desmarca quién asistió. A los inasistentes se les generará la multa correspondiente en el sistema.
          </p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleOpenAddStudentsModal}
            className="btn btn-primary"
            style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            title="Agregar alumnos del curso que no están incluidos en este evento"
          >
            <UserPlus size={15} />
            Agregar Alumnos al Evento ({missingStudents.length})
          </button>

          <div className="search-bar" style={{ maxWidth: '260px' }}>
            <Search size={16} style={{ color: 'var(--text-muted)', marginLeft: '10px' }} />
            <input 
              type="text" 
              placeholder="Buscar alumno..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '0.45rem', background: 'transparent', border: 'none', color: 'white', outline: 'none', fontSize: '0.85rem' }}
            />
          </div>

          <button 
            type="button"
            onClick={fetchDebts}
            className="btn btn-outline"
            style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
            title="Recargar lista"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Banner informativo si faltan alumnos del curso en el evento */}
      {missingStudents.length > 0 && (
        <div style={{
          marginBottom: '1.25rem',
          padding: '0.85rem 1rem',
          borderRadius: '10px',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          border: '1px solid rgba(99, 102, 241, 0.35)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.86rem', color: 'var(--text-main)' }}>
            <AlertCircle size={18} style={{ color: 'var(--primary)', flexShrink: 0 }} />
            <span>
              Hay <strong>{missingStudents.length}</strong> {missingStudents.length === 1 ? 'alumno activo del curso que aún no está registrado' : 'alumnos activos del curso que aún no están registrados'} en este evento.
            </span>
          </div>
          <button
            type="button"
            onClick={handleOpenAddStudentsModal}
            className="btn btn-outline"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', borderColor: 'var(--primary)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <UserPlus size={14} /> Agregar ahora
          </button>
        </div>
      )}

      {/* Tarjeta de Configuración de Multa y Resumen */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '1rem',
        padding: '1.25rem',
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        marginBottom: '1.5rem'
      }}>
        {/* Total Alumnos */}
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Alumnos</span>
          <strong style={{ fontSize: '1.25rem', display: 'block', marginTop: '0.15rem' }}>{totalStudents} alumnos</strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cuota base: {formatMoney(event.mandatoryAmount)}</span>
        </div>

        {/* Asistentes */}
        <div>
          <span style={{ fontSize: '0.75rem', color: '#6ee7b7', textTransform: 'uppercase' }}>Presentes ({attendedCount})</span>
          <strong style={{ fontSize: '1.25rem', color: 'var(--success)', display: 'block', marginTop: '0.15rem' }}>
            {attendedCount} alumnos
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Solo pagan cuota obligatoria</span>
        </div>

        {/* Inasistentes */}
        <div>
          <span style={{ fontSize: '0.75rem', color: '#f87171', textTransform: 'uppercase' }}>Inasistentes ({absentCount})</span>
          <strong style={{ fontSize: '1.25rem', color: 'var(--danger)', display: 'block', marginTop: '0.15rem' }}>
            {absentCount} alumnos
          </strong>
          <span style={{ fontSize: '0.75rem', color: '#fca5a5' }}>
            Total Multas: {formatMoney(absentCount * effectiveFine)}
          </span>
        </div>

        {/* Monto de la Multa */}
        <div style={{ borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: '#fcd34d', textTransform: 'uppercase' }}>Monto Multa Inasistencia</span>
            <button
              type="button"
              onClick={() => setIsEditingFineAmount(!isEditingFineAmount)}
              style={{ background: 'none', border: 'none', color: '#93c5fd', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
            >
              <Edit3 size={12} /> {isEditingFineAmount ? 'Cancelar' : 'Modificar'}
            </button>
          </div>

          {isEditingFineAmount ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.35rem' }}>
              <input 
                type="number"
                min="0"
                value={fineAmountInput}
                onChange={(e) => setFineAmountInput(e.target.value)}
                className="input-field"
                style={{ width: '100px', padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                autoFocus
              />
              <button
                type="button"
                onClick={handleSaveFineAmountConfig}
                className="btn btn-primary"
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
              >
                Guardar
              </button>
            </div>
          ) : (
            <strong style={{ fontSize: '1.25rem', color: '#fcd34d', display: 'block', marginTop: '0.15rem' }}>
              {formatMoney(effectiveFine)}
            </strong>
          )}
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Por cada alumno que no asista</span>
        </div>
      </div>

      {/* Botonera de Acciones Rápidas */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={markAllAttended}
            className="btn btn-outline"
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <CheckCircle2 size={14} color="#10b981" /> Marcar Todos como Asistentes
          </button>
          <button
            type="button"
            onClick={markAllAbsent}
            className="btn btn-outline"
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.4)' }}
          >
            <UserX size={14} /> Marcar Todos Inasistentes
          </button>
        </div>

        <button 
          onClick={handleSave} 
          disabled={saving}
          className="btn btn-primary" 
          style={{ 
            padding: '0.55rem 1.35rem', 
            fontWeight: 'bold', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.45rem',
            backgroundColor: hasChanges ? '#10b981' : 'var(--primary)',
            borderColor: hasChanges ? '#10b981' : 'var(--primary)',
            boxShadow: hasChanges ? '0 0 15px rgba(16, 185, 129, 0.4)' : 'none'
          }}
        >
          <Save size={16} />
          {saving ? 'Guardando...' : (hasChanges ? 'Guardar Asistencia y Generar Cobros' : 'Sincronizar Cuotas de Inasistentes')}
        </button>
      </div>

      {/* Tabla de Alumnos y Asistencia */}
      <div className="table-responsive" style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px' }}>
        <table style={{ width: '100%', minWidth: '580px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
              <th style={{ padding: '0.85rem 1rem', width: '110px', textAlign: 'center' }}>¿Asistió?</th>
              <th style={{ padding: '0.85rem 1rem' }}>Alumno(a)</th>
              <th style={{ padding: '0.85rem 1rem' }}>Estado Cuota Obligatoria</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Cobro Asignado</th>
            </tr>
          </thead>
          <tbody>
            {filteredDebts.map(s => {
              const attended = !s.notAttended;
              let statusEl = null;
              if (s.mainDebt) {
                if (s.mainDebt.status === 'paid') statusEl = <span style={{ color: 'var(--success)', fontWeight: '600' }}>Pagado</span>;
                else if (s.mainDebt.status === 'review') statusEl = <span style={{ color: '#3b82f6', fontWeight: '600' }}>En revisión</span>;
                else if (s.mainDebt.status === 'partial') statusEl = <span style={{ color: 'var(--warning)', fontWeight: '600' }}>Pago Parcial</span>;
                else statusEl = <span style={{ color: 'var(--danger)', fontWeight: '600' }}>Pendiente</span>;
              } else {
                statusEl = <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>Sin cuota obligatoria</span>;
              }

              return (
                <tr key={s.studentId} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', backgroundColor: attended ? 'transparent' : 'rgba(239, 68, 68, 0.05)' }}>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                    <button 
                      type="button"
                      onClick={() => toggleAttendance(s)}
                      style={{ background: 'none', border: 'none', color: attended ? 'var(--success)' : '#ef4444', cursor: 'pointer', padding: 0 }}
                      title={attended ? 'Haz clic para marcar como inasistente' : 'Haz clic para marcar como presente'}
                    >
                      {attended ? <CheckSquare size={22} /> : <Square size={22} />}
                    </button>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: '600' }}>{s.studentName}</span>
                      {!attended && (
                        <span style={{
                          fontSize: '0.72rem',
                          backgroundColor: 'rgba(239, 68, 68, 0.2)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          padding: '0.1rem 0.45rem',
                          borderRadius: '4px',
                          fontWeight: 'bold'
                        }}>
                          Inasistente
                        </span>
                      )}
                    </div>
                    {s.apoderadoEmails && s.apoderadoEmails.length > 0 && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                        {s.apoderadoEmails.join(', ')}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    {statusEl}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                    <div style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>
                      {formatMoney(event.mandatoryAmount)} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(Base)</span>
                    </div>
                    {!attended && (
                      <div style={{ color: 'var(--danger)', fontSize: '0.85rem', fontWeight: 'bold', marginTop: '2px' }}>
                        + {formatMoney(effectiveFine)} (Multa Inasistencia)
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredDebts.length === 0 && (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No se encontraron alumnos con ese criterio.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal para agregar alumnos faltantes al evento */}
      {showAddStudentsModal && createPortal(
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !addingStudents) setShowAddStudentsModal(false);
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
              maxWidth: '580px',
              maxHeight: 'min(90vh, 740px)',
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
                  <UserPlus size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)', fontWeight: '700' }}>
                    Agregar Alumnos al Evento
                  </h3>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {event.name} {requiresMainQuota ? `• Cuota obligatoria: ${formatMoney(event.mandatoryAmount)}` : (!event.isTestEvent ? '• Sin cuota obligatoria' : '')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddStudentsModal(false)}
                disabled={addingStudents}
                className="btn btn-outline"
                style={{ padding: '0.35rem 0.5rem', borderColor: 'var(--border-color)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Search & Select All */}
            <div style={{ padding: '1rem 1.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0, display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Buscar alumno por nombre, RUT o N° lista..."
                  value={addSearchTerm}
                  onChange={(e) => setAddSearchTerm(e.target.value)}
                  style={{ width: '100%', padding: '0.45rem 0.65rem 0.45rem 2rem', fontSize: '0.85rem' }}
                />
                <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              </div>

              {filteredMissingStudents.length > 0 && (
                <button
                  type="button"
                  onClick={handleToggleAllFilteredNewStudents}
                  className="btn btn-outline"
                  style={{ fontSize: '0.78rem', padding: '0.45rem 0.75rem' }}
                >
                  {filteredMissingStudents.every(s => selectedNewStudentIds.has(s.id)) ? 'Deseleccionar Todos' : 'Seleccionar Todos'}
                </button>
              )}
            </div>

            {/* Student List */}
            <div style={{ padding: '1rem 1.5rem', overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {missingStudents.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', backgroundColor: 'rgba(16, 185, 129, 0.05)', borderRadius: 'var(--radius-md)', border: '1px dashed rgba(16, 185, 129, 0.3)', color: 'var(--text-muted)' }}>
                  <CheckCircle size={28} style={{ color: 'var(--success)', margin: '0 auto 0.5rem' }} />
                  <p style={{ margin: '0 0 0.25rem', color: 'var(--text-main)', fontWeight: '600' }}>
                    Todos los alumnos activos del curso ya están en este evento
                  </p>
                  <p style={{ margin: 0, fontSize: '0.8rem' }}>
                    No quedan alumnos pendientes por agregar.
                  </p>
                </div>
              ) : filteredMissingStudents.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                  No se encontraron alumnos con esa búsqueda.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {filteredMissingStudents.map(s => {
                    const isSelected = selectedNewStudentIds.has(s.id);
                    const inAttendanceWithoutQuota = requiresMainQuota && localDebts.some(d => d.studentId === s.id && !d.mainDebt);
                    return (
                      <div
                        key={s.id}
                        onClick={() => handleToggleNewStudent(s.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.75rem',
                          padding: '0.65rem 0.85rem',
                          borderRadius: 'var(--radius-sm)',
                          border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border-color)'}`,
                          backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255,255,255,0.02)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleNewStudent(s.id)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: '17px', height: '17px', accentColor: 'var(--primary)', cursor: 'pointer' }}
                          />
                          <div>
                            <span style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                              {s.listNumber ? `${s.listNumber}. ` : ''}{formatStudentName(s)}
                            </span>
                            {inAttendanceWithoutQuota && (
                              <span style={{ marginLeft: '0.45rem', fontSize: '0.72rem', color: 'var(--warning)' }}>
                                (Sin cuota obligatoria)
                              </span>
                            )}
                            {s.rut && (
                              <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {s.rut}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '1rem 1.5rem',
              borderTop: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-main)',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.85rem'
            }}>
              {requiresMainQuota && missingStudents.length > 0 && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.45rem', fontWeight: '600' }}>
                    Estado inicial de la cuota obligatoria ({formatMoney(event.mandatoryAmount)}):
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '0.45rem' }}>
                    {[
                      { id: 'pending', label: 'Pendiente de pago', icon: <Clock size={14} />, color: 'var(--warning)' },
                      { id: 'cash', label: 'Pagada (Efectivo)', icon: <DollarSign size={14} />, color: 'var(--success)' },
                      { id: 'transfer', label: 'Pagada (Transf.)', icon: <CreditCard size={14} />, color: 'var(--primary)' }
                    ].map(opt => {
                      const active = newStudentsPaymentStatus === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setNewStudentsPaymentStatus(opt.id)}
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
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
                <button
                  type="button"
                  onClick={() => setShowAddStudentsModal(false)}
                  disabled={addingStudents}
                  className="btn btn-outline"
                  style={{ padding: '0.5rem 1.15rem' }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveAddStudents}
                  disabled={addingStudents || selectedNewStudentIds.size === 0}
                  className="btn btn-primary"
                  style={{ padding: '0.5rem 1.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <UserPlus size={16} />
                  {addingStudents ? 'Agregando...' : `Agregar al Evento (${selectedNewStudentIds.size})`}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default EventAttendance;