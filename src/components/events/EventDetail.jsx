import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase/config';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ArrowLeft, LayoutDashboard, CheckSquare, ShoppingBag, DollarSign, Receipt, Package, Printer, Sparkles, RotateCcw, Settings, ChefHat, Camera, Calculator, FileText, Edit, Calendar, X, Check, CheckCircle } from 'lucide-react';
import EventSummary from './tabs/EventSummary';
import EventAttendance from './tabs/EventAttendance';
import EventInventory from './tabs/EventInventory';
import EventMenu from './tabs/EventMenu';
import EventPOS from './tabs/EventPOS';
import EventReconciliation from './tabs/EventReconciliation';
import EventExpenses from './tabs/EventExpenses';
import ThermalReceipt from './tabs/ThermalReceipt';
import PrinterSettingsModal from './PrinterSettingsModal';
import ComandasQRModal from './ComandasQRModal';
import QRScannerModal from './QRScannerModal';
import EventReportModal from './EventReportModal';
import { useModal } from '../../context/ModalContext';
import { useAuth } from '../../context/AuthContext';
import { loadDemoEventData, resetTestEventData } from '../../utils/eventTestUtils';
import {
  getPrinterConfig,
  buildTestReceiptPayload,
  printViaRawBT,
  printViaWebBluetooth
} from '../../utils/thermalPrinterService';
import { formatEventDate } from '../../utils/eventPdfService';
import { checkEventClosureReadiness } from '../../utils/eventClosureValidation';

