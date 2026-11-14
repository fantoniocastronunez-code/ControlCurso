import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { db, auth } from '../firebase/config';
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import {
  ChefHat, Clock, CheckCircle2, Flame, Volume2,
  VolumeX, Maximize, Minimize, RefreshCw, MessageSquare,
  Search, Check, RotateCcw, X, Keyboard
} from 'lucide-react';
import './EventComandas.css';

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

  const [eventData, setEventData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending'); // 'pending', 'preparing', 'ready', 'delivered', 'all'
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [nowTimer, setNowTimer] = useState(Date.now());
  const [searchTerm, setSearchTerm] = useState('');
  const [activeKitchenNoteOrder, setActiveKitchenNoteOrder] = useState(null);
  const [kitchenNoteInput, setKitchenNoteInput] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [showKdsGuide, setShowKdsGuide] = useState(false);

  const previousOrderIdsRef = useRef(new Set());
  const initialLoadCompletedRef = useRef(false);
  const tabRefs = useRef({});

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
      const salesList = snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          orderStatus: data.orderStatus || data.kitchenStatus || 'pending'
        };
      });

      // Ordenar por correlativo descendente (más nuevos primero)
      salesList.sort((a, b) => (b.correlative || 0) - (a.correlative || 0));

      // Detección de nuevos pedidos para emitir sonido
      if (initialLoadCompletedRef.current && soundEnabled) {
        let hasNewPending = false;
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const saleData = change.doc.data();
            const status = saleData.orderStatus || saleData.kitchenStatus || 'pending';
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

  // 6. Cambiar estado de una comanda (campos permitidos en firestore.rules)
  const handleUpdateStatus = async (orderId, newStatus) => {
    try {
      const nowIso = new Date().toISOString();
      const updatePayload = {
        orderStatus: newStatus,
        kitchenStatus: newStatus,
        updatedAt: nowIso
      };

      if (newStatus === 'preparing') {
        updatePayload.preparedAt = nowIso;
      } else if (newStatus === 'delivered') {
        updatePayload.deliveredAt = nowIso;
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
  const activeOrders = orders.filter(o => o.status !== 'cancelled');
  const pendingOrders = activeOrders.filter(o => o.orderStatus === 'pending');
  const preparingOrders = activeOrders.filter(o => o.orderStatus === 'preparing');
  const readyOrders = activeOrders.filter(o => o.orderStatus === 'ready');
  const deliveredOrders = activeOrders.filter(o => o.orderStatus === 'delivered');

  // Filtrado de pedidos según la pestaña activa y búsqueda
  const filteredOrders = activeOrders.filter(order => {
    if (activeTab === 'pending' && order.orderStatus !== 'pending') return false;
    if (activeTab === 'preparing' && order.orderStatus !== 'preparing') return false;
    if (activeTab === 'ready' && order.orderStatus !== 'ready') return false;
    if (activeTab === 'delivered' && order.orderStatus !== 'delivered') return false;

    // Filtro por término de búsqueda (número de ticket, cliente o producto)
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchCorrelative = String(order.correlative).includes(term);
      const matchClient = (order.clientName || '').toLowerCase().includes(term);
      const matchItems = (order.items || []).some(i => i.name.toLowerCase().includes(term));
      return matchCorrelative || matchClient || matchItems;
    }

    return true;
  });

  // Mantener tab activa visible en contenedores con scroll horizontal
  const handleSelectTab = (tabId) => {
    setActiveTab(tabId);
    tabRefs.current[tabId]?.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' });
  };

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
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        activeKitchenNoteOrder !== null
      ) {
        return;
      }

      const tabs = ['pending', 'preparing', 'ready', 'delivered', 'all'];
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

      // Atajos de número para pestañas: 1 (Pendientes), 2 (Preparando), 3 (Listos), 4 (Entregados), 5 (Todas)
      if (key === '1') { e.preventDefault(); playActionBeep(520, 0.05); handleSelectTab('pending'); return; }
      if (key === '2') { e.preventDefault(); playActionBeep(520, 0.05); handleSelectTab('preparing'); return; }
      if (key === '3') { e.preventDefault(); playActionBeep(520, 0.05); handleSelectTab('ready'); return; }
      if (key === '4') { e.preventDefault(); playActionBeep(520, 0.05); handleSelectTab('delivered'); return; }
      if (key === '5') { e.preventDefault(); playActionBeep(520, 0.05); handleSelectTab('all'); return; }

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

      // 2. Mover Selección: Flecha Izquierda / Derecha
      if (key === 'ArrowLeft') {
        e.preventDefault();
        playActionBeep(420, 0.04);
        const nextIndex = safeIndex <= 0 ? filteredOrders.length - 1 : safeIndex - 1;
        setSelectedOrderId(filteredOrders[nextIndex].id);
        return;
      }

      if (key === 'ArrowRight') {
        e.preventDefault();
        playActionBeep(420, 0.04);
        const nextIndex = (safeIndex + 1) % filteredOrders.length;
        setSelectedOrderId(filteredOrders[nextIndex].id);
        return;
      }

      // 3. Acción Principal / Bump: ENTER (Avanzar paso a paso)
      if (key === 'Enter') {
        e.preventDefault();
        if (!currentOrder) return;
        playActionBeep(780, 0.12);

        if (currentOrder.orderStatus === 'pending') {
          handleUpdateStatus(currentOrder.id, 'preparing');
        } else if (currentOrder.orderStatus === 'preparing') {
          handleUpdateStatus(currentOrder.id, 'ready');
        } else if (currentOrder.orderStatus === 'ready') {
          handleUpdateStatus(currentOrder.id, 'delivered');
        } else if (currentOrder.orderStatus === 'delivered') {
          handleUpdateStatus(currentOrder.id, 'ready');
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

      // 5. Acción directa LISTO ('l' / 'L')
      if (key === 'l' || key === 'L') {
        e.preventDefault();
        if (!currentOrder) return;
        playActionBeep(880, 0.12);
        if (currentOrder.orderStatus === 'preparing') {
          handleUpdateStatus(currentOrder.id, 'ready');
        } else if (currentOrder.orderStatus === 'ready') {
          handleUpdateStatus(currentOrder.id, 'delivered');
        }
        return;
      }

      // 6. Acción directa ENTREGAR ('d' / 'D')
      if (key === 'd' || key === 'D') {
        e.preventDefault();
        if (!currentOrder) return;
        playActionBeep(880, 0.12);
        handleUpdateStatus(currentOrder.id, 'delivered');
        return;
      }

      // 7. Acción directa DEVOLVER / REVERTIR ('r' / 'R' o 'ArrowDown' o Backspace)
      if (key === 'r' || key === 'R' || key === 'Backspace' || key === 'ArrowDown') {
        e.preventDefault();
        if (!currentOrder) return;
        if (currentOrder.orderStatus === 'preparing') {
          playActionBeep(350, 0.1);
          handleUpdateStatus(currentOrder.id, 'pending');
        } else if (currentOrder.orderStatus === 'ready') {
          playActionBeep(350, 0.1);
          handleUpdateStatus(currentOrder.id, 'preparing');
        } else if (currentOrder.orderStatus === 'delivered') {
          playActionBeep(350, 0.1);
          handleUpdateStatus(currentOrder.id, 'ready');
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
  }, [filteredOrders, selectedOrderId, activeTab, activeKitchenNoteOrder]);

  useEffect(() => {
    if (activeTab !== 'all') {
      tabRefs.current[activeTab]?.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' });
    }
  }, [activeTab]);

  const stageTabs = [
    {
      id: 'pending',
      label: 'Pendientes',
      title: 'Ver comandas pendientes',
      count: pendingOrders.length,
      icon: Clock,
      activeBg: '#f59e0b',
      activeColor: '#000',
      inactiveBg: 'rgba(245, 158, 11, 0.12)',
      inactiveColor: '#fbbf24',
      borderColor: '#f59e0b',
      badgeActiveBg: '#000',
      badgeActiveColor: '#fbbf24',
      badgeInactiveBg: '#f59e0b',
      badgeInactiveColor: '#000'
    },
    {
      id: 'preparing',
      label: 'Preparando',
      title: 'Ver comandas en preparación',
      count: preparingOrders.length,
      icon: Flame,
      activeBg: '#2563eb',
      activeColor: '#fff',
      inactiveBg: 'rgba(37, 99, 235, 0.14)',
      inactiveColor: '#93c5fd',
      borderColor: '#3b82f6',
      badgeActiveBg: '#fff',
      badgeActiveColor: '#1e3a8a',
      badgeInactiveBg: '#2563eb',
      badgeInactiveColor: '#fff'
    },
    {
      id: 'ready',
      label: 'Listos',
      title: 'Ver comandas listas para retirar',
      count: readyOrders.length,
      icon: CheckCircle2,
      activeBg: '#10b981',
      activeColor: '#022c22',
      inactiveBg: 'rgba(16, 185, 129, 0.14)',
      inactiveColor: '#6ee7b7',
      borderColor: '#10b981',
      badgeActiveBg: '#022c22',
      badgeActiveColor: '#6ee7b7',
      badgeInactiveBg: '#10b981',
      badgeInactiveColor: '#022c22'
    },
    {
      id: 'delivered',
      label: 'Entregados',
      title: 'Ver comandas entregadas',
      count: deliveredOrders.length,
      icon: Check,
      activeBg: '#0f766e',
      activeColor: '#fff',
      inactiveBg: 'rgba(148, 163, 184, 0.1)',
      inactiveColor: '#cbd5e1',
      borderColor: '#64748b',
      badgeActiveBg: '#fff',
      badgeActiveColor: '#0f766e',
      badgeInactiveBg: '#475569',
      badgeInactiveColor: '#f8fafc'
    }
  ];

  const statusLabels = {
    pending: { text: 'PENDIENTE', bg: 'rgba(245, 158, 11, 0.16)', color: '#fbbf24', border: 'rgba(245, 158, 11, 0.35)' },
    preparing: { text: 'PREPARANDO', bg: 'rgba(37, 99, 235, 0.2)', color: '#93c5fd', border: 'rgba(59, 130, 246, 0.4)' },
    ready: { text: 'LISTO', bg: 'rgba(16, 185, 129, 0.18)', color: '#6ee7b7', border: 'rgba(16, 185, 129, 0.4)' },
    delivered: { text: 'ENTREGADO', bg: 'rgba(148, 163, 184, 0.15)', color: '#cbd5e1', border: 'rgba(148, 163, 184, 0.3)' }
  };

  const emptyLabels = {
    pending: 'pendientes',
    preparing: 'en preparación',
    ready: 'listas para retirar',
    delivered: 'entregadas',
    all: ''
  };

  return (
    <div className="kds-page">
      {/* Barra Superior de Cocina */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem',
        padding: '0.8rem 1.1rem',
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        marginBottom: '0.85rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minInlineSize: 0 }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            backgroundColor: 'rgba(99, 102, 241, 0.2)',
            border: '1px solid var(--primary, #6366f1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#93c5fd',
            flexShrink: 0
          }}>
            <ChefHat size={22} aria-hidden="true" />
          </div>
          <div style={{ minInlineSize: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#fff', textWrap: 'balance' }}>
                Comandas de Cocina
              </h1>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#6ee7b7',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '0.7rem',
                fontWeight: 700
              }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#34d399', display: 'inline-block' }} aria-hidden="true" />
                EN VIVO
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>
              {eventData?.name || 'Pantalla de Cocina y Despacho'}
            </p>
          </div>
        </div>

        {/* Controles del Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <label htmlFor="kds-ticket-search" className="kds-visually-hidden">
              Buscar ticket, cliente o producto
            </label>
            <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
            <input
              id="kds-ticket-search"
              type="search"
              placeholder="Buscar # ticket..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="kds-input"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                borderRadius: '8px',
                padding: '0.45rem 0.65rem 0.45rem 2rem',
                fontSize: '0.84rem',
                color: '#fff',
                minBlockSize: '40px',
                width: '150px'
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              if (next) playKitchenChime();
            }}
            aria-pressed={soundEnabled}
            className="kds-btn kds-header-btn"
            style={{
              backgroundColor: soundEnabled ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
              border: soundEnabled ? '1px solid #6366f1' : '1px solid rgba(255, 255, 255, 0.15)',
              color: soundEnabled ? '#c7d2fe' : '#cbd5e1'
            }}
            title={soundEnabled ? 'Silenciar avisos sonoros' : 'Activar timbre sonoro'}
          >
            {soundEnabled ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
            <span>{soundEnabled ? 'Sonido' : 'Silencio'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowKdsGuide(!showKdsGuide)}
            aria-expanded={showKdsGuide}
            className="kds-btn kds-header-btn"
            style={{
              backgroundColor: showKdsGuide ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.05)',
              border: showKdsGuide ? '1px solid #6366f1' : '1px solid rgba(255, 255, 255, 0.15)',
              color: showKdsGuide ? '#c7d2fe' : '#cbd5e1'
            }}
            title="Mostrar / ocultar atajos del teclado KDS Bluetooth"
          >
            <Keyboard size={16} aria-hidden="true" />
            <span>KDS</span>
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            aria-pressed={isFullscreen}
            className="kds-btn kds-header-btn"
            style={{
              backgroundColor: isFullscreen ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.05)',
              border: isFullscreen ? '1px solid #6366f1' : '1px solid rgba(255, 255, 255, 0.15)',
              color: '#fff'
            }}
            aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          >
            {isFullscreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
            <span>{isFullscreen ? 'Salir' : 'Completa'}</span>
          </button>
        </div>
      </header>

      {/* Banner de Atajos de Teclado KDS Bluetooth (oculto por defecto para vista limpia) */}
      {showKdsGuide && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          border: '1px solid rgba(99, 102, 241, 0.28)',
          borderRadius: '10px',
          padding: '0.55rem 0.9rem',
          marginBottom: '0.85rem',
          fontSize: '0.78rem',
          color: '#e2e8f0'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, color: '#c7d2fe', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <Keyboard size={15} aria-hidden="true" /> KDS Bump Bar:
            </span>
            <span><kbd style={{ backgroundColor: 'rgba(255,255,255,0.12)', padding: '2px 6px', borderRadius: '4px', color: '#fff', fontWeight: 700 }}>Q</kbd> / <kbd style={{ backgroundColor: 'rgba(255,255,255,0.12)', padding: '2px 6px', borderRadius: '4px', color: '#fff', fontWeight: 700 }}>E</kbd> Pestañas</span>
            <span>•</span>
            <span><kbd style={{ backgroundColor: 'rgba(255,255,255,0.12)', padding: '2px 6px', borderRadius: '4px', color: '#fff', fontWeight: 700 }}>←</kbd> <kbd style={{ backgroundColor: 'rgba(255,255,255,0.12)', padding: '2px 6px', borderRadius: '4px', color: '#fff', fontWeight: 700 }}>→</kbd> Mover</span>
            <span>•</span>
            <span><kbd style={{ backgroundColor: '#10b981', color: '#022c22', padding: '2px 7px', borderRadius: '4px', fontWeight: 900 }}>ENTER</kbd> Avanzar</span>
            <span>•</span>
            <span><kbd style={{ backgroundColor: '#2563eb', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>P</kbd> Preparar</span>
            <span>•</span>
            <span><kbd style={{ backgroundColor: '#10b981', color: '#022c22', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>L</kbd> Listo</span>
            <span>•</span>
            <span><kbd style={{ backgroundColor: 'rgba(239, 68, 68, 0.25)', border: '1px solid rgba(248, 113, 113, 0.45)', color: '#fecaca', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>R</kbd> Devolver</span>
          </div>
          <button
            type="button"
            onClick={() => setShowKdsGuide(false)}
            aria-label="Cerrar guía de teclado KDS"
            className="kds-btn kds-icon-btn"
            style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: '4px', minBlockSize: '32px', minInlineSize: '32px' }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      <main>
        {/* Barra de Pestañas (1 sola línea, con scroll horizontal en pantallas pequeñas) */}
        <div style={{ marginBottom: '1rem', width: '100%' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '0.45rem'
          }}>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Estado de pedidos
            </span>
            <button
              type="button"
              onClick={() => handleSelectTab('all')}
              aria-pressed={activeTab === 'all'}
              className="kds-btn"
              style={{
                background: activeTab === 'all' ? 'rgba(255, 255, 255, 0.16)' : 'transparent',
                border: activeTab === 'all' ? '1px solid rgba(255, 255, 255, 0.35)' : '1px solid rgba(255, 255, 255, 0.12)',
                color: activeTab === 'all' ? '#fff' : '#cbd5e1',
                fontSize: '0.78rem',
                fontWeight: activeTab === 'all' ? 700 : 600,
                padding: '4px 10px',
                borderRadius: '8px',
                minBlockSize: '32px',
                cursor: 'pointer'
              }}
            >
              {activeTab === 'all' ? `Todas (${activeOrders.length})` : `Ver todas (${activeOrders.length})`}
            </button>
          </div>

          <div role="tablist" aria-label="Estados de comandas" className="kds-tablist">
            {stageTabs.map((tab) => {
              const Icon = tab.icon;
              const isTabActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`kds-tab-${tab.id}`}
                  ref={(el) => { tabRefs.current[tab.id] = el; }}
                  type="button"
                  role="tab"
                  aria-selected={isTabActive}
                  onClick={() => handleSelectTab(tab.id)}
                  title={tab.title}
                  className="kds-tab"
                  style={{
                    backgroundColor: isTabActive ? tab.activeBg : tab.inactiveBg,
                    color: isTabActive ? tab.activeColor : tab.inactiveColor,
                    borderColor: tab.borderColor
                  }}
                >
                  <Icon size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                  <span>{tab.label}</span>
                  <span style={{
                    backgroundColor: isTabActive ? tab.badgeActiveBg : tab.badgeInactiveBg,
                    color: isTabActive ? tab.badgeActiveColor : tab.badgeInactiveColor,
                    padding: '1px 7px',
                    borderRadius: '10px',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    lineHeight: '1.3',
                    flexShrink: 0
                  }}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Panel Activo de Comandas */}
        <div
          role={activeTab === 'all' ? undefined : 'tabpanel'}
          aria-labelledby={activeTab === 'all' ? undefined : `kds-tab-${activeTab}`}
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#94a3b8' }}>
              <RefreshCw size={28} className="animate-spin" aria-hidden="true" style={{ margin: '0 auto 1rem auto' }} />
              <p>Cargando comandas en tiempo real...</p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '3.5rem 1rem',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '14px',
              border: '1px dashed rgba(255, 255, 255, 0.12)',
              color: '#cbd5e1'
            }}>
              <ChefHat size={38} aria-hidden="true" style={{ opacity: 0.5, margin: '0 auto 0.85rem auto' }} />
              <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.1rem', textWrap: 'balance' }}>
                No hay comandas {emptyLabels[activeTab] || ''}
              </h2>
              <p style={{ margin: '0.45rem 0 0 0', fontSize: '0.86rem', color: '#94a3b8' }}>
                Los nuevos pedidos del POS aparecerán aquí al instante.
              </p>
            </div>
          ) : (
            <div className="kds-grid">
              {filteredOrders.map(order => {
                const isPending = order.orderStatus === 'pending';
                const isPreparing = order.orderStatus === 'preparing';
                const isReady = order.orderStatus === 'ready';
                const isDelivered = order.orderStatus === 'delivered';
                const isSelected = order.id === selectedOrderId;

                const createdMs = new Date(order.createdAt).getTime();
                const elapsedMin = Number.isFinite(createdMs) ? Math.floor((nowTimer - createdMs) / 60000) : 0;
                let timeColor = '#94a3b8';
                if ((isPending || isPreparing) && Number.isFinite(createdMs)) {
                  if (elapsedMin >= 15) timeColor = '#f87171';
                  else if (elapsedMin >= 8) timeColor = '#fbbf24';
                  else timeColor = '#34d399';
                }

                let cardBorder = '1px solid var(--border-color, #222631)';
                let cardBg = '#13151b';
                if (isPending) {
                  cardBorder = '1px solid rgba(245, 158, 11, 0.4)';
                  cardBg = '#161920';
                } else if (isPreparing) {
                  cardBorder = '1px solid rgba(59, 130, 246, 0.48)';
                  cardBg = '#151922';
                } else if (isReady) {
                  cardBorder = '1px solid rgba(16, 185, 129, 0.5)';
                  cardBg = '#111b19';
                }

                if (isSelected && showKdsGuide) {
                  cardBorder = '2px solid #818cf8';
                }

                const statusBadge = statusLabels[order.orderStatus] || statusLabels.pending;

                return (
                  <article
                    key={order.id}
                    id={`order-card-${order.id}`}
                    onClick={() => setSelectedOrderId(order.id)}
                    onFocusCapture={() => setSelectedOrderId(order.id)}
                    className="kds-card"
                    style={{
                      backgroundColor: cardBg,
                      border: cardBorder,
                      boxShadow: isSelected && showKdsGuide
                        ? '0 0 20px rgba(99, 102, 241, 0.35), 0 4px 14px rgba(0,0,0,0.5)'
                        : 'var(--shadow-sm)'
                    }}
                  >
                    {/* Cabecera simple: #Ticket, Cliente y Tiempo */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '0.5rem',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                      paddingBottom: '0.6rem'
                    }}>
                      <div style={{ minInlineSize: 0 }}>
                        <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                          Ticket #{order.correlative || 'S/N'}
                        </div>
                        <div style={{ fontSize: '0.88rem', color: '#cbd5e1', marginTop: '0.2rem' }}>
                          Cliente: <strong style={{ color: '#fff' }}>{order.clientName || 'General'}</strong>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.8rem', color: timeColor, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.28rem' }}>
                            <Clock size={13} aria-hidden="true" />
                            <span>{getTimeElapsed(order.createdAt)}</span>
                          </div>
                          {activeTab === 'all' && (
                            <div style={{ marginTop: '0.25rem' }}>
                              <span style={{
                                backgroundColor: statusBadge.bg,
                                color: statusBadge.color,
                                border: `1px solid ${statusBadge.border}`,
                                padding: '2px 7px',
                                borderRadius: '6px',
                                fontSize: '0.68rem',
                                fontWeight: 700
                              }}>
                                {statusBadge.text}
                              </span>
                            </div>
                          )}
                        </div>

                        {activeKitchenNoteOrder !== order.id && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveKitchenNoteOrder(order.id);
                              setKitchenNoteInput(order.kitchenNotes || '');
                            }}
                            className="kds-btn kds-icon-btn"
                            aria-label={`Nota de cocina para Ticket #${order.correlative || 'S/N'}`}
                            title="Agregar o editar nota de cocina"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: order.kitchenNotes ? '#93c5fd' : '#64748b',
                              cursor: 'pointer',
                              padding: '6px',
                              borderRadius: '8px',
                              minBlockSize: '36px',
                              minInlineSize: '36px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <MessageSquare size={15} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Notas solo si existen */}
                    {order.saleNote && (
                      <div style={{
                        backgroundColor: 'rgba(245, 158, 11, 0.14)',
                        border: '1px solid rgba(245, 158, 11, 0.35)',
                        borderRadius: '8px',
                        padding: '0.45rem 0.7rem',
                        fontSize: '0.84rem',
                        color: '#fef08a'
                      }}>
                        <strong>Nota:</strong> {order.saleNote}
                      </div>
                    )}

                    {/* Productos Vendidos */}
                    <ul className="kds-items-list" role="list">
                      {order.items && order.items.map((item, idx) => (
                        <li
                          key={idx}
                          style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.04)',
                            padding: '0.65rem 0.85rem',
                            borderRadius: '10px',
                            border: '1px solid rgba(255, 255, 255, 0.07)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                            <span style={{
                              backgroundColor: '#4f46e5',
                              color: '#fff',
                              fontWeight: 900,
                              fontSize: '0.98rem',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              flexShrink: 0
                            }}>
                              {item.quantity}x
                            </span>
                            <strong style={{ fontSize: '1.1rem', color: '#fff', lineHeight: 1.25 }}>
                              {item.name}
                            </strong>
                          </div>

                          {item.selectedSubproducts && item.selectedSubproducts.length > 0 && (
                            <div style={{ marginTop: '0.4rem', paddingLeft: '2.2rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                              {item.selectedSubproducts.map((sp, spIdx) => (
                                <span
                                  key={spIdx}
                                  style={{
                                    display: 'inline-block',
                                    backgroundColor: 'rgba(99, 102, 241, 0.18)',
                                    border: '1px solid rgba(129, 140, 248, 0.35)',
                                    color: '#e0e7ff',
                                    fontSize: '0.8rem',
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    fontWeight: 600
                                  }}
                                >
                                  + {sp.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>

                    {/* Nota interna de Cocina (si existe) */}
                    {order.kitchenNotes && (
                      <div style={{
                        backgroundColor: 'rgba(99, 102, 241, 0.14)',
                        border: '1px solid rgba(129, 140, 248, 0.3)',
                        borderRadius: '8px',
                        padding: '0.45rem 0.7rem',
                        fontSize: '0.82rem',
                        color: '#e0e7ff'
                      }}>
                        <strong>Cocina:</strong> {order.kitchenNotes}
                      </div>
                    )}

                    {/* Editor rápido de nota de cocina */}
                    {activeKitchenNoteOrder === order.id && (
                      <div style={{ display: 'flex', gap: '0.4rem' }} onClick={(e) => e.stopPropagation()}>
                        <label htmlFor={`kds-note-${order.id}`} className="kds-visually-hidden">
                          Nota de cocina para Ticket #{order.correlative}
                        </label>
                        <input
                          id={`kds-note-${order.id}`}
                          type="text"
                          placeholder="Ej. Sin cebolla..."
                          value={kitchenNoteInput}
                          onChange={(e) => setKitchenNoteInput(e.target.value)}
                          autoFocus
                          className="kds-input"
                          style={{
                            flex: 1,
                            backgroundColor: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid var(--primary, #2563eb)',
                            borderRadius: '8px',
                            padding: '0.45rem 0.65rem',
                            fontSize: '0.84rem',
                            color: '#fff',
                            minBlockSize: '40px'
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveKitchenNote(order.id);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveKitchenNote(order.id)}
                          className="btn btn-primary kds-btn"
                          style={{ padding: '0.45rem 0.8rem', fontSize: '0.82rem', minBlockSize: '40px' }}
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveKitchenNoteOrder(null);
                            setKitchenNoteInput('');
                          }}
                          aria-label="Cancelar nota"
                          className="btn btn-outline kds-btn"
                          style={{ padding: '0.45rem 0.65rem', minBlockSize: '40px' }}
                        >
                          <X size={15} aria-hidden="true" />
                        </button>
                      </div>
                    )}

                    {/* Botón Principal Abajo */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', paddingTop: '0.2rem' }}>
                      {isPending && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, 'preparing'); }}
                          className="kds-btn kds-action-btn"
                          style={{
                            flex: 1,
                            border: 'none',
                            backgroundColor: '#2563eb',
                            color: '#fff',
                            fontWeight: 800,
                            fontSize: '1rem'
                          }}
                        >
                          <Flame size={18} aria-hidden="true" />
                          <span>Preparar</span>
                        </button>
                      )}

                      {isPreparing && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, 'ready'); }}
                            className="kds-btn kds-action-btn"
                            style={{
                              flex: 1,
                              border: 'none',
                              backgroundColor: '#10b981',
                              color: '#022c22',
                              fontWeight: 900,
                              fontSize: '1.05rem',
                              letterSpacing: '0.03em'
                            }}
                          >
                            <Check size={20} strokeWidth={2.75} aria-hidden="true" />
                            <span>LISTO</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, 'pending'); }}
                            className="kds-btn kds-action-btn"
                            aria-label={`Devolver Ticket #${order.correlative || 'S/N'} a pendientes`}
                            title="Devolver a pendientes"
                            style={{
                              padding: '0 0.75rem',
                              border: '1px solid rgba(255, 255, 255, 0.18)',
                              backgroundColor: 'rgba(255, 255, 255, 0.05)',
                              color: '#cbd5e1'
                            }}
                          >
                            <RotateCcw size={17} aria-hidden="true" />
                          </button>
                        </>
                      )}

                      {isReady && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, 'delivered'); }}
                            className="kds-btn kds-action-btn"
                            style={{
                              flex: 1,
                              border: 'none',
                              backgroundColor: '#2563eb',
                              color: '#fff',
                              fontWeight: 800,
                              fontSize: '0.96rem'
                            }}
                          >
                            <CheckCircle2 size={18} aria-hidden="true" />
                            <span>Entregar</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, 'preparing'); }}
                            className="kds-btn kds-action-btn"
                            aria-label={`Volver Ticket #${order.correlative || 'S/N'} a preparando`}
                            title="Volver a preparando"
                            style={{
                              padding: '0 0.75rem',
                              border: '1px solid rgba(255, 255, 255, 0.18)',
                              backgroundColor: 'rgba(255, 255, 255, 0.05)',
                              color: '#cbd5e1'
                            }}
                          >
                            <RotateCcw size={17} aria-hidden="true" />
                          </button>
                        </>
                      )}

                      {isDelivered && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, 'ready'); }}
                          className="kds-btn kds-action-btn"
                          style={{
                            flex: 1,
                            border: '1px solid rgba(255, 255, 255, 0.18)',
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            color: '#cbd5e1',
                            fontWeight: 600,
                            fontSize: '0.88rem'
                          }}
                        >
                          <RotateCcw size={15} aria-hidden="true" />
                          <span>Reabrir a Listos</span>
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default EventComandas;

