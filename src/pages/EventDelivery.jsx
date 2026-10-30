import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db, auth } from '../firebase/config';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { 
  CheckCircle2, AlertTriangle, XCircle, Clock, ShoppingBag, 
  User, Check, Camera, ArrowLeft, RefreshCw, ChefHat, ShieldCheck, Hash
} from 'lucide-react';
import QRScannerModal from '../components/events/QRScannerModal';

/**
 * Sonido de confirmación de entrega exitosa
 */
const playDeliveredChime = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    // Secuencia de dos tonos alegres: 587Hz (D5) -> 880Hz (A5)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // Ignorar si el audio está restringido
  }
};

const EventDelivery = () => {
  const { saleId } = useParams();
  const navigate = useNavigate();

  const [sale, setSale] = useState(null);
  const [eventData, setEventData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [deliverySuccess, setDeliverySuccess] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // 1. Autenticación anónima para que cualquiera que escanee el QR desde su celular pueda operar
  useEffect(() => {
    if (!auth.currentUser) {
      signInAnonymously(auth).catch(err => {
        console.warn("Autenticación anónima en entrega:", err);
      });
    }
  }, []);

  // 2. Cargar datos del ticket / venta
  const fetchSale = async (idToFetch) => {
    setLoading(true);
    setError(null);
    setDeliverySuccess(false);

    // Caso especial: ticket de prueba
    if (idToFetch === 'test' || idToFetch === 'test-preview') {
      setSale({
        id: 'test-preview',
        correlative: 'PRUEBA',
        createdAt: new Date().toISOString(),
        clientName: 'Cliente de Prueba',
        cashierName: 'Cajero Demo',
        total: 5500,
        orderStatus: 'pending',
        items: [
          { quantity: 2, name: 'Completo Italiano', price: 2500, selectedSubproducts: [{ name: 'Mayo Casera' }] },
          { quantity: 1, name: 'Bebida en Lata', price: 1200, selectedSubproducts: [{ name: 'Coca Cola' }] }
        ]
      });
      setEventData({ name: 'Evento de Prueba' });
      setLoading(false);
      return;
    }

    try {
      const saleRef = doc(db, 'eventSales', idToFetch);
      const snap = await getDoc(saleRef);

      if (!snap.exists()) {
        setError('No se encontró el ticket en el sistema. Verifica el código o número de venta.');
        setSale(null);
        setLoading(false);
        return;
      }

      const saleData = { id: snap.id, ...snap.data() };
      setSale(saleData);

      // Cargar nombre del evento
      if (saleData.eventId) {
        try {
          const evSnap = await getDoc(doc(db, 'events', saleData.eventId));
          if (evSnap.exists()) {
            setEventData({ id: evSnap.id, ...evSnap.data() });
          }
        } catch (evErr) {
          console.warn("No se pudo cargar evento:", evErr);
        }
      }

      setLoading(false);
    } catch (err) {
      console.error("Error al cargar venta:", err);
      setError('Error al conectar con la base de datos: ' + err.message);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (saleId) {
      fetchSale(saleId);
    }
  }, [saleId]);

  // 3. Confirmar la entrega segura
  const handleConfirmDelivery = async () => {
    if (!sale) return;

    if (sale.id === 'test-preview') {
      playDeliveredChime();
      setSale(prev => ({
        ...prev,
        orderStatus: 'delivered',
        deliveredAt: new Date().toISOString(),
        deliveredBy: 'Despacho Demo'
      }));
      setDeliverySuccess(true);
      return;
    }

    setActionLoading(true);
    try {
      const deliveredBy = auth.currentUser?.displayName || auth.currentUser?.email || 'Despacho QR';
      const nowIso = new Date().toISOString();

      await updateDoc(doc(db, 'eventSales', sale.id), {
        orderStatus: 'delivered',
        kitchenStatus: 'delivered',
        deliveredAt: nowIso,
        deliveredBy: deliveredBy
      });

      playDeliveredChime();
      setSale(prev => ({
        ...prev,
        orderStatus: 'delivered',
        kitchenStatus: 'delivered',
        deliveredAt: nowIso,
        deliveredBy: deliveredBy
      }));
      setDeliverySuccess(true);
    } catch (err) {
      console.error("Error al confirmar entrega:", err);
      alert("Error al confirmar entrega: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // 4. Procesar escaneo de otro ticket
  const handleScanSuccess = (decodedText) => {
    setShowScanner(false);
    // Si viene una URL completa, extraer el ID final
    let cleanId = decodedText.trim();
    if (cleanId.includes('/entrega/')) {
      cleanId = cleanId.split('/entrega/')[1].split('?')[0].split('#')[0].trim();
    }
    // Si escribió "#3" o similar
    cleanId = cleanId.replace('#', '').trim();

    navigate(`/entrega/${cleanId}`);
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const isDelivered = sale?.orderStatus === 'delivered' || sale?.kitchenStatus === 'delivered';
  const isCancelled = sale?.status === 'cancelled';

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#090d16',
      backgroundImage: 'radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.15) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.1) 0px, transparent 50%)',
      color: '#f8fafc',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center'
    }}>
      {/* Barra Superior */}
      <div style={{
        width: '100%',
        maxWidth: '560px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem',
        padding: '0.5rem 0'
      }}>
        {sale?.eventId ? (
          <Link
            to={`/comandas/${sale.eventId}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.85rem' }}
          >
            <ChefHat size={16} color="var(--primary)" /> Ver Comandas
          </Link>
        ) : (
          <button
            onClick={() => navigate(-1)}
            className="btn btn-outline"
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <ArrowLeft size={15} /> Volver
          </button>
        )}

        <button
          onClick={() => setShowScanner(true)}
          className="btn btn-primary"
          style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Camera size={16} /> Escanear Siguiente
        </button>
      </div>

      {/* Contenido Principal */}
      <div style={{ width: '100%', maxWidth: '560px' }}>
        {loading ? (
          <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
            <RefreshCw size={36} className="animate-spin" style={{ color: 'var(--primary)', margin: '0 auto 1rem' }} />
            <p style={{ color: 'var(--text-muted)' }}>Validando ticket en el sistema...</p>
          </div>
        ) : error ? (
          <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', border: '1px solid var(--danger)' }}>
            <XCircle size={48} style={{ color: 'var(--danger)', margin: '0 auto 1rem' }} />
            <h3 style={{ color: '#fff', marginBottom: '0.5rem' }}>Ticket No Válido</h3>
            <p style={{ color: '#fca5a5', fontSize: '0.9rem', marginBottom: '1.5rem' }}>{error}</p>
            <button
              onClick={() => setShowScanner(true)}
              className="btn btn-primary"
              style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
            >
              <Camera size={18} /> Escanear Otro Ticket
            </button>
          </div>
        ) : sale ? (
          <div className="glass-panel" style={{
            padding: '1.5rem',
            border: isDelivered 
              ? '1px solid rgba(245, 158, 11, 0.5)' 
              : isCancelled 
                ? '1px solid var(--danger)' 
                : '1px solid rgba(16, 185, 129, 0.5)',
            boxShadow: isDelivered 
              ? '0 0 25px rgba(245, 158, 11, 0.15)' 
              : '0 0 25px rgba(16, 185, 129, 0.15)'
          }}>
            {/* Banner de Estado de Seguridad */}
            {isCancelled ? (
              <div style={{
                padding: '1rem',
                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid var(--danger)',
                borderRadius: '12px',
                textAlign: 'center',
                marginBottom: '1.25rem'
              }}>
                <XCircle size={36} style={{ color: 'var(--danger)', margin: '0 auto 0.4rem' }} />
                <h3 style={{ margin: '0 0 0.25rem 0', color: '#fca5a5' }}>VENTA ANULADA</h3>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#fff' }}>
                  Este ticket fue cancelado en caja. <strong>NO entregar productos.</strong>
                </p>
              </div>
            ) : isDelivered ? (
              <div style={{
                padding: '1rem',
                backgroundColor: 'rgba(245, 158, 11, 0.18)',
                border: '1px solid #f59e0b',
                borderRadius: '12px',
                textAlign: 'center',
                marginBottom: '1.25rem'
              }}>
                <AlertTriangle size={36} style={{ color: '#f59e0b', margin: '0 auto 0.4rem' }} />
                <h3 style={{ margin: '0 0 0.25rem 0', color: '#fef08a' }}>¡ATENCIÓN! YA ENTREGADO</h3>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#fff' }}>
                  Este ticket ya fue canjeado previamente. <strong>Evita duplicidad de entrega.</strong>
                </p>
                {sale.deliveredAt && (
                  <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.78rem', color: '#fef3c7' }}>
                    Entregado el: {new Date(sale.deliveredAt).toLocaleString('es-CL')}
                    {sale.deliveredBy && ` • Por: ${sale.deliveredBy}`}
                  </p>
                )}
              </div>
            ) : (
              <div style={{
                padding: '0.85rem 1rem',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid #10b981',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginBottom: '1.25rem'
              }}>
                <ShieldCheck size={32} style={{ color: '#10b981', flexShrink: 0 }} />
                <div>
                  <h4 style={{ margin: 0, color: '#6ee7b7', fontSize: '0.95rem' }}>Ticket Válido - Listo para Entrega</h4>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Verifica los productos antes de presionar confirmar entrega.
                  </p>
                </div>
              </div>
            )}

            {/* Cabecera del Ticket */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              paddingBottom: '1rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              marginBottom: '1rem'
            }}>
              <div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  {eventData?.name || 'Evento'}
                </span>
                <h2 style={{ margin: '0.2rem 0', fontSize: '2rem', color: '#fff', fontWeight: 'bold' }}>
                  Ticket #{sale.correlative}
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  <Clock size={13} />
                  <span>{new Date(sale.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} ({new Date(sale.createdAt).toLocaleDateString('es-CL')})</span>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Cliente:</span>
                <strong style={{ fontSize: '0.95rem', color: 'var(--primary)' }}>{sale.clientName || 'General'}</strong>
                {sale.cashierName && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                    Caja: {sale.cashierName}
                  </span>
                )}
              </div>
            </div>

            {/* Detalle de Productos a Entregar */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.65rem' }}>
                <ShoppingBag size={16} color="var(--primary)" />
                <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#fff', textTransform: 'uppercase' }}>
                  Productos a Entregar ({sale.items?.reduce((s, i) => s + (i.quantity || 1), 0)} unidades)
                </h4>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {sale.items && sale.items.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '0.75rem 1rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '10px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <span style={{
                          backgroundColor: 'var(--primary)',
                          color: '#fff',
                          fontWeight: 'bold',
                          padding: '0.2rem 0.55rem',
                          borderRadius: '8px',
                          fontSize: '0.95rem'
                        }}>
                          {item.quantity}x
                        </span>
                        <strong style={{ fontSize: '1.05rem', color: '#fff' }}>{item.name}</strong>
                      </div>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {formatMoney((item.unitPrice || item.price) * item.quantity)}
                      </span>
                    </div>

                    {item.selectedSubproducts && item.selectedSubproducts.length > 0 && (
                      <div style={{ marginTop: '0.4rem', paddingLeft: '2.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                        {item.selectedSubproducts.map((sp, spIdx) => (
                          <span
                            key={spIdx}
                            style={{
                              backgroundColor: 'rgba(99, 102, 241, 0.15)',
                              color: '#a5b4fc',
                              border: '1px solid rgba(99, 102, 241, 0.3)',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontSize: '0.75rem',
                              fontWeight: '500'
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
            </div>

            {/* Notas del Cliente o Cocina */}
            {(sale.saleNote || sale.kitchenNotes) && (
              <div style={{
                marginBottom: '1.25rem',
                padding: '0.75rem 1rem',
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                borderRadius: '8px',
                fontSize: '0.85rem'
              }}>
                {sale.saleNote && (
                  <p style={{ margin: '0 0 0.25rem 0', color: '#fef08a' }}>
                    <strong>Nota Cliente:</strong> {sale.saleNote}
                  </p>
                )}
                {sale.kitchenNotes && (
                  <p style={{ margin: 0, color: '#fde68a' }}>
                    <strong>Nota Cocina:</strong> {sale.kitchenNotes}
                  </p>
                )}
              </div>
            )}

            {/* Total */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.75rem 0',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              marginBottom: '1.5rem',
              fontSize: '0.9rem'
            }}>
              <span style={{ color: 'var(--text-muted)' }}>
                Pago: {sale.paymentMethod === 'cash' ? 'Efectivo' : 'Transferencia'}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>TOTAL VENTA:</span>
                <strong style={{ fontSize: '1.15rem', color: 'var(--success)' }}>{formatMoney(sale.total)}</strong>
              </div>
            </div>

            {/* Botón de Acción Principal */}
            {!isCancelled && !isDelivered && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleConfirmDelivery}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  padding: '1rem',
                  fontSize: '1.1rem',
                  fontWeight: 'bold',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '0.6rem',
                  backgroundColor: '#10b981',
                  borderColor: '#10b981',
                  boxShadow: '0 4px 15px rgba(16, 185, 129, 0.35)'
                }}
              >
                {actionLoading ? (
                  <>
                    <RefreshCw size={20} className="animate-spin" /> Registrando...
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={22} /> Confirmar Entrega Segura
                  </>
                )}
              </button>
            )}

            {isDelivered && (
              <div style={{ display: 'flex', gap: '0.75rem', flexDirection: 'column' }}>
                <div style={{
                  padding: '0.75rem',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid #10b981',
                  borderRadius: '8px',
                  textAlign: 'center',
                  color: '#6ee7b7',
                  fontSize: '0.9rem',
                  fontWeight: 'bold'
                }}>
                  ✓ Entrega Registrada en el Sistema
                </div>

                <button
                  type="button"
                  onClick={() => setShowScanner(true)}
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    padding: '0.85rem',
                    fontSize: '1rem',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                >
                  <Camera size={18} /> Escanear Siguiente Ticket
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Modal de Escaneo con Cámara */}
      <QRScannerModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScanSuccess={handleScanSuccess}
      />
    </div>
  );
};

export default EventDelivery;

