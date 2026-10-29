import React, { useState } from 'react';
import { 
  Printer, Smartphone, Bluetooth, Monitor, CheckCircle, 
  ExternalLink, X, HelpCircle, AlertCircle, RefreshCw 
} from 'lucide-react';
import { 
  getPrinterConfig, setPrinterConfig, isAndroid,
  getPaperWidth, setPaperWidth,
  connectWebBluetooth, disconnectWebBluetooth, getConnectedBluetoothDevice,
  printViaRawBT, printViaWebBluetooth, buildTestReceiptPayload 
} from '../../utils/thermalPrinterService';
import { useModal } from '../../context/ModalContext';

const PrinterSettingsModal = ({ isOpen, onClose, eventName }) => {
  const { showAlert } = useModal();
  const [selectedMode, setSelectedMode] = useState(getPrinterConfig());
  const [paperWidth, setPaperWidthState] = useState(getPaperWidth());
  const [bleDeviceName, setBleDeviceName] = useState(getConnectedBluetoothDevice());
  const [connectingBle, setConnectingBle] = useState(false);

  if (!isOpen) return null;

  const handleSaveMode = (mode) => {
    setSelectedMode(mode);
    setPrinterConfig(mode);
  };

  const handleSavePaperWidth = (width) => {
    setPaperWidthState(width);
    setPaperWidth(width);
  };

  const handleConnectBle = async () => {
    setConnectingBle(true);
    try {
      const name = await connectWebBluetooth();
      setBleDeviceName(name);
      handleSaveMode('bluetooth');
      await showAlert(`¡Conectado exitosamente a "${name}"!`);
    } catch (err) {
      console.error(err);
      if (err.name !== 'NotFoundError') {
        await showAlert('No se pudo conectar: ' + err.message);
      }
    } finally {
      setConnectingBle(false);
    }
  };

  const handleDisconnectBle = () => {
    disconnectWebBluetooth();
    setBleDeviceName(null);
    showAlert('Impresora Bluetooth desconectada.');
  };

  const handleTestPrint = async (modeToTest) => {
    const payload = buildTestReceiptPayload(eventName || 'APPCURSO POS', 'Test de Impresora');
    
    if (modeToTest === 'rawbt') {
      try {
        printViaRawBT(payload);
      } catch (err) {
        await showAlert('Error al enviar a RawBT: ' + err.message);
      }
    } else if (modeToTest === 'bluetooth') {
      try {
        await printViaWebBluetooth(payload);
        await showAlert('¡Ticket de prueba enviado por Bluetooth!');
      } catch (err) {
        await showAlert('Error en Bluetooth: ' + err.message);
      }
    } else {
      window.print();
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem'
    }}>
      <div style={{
        backgroundColor: '#1e293b',
        color: '#f8fafc',
        borderRadius: 'var(--radius-lg, 12px)',
        width: '100%',
        maxWidth: '560px',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        border: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Printer size={20} color="var(--primary, #6366f1)" />
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#fff' }}>
              Configuración de Impresión Térmica (POS)
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted, #94a3b8)',
              cursor: 'pointer',
              padding: '0.25rem'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.5rem' }}>
          <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.9rem', color: '#94a3b8' }}>
            Selecciona el método de impresión para los recibos y cierres de caja:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Opción 1: RawBT (Automático Android) */}
            <div 
              onClick={() => handleSaveMode('rawbt')}
              style={{
                border: selectedMode === 'rawbt' ? '2px solid var(--primary, #6366f1)' : '1px solid rgba(255, 255, 255, 0.1)',
                backgroundColor: selectedMode === 'rawbt' ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                borderRadius: '10px',
                padding: '1rem',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Smartphone size={20} color={selectedMode === 'rawbt' ? '#818cf8' : '#94a3b8'} />
                  <strong style={{ fontSize: '1rem', color: '#fff' }}>Automático Android (RawBT)</strong>
                </div>
                <span style={{
                  fontSize: '0.75rem',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(16, 185, 129, 0.2)',
                  color: '#34d399',
                  fontWeight: 'bold'
                }}>
                  Recomendado para Android
                </span>
              </div>

              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.82rem', color: '#cbd5e1' }}>
                <strong>¡Sin ventana de Android!</strong> Envía la orden directamente a tu impresora térmica Bluetooth o USB en menos de 1 segundo.
              </p>

              {selectedMode === 'rawbt' && (
                <div style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.25)',
                  borderRadius: '8px',
                  padding: '0.85rem',
                  marginTop: '0.5rem',
                  fontSize: '0.8rem',
                  color: '#94a3b8',
                  lineHeight: '1.4'
                }}>
                  <div style={{ color: '#e2e8f0', fontWeight: 'bold', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <HelpCircle size={14} color="#818cf8" /> Pasos para impresión 100% automática:
                  </div>
                  <ol style={{ margin: '0 0 0.75rem 1.2rem', padding: 0 }}>
                    <li>Instala la app gratuita <strong>RawBT Print Service</strong> en tu Android.</li>
                    <li>Abre RawBT, selecciona tu impresora Bluetooth y vincúlala.</li>
                    <li>En <strong>Ajustes de RawBT</strong>, activa <strong>"Impresión automática"</strong> y <strong>"Cerrar tras imprimir"</strong>.</li>
                  </ol>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <a
                      href="https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-outline"
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.35rem 0.65rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        borderColor: '#818cf8',
                        color: '#818cf8',
                        textDecoration: 'none'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink size={13} /> Abrir RawBT en Google Play
                    </a>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTestPrint('rawbt');
                      }}
                      className="btn btn-primary"
                      style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <Printer size={13} /> Probar Ticket en RawBT
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Opción 2: Web Bluetooth Directo */}
            <div 
              onClick={() => handleSaveMode('bluetooth')}
              style={{
                border: selectedMode === 'bluetooth' ? '2px solid var(--primary, #6366f1)' : '1px solid rgba(255, 255, 255, 0.1)',
                backgroundColor: selectedMode === 'bluetooth' ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                borderRadius: '10px',
                padding: '1rem',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Bluetooth size={20} color={selectedMode === 'bluetooth' ? '#818cf8' : '#94a3b8'} />
                  <strong style={{ fontSize: '1rem', color: '#fff' }}>Bluetooth Directo Web (BLE)</strong>
                </div>
                {bleDeviceName && (
                  <span style={{
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    color: '#60a5fa',
                    fontWeight: 'bold'
                  }}>
                    Conectado
                  </span>
                )}
              </div>

              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.82rem', color: '#cbd5e1' }}>
                Conexión directa desde Google Chrome a impresoras con Bluetooth Low Energy (4.0+), sin instalar ninguna aplicación adicional.
              </p>

              {selectedMode === 'bluetooth' && (
                <div style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.25)',
                  borderRadius: '8px',
                  padding: '0.85rem',
                  marginTop: '0.5rem',
                  fontSize: '0.8rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Dispositivo: </span>
                      <strong style={{ color: bleDeviceName ? '#34d399' : '#f87171' }}>
                        {bleDeviceName ? bleDeviceName : 'No conectado'}
                      </strong>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {bleDeviceName ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDisconnectBle();
                          }}
                          className="btn btn-outline"
                          style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderColor: '#f87171', color: '#f87171' }}
                        >
                          Desconectar
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={connectingBle}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleConnectBle();
                          }}
                          className="btn btn-primary"
                          style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                        >
                          {connectingBle ? <RefreshCw size={13} className="spin" /> : <Bluetooth size={13} />}
                          Vincular Impresora
                        </button>
                      )}

                      {bleDeviceName && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTestPrint('bluetooth');
                          }}
                          className="btn btn-outline"
                          style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                        >
                          Probar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Opción 3: Diálogo del Navegador (window.print) */}
            <div 
              onClick={() => handleSaveMode('system')}
              style={{
                border: selectedMode === 'system' ? '2px solid var(--primary, #6366f1)' : '1px solid rgba(255, 255, 255, 0.1)',
                backgroundColor: selectedMode === 'system' ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                borderRadius: '10px',
                padding: '1rem',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Monitor size={20} color={selectedMode === 'system' ? '#818cf8' : '#94a3b8'} />
                  <strong style={{ fontSize: '1rem', color: '#fff' }}>Diálogo del Sistema (window.print)</strong>
                </div>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>PC / Mac</span>
              </div>

              <p style={{ margin: 0, fontSize: '0.82rem', color: '#cbd5e1' }}>
                Abre la vista previa de impresión clásica de tu computador o celular.
              </p>
            </div>

            {/* Ancho del Papel / Columnas para Impresión Térmica */}
            {(selectedMode === 'rawbt' || selectedMode === 'bluetooth') && (
              <div style={{
                marginTop: '0.5rem',
                padding: '1rem',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '10px',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f8fafc' }}>
                    Ancho de Línea (Caracteres por Fila)
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                    {paperWidth} columnas
                  </span>
                </div>
                <p style={{ margin: '0 0 0.8rem 0', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.4 }}>
                  Las impresoras portátiles de 58mm suelen imprimir 28 caracteres por línea. Si es de 32 o de 80mm, puedes ajustarlo aquí.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => handleSavePaperWidth(28)}
                    style={{
                      padding: '0.5rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      border: paperWidth === 28 ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.1)',
                      backgroundColor: paperWidth === 28 ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.05)',
                      color: paperWidth === 28 ? '#a5b4fc' : '#cbd5e1',
                      cursor: 'pointer'
                    }}
                  >
                    28 col (58mm Ideal)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSavePaperWidth(32)}
                    style={{
                      padding: '0.5rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      border: paperWidth === 32 ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.1)',
                      backgroundColor: paperWidth === 32 ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.05)',
                      color: paperWidth === 32 ? '#a5b4fc' : '#cbd5e1',
                      cursor: 'pointer'
                    }}
                  >
                    32 col (58mm)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSavePaperWidth(42)}
                    style={{
                      padding: '0.5rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      border: paperWidth === 42 ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.1)',
                      backgroundColor: paperWidth === 42 ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.05)',
                      color: paperWidth === 42 ? '#a5b4fc' : '#cbd5e1',
                      cursor: 'pointer'
                    }}
                  >
                    42 col (80mm)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.75rem'
        }}>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-primary"
            style={{ padding: '0.5rem 1.25rem', fontSize: '0.9rem' }}
          >
            Guardar y Listo
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrinterSettingsModal;

