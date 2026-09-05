import React, { useState, useEffect } from 'react';
import { db } from '../../firebase/config';
import { collection, getDocs, doc, setDoc, query, orderBy } from 'firebase/firestore';
import { ArrowLeft, PlusCircle, CheckCircle, Calendar, X, Save } from 'lucide-react';
import { useModal } from '../../context/ModalContext';
import EventDetail from './EventDetail';

const EventManagement = ({ onBack }) => {
  const { showAlert, showConfirm } = useModal();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  
  // Vista actual dentro de EventManagement
  const [selectedEventId, setSelectedEventId] = useState(null);

  // Estados del modal de creación
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState(new Date().toISOString().split('T')[0]);
  const [mandatoryAmount, setMandatoryAmount] = useState('');
  const [noShowAmount, setNoShowAmount] = useState('');

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      const q = query(collection(db, 'events'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const eventsList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setEvents(eventsList);
    } catch (error) {
      console.error("Error al obtener eventos:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!eventName || !mandatoryAmount || !noShowAmount) {
      await showAlert('Debes ingresar el nombre y ambos montos.');
      return;
    }

    if (!(await showConfirm(`¿Estás seguro de crear el evento "${eventName}"?\nEsto cobrará automáticamente $${mandatoryAmount} a todos los alumnos.`))) {
      return;
    }

    setLoading(true);
    try {
      // 1. Crear un Fondo para este evento
      const fundId = 'fund_' + Date.now().toString();
      await setDoc(doc(db, 'funds', fundId), {
        name: `Evento: ${eventName.trim()}`,
        description: `Fondo automático para el evento ${eventName}`,
        createdAt: new Date().toISOString()
      });

      // 2. Crear el Evento
      const eventId = 'evt_' + Date.now().toString();
      const newEvent = {
        name: eventName.trim(),
        date: eventDate,
        mandatoryAmount: parseFloat(mandatoryAmount),
        noShowAmount: parseFloat(noShowAmount),
        fundId: fundId,
        createdAt: new Date().toISOString(),
        status: 'active'
      };
      await setDoc(doc(db, 'events', eventId), newEvent);

      // 3. Crear el Gasto General (Expense)
      const expenseId = `exp_evt_${eventId}`;
      
      // Obtener alumnos activos
      const studentsSnap = await getDocs(collection(db, 'students'));
      const studentsList = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      await setDoc(doc(db, 'expenses', expenseId), {
        title: `Cuota Obligatoria: ${eventName.trim()}`,
        date: eventDate,
        totalAmount: parseFloat(mandatoryAmount) * studentsList.length,
        amountPerStudent: parseFloat(mandatoryAmount),
        studentsCount: studentsList.length,
        paidCount: 0,
        fundId: fundId,
        eventId: eventId,
        createdAt: new Date().toISOString()
      });

      // 4. Crear deudas individuales para cada alumno
      for (const student of studentsList) {
        const debtId = `debt_${expenseId}_${student.id}`;
        await setDoc(doc(db, 'debts', debtId), {
          expenseId,
          studentId: student.id,
          studentName: student.name,
          apoderadoEmails: student.apoderadoEmails || (student.apoderadoEmail ? [student.apoderadoEmail] : []),
          amount: parseFloat(mandatoryAmount),
          status: 'pending', // pending, review, paid
          title: `Cuota Obligatoria: ${eventName.trim()}`,
          date: eventDate,
          fundId: fundId,
          eventId: eventId,
          createdAt: new Date().toISOString()
        });
      }

      setMessage('Evento creado y cuotas generadas con éxito.');
      setShowCreateModal(false);
      setEventName('');
      setMandatoryAmount('');
      setNoShowAmount('');
      
      fetchEvents();
      setTimeout(() => setMessage(''), 3000);

    } catch (error) {
      console.error("Error creando evento:", error);
      await showAlert('Hubo un error al crear el evento.');
    } finally {
      setLoading(false);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  // Si hay un evento seleccionado, mostramos la vista de detalle
  if (selectedEventId) {
    return <EventDetail eventId={selectedEventId} onBack={() => setSelectedEventId(null)} />;
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
            <ArrowLeft size={18} />
          </button>
          <h3 style={{ margin: 0 }}>Gestión de Eventos y Ventas</h3>
        </div>
        <button 
          onClick={() => setShowCreateModal(true)} 
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <PlusCircle size={18} /> Crear Evento
        </button>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                <div style={{ backgroundColor: 'rgba(99,102,241,0.1)', padding: '1rem', borderRadius: '50%', color: 'var(--primary)' }}>
                  <Calendar size={24} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem' }}>{event.name}</h4>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{new Date(event.date).toLocaleDateString('es-CL')}</p>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--text-muted)', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                <div>
                  <span style={{ display: 'block' }}>Cuota</span>
                  <strong style={{ color: 'var(--text)' }}>{formatMoney(event.mandatoryAmount)}</strong>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ display: 'block' }}>Multa</span>
                  <strong style={{ color: 'var(--danger)' }}>{formatMoney(event.noShowAmount)}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Creación */}
      {showCreateModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="glass-panel animate-fade-in" style={{ padding: '2rem', width: '90%', maxWidth: '500px', position: 'relative' }}>
            <button 
              onClick={() => setShowCreateModal(false)}
              style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={24} />
            </button>
            
            <h3 style={{ marginBottom: '1.5rem', marginTop: 0 }}>Crear Nuevo Evento</h3>
            
            <form onSubmit={handleCreateEvent}>
              <div className="input-group">
                <label className="input-label">Nombre del Evento (Ej. Kermesse Solidaria)</label>
                <input 
                  type="text" 
                  required
                  className="input-field" 
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
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
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group">
                  <label className="input-label">Monto Obligatorio ($)</label>
                  <input 
                    type="number" 
                    min="1"
                    required
                    className="input-field" 
                    placeholder="Ej. 1500"
                    value={mandatoryAmount}
                    onChange={(e) => setMandatoryAmount(e.target.value)}
                  />
                  <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>Se cobrará a todos al crear el evento.</small>
                </div>
                
                <div className="input-group">
                  <label className="input-label">Monto si NO Asiste ($)</label>
                  <input 
                    type="number" 
                    min="1"
                    required
                    className="input-field" 
                    placeholder="Ej. 3000"
                    value={noShowAmount}
                    onChange={(e) => setNoShowAmount(e.target.value)}
                  />
                  <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>Multa aplicable después del evento.</small>
                </div>
              </div>
              
              <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-outline">
                  Cancelar
                </button>
                <button type="submit" disabled={loading} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {loading ? 'Creando...' : <><Save size={18} /> Guardar y Generar Cuotas</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default EventManagement;
