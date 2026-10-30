import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db, auth } from '../firebase/config';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { 
  Clock, Flame, CheckCircle2, ShoppingBag, 
  Sparkles, RefreshCw, AlertCircle, ChefHat, Volume2, VolumeX, Heart
} from 'lucide-react';

/**
 * Sonido de campanilla cuando el pedido cambia de estado a listo o en preparación
 */
const playStatusChangeSound = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    // Secuencia alegre de 3 tonos: 523Hz (C5) -> 659Hz (E5) -> 784Hz (G5)
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.12);
      gain.gain.setValueAtTime(0.25, ctx.currentTime + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + idx * 0.12 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.12);
      osc.stop(ctx.currentTime + idx * 0.12 + 0.35);
    });
  } catch {
    // Ignorar si el navegador bloquea audio sin interacción
  }
};

const ClientOrderStatus = () => {
  const { saleId } = useParams();

  const [sale, setSale] = useState(null);
  const [eventData, setEventData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const prevStatusRef = useRef(null);
  const isInitialLoadRef = useRef(true);

  // 1. Autenticación anónima silenciosa para que cualquier cliente que escanee el QR pueda ver su estado en vivo
  useEffect(() => {
    if (!auth.currentUser) {
      signInAnonymously(auth).catch(err => {
        console.warn("Autenticación anónima para consulta de pedido:", err);
      });
    }
  }, []);

  // 2. Suscripción en tiempo real al ticket del cliente
  useEffect(() => {
    if (!saleId) {
      setError('No se especificó ningún número de ticket.');
      setLoading(false);
      return;
    }

    // Modo Demo / Prueba
    if (saleId === 'test' || saleId === 'test-preview') {
      setSale({
        id: 'test-preview',
        correlative: 1,
        createdAt: new Date().toISOString(),
        clientName: 'Cliente Demo',
        total: 5500,
        paymentMethod: 'cash',
        orderStatus: 'preparing',
        kitchenStatus: 'preparing',
        items: [
          { quantity: 2, name: 'Completo Italiano', price: 2500, selectedSubproducts: [{ name: 'Mayo Casera' }] },
          { quantity: 1, name: 'Bebida en Lata', price: 1200, selectedSubproducts: [{ name: 'Coca Cola' }] }
        ]
      });
      setEventData({ name: 'Evento Demo APPCURSO' });
      setLoading(false);
      return;
    }

    const saleRef = doc(db, 'eventSales', saleId);

    const unsubscribe = onSnapshot(saleRef, (docSnap) => {
      if (!docSnap.exists()) {
        setError('No encontramos tu ticket en el sistema. Consulta con el personal de caja.');
        setSale(null);
        setLoading(false);
        return;
      }

      const saleData = { id: docSnap.id, ...docSnap.data() };
      const currentStatus = saleData.orderStatus || saleData.kitchenStatus || 'pending';

      // Reproducir sonido si el estado cambió en vivo
      if (!isInitialLoadRef.current && prevStatusRef.current && prevStatusRef.current !== currentStatus && soundEnabled) {
        playStatusChangeSound();
        if (navigator.vibrate) {
          try { navigator.vibrate([100, 50, 100]); } catch {}
        }
      }

      prevStatusRef.current = currentStatus;
      isInitialLoadRef.current = false;

      setSale(saleData);

      // Cargar información del evento si está presente
      if (saleData.eventId && !eventData) {
        getDoc(doc(db, 'events', saleData.eventId)).then(evSnap => {
          if (evSnap.exists()) {
            setEventData({ id: evSnap.id, ...evSnap.data() });
          }
        }).catch(() => {});
      }

      setLoading(false);
    }, (err) => {
      console.error("Error al escuchar estado del ticket:", err);
      setError('Error al consultar el pedido: ' + err.message);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [saleId, soundEnabled]);

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
  };

  const status = sale?.orderStatus || sale?.kitchenStatus || 'pending';
  const isCancelled = sale?.status === 'cancelled';
  const isDelivered = status === 'delivered';
  const isPreparing = status === 'preparing';
  const isPending = status === 'pending';

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#090d16',
      backgroundImage: 'radial-gradient(at 50% 0%, rgba(99, 102, 241, 0.2) 0px, transparent 65%), radial-gradient(at 100% 100%, rgba(245, 158, 11, 0.1) 0px, transparent 65%)',
      color: '#f8fafc',
      padding: '1.25rem 1rem 3rem',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Contenedor Centrado Responsive */}
      <div style={{ width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        
        {/* Cabecera / Marca del Evento */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: 'rgba(99, 102, 241, 0.2)',
              border: '1px solid var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)'
            }}>
              <ChefHat size={20} />
            </div>
            <div>
              <h4 style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {eventData?.name || 'Estado de tu Pedido'}
              </h4>
              <span style={{ fontSize: '0.75rem', color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }} />
                Actualización en vivo
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="btn btn-outline"
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            title={soundEnabled ? 'Avisos de sonido activados' : 'Avisos de sonido silenciados'}
          >
            {soundEnabled ? <Volume2 size={14} color="var(--primary)" /> : <VolumeX size={14} />}
            <span>{soundEnabled ? 'Sonido ON' : 'Silencio'}</span>
          </button>
        </div>

        {loading ? (
          <div className="glass-panel" style={{ padding: '3.5rem 1.5rem', textAlign: 'center' }}>
            <RefreshCw size={38} className="animate-spin" style={{ color: 'var(--primary)', margin: '0 auto 1rem' }} />
            <h3 style={{ margin: '0 0 0.5rem 0', color: '#fff' }}>Buscando tu pedido...</h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Conectando con la cocina en tiempo real
            </p>
          </div>
        ) : error ? (
          <div className="glass-panel" style={{ padding: '2rem 1.5rem', textAlign: 'center', border: '1px solid rgba(239, 68, 68, 0.4)' }}>
            <AlertCircle size={44} style={{ color: 'var(--danger)', margin: '0 auto 1rem' }} />
            <h3 style={{ margin: '0 0 0.5rem 0', color: '#fff' }}>Ticket no encontrado</h3>
            <p style={{ margin: 0, color: '#fca5a5', fontSize: '0.9rem' }}>{error}</p>
          </div>
        ) : sale ? (
          <>
            {/* Tarjeta de Número de Ticket */}
            <div className="glass-panel" style={{
              padding: '1.25rem 1.5rem',
              textAlign: 'center',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(30, 41, 59, 0.7) 100%)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '16px'
            }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Número de Ticket
              </span>
              <h1 style={{
                margin: '0.2rem 0',
                fontSize: '3.2rem',
                fontWeight: 900,
                color: '#fff',
                textShadow: '0 0 20px rgba(99, 102, 241, 0.5)'
              }}>
                #{sale.correlative || 'S/N'}
              </h1>
              {sale.clientName && (
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#cbd5e1' }}>
                  A nombre de: <strong>{sale.clientName}</strong>
                </p>
              )}
            </div>

            {/* Tarjeta de Estado del Pedido (Semáforo Dinámico) */}
            <div className="glass-panel" style={{
              padding: '1.5rem',
              borderRadius: '16px',
              border: isCancelled
                ? '1px solid var(--danger)'
                : isDelivered
                  ? '1px solid rgba(16, 185, 129, 0.6)'
                  : isPreparing
                    ? '1px solid rgba(245, 158, 11, 0.6)'
                    : '1px solid rgba(99, 102, 241, 0.5)',
              boxShadow: isDelivered
                ? '0 0 30px rgba(16, 185, 129, 0.2)'
                : isPreparing
                  ? '0 0 30px rgba(245, 158, 11, 0.25)'
                  : '0 0 25px rgba(99, 102, 241, 0.15)'
            }}>
              {/* Línea de Progreso Visual */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', position: 'relative' }}>
                {/* Barra conectora */}
                <div style={{
                  position: 'absolute',
                  top: '16px',
                  left: '12%',
                  right: '12%',
                  height: '3px',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  zIndex: 0
                }}>
                  <div style={{
                    height: '100%',
                    backgroundColor: isDelivered ? '#10b981' : isPreparing ? '#f59e0b' : '#6366f1',
                    width: isDelivered ? '100%' : isPreparing ? '50%' : '0%',
                    transition: 'all 0.5s ease'
                  }} />
                </div>

                {/* Paso 1: Recibido */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1 }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: '#1e293b',
                    border: '2px solid #6366f1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#6366f1',
                    fontSize: '0.85rem'
                  }}>
                    <Clock size={16} />
                  </div>
                  <span style={{ fontSize: '0.72rem', marginTop: '0.35rem', color: '#a5b4fc', fontWeight: 'bold' }}>
                    Recibido
                  </span>
                </div>

                {/* Paso 2: Preparando */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1 }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: '#1e293b',
                    border: isPreparing || isDelivered ? '2px solid #f59e0b' : '2px solid rgba(255,255,255,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isPreparing || isDelivered ? '#f59e0b' : 'var(--text-muted)',
                    fontSize: '0.85rem'
                  }}>
                    <Flame size={16} />
                  </div>
                  <span style={{
                    fontSize: '0.72rem',
                    marginTop: '0.35rem',
                    color: isPreparing || isDelivered ? '#fcd34d' : 'var(--text-muted)',
                    fontWeight: isPreparing ? 'bold' : 'normal'
                  }}>
                    Preparando
                  </span>
                </div>

                {/* Paso 3: Listo / Entregado */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1 }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: '#1e293b',
                    border: isDelivered ? '2px solid #10b981' : '2px solid rgba(255,255,255,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isDelivered ? '#10b981' : 'var(--text-muted)',
                    fontSize: '0.85rem'
                  }}>
                    <CheckCircle2 size={16} />
                  </div>
                  <span style={{
                    fontSize: '0.72rem',
                    marginTop: '0.35rem',
                    color: isDelivered ? '#6ee7b7' : 'var(--text-muted)',
                    fontWeight: isDelivered ? 'bold' : 'normal'
                  }}>
                    Listo
                  </span>
                </div>
              </div>

              {/* Mensaje de Estado Actual Destacado */}
              <div style={{
                textAlign: 'center',
                padding: '1.25rem 1rem',
                borderRadius: '12px',
                backgroundColor: isCancelled
                  ? 'rgba(239, 68, 68, 0.15)'
                  : isDelivered
                    ? 'rgba(16, 185, 129, 0.15)'
                    : isPreparing
                      ? 'rgba(245, 158, 11, 0.15)'
                      : 'rgba(99, 102, 241, 0.12)'
              }}>
                {isCancelled ? (
                  <>
                    <h3 style={{ margin: '0 0 0.25rem 0', color: 'var(--danger)', fontSize: '1.25rem' }}>
                      Venta Anulada
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#fca5a5' }}>
                      Este ticket fue cancelado en caja.
                    </p>
                  </>
                ) : isDelivered ? (
                  <>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: '#10b981', marginBottom: '0.25rem' }}>
                      <CheckCircle2 size={24} />
                      <h3 style={{ margin: 0, fontSize: '1.35rem', color: '#6ee7b7', fontWeight: 800 }}>
                        ¡Pedido Entregado!
                      </h3>
                    </div>
                    <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.9rem', color: '#e2e8f0' }}>
                      ¡Muchas gracias por colaborar con el curso! Esperamos que lo disfrutes.
                    </p>
                    {sale.deliveredAt && (
                      <span style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Retirado a las: {new Date(sale.deliveredAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </>
                ) : isPreparing ? (
                  <>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: '#f59e0b', marginBottom: '0.25rem' }}>
                      <Flame size={24} className="animate-pulse" />
                      <h3 style={{ margin: 0, fontSize: '1.35rem', color: '#fcd34d', fontWeight: 800 }}>
                        ¡En Preparación!
                      </h3>
                    </div>
                    <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.92rem', color: '#fff' }}>
                      Tu comida se está cocinando en este momento. ¡Falta muy poco!
                    </p>
                    <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#fde68a' }}>
                      🔔 Te avisaremos con sonido cuando esté lista para retirar.
                    </p>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)', marginBottom: '0.25rem' }}>
                      <Clock size={24} />
                      <h3 style={{ margin: 0, fontSize: '1.35rem', color: '#a5b4fc', fontWeight: 800 }}>
                        En Cola de Cocina
                      </h3>
                    </div>
                    <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.92rem', color: '#cbd5e1' }}>
                      Tu pedido fue recibido y está en la fila de cocina.
                    </p>
                    <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Mantén esta pantalla abierta para ver el avance en tiempo real.
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Detalle de Productos del Ticket */}
            <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.85rem' }}>
                <ShoppingBag size={17} color="var(--primary)" />
                <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Detalle de tu Compra ({Array.isArray(sale.items) ? sale.items.reduce((s, i) => s + (i.quantity || 1), 0) : 0} ítems)
                </h4>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {Array.isArray(sale.items) && sale.items.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '0.65rem 0.85rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: '10px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{
                          backgroundColor: 'rgba(99, 102, 241, 0.2)',
                          color: '#a5b4fc',
                          fontWeight: 'bold',
                          padding: '2px 7px',
                          borderRadius: '6px',
                          fontSize: '0.85rem'
                        }}>
                          {item.quantity}x
                        </span>
                        <strong style={{ fontSize: '0.95rem', color: '#fff' }}>{item.name}</strong>
                      </div>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        {formatMoney((item.unitPrice || item.price || 0) * (item.quantity || 1))}
                      </span>
                    </div>

                    {item.selectedSubproducts && item.selectedSubproducts.length > 0 && (
                      <div style={{ marginTop: '0.35rem', paddingLeft: '2.2rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                        {item.selectedSubproducts.map((sp, spIdx) => (
                          <span
                            key={spIdx}
                            style={{
                              backgroundColor: 'rgba(255, 255, 255, 0.06)',
                              color: '#cbd5e1',
                              padding: '2px 7px',
                              borderRadius: '10px',
                              fontSize: '0.72rem'
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

              {/* Nota del Cliente */}
              {sale.saleNote && (
                <div style={{
                  marginTop: '0.75rem',
                  padding: '0.5rem 0.75rem',
                  backgroundColor: 'rgba(245, 158, 11, 0.08)',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  color: '#fef08a'
                }}>
                  <strong>Tu Nota:</strong> {sale.saleNote}
                </div>
              )}

              {/* Total */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: '0.85rem',
                marginTop: '0.85rem',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                fontSize: '0.9rem'
              }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  Total Pagado ({sale.paymentMethod === 'cash' ? 'Efectivo' : 'Transferencia'}):
                </span>
                <strong style={{ fontSize: '1.15rem', color: 'var(--success)' }}>
                  {formatMoney(sale.total)}
                </strong>
              </div>
            </div>

            {/* Pie de Página Agradecimiento */}
            <div style={{ textAlign: 'center', padding: '1rem 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              <p style={{ margin: '0 0 0.35rem 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                Hecho con <Heart size={14} color="#ec4899" fill="#ec4899" /> para las familias del curso
              </p>
              <p style={{ margin: 0, fontSize: '0.72rem', opacity: 0.7 }}>
                Emitido: {sale.createdAt ? new Date(sale.createdAt).toLocaleString('es-CL') : ''}
              </p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default ClientOrderStatus;

