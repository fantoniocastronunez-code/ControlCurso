import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where } from 'firebase/firestore';
import {
  ArrowLeft, CheckCircle, Trash2, TrendingDown, Edit2, Calculator,
  CheckSquare, Sparkles, RotateCcw, Save, AlertTriangle, ShieldCheck,
  Check, Eye, EyeOff, Search, Filter, Tag, Calendar, User, X
} from 'lucide-react';
import { useModal } from '../context/ModalContext';
import { useCourse } from '../context/CourseContext';
import { useAuth } from '../context/AuthContext';
import { requestApproval } from '../services/approvalService';

const OutcomeManagement = ({ onBack }) => {
  const { showAlert, showConfirm } = useModal();
  const { selectedCourse } = useCourse();
  const { user, role, userData } = useAuth();
  const courseRole = (role === 'superadmin' || userData?.roles?.global === 'superadmin')
    ? 'superadmin'
    : (userData?.roles?.[selectedCourse?.id] || null);

  const [outcomes, setOutcomes] = useState([]);
  const [funds, setFunds] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  // Formulario nuevo gasto
  const [newTitle, setNewTitle] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newMethod, setNewMethod] = useState('cash');
  const [selectedFundId, setSelectedFundId] = useState('general');
  const [newDate, setNewDate] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [newResponsable, setNewResponsable] = useState('');
  const [newVisibleInPortal, setNewVisibleInPortal] = useState(true);

  // Filtros de visualización
  const [filterCategory, setFilterCategory] = useState('all'); // 'all' | 'general' | 'events' | specific eventId
  const [searchQuery, setSearchQuery] = useState('');

  // Edición
  const [editingOutcomeId, setEditingOutcomeId] = useState(null);
  const [editOutcomeTitle, setEditOutcomeTitle] = useState('');
  const [editOutcomeAmount, setEditOutcomeAmount] = useState('');
  const [editOutcomeDate, setEditOutcomeDate] = useState('');
  const [editOutcomeMethod, setEditOutcomeMethod] = useState('cash');
  const [editOutcomeFund, setEditOutcomeFund] = useState('general');
  const [editOutcomeEventId, setEditOutcomeEventId] = useState('');
  const [editOutcomeResponsable, setEditOutcomeResponsable] = useState('');
  const [editOutcomeVisibleInPortal, setEditOutcomeVisibleInPortal] = useState(true);

  // Modo Auditoría
  const [isAuditMode, setIsAuditMode] = useState(false);
  const [auditChecks, setAuditChecks] = useState({});
  const [auditManualAmounts, setAuditManualAmounts] = useState({});

  const fetchData = useCallback(async () => {
    if (!selectedCourse) return;
    setLoading(true);
    try {
      // 1. Obtener Eventos del curso
      const qEvents = query(collection(db, 'events'), where('courseId', '==', selectedCourse.id));
      const eventsSnapshot = await getDocs(qEvents);
      const eventsList = eventsSnapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      eventsList.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      setEvents(eventsList);
      const eventsMap = new Map(eventsList.map(ev => [ev.id, ev]));

      // 2. Obtener Fondos del curso
      const qFunds = query(collection(db, 'funds'), where('courseId', '==', selectedCourse.id));
      const fundsSnapshot = await getDocs(qFunds);
      const fundsList = fundsSnapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      fundsList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setFunds(fundsList);

      // 3. Obtener Gastos (outcomes del curso)
      const outcomesMap = new Map();

      // 3a. Gastos generales con courseId del curso
      const qOutcomes = query(collection(db, 'outcomes'), where('courseId', '==', selectedCourse.id));
      const snapshot = await getDocs(qOutcomes);
      snapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        outcomesMap.set(docSnap.id, {
          id: docSnap.id,
          ...data
        });
      });

      // 3b. Gastos vinculados por eventId a los eventos de este curso
      // Garantiza que cualquier gasto de evento huérfano (sin courseId o vacío) se incorpore y auto-repare
      for (const ev of eventsList) {
        try {
          const qByEvent = query(collection(db, 'outcomes'), where('eventId', '==', ev.id));
          const snapByEvent = await getDocs(qByEvent);
          snapByEvent.docs.forEach(d => {
            const data = d.data();
            const needsRepair = !data.courseId || data.courseId !== selectedCourse.id || !data.eventName;
            if (needsRepair) {
              updateDoc(d.ref, {
                courseId: selectedCourse.id,
                eventName: ev.name || data.eventName || 'Evento',
                isEventExpense: true
              }).catch(console.error);
            }
            outcomesMap.set(d.id, {
              id: d.id,
              ...data,
              courseId: selectedCourse.id,
              eventName: ev.name || data.eventName || 'Evento',
              isEventExpense: true
            });
          });
        } catch (evErr) {
          console.warn(`Error buscando gastos del evento ${ev.id}:`, evErr);
        }

        // 3c. Gastos vinculados por fundId del evento
        if (ev.fundId) {
          try {
            const qByFund = query(collection(db, 'outcomes'), where('fundId', '==', ev.fundId));
            const snapByFund = await getDocs(qByFund);
            snapByFund.docs.forEach(d => {
              const data = d.data();
              if (!data.courseId || data.courseId !== selectedCourse.id || !data.eventName) {
                updateDoc(d.ref, {
                  courseId: selectedCourse.id,
                  eventId: ev.id,
                  eventName: ev.name || 'Evento',
                  isEventExpense: true
                }).catch(console.error);
              }
              if (!outcomesMap.has(d.id)) {
                outcomesMap.set(d.id, {
                  id: d.id,
                  ...data,
                  courseId: selectedCourse.id,
                  eventId: ev.id,
                  eventName: ev.name || 'Evento',
                  isEventExpense: true
                });
              }
            });
          } catch (fErr) {
            console.warn(`Error buscando gastos por fundId del evento ${ev.fundId}:`, fErr);
          }
        }
      }

      const list = Array.from(outcomesMap.values());
      // Ordenar por fecha, más reciente primero
      list.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
      setOutcomes(list);
    } catch (error) {
      console.error("Error al obtener datos:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedCourse]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleOutcomeVisibility = async (id, currentVal) => {
    const nextVal = !currentVal;
    try {
      await updateDoc(doc(db, 'outcomes', id), { visibleInPortal: nextVal });
      setOutcomes(prev => prev.map(o => o.id === id ? { ...o, visibleInPortal: nextVal } : o));
      showAlert(`Gasto marcado como ${nextVal ? 'VISIBLE' : 'OCULTO'} para los apoderados en su portal.`);
    } catch (err) {
      console.error("Error toggling outcome visibility:", err);
      showAlert("Error al cambiar la visibilidad del gasto.");
    }
  };

  const handleEventSelectChange = (eventId) => {
    setSelectedEventId(eventId);
    if (eventId) {
      const ev = events.find(e => e.id === eventId);
      if (ev?.fundId) {
        setSelectedFundId(ev.fundId);
      }
    }
  };

  const handleAddOutcome = async (e) => {
    e.preventDefault();
    if (!newTitle.trim() || !newAmount) {
      await showAlert("Faltan datos obligatorios (motivo o monto).");
      return;
    }

    try {
      const outcomeId = 'out_' + Date.now().toString();
      const selectedEventObj = events.find(ev => ev.id === selectedEventId);
      const effectiveFundId = selectedEventObj?.fundId || selectedFundId || 'general';

      const newOutcome = {
        title: newTitle.trim(),
        amount: parseFloat(newAmount),
        paymentMethod: newMethod,
        fundId: effectiveFundId,
        courseId: selectedCourse.id,
        date: newDate || new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString(),
        visibleInPortal: newVisibleInPortal,
        ...(selectedEventObj ? {
          eventId: selectedEventObj.id,
          eventName: selectedEventObj.name || 'Evento',
          isEventExpense: true,
          responsable: newResponsable.trim() || user?.displayName || user?.email || 'Tesorero'
        } : (newResponsable.trim() ? { responsable: newResponsable.trim() } : {}))
      };

      const requiresApproval = courseRole !== 'tesorero' && courseRole !== 'superadmin';

      if (requiresApproval) {
        const payload = {
          outcomeId,
          outcomeData: newOutcome
        };
        const approvalDescription = selectedEventObj
          ? `Gasto Evento (${selectedEventObj.name}): ${newTitle} ($${newAmount})`
          : `Gasto: ${newTitle} ($${newAmount})`;
        await requestApproval('CREATE_OUTCOME', approvalDescription, payload, user, selectedCourse.id);
        setMessage('Solicitud de gasto enviada a la tesorera para su aprobación.');
      } else {
        const outcomeRef = doc(db, 'outcomes', outcomeId);
        await setDoc(outcomeRef, newOutcome);

        setOutcomes([{ id: outcomeId, ...newOutcome }, ...outcomes]);
        setMessage(selectedEventObj
          ? `Gasto registrado y vinculado al evento "${selectedEventObj.name}" correctamente.`
          : 'Gasto registrado correctamente.');
      }

      setNewTitle('');
      setNewAmount('');
      setNewMethod('cash');
      setNewDate('');
      setSelectedEventId('');
      setNewResponsable('');
      setNewVisibleInPortal(true);

      setTimeout(() => setMessage(''), 3500);
    } catch (error) {
      console.error("Error registrando gasto:", error);
      setMessage('Error al registrar el gasto');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleStartEdit = (o) => {
    setEditingOutcomeId(o.id);
    setEditOutcomeTitle(o.title || '');
    setEditOutcomeAmount(o.amount || '');
    setEditOutcomeDate(o.date || '');
    setEditOutcomeMethod(o.paymentMethod || 'cash');
    setEditOutcomeFund(o.fundId || 'general');
    setEditOutcomeEventId(o.eventId || '');
    setEditOutcomeResponsable(o.responsable || '');
    setEditOutcomeVisibleInPortal(o.visibleInPortal !== false);
  };

  const handleSaveEdit = async (id) => {
    if (!editOutcomeTitle || !editOutcomeAmount) return;
    try {
      const existing = outcomes.find(o => o.id === id);
      const selectedEventObj = events.find(ev => ev.id === editOutcomeEventId);

      const updatedData = {
        title: editOutcomeTitle.trim(),
        amount: parseFloat(editOutcomeAmount),
        date: editOutcomeDate || new Date().toISOString().split('T')[0],
        paymentMethod: editOutcomeMethod,
        fundId: editOutcomeFund,
        visibleInPortal: editOutcomeVisibleInPortal,
        ...(selectedEventObj ? {
          eventId: selectedEventObj.id,
          eventName: selectedEventObj.name || 'Evento',
          isEventExpense: true,
          responsable: editOutcomeResponsable.trim() || existing?.responsable || 'Tesorero'
        } : (existing?.eventId && !editOutcomeEventId ? {
          eventId: null,
          eventName: null,
          isEventExpense: false,
          responsable: editOutcomeResponsable.trim() || null
        } : (existing?.eventId ? {
          eventId: existing.eventId,
          eventName: existing.eventName || 'Evento',
          isEventExpense: true,
          responsable: editOutcomeResponsable.trim() || existing?.responsable || 'Tesorero'
        } : (editOutcomeResponsable.trim() ? { responsable: editOutcomeResponsable.trim() } : {}))))
      };

      await updateDoc(doc(db, 'outcomes', id), updatedData);

      setOutcomes(outcomes.map(o => o.id === id ? { ...o, ...updatedData } : o).sort((a, b) => new Date(b.date) - new Date(a.date)));
      setEditingOutcomeId(null);
      setMessage('Gasto actualizado correctamente');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error actualizando gasto:", error);
    }
  };

  const handleDelete = async (id) => {
    const targetOutcome = outcomes.find(o => o.id === id);
    const confirmText = targetOutcome?.eventId
      ? `¿Seguro que deseas eliminar este gasto del evento "${targetOutcome.eventName || 'Evento'}"? Se eliminará tanto del evento como del historial general.`
      : '¿Seguro que deseas eliminar este gasto? El dinero volverá a los fondos.';

    if (!(await showConfirm(confirmText))) return;
    try {
      await deleteDoc(doc(db, 'outcomes', id));
      setOutcomes(outcomes.filter(o => o.id !== id));
      setMessage('Gasto eliminado correctamente');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error eliminando gasto:", error);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
  };

  // Totales y Estadísticas Generales
  const totalOutcomesAmount = useMemo(() => {
    return outcomes.reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);
  }, [outcomes]);

  const totalGeneralAmount = useMemo(() => {
    return outcomes.filter(o => !o.eventId && !o.isEventExpense).reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);
  }, [outcomes]);

  const totalEventsAmount = useMemo(() => {
    return outcomes.filter(o => !!o.eventId || !!o.isEventExpense).reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);
  }, [outcomes]);

  // Filtro de resultados
  const filteredOutcomes = useMemo(() => {
    return outcomes.filter(o => {
      // Filtro por categoría o evento
      if (filterCategory === 'general') {
        if (o.eventId || o.isEventExpense) return false;
      } else if (filterCategory === 'events') {
        if (!o.eventId && !o.isEventExpense) return false;
      } else if (filterCategory !== 'all') {
        if (o.eventId !== filterCategory) return false;
      }

      // Filtro por texto de búsqueda
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (o.title || '').toLowerCase().includes(q);
        const matchResp = (o.responsable || '').toLowerCase().includes(q);
        const matchEvent = (o.eventName || '').toLowerCase().includes(q);
        const matchDate = (o.date || '').toLowerCase().includes(q);
        const matchFund = (funds.find(f => f.id === o.fundId)?.name || '').toLowerCase().includes(q);
        if (!matchTitle && !matchResp && !matchEvent && !matchDate && !matchFund) return false;
      }

      return true;
    });
  }, [outcomes, filterCategory, searchQuery, funds]);

  // Cálculos y Helpers del Modo Auditoría
  const systemTotalOutcomes = useMemo(() => {
    return filteredOutcomes.reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);
  }, [filteredOutcomes]);

  const auditTotalManual = useMemo(() => {
    return Object.entries(auditManualAmounts).reduce((sum, [, val]) => {
      const num = parseFloat(val);
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  }, [auditManualAmounts]);

  const auditTickedCount = useMemo(() => {
    return filteredOutcomes.filter(o => !!auditChecks[o.id]).length;
  }, [filteredOutcomes, auditChecks]);

  const auditDifference = auditTotalManual - systemTotalOutcomes;

  const handleToggleAuditCheck = (id) => {
    const isCurrentlyChecked = !!auditChecks[id];
    const newCheckState = !isCurrentlyChecked;

    setAuditChecks(prev => ({ ...prev, [id]: newCheckState }));

    if (newCheckState && (auditManualAmounts[id] === undefined || auditManualAmounts[id] === '')) {
      const outcome = outcomes.find(o => o.id === id);
      if (outcome) {
        setAuditManualAmounts(prev => ({ ...prev, [id]: outcome.amount }));
      }
    }
  };

  const handleAuditManualAmountChange = (id, val) => {
    setAuditManualAmounts(prev => ({ ...prev, [id]: val }));
    if (val !== '' && !auditChecks[id]) {
      setAuditChecks(prev => ({ ...prev, [id]: true }));
    }
  };

  const handleAutoFillAudit = () => {
    const newAmounts = {};
    const newChecks = {};
    filteredOutcomes.forEach(o => {
      newAmounts[o.id] = o.amount;
      newChecks[o.id] = true;
    });
    setAuditManualAmounts(newAmounts);
    setAuditChecks(newChecks);
  };

  const handleToggleAllAuditChecks = () => {
    const allChecked = filteredOutcomes.every(o => auditChecks[o.id]);
    const newChecks = {};
    filteredOutcomes.forEach(o => {
      newChecks[o.id] = !allChecked;
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

    if (!(await showConfirm(`¿Estás seguro de reemplazar TODOS los montos en sistema por las sumas manuales auditadas?\n\n⚠️ ATENCIÓN: Cualquier gasto que NO tenga un monto manual ingresado quedará en $0.`))) return;

    setLoading(true);
    try {
      let updatedCount = 0;
      for (const o of filteredOutcomes) {
        const manualAmtStr = auditManualAmounts[o.id];

        let manualAmt = 0;
        if (manualAmtStr !== undefined && manualAmtStr !== '') {
          manualAmt = parseFloat(manualAmtStr);
          if (isNaN(manualAmt) || manualAmt < 0) manualAmt = 0;
        }

        await updateDoc(doc(db, 'outcomes', o.id), {
          amount: manualAmt
        });

        updatedCount++;
      }

      await showAlert(`Se ha reemplazado la suma del sistema con éxito. ${updatedCount} registros actualizados.`);

      setAuditChecks({});
      setAuditManualAmounts({});

      fetchData();
    } catch (error) {
      console.error("Error al actualizar montos de auditoría masivos:", error);
      await showAlert("Error al guardar los montos auditados.");
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando gastos...</div>;
  }

  return (
    <div className="animate-fade-in">
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h3 style={{ margin: 0 }}>Historial y Registro de Gastos</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Control centralizado de egresos del curso y gastos de eventos
            </span>
          </div>
        </div>

        <button
          onClick={() => setIsAuditMode(!isAuditMode)}
          className={`btn ${isAuditMode ? 'btn-primary' : 'btn-outline'}`}
          style={{
            backgroundColor: isAuditMode ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
            borderColor: isAuditMode ? '#8b5cf6' : 'var(--border-color)',
            color: isAuditMode ? '#c4b5fd' : 'var(--text-main)',
            display: 'flex', alignItems: 'center', gap: '0.5rem'
          }}
        >
          <ShieldCheck size={18} />
          {isAuditMode ? 'Modo Auditoría Activo' : 'Activar Modo Auditoría'}
        </button>
      </div>

      {/* Tarjetas KPI de Resumen Centralizado */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
        <div className="glass-panel" style={{ padding: '1rem 1.25rem', borderRadius: '12px', borderLeft: '4px solid var(--danger)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Total General Gastado</div>
          <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: 'var(--danger)' }}>{formatMoney(totalOutcomesAmount)}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{outcomes.length} gastos en total</div>
        </div>

        <div className="glass-panel" style={{ padding: '1rem 1.25rem', borderRadius: '12px', borderLeft: '4px solid var(--primary)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Gastos Generales del Curso</div>
          <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: 'var(--text-main)' }}>{formatMoney(totalGeneralAmount)}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            {outcomes.filter(o => !o.eventId && !o.isEventExpense).length} egresos ordinarios
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1rem 1.25rem', borderRadius: '12px', borderLeft: '4px solid #8b5cf6', background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(139, 92, 246, 0.1) 100%)' }}>
          <div style={{ fontSize: '0.8rem', color: '#c4b5fd', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span>🎉 Gastos Imputados a Eventos</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: '#c4b5fd' }}>{formatMoney(totalEventsAmount)}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            {outcomes.filter(o => !!o.eventId || !!o.isEventExpense).length} compras registradas en eventos
          </div>
        </div>
      </div>

      {/* Modo Auditoría Panel */}
      {isAuditMode && (
        <div className="glass-panel animate-fade-in" style={{ padding: '1.5rem', marginBottom: '2rem', border: '1px solid rgba(139, 92, 246, 0.4)', background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(88, 28, 135, 0.2) 100%)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ backgroundColor: 'rgba(139, 92, 246, 0.25)', padding: '0.6rem', borderRadius: '10px', color: '#a78bfa' }}>
                <Calculator size={22} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#c4b5fd' }}>Panel de Auditoría de Gastos</h3>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Verifica que cada gasto registrado concuerde con las boletas/facturas físicas o digitales.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={handleToggleAllAuditChecks}
                className="btn btn-outline"
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', borderColor: '#8b5cf6', color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <CheckSquare size={15} />
                {auditTickedCount === filteredOutcomes.length ? 'Desmarcar Todos' : 'Tickear Todos'}
              </button>
              <button
                onClick={handleAutoFillAudit}
                className="btn btn-outline"
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', borderColor: 'var(--primary)', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Sparkles size={15} />
                Copiar del Sistema
              </button>
              <button
                onClick={handleClearAudit}
                className="btn btn-outline"
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <RotateCcw size={15} />
                Limpiar
              </button>
              <button
                onClick={handleAcceptAllAudit}
                className="btn btn-primary"
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', backgroundColor: '#8b5cf6', border: 'none', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 'bold' }}
                disabled={Object.keys(auditManualAmounts).length === 0}
              >
                <Save size={15} />
                Aceptar Suma Auditada
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Suma Registrada en Sistema</span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.35rem', color: 'var(--text-main)' }}>
                {formatMoney(systemTotalOutcomes)}
              </h3>
            </div>

            <div style={{ padding: '1rem', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
              <span style={{ fontSize: '0.8rem', color: '#c4b5fd' }}>Suma Manual Auditada</span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.35rem', color: '#a78bfa' }}>
                {formatMoney(auditTotalManual)}
              </h3>
            </div>

            <div style={{
              padding: '1rem',
              backgroundColor: auditDifference === 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.15)',
              borderRadius: 'var(--radius-md)',
              border: auditDifference === 0 ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.4)'
            }}>
              <span style={{ fontSize: '0.8rem', color: auditDifference === 0 ? 'var(--success)' : 'var(--danger)' }}>
                Diferencia de Cuadratura
              </span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.35rem', color: auditDifference === 0 ? 'var(--success)' : 'var(--danger)' }}>
                {auditDifference > 0 ? `+${formatMoney(auditDifference)}` : formatMoney(auditDifference)}
              </h3>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', color: 'var(--success)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={18} /> {message}
        </div>
      )}

      {/* Formulario para agregar egreso (general o de evento) */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)' }}>
          <TrendingDown size={18} /> Registrar Nuevo Gasto
        </h4>
        <form onSubmit={handleAddOutcome} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: '2', minWidth: '220px', marginBottom: 0 }}>
            <label className="input-label">Motivo / Descripción *</label>
            <input
              type="text"
              required
              className="input-field"
              placeholder="Ej. Compra de cartulinas, hielo, pan..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </div>

          <div className="input-group" style={{ flex: '1', minWidth: '140px', marginBottom: 0 }}>
            <label className="input-label">Monto ($) *</label>
            <input
              type="number"
              required
              min="1"
              className="input-field"
              placeholder="Ej. 15000"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
            />
          </div>

          <div className="input-group" style={{ flex: '1', minWidth: '140px', marginBottom: 0 }}>
            <label className="input-label">Fecha (Opcional)</label>
            <input
              type="date"
              className="input-field"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </div>

          <div className="input-group" style={{ flex: '1', minWidth: '150px', marginBottom: 0 }}>
            <label className="input-label">Medio de Pago</label>
            <select
              className="input-field"
              value={newMethod}
              onChange={(e) => setNewMethod(e.target.value)}
            >
              <option value="cash">💵 Efectivo (Caja Chica)</option>
              <option value="transfer">🏦 Transferencia (Cuenta)</option>
            </select>
          </div>

          {/* Selector de Evento */}
          <div className="input-group" style={{ flex: '1.5', minWidth: '180px', marginBottom: 0 }}>
            <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span>¿Asociar a un Evento?</span>
              <span style={{ fontSize: '0.75rem', color: '#c4b5fd' }}>(Opcional)</span>
            </label>
            <select
              className="input-field"
              value={selectedEventId}
              onChange={(e) => handleEventSelectChange(e.target.value)}
              style={{
                borderColor: selectedEventId ? '#8b5cf6' : 'var(--border-color)',
                backgroundColor: selectedEventId ? 'rgba(139, 92, 246, 0.08)' : 'transparent'
              }}
            >
              <option value="">Ninguno (Gasto Ordinario del Curso)</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>🎉 Evento: {ev.name}</option>
              ))}
            </select>
          </div>

          {/* Responsable si es evento o gasto justificado */}
          {selectedEventId && (
            <div className="input-group animate-fade-in" style={{ flex: '1.2', minWidth: '160px', marginBottom: 0 }}>
              <label className="input-label">Responsable (Quién compró)</label>
              <input
                type="text"
                className="input-field"
                placeholder="Ej. Tesorera, Delegado..."
                value={newResponsable}
                onChange={(e) => setNewResponsable(e.target.value)}
              />
            </div>
          )}

          <div className="input-group" style={{ flex: '1.2', minWidth: '160px', marginBottom: 0 }}>
            <label className="input-label">Fondo de Origen</label>
            <select
              className="input-field"
              value={selectedFundId}
              onChange={(e) => setSelectedFundId(e.target.value)}
            >
              <option value="general">Fondo General</option>
              {funds.filter(f => !f.isLocked && f.id !== 'general').map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setNewVisibleInPortal(!newVisibleInPortal)}
            className="btn btn-outline"
            style={{
              height: '42px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              borderColor: newVisibleInPortal ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)',
              color: newVisibleInPortal ? 'var(--success)' : '#f87171',
              backgroundColor: newVisibleInPortal ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              fontSize: '0.85rem'
            }}
            title="Determina si este gasto será visible para los apoderados en su portal"
          >
            {newVisibleInPortal ? <Eye size={16} /> : <EyeOff size={16} />}
            <span>{newVisibleInPortal ? 'Visible en Portal' : 'Oculto en Portal'}</span>
          </button>

          <button type="submit" className="btn btn-outline" style={{ height: '42px', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.4)' }}>
            Registrar Gasto
          </button>
        </form>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <Filter size={15} />
            <span>Mostrar:</span>
          </div>

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="input-field"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', width: 'auto', margin: 0 }}
          >
            <option value="all">Todos los Gastos ({outcomes.length})</option>
            <option value="general">Solo Gastos del Curso ({outcomes.filter(o => !o.eventId && !o.isEventExpense).length})</option>
            <option value="events">Todos los Gastos de Eventos ({outcomes.filter(o => !!o.eventId || !!o.isEventExpense).length})</option>
            {events.length > 0 && (
              <optgroup label="Filtrar por Evento Específico">
                {events.map(ev => {
                  const evCount = outcomes.filter(o => o.eventId === ev.id).length;
                  return (
                    <option key={ev.id} value={ev.id}>
                      🎉 {ev.name} ({evCount})
                    </option>
                  );
                })}
              </optgroup>
            )}
          </select>
        </div>

        <div style={{ position: 'relative', minWidth: '220px' }}>
          <input
            type="text"
            placeholder="Buscar por motivo, responsable..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field"
            style={{ padding: '0.4rem 0.75rem 0.4rem 2rem', fontSize: '0.85rem', margin: 0, width: '100%' }}
          />
          <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        </div>
      </div>

      {/* Tabla de Gastos */}
      <div className="table-responsive glass-panel" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: '820px', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              {isAuditMode && <th style={{ padding: '0.75rem 0.5rem', width: '36px' }}>Audit.</th>}
              <th style={{ padding: '0.75rem', width: '100px', whiteSpace: 'nowrap' }}>Fecha</th>
              <th style={{ padding: '0.75rem' }}>Motivo / Origen</th>
              <th style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', minWidth: '125px' }}>{isAuditMode ? 'Monto Sistema' : 'Monto'}</th>
              {isAuditMode && <th style={{ padding: '0.75rem', width: '110px' }}>Monto Manual ($)</th>}
              {isAuditMode && <th style={{ padding: '0.75rem', width: '90px' }}>Cuadratura</th>}
              <th style={{ padding: '0.75rem' }}>Medio / Fondo</th>
              <th style={{ padding: '0.75rem', textAlign: 'center', width: '60px' }}>Portal</th>
              <th style={{ padding: '0.75rem', textAlign: 'center', width: '85px' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredOutcomes.map(o => {
              const f = funds.find(fund => fund.id === o.fundId);
              const isEvent = Boolean(o.eventId || o.isEventExpense);
              const eventNameDisplay = o.eventName || events.find(ev => ev.id === o.eventId)?.name || 'Evento';

              return (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  {editingOutcomeId === o.id ? (
                    <>
                      <td style={{ padding: '1rem' }}>
                        <input
                          type="date"
                          className="input-field"
                          value={editOutcomeDate}
                          onChange={e => setEditOutcomeDate(e.target.value)}
                          style={{ margin: 0, padding: '0.4rem 0.5rem', minWidth: '120px' }}
                        />
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <input
                          type="text"
                          className="input-field"
                          value={editOutcomeTitle}
                          onChange={e => setEditOutcomeTitle(e.target.value)}
                          style={{ margin: '0 0 0.4rem 0', padding: '0.4rem 0.5rem' }}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <select
                            className="input-field"
                            value={editOutcomeEventId}
                            onChange={e => setEditOutcomeEventId(e.target.value)}
                            style={{ margin: 0, padding: '0.3rem 0.5rem', fontSize: '0.75rem', width: 'auto' }}
                          >
                            <option value="">Gasto General (Sin evento)</option>
                            {events.map(ev => (
                              <option key={ev.id} value={ev.id}>🎉 {ev.name}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            placeholder="Responsable"
                            className="input-field"
                            value={editOutcomeResponsable}
                            onChange={e => setEditOutcomeResponsable(e.target.value)}
                            style={{ margin: 0, padding: '0.3rem 0.5rem', fontSize: '0.75rem', width: '130px' }}
                          />
                        </div>
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <input
                          type="number"
                          className="input-field"
                          value={editOutcomeAmount}
                          onChange={e => setEditOutcomeAmount(e.target.value)}
                          style={{ margin: 0, padding: '0.4rem 0.5rem', width: '100px' }}
                        />
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <select
                          className="input-field"
                          value={editOutcomeMethod}
                          onChange={e => setEditOutcomeMethod(e.target.value)}
                          style={{ margin: '0 0 0.5rem 0', padding: '0.4rem 0.5rem' }}
                        >
                          <option value="cash">Efectivo</option>
                          <option value="transfer">Transferencia</option>
                        </select>
                        <select
                          className="input-field"
                          value={editOutcomeFund}
                          onChange={e => setEditOutcomeFund(e.target.value)}
                          style={{ margin: 0, padding: '0.4rem 0.5rem' }}
                        >
                          <option value="general">Fondo General</option>
                          {funds.filter(fd => !fd.isLocked && fd.id !== 'general').map(fd => (
                            <option key={fd.id} value={fd.id}>{fd.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'center', width: '60px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={editOutcomeVisibleInPortal}
                            onClick={() => setEditOutcomeVisibleInPortal(!editOutcomeVisibleInPortal)}
                            style={{
                              width: '40px',
                              height: '22px',
                              borderRadius: '11px',
                              backgroundColor: editOutcomeVisibleInPortal ? '#10b981' : '#334155',
                              border: `1px solid ${editOutcomeVisibleInPortal ? '#059669' : '#475569'}`,
                              position: 'relative',
                              cursor: 'pointer',
                              padding: 0,
                              transition: 'all 0.2s ease',
                              display: 'inline-flex',
                              alignItems: 'center',
                              outline: 'none'
                            }}
                            title={editOutcomeVisibleInPortal ? 'Visible en portal' : 'Oculto'}
                          >
                            <span
                              style={{
                                width: '16px',
                                height: '16px',
                                borderRadius: '50%',
                                backgroundColor: '#ffffff',
                                position: 'absolute',
                                top: '2px',
                                left: editOutcomeVisibleInPortal ? '20px' : '2px',
                                transition: 'all 0.2s ease',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                            >
                              {editOutcomeVisibleInPortal ? (
                                <Eye size={10} color="#059669" />
                              ) : (
                                <EyeOff size={10} color="#64748b" />
                              )}
                            </span>
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'center', width: '85px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '0.35rem', justifyContent: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(o.id)}
                            className="btn btn-primary"
                            style={{ padding: '0.45rem', backgroundColor: 'var(--success)', borderRadius: '8px' }}
                            title="Guardar cambios"
                          >
                            <CheckCircle size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingOutcomeId(null)}
                            className="btn btn-outline"
                            style={{ padding: '0.45rem', borderRadius: '8px' }}
                            title="Cancelar edición"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : isAuditMode ? (
                    <>
                      <td style={{ padding: '1rem' }}>
                        <div
                          onClick={(e) => { e.stopPropagation(); handleToggleAuditCheck(o.id); }}
                          style={{
                            width: '24px', height: '24px', borderRadius: '6px',
                            border: `2px solid ${auditChecks[o.id] ? '#8b5cf6' : 'var(--border-color)'}`,
                            backgroundColor: auditChecks[o.id] ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                          }}
                        >
                          {auditChecks[o.id] && <Check size={16} color="#8b5cf6" />}
                        </div>
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{o.date}</td>
                      <td style={{ padding: '1rem', fontWeight: '500' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span>{o.title}</span>
                          {isEvent && (
                            <span style={{
                              fontSize: '0.72rem',
                              padding: '0.15rem 0.5rem',
                              borderRadius: '12px',
                              backgroundColor: 'rgba(139, 92, 246, 0.15)',
                              color: '#c4b5fd',
                              border: '1px solid rgba(139, 92, 246, 0.3)',
                              fontWeight: '600'
                            }}>
                              🎉 Evento: {eventNameDisplay}
                            </span>
                          )}
                          {o.responsable && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              • Resp: {o.responsable}
                            </span>
                          )}
                          {o.visibleInPortal === false && (
                            <span style={{
                              fontSize: '0.7rem',
                              padding: '0.1rem 0.45rem',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(239, 68, 68, 0.15)',
                              color: '#f87171',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              fontWeight: '600'
                            }}>
                              Oculto en portal
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: 'var(--danger)', fontWeight: 'bold', whiteSpace: 'nowrap', minWidth: '125px' }}>
                        -{formatMoney(o.amount)}
                      </td>

                      <td style={{ padding: '1rem' }}>
                        <input
                          type="number"
                          className="input-field"
                          placeholder="$ 0"
                          value={auditManualAmounts[o.id] !== undefined ? auditManualAmounts[o.id] : ''}
                          onChange={(e) => handleAuditManualAmountChange(o.id, e.target.value)}
                          style={{
                            width: '100px', margin: 0, padding: '0.4rem 0.5rem',
                            borderColor: auditManualAmounts[o.id] !== undefined ? '#8b5cf6' : 'var(--border-color)',
                            backgroundColor: auditManualAmounts[o.id] !== undefined ? 'rgba(139,92,246,0.05)' : 'transparent'
                          }}
                        />
                      </td>

                      <td style={{ padding: '1rem' }}>
                        {(() => {
                          const manualVal = parseFloat(auditManualAmounts[o.id]);
                          if (isNaN(manualVal)) {
                            return <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Sin ingresar</span>;
                          }
                          const sysAmt = parseFloat(o.amount) || 0;
                          const diff = manualVal - sysAmt;
                          if (diff === 0) {
                            return (
                              <span style={{
                                fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '10px',
                                backgroundColor: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '0.2rem'
                              }}>
                                <Check size={13} /> OK ($0)
                              </span>
                            );
                          }
                          return (
                            <span style={{
                              fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '10px',
                              backgroundColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--danger)', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '0.2rem'
                            }}>
                              <AlertTriangle size={13} /> {diff > 0 ? `+${formatMoney(diff)}` : formatMoney(diff)}
                            </span>
                          );
                        })()}
                      </td>

                      <td style={{ padding: '1rem' }}>
                        <div style={{ fontSize: '0.9rem' }}>{o.paymentMethod === 'cash' ? '💵 Efectivo' : '🏦 Transferencia'}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {f ? f.name : (isEvent ? `Evento: ${eventNameDisplay}` : 'Fondo General')}
                        </div>
                      </td>

                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', width: '60px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={o.visibleInPortal !== false}
                            onClick={() => handleToggleOutcomeVisibility(o.id, o.visibleInPortal !== false)}
                            style={{
                              width: '40px',
                              height: '22px',
                              borderRadius: '11px',
                              backgroundColor: o.visibleInPortal !== false ? '#10b981' : '#334155',
                              border: `1px solid ${o.visibleInPortal !== false ? '#059669' : '#475569'}`,
                              position: 'relative',
                              cursor: 'pointer',
                              padding: 0,
                              transition: 'all 0.2s ease',
                              display: 'inline-flex',
                              alignItems: 'center',
                              outline: 'none'
                            }}
                            title={o.visibleInPortal !== false ? 'Gasto visible en portal de apoderados (clic para ocultar)' : 'Gasto oculto en portal de apoderados (clic para mostrar)'}
                          >
                            <span
                              style={{
                                width: '16px',
                                height: '16px',
                                borderRadius: '50%',
                                backgroundColor: '#ffffff',
                                position: 'absolute',
                                top: '2px',
                                left: o.visibleInPortal !== false ? '20px' : '2px',
                                transition: 'all 0.2s ease',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                            >
                              {o.visibleInPortal !== false ? (
                                <Eye size={10} color="#059669" />
                              ) : (
                                <EyeOff size={10} color="#64748b" />
                              )}
                            </span>
                          </button>
                        </div>
                      </td>

                      <td style={{ padding: '1rem', textAlign: 'center' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleAuditCheck(o.id); }}
                          className="btn btn-outline"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', borderColor: auditChecks[o.id] ? 'var(--success)' : '#8b5cf6', color: auditChecks[o.id] ? 'var(--success)' : '#c4b5fd' }}
                        >
                          {auditChecks[o.id] ? '✔ Listo' : 'Verificar'}
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{o.date}</td>
                      <td style={{ padding: '1rem', fontWeight: '500' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span>{o.title}</span>
                          {isEvent && (
                            <span style={{
                              fontSize: '0.72rem',
                              padding: '0.15rem 0.55rem',
                              borderRadius: '12px',
                              backgroundColor: 'rgba(139, 92, 246, 0.15)',
                              color: '#c4b5fd',
                              border: '1px solid rgba(139, 92, 246, 0.3)',
                              fontWeight: '600'
                            }}>
                              🎉 Evento: {eventNameDisplay}
                            </span>
                          )}
                          {o.responsable && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              • Resp: {o.responsable}
                            </span>
                          )}
                          {o.visibleInPortal === false && (
                            <span style={{
                              fontSize: '0.7rem',
                              padding: '0.1rem 0.45rem',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(239, 68, 68, 0.15)',
                              color: '#f87171',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              fontWeight: '600'
                            }}>
                              Oculto en portal
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{
                        padding: '0.85rem 1rem',
                        color: 'var(--danger)',
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                        minWidth: '125px',
                        fontSize: '0.95rem'
                      }}>
                        -{formatMoney(o.amount)}
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ fontSize: '0.9rem' }}>{o.paymentMethod === 'cash' ? '💵 Efectivo' : '🏦 Transferencia'}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {f ? f.name : (isEvent ? `Evento: ${eventNameDisplay}` : 'Fondo General')}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', width: '60px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={o.visibleInPortal !== false}
                            onClick={() => handleToggleOutcomeVisibility(o.id, o.visibleInPortal !== false)}
                            style={{
                              width: '40px',
                              height: '22px',
                              borderRadius: '11px',
                              backgroundColor: o.visibleInPortal !== false ? '#10b981' : '#334155',
                              border: `1px solid ${o.visibleInPortal !== false ? '#059669' : '#475569'}`,
                              position: 'relative',
                              cursor: 'pointer',
                              padding: 0,
                              transition: 'all 0.2s ease',
                              display: 'inline-flex',
                              alignItems: 'center',
                              outline: 'none'
                            }}
                            title={o.visibleInPortal !== false ? 'Gasto visible en portal de apoderados (clic para ocultar)' : 'Gasto oculto en portal de apoderados (clic para mostrar)'}
                          >
                            <span
                              style={{
                                width: '16px',
                                height: '16px',
                                borderRadius: '50%',
                                backgroundColor: '#ffffff',
                                position: 'absolute',
                                top: '2px',
                                left: o.visibleInPortal !== false ? '20px' : '2px',
                                transition: 'all 0.2s ease',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                            >
                              {o.visibleInPortal !== false ? (
                                <Eye size={10} color="#059669" />
                              ) : (
                                <EyeOff size={10} color="#64748b" />
                              )}
                            </span>
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', width: '85px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '0.35rem', justifyContent: 'center', alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleStartEdit(o)}
                            className="btn btn-outline"
                            style={{
                              padding: '0.45rem',
                              borderRadius: '8px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--text-main)',
                              borderColor: 'rgba(255, 255, 255, 0.15)'
                            }}
                            title="Editar gasto"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(o.id)}
                            className="btn btn-outline"
                            style={{
                              padding: '0.45rem',
                              borderRadius: '8px',
                              color: 'var(--danger)',
                              borderColor: 'rgba(239, 68, 68, 0.3)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            title="Eliminar gasto"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredOutcomes.length === 0 && (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            {outcomes.length === 0
              ? 'No se han registrado gastos aún.'
              : 'No hay gastos que coincidan con el filtro o búsqueda seleccionada.'}
          </div>
        )}
      </div>
    </div>
  );
};

export default OutcomeManagement;
