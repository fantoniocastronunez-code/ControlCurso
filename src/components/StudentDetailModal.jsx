import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { 
  X, User, AlertCircle, CheckCircle, Clock, Download, 
  DollarSign, Sparkles, CreditCard, Eye, FileText, AlertTriangle 
} from 'lucide-react';
import { formatStudentName } from '../utils/nameUtils';
import { useModal } from '../context/ModalContext';
import html2canvas from 'html2canvas';

const StudentDetailModal = ({ student, usersMap = {}, onClose, isModal = false }) => {
  const { showAlert } = useModal();
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [previewReceipt, setPreviewReceipt] = useState(null);
  const detailRef = useRef(null);

  useEffect(() => {
    if (student?.id) {
      fetchDebts();
    }
  }, [student?.id]);

  const fetchDebts = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'debts'), where('studentId', '==', student.id));
      const snap = await getDocs(q);
      const fetchedDebts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Sort: Pending/Review/Partial first, then by date descending
      fetchedDebts.sort((a, b) => {
        const order = { pending: 1, partial: 2, review: 3, paid: 4 };
        const orderA = order[a.status] || 5;
        const orderB = order[b.status] || 5;
        if (orderA !== orderB) return orderA - orderB;
        return new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0);
      });

      // Hide 'partial' debts ONLY if a '(Saldo Restante)' debt was manually created for THIS SPECIFIC debt title
      const filteredDebts = fetchedDebts.filter(d => {
        if (d.status === 'partial') {
          const baseTitle = d.title.trim();
          const hasSpecificSaldoRestante = fetchedDebts.some(other => 
            other.title.includes('(Saldo Restante)') && other.title.includes(baseTitle)
          );
          if (hasSpecificSaldoRestante) return false;
        }
        return true;
      });

      setDebts(filteredDebts);
    } catch (error) {
      console.error("Error fetching debts:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
  };

  const pendingDebts = debts.filter(d => d.status === 'pending' || d.status === 'review' || d.status === 'partial');
  const paidDebts = debts.filter(d => d.status === 'paid');

  // Calculations
  const totalPaid = debts.reduce((sum, d) => {
    if (d.status === 'paid') {
      return sum + (typeof d.paidAmount === 'number' ? d.paidAmount : (d.amount || 0));
    }
    if (d.status === 'partial') {
      return sum + (d.paidAmount || 0);
    }
    return sum;
  }, 0);

  const totalPending = debts.reduce((sum, d) => {
    if (d.status === 'pending' || d.status === 'review') {
      return sum + (d.amount || 0);
    }
    if (d.status === 'partial') {
      return sum + Math.max(0, (d.amount || 0) - (d.paidAmount || 0));
    }
    return sum;
  }, 0);

  const emails = student.apoderadoEmails || (student.apoderadoEmail ? [student.apoderadoEmail] : []);

  const handleShare = async () => {
    setSharing(true);
    setIsCapturing(true);

    // Damos un breve tiempo para que React re-renderice quitando el scroll
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      if (!detailRef.current) return;
      
      // Ocultar botones temporalmente para la captura limpia
      const actionsDiv = document.getElementById(`actions-${student.id}`);
      if (actionsDiv) actionsDiv.style.display = 'none';

      const canvas = await html2canvas(detailRef.current, {
        backgroundColor: '#0f172a', // Fondo dark elegante
        scale: 2,
        windowHeight: detailRef.current.scrollHeight // Asegura la altura total
      });
      
      if (actionsDiv) actionsDiv.style.display = 'flex';

      const image = canvas.toDataURL("image/png");
      const res = await fetch(image);
      const blob = await res.blob();
      const safeName = (student.name || 'alumno').replace(/[^a-zA-Z0-9]/g, '_');
      const file = new File([blob], `historial_${safeName}.png`, { type: 'image/png' });

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

      if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Historial de ${formatStudentName(student)}`,
          text: `Detalle completo de pagos y estado de cuenta de ${formatStudentName(student)}.`
        });
      } else {
        const link = document.createElement('a');
        link.href = image;
        link.download = `historial_${safeName}.png`;
        link.click();
        await showAlert("Ficha descargada exitosamente.");
      }
      if (actionsDiv) actionsDiv.style.display = 'flex';
    } catch (error) {
      console.error("Error al generar imagen:", error);
      await showAlert("Hubo un error al generar la imagen de la ficha.");
    } finally {
      setIsCapturing(false);
      setSharing(false);
    }
  };

  const content = (
    <div 
      ref={detailRef} 
      className="glass-panel animate-fade-in" 
      style={{ 
        width: '100%', 
        maxWidth: isModal ? '850px' : '100%',
        padding: '1.75rem', 
        backgroundColor: 'var(--bg-main)',
        border: '1px solid rgba(99, 102, 241, 0.3)',
        boxShadow: isModal ? '0 25px 50px -12px rgba(0, 0, 0, 0.6)' : 'none',
        position: 'relative'
      }}
    >
      {/* Header Ficha */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
            <span style={{ 
              fontSize: '0.8rem', 
              fontWeight: '700', 
              padding: '0.2rem 0.6rem', 
              borderRadius: '6px', 
              backgroundColor: 'rgba(99, 102, 241, 0.2)',
              color: 'var(--primary)'
            }}>
              N° {student.listNumber || '-'}
            </span>
            <h2 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.4rem' }}>
              {formatStudentName(student)}
            </h2>
          </div>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            {student.rut ? `RUT: ${student.rut}` : 'Sin RUT registrado'}
          </p>
        </div>

        <div id={`actions-${student.id}`} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button 
            onClick={handleShare} 
            disabled={sharing} 
            className="btn btn-outline" 
            style={{ padding: '0.5rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderColor: '#25D366', color: '#25D366' }}
            title="Descargar o compartir comprobante por WhatsApp"
          >
            <Download size={16} /> {sharing ? 'Generando...' : 'Compartir / Guardar'}
          </button>
          <button 
            onClick={onClose} 
            className="btn btn-outline" 
            style={{ padding: '0.5rem', borderRadius: '50%', minWidth: '36px', height: '36px' }} 
            title="Cerrar Ficha"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* KPI Financial Summary Cards */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', 
        gap: '0.75rem', 
        marginBottom: '1.5rem' 
      }}>
        {/* Total Pagado */}
        <div style={{ padding: '1rem', backgroundColor: 'rgba(16, 185, 129, 0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
          <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <CheckCircle size={14} style={{ color: 'var(--success)' }} /> Total Pagado
          </p>
          <h3 style={{ margin: 0, color: 'var(--success)', fontSize: '1.25rem' }}>{formatMoney(totalPaid)}</h3>
        </div>

        {/* Total Pendiente */}
        <div style={{ padding: '1rem', backgroundColor: totalPending > 0 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: totalPending > 0 ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid var(--border-color)' }}>
          <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <AlertCircle size={14} style={{ color: totalPending > 0 ? 'var(--danger)' : 'var(--text-muted)' }} /> Por Pagar / Pendiente
          </p>
          <h3 style={{ margin: 0, color: totalPending > 0 ? 'var(--danger)' : 'var(--text-main)', fontSize: '1.25rem' }}>
            {formatMoney(totalPending)}
          </h3>
        </div>

        {/* Saldo a Favor */}
        <div style={{ padding: '1rem', backgroundColor: (student.balance || 0) > 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: (student.balance || 0) > 0 ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border-color)' }}>
          <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Sparkles size={14} style={{ color: 'var(--success)' }} /> Saldo a Favor
          </p>
          <h3 style={{ margin: 0, color: (student.balance || 0) > 0 ? 'var(--success)' : 'var(--text-muted)', fontSize: '1.25rem' }}>
            {formatMoney(student.balance || 0)}
          </h3>
        </div>

        {/* Cuotas Registradas */}
        <div style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <FileText size={14} /> Total Cuotas
          </p>
          <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.25rem' }}>
            {debts.length}
          </h3>
        </div>
      </div>

      {/* Sección Apoderados */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--text-muted)' }}>
          <User size={16} /> Apoderados Vinculados
        </h4>
        {emails.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem' }}>No hay apoderados vinculados a este alumno.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {emails.map((email, idx) => {
              const apName = usersMap[email.toLowerCase()] || usersMap[email];
              return (
                <div key={idx} style={{ padding: '0.75rem 1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                  <p style={{ fontWeight: '600', margin: '0 0 0.15rem 0', fontSize: '0.95rem', color: 'var(--text-main)' }}>
                    {apName || 'Nombre no registrado'}
                  </p>
                  <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8rem' }}>{email}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Grid: Por Pagar vs Pagados */}
      <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        
        {/* Deudas Pendientes / Por Pagar */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h4 style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '1rem' }}>
            <AlertCircle size={18} /> Por Pagar / En Revisión ({pendingDebts.length})
          </h4>
          
          {loading ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando cuotas...</p>
          ) : pendingDebts.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', backgroundColor: 'rgba(16, 185, 129, 0.04)', borderRadius: 'var(--radius-md)', border: '1px dashed rgba(16, 185, 129, 0.3)', color: 'var(--success)' }}>
              <CheckCircle size={24} style={{ margin: '0 auto 0.5rem auto' }} />
              <p style={{ margin: 0, fontWeight: '500' }}>¡Al día!</p>
              <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.8 }}>No tiene cuotas pendientes por pagar.</p>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem', maxHeight: (isModal && !isCapturing) ? '350px' : 'none', overflowY: (isModal && !isCapturing) ? 'auto' : 'visible' }}>
              {pendingDebts.map(d => {
                const isPartial = d.status === 'partial';
                const isReview = d.status === 'review';
                const debtAmount = d.amount || 0;
                const paidAmount = d.paidAmount || 0;
                const remaining = isPartial ? Math.max(0, debtAmount - paidAmount) : debtAmount;

                return (
                  <li 
                    key={d.id} 
                    style={{ 
                      padding: '0.85rem 1rem', 
                      backgroundColor: 'rgba(255,255,255,0.02)', 
                      borderRadius: 'var(--radius-sm)', 
                      borderLeft: `4px solid ${isReview ? 'var(--warning)' : isPartial ? '#f59e0b' : 'var(--danger)'}`,
                      border: '1px solid var(--border-color)',
                      borderLeftWidth: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.35rem', gap: '0.5rem' }}>
                      <span style={{ fontWeight: '600', color: 'var(--text-main)', fontSize: '0.95rem' }}>{d.title}</span>
                      <span style={{ fontWeight: '700', color: 'var(--danger)', fontSize: '1rem', whiteSpace: 'nowrap' }}>
                        {formatMoney(remaining)}
                      </span>
                    </div>

                    {isPartial && (
                      <div style={{ fontSize: '0.8rem', color: '#f59e0b', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <AlertTriangle size={13} />
                        Pago parcial: {formatMoney(paidAmount)} pagados de {formatMoney(debtAmount)}
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span>Emitido: {d.date || (d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '-')}</span>
                      
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        {isReview && (
                          <span style={{ color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontWeight: '500' }}>
                            <Clock size={13} /> En Revisión
                          </span>
                        )}

                        {d.receiptUrl && (
                          <button
                            onClick={() => setPreviewReceipt(d.receiptUrl)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--primary)',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              fontSize: '0.8rem',
                              padding: 0
                            }}
                          >
                            <Eye size={13} /> Ver Comprobante
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Historial de Pagos Realizados */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h4 style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '1rem' }}>
            <CheckCircle size={18} /> Pagos Realizados ({paidDebts.length})
          </h4>
          
          {loading ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando historial...</p>
          ) : paidDebts.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-color)', color: 'var(--text-muted)' }}>
              <p style={{ margin: 0 }}>No tiene pagos registrados todavía.</p>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem', maxHeight: (isModal && !isCapturing) ? '350px' : 'none', overflowY: (isModal && !isCapturing) ? 'auto' : 'visible' }}>
              {paidDebts.map(d => {
                const methodLabel = d.paymentMethod === 'transfer' ? 'Transferencia' : d.paymentMethod === 'cash' ? 'Efectivo' : d.paymentMethod === 'balance' ? 'Saldo a Favor' : 'Pagado';
                const paidDate = d.paidAt ? new Date(d.paidAt).toLocaleDateString() : d.date || '-';
                
                return (
                  <li 
                    key={d.id} 
                    style={{ 
                      padding: '0.85rem 1rem', 
                      backgroundColor: 'rgba(255,255,255,0.02)', 
                      borderRadius: 'var(--radius-sm)', 
                      borderLeft: '4px solid var(--success)',
                      border: '1px solid var(--border-color)',
                      borderLeftWidth: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.35rem', gap: '0.5rem' }}>
                      <span style={{ fontWeight: '600', color: 'var(--text-main)', fontSize: '0.95rem' }}>{d.title}</span>
                      <span style={{ fontWeight: '700', color: 'var(--success)', fontSize: '1rem', whiteSpace: 'nowrap' }}>
                        {formatMoney(d.paidAmount || d.amount)}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span>Fecha pago: {paidDate}</span>
                      
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span style={{ 
                          fontSize: '0.75rem', 
                          padding: '0.15rem 0.5rem', 
                          borderRadius: '12px', 
                          backgroundColor: 'rgba(16, 185, 129, 0.1)', 
                          color: 'var(--success)',
                          border: '1px solid rgba(16, 185, 129, 0.2)'
                        }}>
                          {methodLabel}
                        </span>

                        {d.receiptUrl && (
                          <button
                            onClick={() => setPreviewReceipt(d.receiptUrl)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--primary)',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              fontSize: '0.8rem',
                              padding: 0
                            }}
                          >
                            <Eye size={13} /> Ver Comprobante
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Lightbox Comprobante */}
      {previewReceipt && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            zIndex: 1100,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '1rem'
          }}
          onClick={() => setPreviewReceipt(null)}
        >
          <div 
            style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewReceipt(null)}
              style={{
                position: 'absolute',
                top: '-2.5rem',
                right: 0,
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <X size={18} />
            </button>
            <img 
              src={previewReceipt} 
              alt="Comprobante de pago" 
              style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: '8px', objectFit: 'contain' }} 
            />
          </div>
        </div>
      )}
    </div>
  );

  if (isModal) {
    return (
      <div 
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 1000,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '1rem',
          overflowY: 'auto'
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div style={{ marginTop: '2rem', marginBottom: '2rem', width: '100%', maxWidth: '850px' }}>
          {content}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '1rem', borderTop: 'none', borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(0,0,0,0.2)' }}>
      {content}
    </div>
  );
};

export default StudentDetailModal;
