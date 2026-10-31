import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { ArrowLeft, LayoutDashboard, CheckSquare, ShoppingBag, DollarSign, Receipt, Package, Printer, Sparkles, RotateCcw, Settings, ChefHat, Camera, Calculator, FileText } from 'lucide-react';
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

  const handleScanSuccess = (decodedText) => {
    setShowScanner(false);
    let cleanId = decodedText.trim();
    if (cleanId.includes('/entrega/')) {
      cleanId = cleanId.split('/entrega/')[1].split('?')[0].split('#')[0].trim();
    }
    cleanId = cleanId.replace('#', '').trim();
    navigate(`/entrega/${cleanId}`);
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
            <h2 style={{ margin: 0, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              {eventData.name}
              {eventData.isTestEvent && (
                <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.65rem', backgroundColor: 'var(--warning)', color: '#000', borderRadius: '1rem', fontWeight: 'bold' }}>
                  🧪 MODO PRUEBA
                </span>
              )}
            </h2>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {new Date(eventData.date).toLocaleDateString('es-CL')} • Cuota: ${eventData.mandatoryAmount} • Multa: ${eventData.noShowAmount}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setShowReportModal(true)}
            className="btn btn-primary"
            style={{ fontSize: '0.85rem', padding: '0.45rem 0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: '#6366f1', borderColor: '#6366f1', color: '#fff', fontWeight: 'bold' }}
            title="Generar y descargar informe financiero completo del evento"
          >
            <FileText size={16} /> Informe de Evento
          </button>

          <button
            type="button"
            onClick={() => setShowComandasModal(true)}
            className="btn btn-outline"
            style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', borderColor: '#f59e0b', color: '#f59e0b' }}
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
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.35)',
          padding: '0.85rem 1.25rem',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.5rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.5rem' }}>🧪</span>
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
    </div>
  );
};

export default EventDetail;
