import React from 'react';
import { createPortal } from 'react-dom';

const ThermalClosureReceipt = ({ event, stats, itemsSummary }) => {
  if (!event || !stats) return null;

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const receiptContent = (
    <div className="thermal-receipt closure-receipt" style={{ display: 'none' }}>
      <div style={{ textAlign: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: '0 0 5px 0', fontSize: '14px', textTransform: 'uppercase' }}>CIERRE DE EVENTO</h3>
        <h4 style={{ margin: '0 0 5px 0', fontSize: '12px' }}>{event.name}</h4>
        <p style={{ margin: '0', fontSize: '10px' }}>Fecha: {new Date(event.date).toLocaleDateString('es-CL')}</p>
        <p style={{ margin: '0', fontSize: '10px' }}>Impreso: {new Date().toLocaleString('es-CL')}</p>
      </div>

      <div style={{ borderTop: '1px dashed black', borderBottom: '1px dashed black', padding: '5px 0', margin: '10px 0', fontSize: '12px', fontFamily: 'monospace' }}>
        <div style={{ marginBottom: '5px', fontWeight: 'bold', textAlign: 'center' }}>RESUMEN FINANCIERO</div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Ingresos Cuotas:</span>
          <span>{formatMoney(stats.paidQuotas)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Ventas POS:</span>
          <span>{formatMoney(stats.salesTotal)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Gastos Registrados:</span>
          <span>- {formatMoney(stats.expensesTotal)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginTop: '5px', paddingTop: '5px', borderTop: '1px solid black' }}>
          <span>GANANCIA NETA:</span>
          <span>{formatMoney(stats.netProfit)}</span>
        </div>
      </div>

      <div style={{ fontSize: '12px', fontFamily: 'monospace', marginBottom: '10px' }}>
        <div style={{ fontWeight: 'bold', textAlign: 'center', marginBottom: '5px', borderBottom: '1px dashed black', paddingBottom: '3px' }}>DETALLE DE VENTAS (POS)</div>
        {itemsSummary && itemsSummary.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '10px' }}>
                <th style={{ width: '15%' }}>C</th>
                <th style={{ width: '50%' }}>Item</th>
                <th style={{ width: '35%', textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {itemsSummary.map((item, idx) => (
                <tr key={idx} style={{ fontSize: '11px' }}>
                  <td style={{ verticalAlign: 'top' }}>{item.qty}x</td>
                  <td style={{ wordBreak: 'break-word', paddingRight: '5px' }}>{item.name}</td>
                  <td style={{ textAlign: 'right' }}>{formatMoney(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ textAlign: 'center', fontSize: '10px' }}>No hay ventas registradas</div>
        )}
      </div>
      
      <div style={{ textAlign: 'center', marginTop: '15px', fontSize: '10px' }}>
        <p>Fin de reporte</p>
      </div>
      
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

export default ThermalClosureReceipt;