const EventDetail = ({ eventId, onBack }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showAlert, showConfirm } = useModal();
  const [eventData, setEventData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('summary'); // summary, inventory, menu, pos, expenses, attendance
  const [testSaleToPrint, setTestSaleToPrint] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showPrinterModal, setShowPrinterModal] = useState(false);
  const [showComandasModal, setShowComandasModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editMandatoryAmount, setEditMandatoryAmount] = useState('');
  const [editNoShowAmount, setEditNoShowAmount] = useState('');

  const handleOpenEditModal = () => {
    setEditName(eventData?.name || '');
    setEditDate(eventData?.date || '');
    setEditMandatoryAmount(String(eventData?.mandatoryAmount ?? ''));
    setEditNoShowAmount(String(eventData?.noShowAmount ?? ''));
    setShowEditModal(true);
  };

  const handleSaveEditEvent = async (e) => {
    e.preventDefault();
    if (!editName.trim() || !editDate) {
      await showAlert("Por favor ingresa nombre y fecha.");
      return;
    }
    setActionLoading(true);
    try {
      const updatedFields = {
        name: editName.trim(),
        date: editDate,
        mandatoryAmount: parseFloat(editMandatoryAmount) || 0,
        noShowAmount: parseFloat(editNoShowAmount) || 0,
        updatedAt: new Date().toISOString()
      };
      await updateDoc(doc(db, 'events', eventData.id), updatedFields);

      try {
        await updateDoc(doc(db, 'expenses', `exp_evt_${eventData.id}`), {
          title: `Cuota Obligatoria: ${editName.trim()}`,
          date: editDate
        });
      } catch {
        // Ignorar si no existe
      }

      setEventData(prev => ({ ...prev, ...updatedFields }));
      setShowEditModal(false);
      await showAlert("Evento y fecha actualizados correctamente.");
    } catch (err) {
      console.error("Error al actualizar evento:", err);
      await showAlert("Error al actualizar el evento: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleScanSuccess = (decodedText) => {
    setShowScanner(false);
    let cleanId = decodedText.trim();
    if (cleanId.includes('/entrega/')) {
      cleanId = cleanId.split('/entrega/')[1].split('?')[0].split('#')[0].trim();
    }
    cleanId = cleanId.replace('#', '').trim();
    navigate(`/entrega/${cleanId}`);
  };

  const handleToggleCompleted = async () => {
    if (!eventData) return;
    const isCurrentlyDone = Boolean(eventData.isCompleted || eventData.status === 'completed');
    const willBeDone = !isCurrentlyDone;

    // Si ya está terminado y se desea reabrir a En Curso:
    if (!willBeDone) {
      if (!(await showConfirm(`¿Deseas reabrir el evento "${eventData.name}" y dejarlo en estado Activo / En Curso?`))) return;
      try {
        const updateData = {
          isCompleted: false,
          status: 'active',
          reopenedAt: new Date().toISOString()
        };
        await updateDoc(doc(db, 'events', eventData.id), updateData);
        setEventData(prev => ({ ...prev, ...updateData }));
        await showAlert('Evento reabierto a estado En Curso.');
      } catch (err) {
        console.error("Error al reabrir evento:", err);
        await showAlert("Error al actualizar el estado del evento.");
      }
      return;
    }

    // SI SE DESEA CERRAR: VALIDACIÓN ESTRICTA DE CUADRATURA Y CUOTAS
    const validation = await checkEventClosureReadiness(eventData);
    if (!validation.canClose) {
      await showAlert(
        `AVISO: NO SE PUEDE CERRAR EL EVENTO\n\n` +
        `El evento "${eventData.name}" aún no cumple los requisitos para ser marcado como "Terminado y Cuadrado":\n\n` +
        validation.blockingReasons.map((r, i) => `• ${r}`).join('\n\n') +
        `\n\nRequisitos para cerrarlo:\n` +
        `• Recaudar y dejar al día las cuotas obligatorias pendientes.\n` +
        `• Realizar el arqueo de cierre de caja en la pestaña "Arqueo" o "Caja POS" asegurando que la diferencia sea exactamente $0.`
      );
      return;
    }

    const confirmMsg = `¿Confirmas marcar el evento "${eventData.name}" como TERMINADO Y CUADRADO?\n\n` +
      `• Cuotas obligatorias: 100% al día.\n` +
      `• Caja del evento: Cuadrada ($0 de diferencia).\n\n` +
      `Esto dejará constancia oficial del cierre y cuadratura del evento.`;

    if (!(await showConfirm(confirmMsg))) return;

    try {
      const updateData = {
        isCompleted: true,
        status: 'completed',
        completedAt: new Date().toISOString(),
        completedBy: user?.displayName || user?.email || 'Admin'
      };

      await updateDoc(doc(db, 'events', eventData.id), updateData);
      setEventData(prev => ({ ...prev, ...updateData }));
      await showAlert('Evento marcado como TERMINADO Y CUADRADO con éxito.');
    } catch (err) {
      console.error("Error al actualizar estado del evento:", err);
      await showAlert("Error al actualizar el estado del evento.");
    }
  };

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

  const handlePrintTestTicket = async () => {
    const printMode = getPrinterConfig();
    const cashier = user?.displayName || user?.email?.split('@')[0] || 'Cajero de Prueba';
    if (printMode === 'rawbt') {
      printViaRawBT(buildTestReceiptPayload(eventData.name, cashier));
    } else if (printMode === 'bluetooth') {
      try {
        await printViaWebBluetooth(buildTestReceiptPayload(eventData.name, cashier));
        await showAlert('¡Ticket de prueba enviado por Bluetooth!');
      } catch (err) {
        console.warn("Fallo bluetooth directo:", err);
        setTestSaleToPrint({
          isTestTicket: true,
          correlative: 'PRUEBA',
          createdAt: new Date().toISOString(),
          cashierName: cashier,
          total: 0,
          items: []
        });
        setTimeout(() => window.print(), 250);
      }
    } else {
      setTestSaleToPrint({
        isTestTicket: true,
        correlative: 'PRUEBA',
        createdAt: new Date().toISOString(),
        cashierName: cashier,
        total: 0,
        items: []
      });
      setTimeout(() => {
        window.print();
      }, 250);
    }
  };

  const handleLoadDemo = async () => {
    if (!(await showConfirm('¿Deseas precargar insumos y menú de prueba (Completos, Panes, Vienesas y Bebidas)?'))) return;
    setActionLoading(true);
    try {
      await loadDemoEventData(eventId, eventData.courseId, user);
      await showAlert('¡Datos de prueba cargados con éxito! Ahora puedes ir al Punto de Venta o Inventario.');
      setActiveTab('pos');
    } catch (err) {
      console.error(err);
      await showAlert('Error al cargar datos de prueba: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetTest = async () => {
    if (!(await showConfirm('¿Estás seguro de reiniciar los datos de prueba? Esto limpiará las ventas emitidas y restaurará el stock inicial de los insumos.'))) return;
    setActionLoading(true);
    try {
      await resetTestEventData(eventId);
      await showAlert('Prueba reiniciada con éxito. Stock restablecido y ventas limpiadas.');
      window.location.reload();
    } catch (err) {
      console.error(err);
      await showAlert('Error al reiniciar prueba: ' + err.message);
    } finally {
      setActionLoading(false);
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
    { id: 'inventory', label: 'Inventario / Stock', icon: <Package size={16} /> },
    { id: 'menu', label: 'Menú / Ítems', icon: <ShoppingBag size={16} /> },
    { id: 'pos', label: 'Punto de Venta', icon: <Receipt size={16} /> },
    { id: 'reconciliation', label: 'Cuadrar Caja', icon: <Calculator size={16} /> },
    { id: 'expenses', label: 'Gastos', icon: <DollarSign size={16} /> },
    { id: 'attendance', label: 'Asistencia', icon: <CheckSquare size={16} /> }
  ];

  return (
    <div className="animate-fade-in">
      {/* Impresión de ticket de prueba */}
      <ThermalReceipt sale={testSaleToPrint} eventName={eventData.name} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, minWidth: '240px' }}>
          <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 style={{ margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              {eventData.name}
              {eventData.isTestEvent && (
                <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', backgroundColor: 'var(--warning)', color: '#000', borderRadius: 'var(--radius-sm)', fontWeight: 'bold' }}>
                  MODO PRUEBA
                </span>
              )}
              {(eventData.isCompleted || eventData.status === 'completed') ? (
                <span style={{
                  fontSize: '0.75rem',
                  padding: '0.2rem 0.65rem',
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  color: 'var(--success)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: 'var(--radius-sm)',
                  fontWeight: '600',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}>
                  <CheckCircle size={14} /> Terminado y Cuadrado
                </span>
              ) : (
                <span style={{
                  fontSize: '0.72rem',
                  padding: '0.15rem 0.5rem',
                  backgroundColor: 'rgba(37, 99, 235, 0.1)',
                  color: '#93c5fd',
                  border: '1px solid rgba(37, 99, 235, 0.25)',
                  borderRadius: 'var(--radius-sm)',
                  fontWeight: '600'
                }}>
                  En Curso
                </span>
              )}
            </h2>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: '500', color: 'var(--text)' }}>{formatEventDate(eventData.date)}</span>
                <span>•</span>
                <span>Cuota: ${eventData.mandatoryAmount}</span>
                <span>•</span>
                <span>Multa: ${eventData.noShowAmount}</span>
                <button
                  type="button"
                  onClick={handleOpenEditModal}
                  className="btn btn-outline"
                  style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', borderColor: 'var(--border-color)' }}
                  title="Editar fecha y datos del evento"
                >
                  <Edit size={12} /> Editar Fecha
                </button>
              </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleToggleCompleted}
            className="btn btn-outline"
            style={{
              fontSize: '0.85rem',
              padding: '0.45rem 0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              borderColor: (eventData.isCompleted || eventData.status === 'completed') ? 'var(--success)' : 'rgba(16, 185, 129, 0.5)',
              color: (eventData.isCompleted || eventData.status === 'completed') ? 'var(--success)' : '#6ee7b7',
              backgroundColor: (eventData.isCompleted || eventData.status === 'completed') ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
              fontWeight: '600'
            }}
            title={(eventData.isCompleted || eventData.status === 'completed') ? "Clic para reabrir el evento" : "Marcar que este evento está terminado y su caja cuadrada"}
          >
            <CheckCircle size={16} />
            <span>{(eventData.isCompleted || eventData.status === 'completed') ? 'Terminado y Cuadrado' : 'Marcar Terminado y Cuadrado'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowReportModal(true)}
            className="btn btn-primary"
            style={{ fontSize: '0.85rem', padding: '0.45rem 0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: '600' }}
            title="Generar y descargar informe financiero completo del evento"
          >
            <FileText size={16} /> Informe de Evento
          </button>

          <button
            type="button"
            onClick={() => setShowComandasModal(true)}
            className="btn btn-outline"
            style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
            title="Abrir código QR para pantalla de comandas y cocina"
          >
            <ChefHat size={16} /> Comandas Cocina (QR)
          </button>
        </div>
      </div>

      {/* Banner de Modo Prueba */}
      {eventData.isTestEvent && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          backgroundColor: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.25)',
          padding: '0.85rem 1.25rem',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.5rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--warning)',
              fontSize: '0.75rem',
              fontWeight: '700'
            }}>
              DEMO
            </div>
            <div>
              <strong style={{ color: 'var(--warning)', display: 'block', fontSize: '0.95rem' }}>
                Modo Prueba Activo (Simulación de Evento)
              </strong>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Usa este espacio para probar ventas en el POS, descuento de insumos (panes/vienesas), imprimir en impresora térmica y cerrar caja.
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handlePrintTestTicket}
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', borderColor: 'var(--warning)', color: 'var(--warning)' }}
              title="Mandar ticket de prueba a la impresora térmica"
            >
              <Printer size={14} /> Probar Impresora
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={handleLoadDemo}
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              title="Cargar insumos y menú de completos automáticamente"
            >
              <Sparkles size={14} /> Cargar Datos Demo (Completos)
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={handleResetTest}
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', borderColor: 'rgba(239, 68, 68, 0.4)', color: 'var(--danger)' }}
              title="Limpiar ventas de prueba y restablecer stock inicial"
            >
              <RotateCcw size={14} /> Reiniciar Prueba
            </button>
            <button
              type="button"
              onClick={() => setShowPrinterModal(true)}
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              title="Ajustes de Impresión Térmica (Automático Android RawBT, Bluetooth, Navegador)"
            >
              <Settings size={14} /> Configurar Impresora
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div
        className="event-tabs-bar"
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '2rem',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '0.85rem',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-x pan-y',
          maxWidth: '100%',
          width: '100%'
        }}
      >
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-outline'}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              borderColor: activeTab === tab.id ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
              backgroundColor: activeTab === tab.id ? 'var(--primary)' : 'transparent',
              color: activeTab === tab.id ? '#fff' : 'var(--text-muted)',
              flexShrink: 0,
              whiteSpace: 'nowrap'
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'summary' && <EventSummary event={eventData} onNavigateTab={setActiveTab} />}
        {activeTab === 'inventory' && <EventInventory event={eventData} />}
        {activeTab === 'menu' && <EventMenu event={eventData} />}
        {activeTab === 'pos' && <EventPOS event={eventData} onNavigateTab={setActiveTab} />}
        {activeTab === 'reconciliation' && <EventReconciliation event={eventData} onNavigateTab={setActiveTab} />}
        {activeTab === 'expenses' && <EventExpenses event={eventData} />}
        {activeTab === 'attendance' && <EventAttendance event={eventData} />}
      </div>

      {/* Modal de Configuración de Impresora */}
      <PrinterSettingsModal
        isOpen={showPrinterModal}
        onClose={() => setShowPrinterModal(false)}
        eventName={eventData.name}
      />

      {/* Modal de Código QR para Pantalla de Comandas / Cocina */}
      <ComandasQRModal
        isOpen={showComandasModal}
        onClose={() => setShowComandasModal(false)}
        eventId={eventData.id}
        eventName={eventData.name}
      />

      {/* Modal de Informe Completo del Evento */}
      <EventReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        event={eventData}
      />

      {/* Modal para Editar Datos y Fecha del Evento */}
      {showEditModal && (
        <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000, padding: '1rem' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '480px', padding: '1.5rem', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={20} color="var(--primary)" /> Editar Evento y Fecha
              </h3>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveEditEvent}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  Nombre del Evento:
                </label>
                <input
                  type="text"
                  className="input-field"
                  style={{ width: '100%' }}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  Fecha del Evento:
                </label>
                <input
                  type="date"
                  className="input-field"
                  style={{ width: '100%' }}
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  required
                />
                <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block', marginTop: '0.25rem' }}>
                  Formato de fecha (ej: 30/10/2026). Cambiar la fecha aquí actualizará todos los reportes, PDFs y tickets.
                </small>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                    Cuota Obligatoria ($):
                  </label>
                  <input
                    type="number"
                    min="0"
                    className="input-field"
                    style={{ width: '100%' }}
                    value={editMandatoryAmount}
                    onChange={(e) => setEditMandatoryAmount(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                    Multa Inasistencia ($):
                  </label>
                  <input
                    type="number"
                    min="0"
                    className="input-field"
                    style={{ width: '100%' }}
                    value={editNoShowAmount}
                    onChange={(e) => setEditNoShowAmount(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowEditModal(false)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={actionLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  {actionLoading ? 'Guardando...' : <><Check size={16} /> Guardar Cambios</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default EventDetail;
