import React from 'react';
import { createPortal } from 'react-dom';

// Este componente solo es visible cuando se invoca la impresión (@media print en CSS global)
// Está pensado para impresoras térmicas (POS) de 58mm.
const ThermalReceipt = ({ sale, eventName }) => {
  if (!sale) return null;

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const receiptContent = (
    <div className="thermal-receipt" style={{ display: 'none' }}>
      {sale.isTestTicket ? (
        <div style={{ textAlign: 'center', marginBottom: '10px' }}>
          <h3 style={{ margin: '0 0 5px 0', fontSize: '14px', textTransform: 'uppercase' }}>*** TEST DE IMPRESORA ***</h3>
          <h4 style={{ margin: '0 0 5px 0', fontSize: '12px' }}>{eventName}</h4>
          <p style={{ margin: '0', fontSize: '10px', color: '#555' }}>MODO PRUEBA / ENSAYO</p>
          <p style={{ margin: '0', fontSize: '10px' }}>Fecha: {new Date().toLocaleString('es-CL')}</p>
          <p style={{ margin: '0', fontSize: '10px' }}>Cajero/a: {sale.cashierName || 'Cajero de Prueba'}</p>

          <div style={{ borderTop: '1px dashed black', borderBottom: '1px dashed black', padding: '6px 0', margin: '8px 0', fontSize: '11px', textAlign: 'left', fontFamily: 'monospace' }}>
            <p style={{ margin: '2px 0' }}>✓ Formato POS Térmico 58mm</p>
            <p style={{ margin: '2px 0' }}>✓ Impresora conectada y lista</p>
            <p style={{ margin: '2px 0' }}>✓ Test números: $1.000 / $25.990</p>
            <p style={{ margin: '2px 0' }}>✓ Test acentos: á, é, í, ó, ú, ñ</p>
          </div>

          <div style={{ fontSize: '12px', fontWeight: 'bold', margin: '8px 0' }}>
            ¡IMPRESIÓN CORRECTA!
          </div>
          <p style={{ margin: '0', fontSize: '9px', fontStyle: 'italic' }}>Este ticket es solo para probar la impresora</p>
        </div>
      ) : (
        <>
          <div style={{ textAlign: 'center', marginBottom: '10px' }}>
            <h3 style={{ margin: '0 0 5px 0', fontSize: '14px' }}>{eventName}</h3>
            <p style={{ margin: '0', fontSize: '12px' }}>Ticket #{sale.correlative}</p>
            <p style={{ margin: '0', fontSize: '12px' }}>{new Date(sale.createdAt).toLocaleString('es-CL')}</p>
          </div>

          <div style={{ borderTop: '1px dashed black', borderBottom: '1px dashed black', padding: '5px 0', margin: '10px 0', fontSize: '12px', fontFamily: 'monospace' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ width: '15%' }}>C</th>
                  <th style={{ width: '50%' }}>Item</th>
                  <th style={{ width: '35%', textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((item, idx) => (
                  <React.Fragment key={idx}>
                    <tr>
                      <td style={{ verticalAlign: 'top' }}>{item.quantity}x</td>
                      <td style={{ wordBreak: 'break-word', paddingRight: '4px' }}>{item.name}</td>
                      <td style={{ textAlign: 'right', verticalAlign: 'top' }}>{formatMoney(item.price * item.quantity)}</td>
                    </tr>
                    {item.selectedSubproducts && item.selectedSubproducts.length > 0 && (
                      item.selectedSubproducts.map((sp, spIdx) => (
                        <tr key={`sp-${spIdx}`}>
                          <td></td>
                          <td style={{ paddingLeft: '8px', fontSize: '10px', wordBreak: 'break-word', paddingRight: '4px' }}>+ {sp.name}</td>
                          <td style={{ textAlign: 'right', fontSize: '10px', verticalAlign: 'top' }}>{formatMoney(sp.price * item.quantity)}</td>
                        </tr>
                      ))
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ textAlign: 'right', fontSize: '14px', fontWeight: 'bold' }}>
            TOTAL: {formatMoney(sale.total)}
          </div>
          
          <div style={{ marginTop: '10px', fontSize: '12px', textAlign: 'center' }}>
            <p style={{ margin: '0' }}>Pago: {sale.paymentMethod === 'cash' ? 'Efectivo' : 'Transferencia'}</p>
            <p style={{ margin: '5px 0 0 0' }}>Cliente: {sale.clientName || 'Cliente General'}</p>
            {sale.cashierName && (
              <p style={{ margin: '5px 0 0 0' }}>Cajero/a: {sale.cashierName}</p>
            )}
            {sale.saleNote && (
              <p style={{ margin: '5px 0 0 0', fontWeight: 'bold' }}>Nota: {sale.saleNote}</p>
            )}
          </div>
          
          <div style={{ textAlign: 'center', marginTop: '15px', fontSize: '12px' }}>
            <p>¡Gracias por su colaboración!</p>
          </div>
        </>
      )}
      
      {/* Estilos para impresión */}
      <style>{`
        @media print {
          body > *:not(.thermal-receipt) {
            display: none !important;
          }
          .thermal-receipt {
            display: block !important;
            width: 58mm; /* Standard POS printer width */
            padding: 0 0 15mm 0;
            margin: 0;
            color: black;
            background: white;
            font-family: monospace;
          }
          @page {
            margin: 0;
            size: 58mm auto;
          }
        }
      `}</style>
    </div>
  );

  return createPortal(receiptContent, document.body);
};

export default ThermalReceipt;
