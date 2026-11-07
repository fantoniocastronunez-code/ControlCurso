import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase/config';
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import {
  ChefHat, Clock, CheckCircle2, Flame, AlertCircle, Volume2,
  VolumeX, Maximize, Minimize, RefreshCw, MessageSquare,
  ArrowLeft, Search, Filter, Check, RotateCcw, Camera, X,
  Keyboard, HelpCircle
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
 * Beep corto y táctil para confirmación de comandos KDS / Bump bar
 */
const playActionBeep = (freq = 600, duration = 0.08) => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    // audio context blocked or unsupported
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
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [showKdsGuide, setShowKdsGuide] = useState(true);

  const previousOrderIdsRef = useRef(new Set());
  const initialLoadCompletedRef = useRef(false);

  const handleScanSuccess = (decodedText) => {
    setShowScanner(false);
    let cleanId = decodedText.trim();
    if (cleanId.includes('/entrega/')) {
      cleanId = cleanId.split('/entrega/')[1].split('?')[0].split('#')[0].trim();
    }
    cleanId = cleanId.replace('#', '').trim();
    navigate(`/entrega/${cleanId}`);
  };

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
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => { });
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => { });
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

  // Sincronización automática de selección de comanda
  useEffect(() => {
    if (filteredOrders.length === 0) {
      if (selectedOrderId !== null) setSelectedOrderId(null);
      return;
    }
    const exists = filteredOrders.some(o => o.id === selectedOrderId);
    if (!exists) {
      setSelectedOrderId(filteredOrders[0].id);
    }
  }, [filteredOrders, selectedOrderId]);

  // Auto-scroll para mantener la comanda seleccionada siempre en foco
  useEffect(() => {
    if (!selectedOrderId) return;
    const cardEl = document.getElementById(`order-card-${selectedOrderId}`);
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [selectedOrderId]);

  // Manejador Global de Teclas KDS (Perfil "CURSO" del Teclado / Bump Bar Bluetooth)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Si el usuario está escribiendo en el buscador o editando notas de cocina, no interceptar
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        showScanner ||
        activeKitchenNoteOrder !== null
      ) {
        return;
      }

      const tabs = ['pending', 'preparing', 'delivered', 'all'];
      const key = e.key;

      // 1. Navegación de Pestañas: 'q' / 'Q' (Pestaña Izq) y 'e' / 'E' (Pestaña Der)
      if (key === 'q' || key === 'Q') {
        e.preventDefault();
        playActionBeep(520, 0.05);
        setActiveTab(prev => {
          const idx = tabs.indexOf(prev);
          const nextIdx = idx <= 0 ? tabs.length - 1 : idx - 1;
          return tabs[nextIdx];
        });
        return;
      }

      if (key === 'e' || key === 'E') {
        e.preventDefault();
        playActionBeep(520, 0.05);
        setActiveTab(prev => {
          const idx = tabs.indexOf(prev);
          const nextIdx = (idx + 1) % tabs.length;
          return tabs[nextIdx];
        });
        return;
      }

      // Atajos de número para pestañas: 1 (Pendientes), 2 (En Prep.), 3 (Entregados), 4 (Todas)
      if (key === '1') { e.preventDefault(); playActionBeep(520, 0.05); setActiveTab('pending'); return; }
      if (key === '2') { e.preventDefault(); playActionBeep(520, 0.05); setActiveTab('preparing'); return; }
      if (key === '3') { e.preventDefault(); playActionBeep(520, 0.05); setActiveTab('delivered'); return; }
      if (key === '4') { e.preventDefault(); playActionBeep(520, 0.05); setActiveTab('all'); return; }

      // Atajo de Pantalla Completa: 'f' / 'F'
      if (key === 'f' || key === 'F') {
        e.preventDefault();
        toggleFullscreen();
        return;
      }

      // Atajo de Sonido: 's' / 'S'
      if (key === 's' || key === 'S') {
        e.preventDefault();
        setSoundEnabled(prev => {
          const next = !prev;
          if (next) playKitchenChime();
          return next;
        });
        return;
      }

      if (filteredOrders.length === 0) return;

      const currentIndex = filteredOrders.findIndex(o => o.id === selectedOrderId);
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;
      const currentOrder = filteredOrders[safeIndex];

      // 2. Mover Selección: Flecha Izquierda (Anterior)
      if (key === 'ArrowLeft') {
        e.preventDefault();
        playActionBeep(420, 0.04);
        const nextIndex = safeIndex <= 0 ? filteredOrders.length - 1 : safeIndex - 1;
        setSelectedOrderId(filteredOrders[nextIndex].id);
        return;
      }

      // Mover Selección: Flecha Derecha (Siguiente)
      if (key === 'ArrowRight') {
        e.preventDefault();
        playActionBeep(420, 0.04);
        const nextIndex = (safeIndex + 1) % filteredOrders.length;
        setSelectedOrderId(filteredOrders[nextIndex].id);
        return;
      }

      // 3. Acción Principal / Bump: ENTER (Avanzar estado según el flujo de cocina)
      if (key === 'Enter') {
        e.preventDefault();
        if (!currentOrder) return;
        playActionBeep(780, 0.12);

        if (currentOrder.orderStatus === 'pending') {
          handleUpdateStatus(currentOrder.id, 'preparing');
        } else if (currentOrder.orderStatus === 'preparing') {
          handleUpdateStatus(currentOrder.id, 'delivered');
        } else if (currentOrder.orderStatus === 'delivered') {
          handleUpdateStatus(currentOrder.id, 'preparing');
        }
        return;
      }

      // 4. Acción directa PREPARAR ('p' / 'P' o 'ArrowUp')
      if (key === 'p' || key === 'P' || key === 'ArrowUp') {
        e.preventDefault();
        if (!currentOrder) return;
        if (currentOrder.orderStatus === 'pending' || currentOrder.orderStatus === 'delivered') {
          playActionBeep(680, 0.1);
          handleUpdateStatus(currentOrder.id, 'preparing');
        } else if (key === 'ArrowUp') {
          playActionBeep(420, 0.04);
          const nextIndex = safeIndex <= 0 ? filteredOrders.length - 1 : safeIndex - 1;
          setSelectedOrderId(filteredOrders[nextIndex].id);
        }
        return;
      }

      // 5. Acción directa ENTREGAR / LISTO ('d' / 'D' / 'l' / 'L')
      if (key === 'd' || key === 'D' || key === 'l' || key === 'L') {
        e.preventDefault();
        if (!currentOrder) return;
        playActionBeep(880, 0.12);
        handleUpdateStatus(currentOrder.id, 'delivered');
        return;
      }

      // 6. Acción directa DEVOLVER / REVERTIR ('r' / 'R' o 'ArrowDown' o Backspace)
      if (key === 'r' || key === 'R' || key === 'Backspace' || key === 'ArrowDown') {
        e.preventDefault();
        if (!currentOrder) return;
        if (currentOrder.orderStatus === 'preparing') {
          playActionBeep(350, 0.1);
          handleUpdateStatus(currentOrder.id, 'pending');
        } else if (currentOrder.orderStatus === 'delivered') {
          playActionBeep(350, 0.1);
          handleUpdateStatus(currentOrder.id, 'preparing');
        } else if (key === 'ArrowDown') {
          playActionBeep(420, 0.04);
          const nextIndex = (safeIndex + 1) % filteredOrders.length;
          setSelectedOrderId(filteredOrders[nextIndex].id);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredOrders, selectedOrderId, activeTab, showScanner, activeKitchenNoteOrder]);

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0c0d10',
      backgroundImage: 'none',
      color: '#f3f4f6',
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

          {/* Toggle Guía KDS */}
          <button
            type="button"
            onClick={() => setShowKdsGuide(!showKdsGuide)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.45rem 0.75rem',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 600,
              backgroundColor: showKdsGuide ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.05)',
              border: showKdsGuide ? '1px solid #6366f1' : '1px solid rgba(255, 255, 255, 0.15)',
              color: showKdsGuide ? '#c7d2fe' : '#94a3b8',
              cursor: 'pointer'
            }}
            title="Mostrar / ocultar atajos del teclado KDS Bluetooth"
          >
            <Keyboard size={16} />
            <span>KDS Teclas</span>
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

      {/* Banner de Atajos de Teclado KDS Bluetooth (Modo "CURSO") */}
      {showKdsGuide && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
          backgroundColor: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.25)',
          borderRadius: '10px',
          padding: '0.55rem 1rem',
          marginBottom: '0.85rem',
          fontSize: '0.78rem',
          color: '#cbd5e1'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Keyboard size={15} /> KDS Bump Bar (Modo CURSO):
            </span>
            <span><kbd style={{ backgroundColor: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', color: '#fff', fontWeight: 'bold' }}>Q</kbd> / <kbd style={{ backgroundColor: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', color: '#fff', fontWeight: 'bold' }}>E</kbd> Pestaña Izq / Der</span>
            <span>•</span>
            <span><kbd style={{ backgroundColor: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', color: '#fff', fontWeight: 'bold' }}>←</kbd> <kbd style={{ backgroundColor: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', color: '#fff', fontWeight: 'bold' }}>→</kbd> Comanda Anterior / Siguiente</span>
            <span>•</span>
            <span><kbd style={{ backgroundColor: '#10b981', color: '#000', padding: '2px 7px', borderRadius: '4px', fontWeight: 900 }}>ENTER</kbd> Aceptar / Avanzar</span>
            <span>•</span>
            <span><kbd style={{ backgroundColor: '#3b82f6', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>P / ↑</kbd> Preparar</span>
            <span>•</span>
            <span><kbd style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#fca5a5', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>R / ↓</kbd> Devolver</span>
          </div>
          <button
            type="button"
            onClick={() => setShowKdsGuide(false)}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
            title="Ocultar barra de atajos"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Barra de Filtros de Estado: Compacta en 1 sola línea */}
      <div style={{ marginBottom: '1rem', width: '100%' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.35rem',
          padding: '0 0.15rem'
        }}>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Estado del Pedido:
          </span>
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            style={{
              background: activeTab === 'all' ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
              border: activeTab === 'all' ? '1px solid rgba(255, 255, 255, 0.3)' : '1px solid transparent',
              color: activeTab === 'all' ? '#fff' : '#94a3b8',
              fontSize: '0.72rem',
              fontWeight: activeTab === 'all' ? 700 : 500,
              padding: '2px 8px',
              borderRadius: '6px',
              cursor: 'pointer',
              textDecoration: activeTab === 'all' ? 'none' : 'underline'
            }}
          >
            {activeTab === 'all' ? 'Mostrando Todas' : `Ver todas (${orders.filter(o => o.status !== 'cancelled').length})`}
          </button>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '0.35rem',
          width: '100%',
          boxSizing: 'border-box'
        }}>
          {/* 1. Pendientes */}
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.3rem',
              padding: '0.45rem 0.2rem',
              borderRadius: '8px',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              backgroundColor: activeTab === 'pending' ? '#f59e0b' : 'rgba(245, 158, 11, 0.12)',
              color: activeTab === 'pending' ? '#000' : '#f59e0b',
              border: '1px solid #f59e0b',
              minWidth: 0,
              overflow: 'hidden'
            }}
            title="Ver comandas pendientes"
          >
            <Clock size={13} style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Pendientes
            </span>
            <span style={{
              backgroundColor: activeTab === 'pending' ? '#000' : '#f59e0b',
              color: activeTab === 'pending' ? '#f59e0b' : '#000',
              padding: '0 5px',
              borderRadius: '10px',
              fontSize: '0.7rem',
              fontWeight: 800,
              lineHeight: '1.3',
              flexShrink: 0
            }}>
              {pendingOrders.length}
            </span>
          </button>

          {/* 2. En Preparación */}
          <button
            type="button"
            onClick={() => setActiveTab('preparing')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.3rem',
              padding: '0.45rem 0.2rem',
              borderRadius: '8px',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              backgroundColor: activeTab === 'preparing' ? '#3b82f6' : 'rgba(59, 130, 246, 0.12)',
              color: activeTab === 'preparing' ? '#fff' : '#60a5fa',
              border: '1px solid #3b82f6',
              minWidth: 0,
              overflow: 'hidden'
            }}
            title="Ver comandas en preparación"
          >
            <Flame size={13} style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              En Prep.
            </span>
            <span style={{
              backgroundColor: activeTab === 'preparing' ? '#fff' : '#3b82f6',
              color: activeTab === 'preparing' ? '#1e3a8a' : '#fff',
              padding: '0 5px',
              borderRadius: '10px',
              fontSize: '0.7rem',
              fontWeight: 800,
              lineHeight: '1.3',
              flexShrink: 0
            }}>
              {preparingOrders.length}
            </span>
          </button>

          {/* 3. Entregados */}
          <button
            type="button"
            onClick={() => setActiveTab('delivered')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.3rem',
              padding: '0.45rem 0.2rem',
              borderRadius: '8px',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              backgroundColor: activeTab === 'delivered' ? '#10b981' : 'rgba(16, 185, 129, 0.12)',
              color: activeTab === 'delivered' ? '#000' : '#34d399',
              border: '1px solid #10b981',
              minWidth: 0,
              overflow: 'hidden'
            }}
            title="Ver comandas entregadas"
          >
            <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Entregados
            </span>
            <span style={{
              backgroundColor: activeTab === 'delivered' ? '#000' : '#10b981',
              color: activeTab === 'delivered' ? '#34d399' : '#000',
              padding: '0 5px',
              borderRadius: '10px',
              fontSize: '0.7rem',
              fontWeight: 800,
              lineHeight: '1.3',
              flexShrink: 0
            }}>
              {deliveredOrders.length}
            </span>
          </button>
        </div>
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
            const isSelected = order.id === selectedOrderId;

            // Tiempo transcurrido
            const createdMs = new Date(order.createdAt).getTime();
            const elapsedMin = Math.floor((nowTimer - createdMs) / 60000);
            let timeColor = '#94a3b8';
            if (isPending || isPreparing) {
              if (elapsedMin >= 15) timeColor = '#ef4444'; // Rojo (>15m)
              else if (elapsedMin >= 8) timeColor = '#f59e0b'; // Amarillo (>8m)
              else timeColor = '#10b981'; // Verde (<8m)
            }

            // Borde y fondo según estado y selección KDS
            let cardBorder = '1px solid var(--border-color)';
            let cardBg = '#13151b';
            if (isPending) {
              cardBorder = '1px solid rgba(245, 158, 11, 0.4)';
              cardBg = '#161920';
            } else if (isPreparing) {
              cardBorder = '1px solid rgba(37, 99, 235, 0.5)';
              cardBg = '#151922';
            } else if (isDelivered) {
              cardBorder = '1px solid var(--border-color)';
              cardBg = 'var(--bg-main)';
            }

            if (isSelected) {
              cardBorder = '2px solid #818cf8';
              cardBg = '#191e2b';
            }

            return (
              <div
                key={order.id}
                id={`order-card-${order.id}`}
                onClick={() => setSelectedOrderId(order.id)}
                style={{
                  backgroundColor: cardBg,
                  border: cardBorder,
                  borderRadius: 'var(--radius-lg)',
                  padding: '1.15rem',
                  boxShadow: isSelected
                    ? '0 0 24px rgba(99, 102, 241, 0.45), 0 4px 14px rgba(0,0,0,0.6)'
                    : 'var(--shadow-sm)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.85rem',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {/* Cabecera de la Comanda: # Ticket, Tiempo y Estado */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '1.6rem', fontWeight: 700, color: '#fff', letterSpacing: '-0.02em', display: 'block' }}>
                        Ticket #{order.correlative}
                      </span>
                      {isSelected && (
                        <span style={{
                          backgroundColor: '#4f46e5',
                          color: '#fff',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          letterSpacing: '0.5px'
                        }}>
                          ★ EN FOCO
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '0.78rem', color: timeColor, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Clock size={12} />
                      {getTimeElapsed(order.createdAt)} • {new Date(order.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* Badge de Estado */}
                  <div>
                    {isPending && (
                      <span style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '3px 9px', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontWeight: 600 }}>
                        PENDIENTE
                      </span>
                    )}
                    {isPreparing && (
                      <span style={{ backgroundColor: 'rgba(37, 99, 235, 0.15)', color: '#60a5fa', border: '1px solid rgba(37, 99, 235, 0.3)', padding: '3px 9px', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontWeight: 600 }}>
                        PREPARANDO
                      </span>
                    )}
                    {isDelivered && (
                      <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '3px 9px', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontWeight: 600 }}>
                        ENTREGADO
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
                    <strong>Nota Cliente:</strong> {order.saleNote}
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
                    <strong>Cocina:</strong> {order.kitchenNotes}
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
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* Botones de Acción de Cocina */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                  {isPending && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, 'preparing'); }}
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
                          gap: '0.4rem',
                          boxShadow: isSelected ? '0 0 10px rgba(59, 130, 246, 0.45)' : 'none'
                        }}
                      >
                        <Flame size={16} /> Preparar {isSelected && <kbd style={{ fontSize: '0.68rem', backgroundColor: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: '4px' }}>[ENTER]</kbd>}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, 'delivered'); }}
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
                        <Check size={16} /> Entregar {isSelected && <kbd style={{ fontSize: '0.68rem', backgroundColor: 'rgba(0,0,0,0.2)', padding: '1px 5px', borderRadius: '4px' }}>[D]</kbd>}
                      </button>
                    </>
                  )}

                  {isPreparing && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, 'delivered'); }}
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
                          gap: '0.4rem',
                          boxShadow: isSelected ? '0 0 12px rgba(16, 185, 129, 0.5)' : 'none'
                        }}
                      >
                        <Check size={18} /> ¡Listo / Entregar! {isSelected && <kbd style={{ fontSize: '0.72rem', backgroundColor: 'rgba(0,0,0,0.25)', padding: '2px 6px', borderRadius: '4px' }}>[ENTER]</kbd>}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, 'pending'); }}
                        style={{
                          flex: 1,
                          padding: '0.75rem',
                          borderRadius: '8px',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          color: '#94a3b8',
                          fontWeight: 600,
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.3rem'
                        }}
                        title="Devolver a pendientes"
                      >
                        <RotateCcw size={14} /> Devolver {isSelected && <kbd style={{ fontSize: '0.68rem', backgroundColor: 'rgba(255,255,255,0.1)', padding: '1px 4px', borderRadius: '4px' }}>[R]</kbd>}
                      </button>
                    </>
                  )}

                  {isDelivered && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, 'preparing'); }}
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
                      <RotateCcw size={13} /> Reabrir Comanda {isSelected && <kbd style={{ fontSize: '0.68rem', backgroundColor: 'rgba(255,255,255,0.1)', padding: '1px 4px', borderRadius: '4px' }}>[ENTER]</kbd>}
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
    </div>
  );
};

export default EventComandas;

