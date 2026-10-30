import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase/config';
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { 
  ChefHat, Clock, CheckCircle2, Flame, AlertCircle, Volume2, 
  VolumeX, Maximize, Minimize, RefreshCw, MessageSquare, 
  ArrowLeft, Search, Filter, Check, RotateCcw, Camera
} from 'lucide-react';
import QRScannerModal from '../components/events/QRScannerModal';

/**
 * Sintetizador de sonido de campana de cocina usando Web Audio API
 */
const playKitchenChime = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    // Tono 1: 880Hz (A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, ctx.currentTime);
    gain1.gain.setValueAtTime(0.3, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.6);

    // Tono 2: 1320Hz (E6) con ligero retraso
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, ctx.currentTime + 0.15);
    gain2.gain.setValueAtTime(0.35, ctx.currentTime + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.85);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 0.85);
  } catch (e) {
    console.warn("Audio Context playback prevented:", e);
  }
};

/**
 * Calcula el tiempo transcurrido en formato amigable
 */
const getTimeElapsed = (dateString) => {
  if (!dateString) return '';
  const now = Date.now();
  const created = new Date(dateString).getTime();
  const diffSec = Math.floor((now - created) / 1000);

  if (diffSec < 60) return 'Hace un momento';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  return `Hace ${diffHours} h`;
};

