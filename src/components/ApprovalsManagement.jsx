import React, { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { CheckCircle, XCircle, Clock, Check, X, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCourse } from '../context/CourseContext';
import { executeApproval, rejectApproval } from '../services/approvalService';
import { useModal } from '../context/ModalContext';

const ApprovalsManagement = ({ onBack }) => {
  const { user } = useAuth();
  const { selectedCourse } = useCourse();
  const { showAlert, showConfirm } = useModal();
  const [pendingActions, setPendingActions] = useState([]);
  const [historyActions, setHistoryActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending'); // pending, history
  const [processingId, setProcessingId] = useState(null);

  const fetchActions = async () => {
    if (!selectedCourse) return;
    setLoading(true);
    try {
      const qPending = query(
        collection(db, 'pending_actions'), 
        where('courseId', '==', selectedCourse.id),
        where('status', '==', 'pending')
      );
      const snapPending = await getDocs(qPending);
      const pActions = snapPending.docs.map(d => ({ id: d.id, ...d.data() }));
      
      const qHistory = query(
        collection(db, 'pending_actions'), 
        where('courseId', '==', selectedCourse.id),
        where('status', 'in', ['approved', 'rejected'])
      );
      const snapHistory = await getDocs(qHistory);
      const hActions = snapHistory.docs.map(d => ({ id: d.id, ...d.data() }));

      // Sort locally by date desc
      pActions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      hActions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      setPendingActions(pActions);
      setHistoryActions(hActions);
    } catch (error) {
      console.error("Error fetching approvals:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActions();
  }, [selectedCourse]);

  const handleApprove = async (action) => {
    if (!(await showConfirm('¿Estás seguro de aprobar esta solicitud?', 'Se ejecutarán los cambios permanentemente.'))) return;
    setProcessingId(action.id);
    const result = await executeApproval(action.id, action, user);
    setProcessingId(null);
    if (result.success) {
      await showAlert('Solicitud aprobada con éxito.');
      fetchActions();
    } else {
      await showAlert(`Error al aprobar: ${result.error}`);
    }
  };

  const handleReject = async (action) => {
    if (!(await showConfirm('¿Estás seguro de rechazar esta solicitud?'))) return;
    setProcessingId(action.id);
    await rejectApproval(action.id, user);
    setProcessingId(null);
    await showAlert('Solicitud rechazada.');
    fetchActions();
  };

  const getActionTypeLabel = (type) => {
    switch(type) {
      case 'CREATE_EXPENSE': return 'Creación de Cuota';
      case 'CREATE_OUTCOME': return 'Registro de Gasto/Egreso';
      case 'REGISTER_PAYMENTS': return 'Registro de Pago';
      default: return 'Acción Desconocida';
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: '1rem', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
          &larr;
        </button>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={24} style={{ color: 'var(--primary)' }} /> Bandeja de Aprobaciones
        </h3>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
        <button 
          className={`btn ${activeTab === 'pending' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveTab('pending')}
        >
          <Clock size={16} /> Pendientes ({pendingActions.length})
        </button>
        <button 
          className={`btn ${activeTab === 'history' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveTab('history')}
        >
          <FileText size={16} /> Historial
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Cargando solicitudes...</div>
      ) : activeTab === 'pending' ? (
        pendingActions.length === 0 ? (
          <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <CheckCircle size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
            <p>No hay aprobaciones pendientes en este momento.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {pendingActions.map(action => (
              <div key={action.id} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      {getActionTypeLabel(action.type)}
                    </span>
                    <h4 style={{ margin: '0.5rem 0', fontSize: '1.1rem' }}>{action.summary}</h4>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Solicitado por: <strong>{action.requestedByName}</strong> • {new Date(action.createdAt).toLocaleString('es-CL')}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      className="btn btn-outline" 
                      onClick={() => handleReject(action)}
                      disabled={processingId === action.id}
                      style={{ color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                    >
                      <X size={18} /> Rechazar
                    </button>
                    <button 
                      className="btn btn-primary" 
                      onClick={() => handleApprove(action)}
                      disabled={processingId === action.id}
                      style={{ backgroundColor: 'var(--success)', borderColor: 'var(--success)' }}
                    >
                      <Check size={18} /> Aprobar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        historyActions.length === 0 ? (
          <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p>No hay historial de aprobaciones.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {historyActions.map(action => (
              <div key={action.id} className="glass-panel" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    {getActionTypeLabel(action.type)}
                  </span>
                  <p style={{ margin: '0.2rem 0', fontWeight: '500' }}>{action.summary}</p>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Solicitado por {action.requestedByName} • Resuelto el {new Date(action.reviewedAt).toLocaleDateString('es-CL')}
                  </p>
                </div>
                <div>
                  {action.status === 'approved' ? (
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '1rem', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <CheckCircle size={14} /> Aprobado
                    </span>
                  ) : (
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <XCircle size={14} /> Rechazado
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
};

export default ApprovalsManagement;
