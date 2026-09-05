import React, { useState, useEffect } from 'react';
import { db } from '../../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { ArrowLeft, LayoutDashboard, CheckSquare, ShoppingBag, DollarSign, Receipt } from 'lucide-react';
import EventSummary from './tabs/EventSummary';
import EventAttendance from './tabs/EventAttendance';
import EventMenu from './tabs/EventMenu';
import EventPOS from './tabs/EventPOS';
import EventExpenses from './tabs/EventExpenses';

const EventDetail = ({ eventId, onBack }) => {
  const [eventData, setEventData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('summary'); // summary, attendance, menu, pos, expenses

  useEffect(() => {
    fetchEventData();
  }, [eventId]);

  const fetchEventData = async () => {
    try {
      const docRef = doc(db, 'events', eventId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setEventData({ id: docSnap.id, ...docSnap.data() });
      } else {
        console.error("Evento no encontrado");
      }
    } catch (error) {
      console.error("Error obteniendo evento:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando evento...</div>;
  }

  if (!eventData) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Evento no encontrado.</div>;
  }

  const tabs = [
    { id: 'summary', label: 'Resumen', icon: <LayoutDashboard size={16} /> },
    { id: 'attendance', label: 'Asistencia', icon: <CheckSquare size={16} /> },
    { id: 'menu', label: 'Menú / Ítems', icon: <ShoppingBag size={16} /> },
    { id: 'pos', label: 'Punto de Venta', icon: <Receipt size={16} /> },
    { id: 'expenses', label: 'Gastos', icon: <DollarSign size={16} /> }
  ];

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 style={{ margin: 0, color: 'var(--primary)' }}>{eventData.name}</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {new Date(eventData.date).toLocaleDateString('es-CL')} • Cuota: ${eventData.mandatoryAmount} • Multa: ${eventData.noShowAmount}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', overflowX: 'auto', whiteSpace: 'nowrap' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-outline'}`}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem', 
              padding: '0.5rem 1rem',
              borderColor: activeTab === tab.id ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
              backgroundColor: activeTab === tab.id ? 'var(--primary)' : 'transparent',
              color: activeTab === tab.id ? '#fff' : 'var(--text-muted)'
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'summary' && <EventSummary event={eventData} />}
        {activeTab === 'attendance' && <EventAttendance event={eventData} />}
        {activeTab === 'menu' && <EventMenu event={eventData} />}
        {activeTab === 'pos' && <EventPOS event={eventData} />}
        {activeTab === 'expenses' && <EventExpenses event={eventData} />}
      </div>
    </div>
  );
};

export default EventDetail;