const EventComandas = () => {
  const { eventId } = useParams();
  const navigate = useNavigate();

  const [eventData, setEventData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending'); // 'pending', 'preparing', 'delivered', 'all'
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [nowTimer, setNowTimer] = useState(Date.now());
  const [searchTerm, setSearchTerm] = useState('');
  const [activeKitchenNoteOrder, setActiveKitchenNoteOrder] = useState(null);
  const [kitchenNoteInput, setKitchenNoteInput] = useState('');
  const [showScanner, setShowScanner] = useState(false);

  const handleScanSuccess = (decodedText) => {
    setShowScanner(false);
    let cleanId = decodedText.trim();
    if (cleanId.includes('/entrega/')) {
      cleanId = cleanId.split('/entrega/')[1].split('?')[0].split('#')[0].trim();
    }
    cleanId = cleanId.replace('#', '').trim();
    navigate(`/entrega/${cleanId}`);
  };

  const previousOrderIdsRef = useRef(new Set());
  const initialLoadCompletedRef = useRef(false);

  // 1. Autenticación anónima silenciosa si el usuario entra por QR sin sesión
  useEffect(() => {
    if (!auth.currentUser) {
      signInAnonymously(auth).catch(err => {
        console.warn("Autenticación anónima:", err);
      });
    }
  }, []);

  // 2. Cargar datos del evento
  useEffect(() => {
    if (!eventId) return;
    const fetchEvent = async () => {
      try {
        const evSnap = await getDoc(doc(db, 'events', eventId));
        if (evSnap.exists()) {
          setEventData({ id: evSnap.id, ...evSnap.data() });
        }
      } catch (err) {
        console.error("Error al cargar evento:", err);
      }
    };
    fetchEvent();
  }, [eventId]);

  // 3. Suscripción en tiempo real a las ventas / comandas del evento
  useEffect(() => {
    if (!eventId) return;
    setLoading(true);

    const q = query(collection(db, 'eventSales'), where('eventId', '==', eventId));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const salesList = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
        orderStatus: d.data().orderStatus || 'pending'
      }));

      // Ordenar por correlativo descendente (más nuevos primero)
      salesList.sort((a, b) => (b.correlative || 0) - (a.correlative || 0));

      // Detección de nuevos pedidos para emitir sonido
      if (initialLoadCompletedRef.current && soundEnabled) {
        let hasNewPending = false;
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const saleData = change.doc.data();
            const status = saleData.orderStatus || 'pending';
            if (status === 'pending' && !previousOrderIdsRef.current.has(change.doc.id)) {
              hasNewPending = true;
            }
          }
        });

        if (hasNewPending) {
          playKitchenChime();
        }
      }

      // Actualizar registro de IDs
      previousOrderIdsRef.current = new Set(salesList.map(s => s.id));
      initialLoadCompletedRef.current = true;

      setOrders(salesList);
      setLoading(false);
    }, (error) => {
      console.error("Error en listener de comandas:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [eventId, soundEnabled]);

  // 4. Timer cada 30 segundos para refrescar los minutos transcurridos
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTimer(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // 5. Pantalla Completa
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // 6. Cambiar estado de una comanda
  const handleUpdateStatus = async (orderId, newStatus) => {
    try {
      const updatePayload = {
        orderStatus: newStatus,
        kitchenStatus: newStatus
      };

      if (newStatus === 'preparing') {
        updatePayload.preparedAt = new Date().toISOString();
      } else if (newStatus === 'delivered') {
        updatePayload.deliveredAt = new Date().toISOString();
      }

      await updateDoc(doc(db, 'eventSales', orderId), updatePayload);
    } catch (err) {
      console.error("Error al actualizar comanda:", err);
      alert("No se pudo actualizar el estado: " + err.message);
    }
  };

  // 7. Guardar nota de cocina
  const handleSaveKitchenNote = async (orderId) => {
    try {
      await updateDoc(doc(db, 'eventSales', orderId), {
        kitchenNotes: kitchenNoteInput.trim()
      });
      setActiveKitchenNoteOrder(null);
      setKitchenNoteInput('');
    } catch (err) {
      console.error("Error al guardar nota de cocina:", err);
      alert("Error al guardar nota: " + err.message);
    }
  };

  // Contadores por estado
  const pendingOrders = orders.filter(o => o.orderStatus === 'pending' && o.status !== 'cancelled');
  const preparingOrders = orders.filter(o => o.orderStatus === 'preparing' && o.status !== 'cancelled');
  const deliveredOrders = orders.filter(o => o.orderStatus === 'delivered' && o.status !== 'cancelled');

  // Filtrado de pedidos según la pestaña activa y búsqueda
  const filteredOrders = orders.filter(order => {
    if (order.status === 'cancelled') return false;

    // Filtro por pestaña
    if (activeTab === 'pending' && order.orderStatus !== 'pending') return false;
    if (activeTab === 'preparing' && order.orderStatus !== 'preparing') return false;
    if (activeTab === 'delivered' && order.orderStatus !== 'delivered') return false;

    // Filtro por término de búsqueda (número de ticket o cliente)
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchCorrelative = String(order.correlative).includes(term);
      const matchClient = (order.clientName || '').toLowerCase().includes(term);
      const matchItems = (order.items || []).some(i => i.name.toLowerCase().includes(term));
      return matchCorrelative || matchClient || matchItems;
    }

    return true;
  });

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#090d16',
      backgroundImage: 'radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(236, 72, 153, 0.08) 0px, transparent 50%)',
      color: '#f8fafc',
      fontFamily: 'Inter, system-ui, sans-serif',
      padding: '1rem',
      boxSizing: 'border-box'
    }}>
      {/* Barra Superior de la Cocina (KDS Header) */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem',
        padding: '0.85rem 1.25rem',
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(10px)',
        borderRadius: '14px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        marginBottom: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            backgroundColor: 'rgba(99, 102, 241, 0.2)',
            border: '1px solid var(--primary, #6366f1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#818cf8'
          }}>
            <ChefHat size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#fff' }}>
                Comandas en Vivo
              </h2>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '0.72rem',
                fontWeight: 'bold'
              }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#34d399', display: 'inline-block' }} />
                EN VIVO
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>
              {eventData?.name || 'Pantalla de Cocina y Despacho'}
            </p>
          </div>
        </div>

        {/* Acciones del Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {/* Buscador Rápido de Ticket */}
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input 
              type="text"
              placeholder="Buscar # ticket..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                padding: '0.4rem 0.6rem 0.4rem 2rem',
                fontSize: '0.82rem',
                color: '#fff',
                width: '140px'
              }}
            />
          </div>

          {/* Escanear QR para Entrega Segura */}
          <button
            type="button"
            onClick={() => setShowScanner(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.85rem',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 700,
              backgroundColor: '#10b981',
              border: '1px solid #10b981',
              color: '#fff',
              cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(16, 185, 129, 0.3)'
            }}
            title="Escanear código QR del ticket de papel para confirmar entrega segura"
          >
            <Camera size={16} />
            <span>Escanear Entrega</span>
          </button>

          {/* Toggle Sonido */}
          <button
            type="button"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              if (next) playKitchenChime();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.45rem 0.75rem',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 600,
              backgroundColor: soundEnabled ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
              border: soundEnabled ? '1px solid #6366f1' : '1px solid rgba(255, 255, 255, 0.15)',
              color: soundEnabled ? '#a5b4fc' : '#94a3b8',
              cursor: 'pointer'
            }}
            title={soundEnabled ? 'Silenciar avisos sonoros' : 'Activar timbre sonoro al entrar pedidos'}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>{soundEnabled ? 'Sonido ON' : 'Silencio'}</span>
          </button>

          {/* Pantalla Completa */}
          <button
            type="button"
            onClick={toggleFullscreen}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.45rem 0.75rem',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 600,
              backgroundColor: isFullscreen ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.05)',
              border: isFullscreen ? '1px solid #6366f1' : '1px solid rgba(255, 255, 255, 0.15)',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            <span>{isFullscreen ? 'Salir' : 'Pantalla Completa'}</span>
          </button>
        </div>
      </header>

      {/* Pestañas de Estado con Contadores */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        marginBottom: '1.25rem',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        paddingBottom: '0.25rem'
      }}>
        <button
          type="button"
          onClick={() => setActiveTab('pending')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.6rem 1.1rem',
            borderRadius: '10px',
            fontSize: '0.88rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            backgroundColor: activeTab === 'pending' ? '#f59e0b' : 'rgba(245, 158, 11, 0.1)',
            color: activeTab === 'pending' ? '#000' : '#f59e0b',
            border: '1px solid #f59e0b'
          }}
        >
          <Clock size={16} />
          <span>Pendientes</span>
          <span style={{
            backgroundColor: activeTab === 'pending' ? '#000' : '#f59e0b',
            color: activeTab === 'pending' ? '#f59e0b' : '#000',
            padding: '1px 7px',
            borderRadius: '12px',
            fontSize: '0.78rem',
            fontWeight: 800
          }}>
            {pendingOrders.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('preparing')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.6rem 1.1rem',
            borderRadius: '10px',
            fontSize: '0.88rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            backgroundColor: activeTab === 'preparing' ? '#3b82f6' : 'rgba(59, 130, 246, 0.1)',
            color: activeTab === 'preparing' ? '#fff' : '#60a5fa',
            border: '1px solid #3b82f6'
          }}
        >
          <Flame size={16} />
          <span>En Preparación</span>
          <span style={{
            backgroundColor: activeTab === 'preparing' ? '#fff' : '#3b82f6',
            color: activeTab === 'preparing' ? '#1e3a8a' : '#fff',
            padding: '1px 7px',
            borderRadius: '12px',
            fontSize: '0.78rem',
            fontWeight: 800
          }}>
            {preparingOrders.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('delivered')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.6rem 1.1rem',
            borderRadius: '10px',
            fontSize: '0.88rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            backgroundColor: activeTab === 'delivered' ? '#10b981' : 'rgba(16, 185, 129, 0.1)',
            color: activeTab === 'delivered' ? '#000' : '#34d399',
            border: '1px solid #10b981'
          }}
        >
          <CheckCircle2 size={16} />
          <span>Entregados</span>
          <span style={{
            backgroundColor: activeTab === 'delivered' ? '#000' : '#10b981',
            color: activeTab === 'delivered' ? '#34d399' : '#000',
            padding: '1px 7px',
            borderRadius: '12px',
            fontSize: '0.78rem',
            fontWeight: 800
          }}>
            {deliveredOrders.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('all')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.6rem 1.1rem',
            borderRadius: '10px',
            fontSize: '0.88rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            backgroundColor: activeTab === 'all' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)',
            color: '#fff',
            border: '1px solid rgba(255, 255, 255, 0.15)'
          }}
        >
          <span>Todas ({orders.filter(o => o.status !== 'cancelled').length})</span>
        </button>
      </div>

      {/* Grid de Tarjetas de Comanda */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#94a3b8' }}>
          <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 1rem auto' }} />
          <p>Conectando con la cocina en tiempo real...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '4rem 1rem',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          borderRadius: '16px',
          border: '1px dashed rgba(255, 255, 255, 0.1)',
          color: '#94a3b8'
        }}>
          <ChefHat size={40} style={{ opacity: 0.4, margin: '0 auto 1rem auto' }} />
          <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '1.1rem' }}>
            No hay comandas {activeTab === 'pending' ? 'pendientes' : activeTab === 'preparing' ? 'en preparación' : activeTab === 'delivered' ? 'entregadas' : ''}
          </h3>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem' }}>
            Cuando el cajero emita un nuevo vale en el POS, aparecerá aquí inmediatamente con aviso sonoro.
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '1rem',
          alignItems: 'start'
        }}>
          {filteredOrders.map(order => {
            const isPending = order.orderStatus === 'pending';
            const isPreparing = order.orderStatus === 'preparing';
            const isDelivered = order.orderStatus === 'delivered';

            // Tiempo transcurrido
            const createdMs = new Date(order.createdAt).getTime();
            const elapsedMin = Math.floor((nowTimer - createdMs) / 60000);
            let timeColor = '#94a3b8';
            if (isPending || isPreparing) {
              if (elapsedMin >= 15) timeColor = '#ef4444'; // Rojo (>15m)
              else if (elapsedMin >= 8) timeColor = '#f59e0b'; // Amarillo (>8m)
              else timeColor = '#10b981'; // Verde (<8m)
            }

            // Borde y fondo según estado
            let cardBorder = '1px solid rgba(255, 255, 255, 0.1)';
            let cardBg = 'rgba(15, 23, 42, 0.75)';
            if (isPending) {
              cardBorder = '2px solid rgba(245, 158, 11, 0.5)';
              cardBg = 'linear-gradient(180deg, rgba(245, 158, 11, 0.08) 0%, rgba(15, 23, 42, 0.85) 100%)';
            } else if (isPreparing) {
              cardBorder = '2px solid rgba(59, 130, 246, 0.6)';
              cardBg = 'linear-gradient(180deg, rgba(59, 130, 246, 0.08) 0%, rgba(15, 23, 42, 0.85) 100%)';
            } else if (isDelivered) {
              cardBorder = '1px solid rgba(16, 185, 129, 0.3)';
              cardBg = 'rgba(15, 23, 42, 0.5)';
            }

            return (
              <div
                key={order.id}
                style={{
                  backgroundColor: cardBg,
                  border: cardBorder,
                  borderRadius: '14px',
                  padding: '1.15rem',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.85rem'
                }}
              >
                {/* Cabecera de la Comanda: # Ticket, Tiempo y Estado */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: '1.6rem', fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', display: 'block' }}>
                      Ticket #{order.correlative}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: timeColor, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Clock size={12} />
                      {getTimeElapsed(order.createdAt)} • {new Date(order.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* Badge de Estado */}
                  <div>
                    {isPending && (
                      <span style={{ backgroundColor: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.4)', padding: '3px 9px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 800 }}>
                        ⏳ PENDIENTE
                      </span>
                    )}
                    {isPreparing && (
                      <span style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.4)', padding: '3px 9px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 800 }}>
                        🔥 PREPARANDO
                      </span>
                    )}
                    {isDelivered && (
                      <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.2)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.4)', padding: '3px 9px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 800 }}>
                        ✓ ENTREGADO
                      </span>
                    )}
                  </div>
                </div>

                {/* Datos del Cliente y Cajero */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.82rem',
                  color: '#94a3b8',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingBottom: '0.5rem'
                }}>
                  <span>Cliente: <strong style={{ color: '#fff' }}>{order.clientName || 'General'}</strong></span>
                  <span>Cajero/a: <strong style={{ color: '#818cf8' }}>{order.cashierName || 'Caja'}</strong></span>
                </div>

                {/* Nota del Cliente (si existe) */}
                {order.saleNote && (
                  <div style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    borderRadius: '8px',
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.82rem',
                    color: '#fef08a'
                  }}>
                    <strong>⚠️ Nota Cliente:</strong> {order.saleNote}
                  </div>
                )}

                {/* Lista de Ítems / Productos a Preparar */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  {order.items && order.items.map((item, idx) => (
                    <div 
                      key={idx}
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.04)',
                        padding: '0.65rem 0.85rem',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.06)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                        <span style={{
                          backgroundColor: '#6366f1',
                          color: '#fff',
                          fontWeight: 900,
                          fontSize: '1rem',
                          padding: '2px 8px',
                          borderRadius: '6px'
                        }}>
                          {item.quantity}x
                        </span>
                        <strong style={{ fontSize: '1.05rem', color: '#fff' }}>
                          {item.name}
                        </strong>
                      </div>

                      {/* Subproductos / Toppings / Salsas */}
                      {item.selectedSubproducts && item.selectedSubproducts.length > 0 && (
                        <div style={{ marginTop: '0.4rem', paddingLeft: '2rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                          {item.selectedSubproducts.map((sp, spIdx) => (
                            <span
                              key={spIdx}
                              style={{
                                display: 'inline-block',
                                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                                border: '1px solid rgba(99, 102, 241, 0.3)',
                                color: '#c7d2fe',
                                fontSize: '0.78rem',
                                padding: '2px 7px',
                                borderRadius: '12px',
                                fontWeight: 600
                              }}
                            >
                              + {sp.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Nota interna de Cocina (si existe) */}
                {order.kitchenNotes && (
                  <div style={{
                    backgroundColor: 'rgba(99, 102, 241, 0.12)',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    borderRadius: '8px',
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.8rem',
                    color: '#c7d2fe'
                  }}>
                    💬 <strong>Cocina:</strong> {order.kitchenNotes}
                  </div>
                )}

                {/* Formulario rápido para añadir/editar nota de cocina */}
                {activeKitchenNoteOrder === order.id && (
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem' }}>
                    <input 
                      type="text"
                      placeholder="Escribe detalle (ej. Falta pan)..."
                      value={kitchenNoteInput}
                      onChange={(e) => setKitchenNoteInput(e.target.value)}
                      autoFocus
                      style={{
                        flex: 1,
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid var(--primary)',
                        borderRadius: '6px',
                        padding: '0.4rem 0.6rem',
                        fontSize: '0.82rem',
                        color: '#fff'
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveKitchenNote(order.id);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveKitchenNote(order.id)}
                      className="btn btn-primary"
                      style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveKitchenNoteOrder(null);
                        setKitchenNoteInput('');
                      }}
                      className="btn btn-outline"
                      style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* Botones de Acción de Cocina */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                  {isPending && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(order.id, 'preparing')}
                        style={{
                          flex: 1,
                          padding: '0.65rem',
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: '#3b82f6',
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: '0.88rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem'
                        }}
                      >
                        <Flame size={16} /> Preparar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(order.id, 'delivered')}
                        style={{
                          flex: 1,
                          padding: '0.65rem',
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: '#10b981',
                          color: '#000',
                          fontWeight: 800,
                          fontSize: '0.88rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem'
                        }}
                      >
                        <Check size={16} /> Entregar
                      </button>
                    </>
                  )}

                  {isPreparing && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(order.id, 'delivered')}
                        style={{
                          flex: 2,
                          padding: '0.75rem',
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: '#10b981',
                          color: '#000',
                          fontWeight: 900,
                          fontSize: '0.95rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem'
                        }}
                      >
                        <Check size={18} /> ¡Listo / Entregar!
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(order.id, 'pending')}
                        style={{
                          flex: 1,
                          padding: '0.75rem',
                          borderRadius: '8px',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          color: '#94a3b8',
                          fontWeight: 600,
                          fontSize: '0.8rem',
                          cursor: 'pointer'
                        }}
                        title="Devolver a pendientes"
                      >
                        <RotateCcw size={14} />
                      </button>
                    </>
                  )}

                  {isDelivered && (
                    <button
                      type="button"
                      onClick={() => handleUpdateStatus(order.id, 'preparing')}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        backgroundColor: 'rgba(255, 255, 255, 0.04)',
                        color: '#94a3b8',
                        fontWeight: 600,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.35rem'
                      }}
                    >
                      <RotateCcw size={13} /> Reabrir Comanda
                    </button>
                  )}

                  {/* Botón Nota Cocina */}
                  {activeKitchenNoteOrder !== order.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveKitchenNoteOrder(order.id);
                        setKitchenNoteInput(order.kitchenNotes || '');
                      }}
                      style={{
                        padding: '0.5rem 0.65rem',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        backgroundColor: 'rgba(255, 255, 255, 0.04)',
                        color: '#cbd5e1',
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem'
                      }}
                      title="Agregar detalle o nota de cocina"
                    >
                      <MessageSquare size={13} /> Nota
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Escáner QR para Entrega Segura */}
      <QRScannerModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScanSuccess={handleScanSuccess}
      />
    </div>
  );
};

export default EventComandas;

