import React from 'react';
import { formatStudentName } from '../../../utils/nameUtils';

// Este componente solo es visible cuando se invoca la impresión (@media print en CSS global)
// Está pensado para impresoras térmicas (POS) de 58mm.
const ThermalReceipt = ({ sale, eventName }) => {
  if (!sale) return null;

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const padRight = (str, len) => (str + ' '.repeat(len)).substring(0, len);
  const padLeft = (str, len) => (' '.repeat(len) + str).slice(-len);

  return (
    <div className="thermal-receipt" style={{ display: 'none' }}>
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
                  <td>{item.name.substring(0, 15)}</td>
                  <td style={{ textAlign: 'right', verticalAlign: 'top' }}>{formatMoney(item.price * item.quantity)}</td>
                </tr>
                {item.selectedSubproducts && item.selectedSubproducts.length > 0 && (
                  item.selectedSubproducts.map((sp, spIdx) => (
                    <tr key={`sp-${spIdx}`}>
                      <td></td>
                      <td style={{ paddingLeft: '8px', fontSize: '10px' }}>+ {sp.name.substring(0, 13)}</td>
                      <td style={{ textAlign: 'right', fontSize: '10px' }}>{formatMoney(sp.price * item.quantity)}</td>
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
        {sale.saleNote && (
          <p style={{ margin: '5px 0 0 0', fontWeight: 'bold' }}>Nota: {sale.saleNote}</p>
        )}
      </div>
      
      <div style={{ textAlign: 'center', marginTop: '15px', fontSize: '12px' }}>
        <p>¡Gracias por su colaboración!</p>
      </div>
      
      {/* Estilos para impresión */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .thermal-receipt, .thermal-receipt * {
            visibility: visible;
          }
          .thermal-receipt {
            display: block !important;
            position: absolute;
            left: 0;
            top: 0;
            width: 58mm; /* Standard POS printer width */
            padding: 0;
            margin: 0;
            color: black;
            background: white;
            font-family: monospace;
          }
        }
      `}</style>
    </div>
  );
};

export default ThermalReceipt;
