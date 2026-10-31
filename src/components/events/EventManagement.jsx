import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../../firebase/config';
import { collection, getDocs, doc, setDoc, query, deleteDoc, where } from 'firebase/firestore';
import { ArrowLeft, PlusCircle, CheckCircle, Calendar, X, Save, Trash2, Users, UserCheck, Search, Sparkles } from 'lucide-react';
import { useModal } from '../../context/ModalContext';
import { formatStudentName } from '../../utils/nameUtils';
import { useAuth } from '../../context/AuthContext';
import EventDetail from './EventDetail';
import { useCourse } from '../../context/CourseContext';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';
import { loadDemoEventData } from '../../utils/eventTestUtils';

const EventManagement = ({ onBack }) => {
  const { user } = useAuth();
  const { showAlert, showConfirm } = useModal();
  const { selectedCourse } = useCourse();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  // Vista actual dentro de EventManagement
  const [selectedEventId, setSelectedEventId] = useState(null);

  // Estados del modal de creación
  const [showCreateModal, setShowCreateModal] = useState(false);
  useLockBodyScroll(showCreateModal);
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState(new Date().toISOString().split('T')[0]);
  const [mandatoryAmount, setMandatoryAmount] = useState('');
  const [noShowAmount, setNoShowAmount] = useState('');
  const [isTestEvent, setIsTestEvent] = useState(false);
  const [preloadDemoData, setPreloadDemoData] = useState(true);

  // Selección de alumnos para el evento
  const [courseStudents, setCourseStudents] = useState([]);
  const [studentSelectionMode, setStudentSelectionMode] = useState('all'); // 'all' | 'custom'
  const [selectedStudentIds, setSelectedStudentIds] = useState(new Set());
  const [studentSearchTerm, setStudentSearchTerm] = useState('');

  const fetchEvents = useCallback(async () => {
    if (!selectedCourse) return;
    setLoading(true);
    try {
      const q = query(collection(db, 'events'), where('courseId', '==', selectedCourse.id));
      const querySnapshot = await getDocs(q);
      const eventsList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      eventsList.sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
      setEvents(eventsList);
    } catch (error) {
      console.error("Error al obtener eventos:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedCourse]);

  const fetchCourseStudents = useCallback(async () => {
    if (!selectedCourse?.id) return;
    try {
      const q = query(collection(db, 'students'), where('courseId', '==', selectedCourse.id));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.status !== 'retirado');
      list.sort((a, b) => {
        const aNum = parseInt(a.listNumber, 10) || 999;
        const bNum = parseInt(b.listNumber, 10) || 999;
        return aNum - bNum;
      });
      setCourseStudents(list);
      setSelectedStudentIds(new Set(list.map(s => s.id)));
    } catch (error) {
      console.error("Error al obtener alumnos del curso:", error);
    }
  }, [selectedCourse]);

  useEffect(() => {
    fetchEvents();
    fetchCourseStudents();
  }, [fetchEvents, fetchCourseStudents]);

  useEffect(() => {
    if (showCreateModal) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [showCreateModal]);

  const handleOpenCreateModal = () => {
    setEventName('');
    setEventDate(new Date().toISOString().split('T')[0]);
    setMandatoryAmount('');
    setNoShowAmount('');
    setIsTestEvent(false);
    setPreloadDemoData(false);
    setStudentSelectionMode('all');
    setSelectedStudentIds(new Set(courseStudents.map(s => s.id)));
    setStudentSearchTerm('');
    setShowCreateModal(true);
  };

  const handleOpenQuickTestEvent = () => {
    setEventName('Evento de Prueba (Completos y POS)');
    setEventDate(new Date().toISOString().split('T')[0]);
    setMandatoryAmount('0');
    setNoShowAmount('0');
    setIsTestEvent(true);
    setPreloadDemoData(true);
    setStudentSelectionMode('all');
    setSelectedStudentIds(new Set(courseStudents.map(s => s.id)));
    setStudentSearchTerm('');
    setShowCreateModal(true);
  };

  const handleToggleStudent = (studentId) => {
    setSelectedStudentIds(prev => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!eventName || (!isTestEvent && (!mandatoryAmount || !noShowAmount)) || !selectedCourse) {
      await showAlert('Debes ingresar el nombre y los montos requeridos.');
      return;
    }

    if (studentSelectionMode === 'custom' && selectedStudentIds.size === 0) {
      await showAlert('Debes seleccionar al menos un alumno para participar en el evento.');
      return;
    }

    const targetStudents = studentSelectionMode === 'all'
      ? courseStudents
      : courseStudents.filter(s => selectedStudentIds.has(s.id));

    const confirmMessage = isTestEvent
      ? `¿Estás seguro de crear el evento "${eventName}"?\nES UN EVENTO DE PRUEBA. No se cobrará nada a los alumnos.`
      : `¿Estás seguro de crear el evento "${eventName}"?\nEsto cobrará automáticamente $${mandatoryAmount} a los ${targetStudents.length} alumno(s) ${studentSelectionMode === 'all' ? '(todos)' : 'seleccionados'}.`;

    if (!(await showConfirm(confirmMessage))) {
      return;
    }

    setLoading(true);
    try {
      // 1. Crear un Fondo para este evento
      const fundId = 'fund_' + Date.now().toString();
      await setDoc(doc(db, 'funds', fundId), {
        name: `Evento: ${eventName.trim()}`,
        description: `Fondo automático para el evento ${eventName}`,
        courseId: selectedCourse.id,
        createdAt: new Date().toISOString()
      });

      // 2. Crear el Evento
      const eventId = 'evt_' + Date.now().toString();
      const newEvent = {
        name: eventName.trim(),
        date: eventDate,
        mandatoryAmount: isTestEvent ? 0 : parseFloat(mandatoryAmount),
        noShowAmount: isTestEvent ? 0 : parseFloat(noShowAmount),
        fundId: fundId,
        courseId: selectedCourse.id,
        createdAt: new Date().toISOString(),
        createdBy: user?.email || user?.displayName || 'Unknown User',
        status: 'active',
        isTestEvent: isTestEvent,
        studentSelectionMode: studentSelectionMode,
        participantStudentIds: targetStudents.map(s => s.id),
        studentsCount: targetStudents.length
      };
      await setDoc(doc(db, 'events', eventId), newEvent);

      if (isTestEvent && preloadDemoData) {
        try {
          await loadDemoEventData(eventId, selectedCourse.id, user);
        } catch (demoErr) {
          console.error("Error al precargar datos de prueba:", demoErr);
        }
      }

      if (!isTestEvent) {
        // 3. Crear el Gasto General (Expense)
        const expenseId = `exp_evt_${eventId}`;

        await setDoc(doc(db, 'expenses', expenseId), {
          title: `Cuota Obligatoria: ${eventName.trim()}`,
          date: eventDate,
          totalAmount: parseFloat(mandatoryAmount) * targetStudents.length,
          amountPerStudent: parseFloat(mandatoryAmount),
          studentsCount: targetStudents.length,
          paidCount: 0,
          fundId: fundId,
          courseId: selectedCourse.id,
          eventId: eventId,
          createdAt: new Date().toISOString()
        });

        // 4. Crear deudas individuales sólo para los alumnos seleccionados
        for (const student of targetStudents) {
          const debtId = `debt_${expenseId}_${student.id}`;
          await setDoc(doc(db, 'debts', debtId), {
            expenseId,
            studentId: student.id,
            studentName: formatStudentName(student),
            apoderadoEmails: student.apoderadoEmails || (student.apoderadoEmail ? [student.apoderadoEmail] : []),
            amount: parseFloat(mandatoryAmount),
            status: 'pending', // pending, review, paid
            title: `Cuota Obligatoria: ${eventName.trim()}`,
            date: eventDate,
            fundId: fundId,
            courseId: selectedCourse.id,
            eventId: eventId,
            createdAt: new Date().toISOString()
          });
        }
      }

      setMessage(isTestEvent ? 'Evento de prueba creado con éxito.' : 'Evento creado y cuotas generadas con éxito.');
      setShowCreateModal(false);
      setEventName('');
      setMandatoryAmount('');
      setNoShowAmount('');
      setIsTestEvent(false);
      setStudentSelectionMode('all');
      setSelectedStudentIds(new Set(courseStudents.map(s => s.id)));
      setStudentSearchTerm('');

      fetchEvents();
      setTimeout(() => setMessage(''), 3000);

    } catch (error) {
      console.error("Error creando evento:", error);
      await showAlert('Hubo un error al crear el evento.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEvent = async (e, eventToDelete) => {
    e.stopPropagation();
    if (!(await showConfirm(`¿Estás seguro de ELIMINAR el evento "${eventToDelete.name}" y todos sus registros asociados? Esta acción no se puede deshacer.`))) return;

    setLoading(true);
    try {
      await deleteDoc(doc(db, 'events', eventToDelete.id));
      await deleteDoc(doc(db, 'funds', eventToDelete.fundId));
      await deleteDoc(doc(db, 'expenses', `exp_evt_${eventToDelete.id}`));
      try {
        await deleteDoc(doc(db, 'expenses', `exp_evt_fine_${eventToDelete.id}`));
      } catch (e) {
        // Ignorar si no existía multa
      }

      const queries = [
        query(collection(db, 'debts'), where('eventId', '==', eventToDelete.id)),
        query(collection(db, 'eventItems'), where('eventId', '==', eventToDelete.id)),
        query(collection(db, 'eventInventory'), where('eventId', '==', eventToDelete.id)),
        query(collection(db, 'eventSales'), where('eventId', '==', eventToDelete.id)),
        query(collection(db, 'incomes'), where('eventId', '==', eventToDelete.id)),
        query(collection(db, 'outcomes'), where('eventId', '==', eventToDelete.id))
      ];

      for (const q of queries) {
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          await deleteDoc(d.ref);
        }
      }

      setMessage('Evento eliminado con éxito.');
      fetchEvents();
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error eliminando evento:", error);
      await showAlert('Hubo un error al eliminar el evento.');
      setLoading(false); // only set false on error because fetchEvents will set false on success
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  // Si hay un evento seleccionado, mostramos la vista de detalle
  if (selectedEventId) {
    return <EventDetail eventId={selectedEventId} onBack={() => setSelectedEventId(null)} />;
  }

  // Alumnos filtrados para el selector
  const filteredCourseStudents = courseStudents.filter(student => {
    if (!studentSearchTerm) return true;
    const name = formatStudentName(student).toLowerCase();
    const listNum = String(student.listNumber || '');
    const term = studentSearchTerm.toLowerCase();
    return name.includes(term) || listNum.includes(term);
  });

  const targetStudentsCount = studentSelectionMode === 'all'
    ? courseStudents.length
    : selectedStudentIds.size;

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
            <ArrowLeft size={18} />
          </button>
          <h3 style={{ margin: 0 }}>Gestión de Eventos y Ventas</h3>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={handleOpenQuickTestEvent}
            className="btn btn-outline"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderColor: 'var(--warning)', color: 'var(--warning)' }}
            title="Crear un evento de simulación para ensayar ventas, stock e impresora térmica"
          >
            🧪 Crear Evento de Prueba
          </button>
          <button
            onClick={handleOpenCreateModal}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <PlusCircle size={18} /> Crear Evento
          </button>
        </div>
      </div>

      {message && (
        <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', color: 'var(--success)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={18} /> {message}
        </div>
      )}

      {/* Lista de Eventos */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando eventos...</div>
      ) : events.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <Calendar size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem', opacity: 0.5 }} />
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>No hay eventos creados todavía.</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Crea un evento para organizar ventas y asistencia.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {events.map(event => (
            <div
              key={event.id}
              onClick={() => setSelectedEventId(event.id)}
              className="glass-panel"
              style={{ padding: '1.5rem', cursor: 'pointer', transition: 'all 0.2s', border: '1px solid transparent' }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
              onMouseOut={(e) => e.currentTarget.style.borderColor = 'transparent'}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ backgroundColor: 'rgba(99,102,241,0.1)', padding: '1rem', borderRadius: '50%', color: 'var(--primary)' }}>
                    <Calendar size={24} />
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {event.name}
                      {event.isTestEvent && <span style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', backgroundColor: 'var(--warning)', color: '#000', borderRadius: '1rem', fontWeight: 'bold' }}>PRUEBA</span>}
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span>{new Date(event.date).toLocaleDateString('es-CL')}</span>
                      {typeof event.studentsCount === 'number' && (
                        <span>• {event.studentsCount} alumnos</span>
                      )}
                      {event.studentSelectionMode === 'custom' && (
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', backgroundColor: 'rgba(99,102,241,0.2)', color: '#a5b4fc', borderRadius: '4px' }}>
                          Sólo algunos
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  onClick={(e) => handleDeleteEvent(e, event)}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem', opacity: 0.7 }}
                  onMouseOver={(e) => e.currentTarget.style.opacity = 1}
                  onMouseOut={(e) => e.currentTarget.style.opacity = 0.7}
                  title="Eliminar Evento"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--text-muted)', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                {event.isTestEvent ? (
                  <div style={{ width: '100%', textAlign: 'center', color: 'var(--warning)', fontWeight: 'bold', fontSize: '0.85rem' }}>EVENTO DE MUESTRA / PRUEBA</div>
                ) : (
                  <>
                    <div>
                      <span style={{ display: 'block' }}>Cuota</span>
                      <strong style={{ color: 'var(--text)' }}>{formatMoney(event.mandatoryAmount)}</strong>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ display: 'block' }}>Multa</span>
                      <strong style={{ color: 'var(--danger)' }}>{formatMoney(event.noShowAmount)}</strong>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Creación */}
      {showCreateModal && createPortal(
        <div 
          className="modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            backdropFilter: 'blur(6px)',
            zIndex: 9999,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            padding: '1rem 0.5rem 2rem',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          <div className="glass-panel animate-fade-in" style={{
            width: '100%',
            maxWidth: '560px',
            maxHeight: 'min(92vh, 750px)',
            margin: '0.25rem auto',
            backgroundColor: '#0f172a',
            border: '1px solid rgba(99, 102, 241, 0.35)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 25px rgba(99, 102, 241, 0.15)'
          }}>
            {/* 1. Encabezado Fijo del Modal (Siempre visible) */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(15, 23, 42, 0) 100%)',
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(99, 102, 241, 0.2)',
                  border: '1px solid rgba(99, 102, 241, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--primary)'
                }}>
                  <Calendar size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#fff', fontWeight: '700' }}>
                    Crear Nuevo Evento
                  </h3>
                  <p style={{ margin: '0.15rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    Configura los detalles, participantes y cobros del evento
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.4rem', borderRadius: '6px' }}
                title="Cerrar"
              >
                <X size={20} />
              </button>
            </div>

            {/* 2. Cuerpo Desplazable del Formulario (Scroll interno) */}
            <form onSubmit={handleCreateEvent} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <div style={{
                padding: '1.5rem',
                overflowY: 'auto',
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem'
              }}>
                <div className="input-group">
                  <label className="input-label">Nombre del Evento (Ej. Kermesse Solidaria)</label>
                  <input
                    type="text"
                    required
                    className="input-field"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    placeholder="Nombre del evento..."
                  />
                </div>

                <div className="input-group">
                  <label className="input-label">Fecha del Evento</label>
                  <input
                    type="date"
                    required
                    className="input-field"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', backgroundColor: 'rgba(245, 158, 11, 0.1)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <input
                      type="checkbox"
                      id="isTestEvent"
                      checked={isTestEvent}
                      onChange={(e) => {
                        setIsTestEvent(e.target.checked);
                        if (e.target.checked) setPreloadDemoData(true);
                      }}
                      style={{ width: '18px', height: '18px', accentColor: 'var(--warning)', cursor: 'pointer' }}
                    />
                    <label htmlFor="isTestEvent" style={{ fontSize: '0.85rem', color: 'var(--warning)', cursor: 'pointer', fontWeight: '500' }}>
                      Crear como <strong>Evento de Prueba</strong> (No generará cuotas ni deudas reales, ideal para probar el POS)
                    </label>
                  </div>

                  {isTestEvent && (
                    <div style={{ paddingLeft: '1.75rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                        <input
                          type="checkbox"
                          checked={preloadDemoData}
                          onChange={(e) => setPreloadDemoData(e.target.checked)}
                          style={{ accentColor: 'var(--warning)', width: '16px', height: '16px' }}
                        />
                        <span>Precargar insumos y menú de prueba (Panes, Vienesas y Completos listos para vender)</span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Opción de Selección de Alumnos (Todos o sólo algunos) */}
                <div>
                  <label className="input-label" style={{ marginBottom: '0.5rem', display: 'block' }}>
                    Alumnos participantes en este evento
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setStudentSelectionMode('all');
                        setSelectedStudentIds(new Set(courseStudents.map(s => s.id)));
                      }}
                      style={{
                        padding: '0.75rem 0.5rem',
                        borderRadius: 'var(--radius-md)',
                        border: studentSelectionMode === 'all' ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                        backgroundColor: studentSelectionMode === 'all' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                        color: studentSelectionMode === 'all' ? '#a5b4fc' : 'var(--text-main)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.25rem',
                        textAlign: 'center',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <Users size={20} style={{ color: studentSelectionMode === 'all' ? 'var(--primary)' : 'var(--text-muted)' }} />
                      <strong style={{ fontSize: '0.85rem' }}>Todos los alumnos</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {courseStudents.length} alumnos del curso
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setStudentSelectionMode('custom')}
                      style={{
                        padding: '0.75rem 0.5rem',
                        borderRadius: 'var(--radius-md)',
                        border: studentSelectionMode === 'custom' ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                        backgroundColor: studentSelectionMode === 'custom' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                        color: studentSelectionMode === 'custom' ? '#a5b4fc' : 'var(--text-main)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.25rem',
                        textAlign: 'center',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <UserCheck size={20} style={{ color: studentSelectionMode === 'custom' ? 'var(--primary)' : 'var(--text-muted)' }} />
                      <strong style={{ fontSize: '0.85rem' }}>Sólo algunos</strong>
                      <span style={{ fontSize: '0.75rem', color: studentSelectionMode === 'custom' ? 'var(--primary)' : 'var(--text-muted)' }}>
                        {selectedStudentIds.size} de {courseStudents.length} seleccionados
                      </span>
                    </button>
                  </div>

                  {studentSelectionMode === 'custom' && (
                    <div style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      padding: '0.85rem',
                      marginTop: '0.5rem'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                        <div style={{ position: 'relative', flex: 1, minWidth: '150px' }}>
                          <input
                            type="text"
                            placeholder="Buscar por nombre o N°..."
                            value={studentSearchTerm}
                            onChange={(e) => setStudentSearchTerm(e.target.value)}
                            className="input-field"
                            style={{ padding: '0.35rem 0.5rem 0.35rem 1.8rem', fontSize: '0.85rem' }}
                          />
                          <Search size={14} style={{ position: 'absolute', left: '0.55rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            type="button"
                            onClick={() => setSelectedStudentIds(new Set(courseStudents.map(s => s.id)))}
                            className="btn btn-outline"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                          >
                            Todos
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedStudentIds(new Set())}
                            className="btn btn-outline"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                          >
                            Ninguno
                          </button>
                        </div>
                      </div>

                      <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingRight: '0.2rem' }}>
                        {filteredCourseStudents.map(student => {
                          const isSelected = selectedStudentIds.has(student.id);
                          return (
                            <div
                              key={student.id}
                              onClick={() => handleToggleStudent(student.id)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.6rem',
                                padding: '0.45rem 0.65rem',
                                backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                                border: isSelected ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                                borderRadius: 'var(--radius-sm)',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleStudent(student.id)}
                                style={{ width: '16px', height: '16px', accentColor: 'var(--primary)', cursor: 'pointer' }}
                              />
                              <span style={{ fontSize: '0.85rem', color: isSelected ? '#fff' : 'var(--text-main)', fontWeight: isSelected ? '600' : 'normal' }}>
                                {student.listNumber ? `${student.listNumber}. ` : ''}{formatStudentName(student)}
                              </span>
                            </div>
                          );
                        })}
                        {filteredCourseStudents.length === 0 && (
                          <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            No se encontraron alumnos con esa búsqueda.
                          </div>
                        )}
                      </div>

                      <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                        {selectedStudentIds.size} de {courseStudents.length} alumnos seleccionados
                      </div>
                    </div>
                  )}
                </div>

                {!isTestEvent && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div className="input-group">
                        <label className="input-label">Monto Obligatorio ($)</label>
                        <input
                          type="number"
                          min="1"
                          required={!isTestEvent}
                          className="input-field"
                          placeholder="Ej. 1500"
                          value={mandatoryAmount}
                          onChange={(e) => setMandatoryAmount(e.target.value)}
                        />
                        <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                          Se cobrará a los alumnos asignados.
                        </small>
                      </div>

                      <div className="input-group">
                        <label className="input-label">Monto si NO Asiste ($)</label>
                        <input
                          type="number"
                          min="1"
                          required={!isTestEvent}
                          className="input-field"
                          placeholder="Ej. 3000"
                          value={noShowAmount}
                          onChange={(e) => setNoShowAmount(e.target.value)}
                        />
                        <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                          Multa aplicable si falta.
                        </small>
                      </div>
                    </div>

                    {mandatoryAmount && (
                      <div style={{ padding: '0.75rem 1rem', backgroundColor: 'rgba(99, 102, 241, 0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(99, 102, 241, 0.25)', fontSize: '0.85rem' }}>
                        <strong>Resumen de cuota:</strong> Se cobrará <strong>{formatMoney(parseFloat(mandatoryAmount) || 0)}</strong> a <strong>{targetStudentsCount}</strong> alumno(s) {studentSelectionMode === 'all' ? '(todo el curso)' : '(seleccionados)'} (Total inicial: <strong>{formatMoney((parseFloat(mandatoryAmount) || 0) * targetStudentsCount)}</strong>).
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 3. Pie Fijo de Acciones (Botones siempre visibles) */}
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
                padding: '1rem 1.5rem',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                backgroundColor: '#0f172a',
                flexShrink: 0
              }}>
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-outline" style={{ padding: '0.55rem 1.25rem' }}>
                  Cancelar
                </button>
                <button type="submit" disabled={loading} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 1.4rem' }}>
                  {loading ? 'Creando...' : <><Save size={18} /> Guardar y Generar Cuotas</>}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default EventManagement;
