import React from 'react';
import { createPortal } from 'react-dom';

const ThermalClosureReceipt = ({ event, stats, itemsSummary, expensesSummary, inventorySummary = [], cashiersSummary = [] }) => {
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

      {stats?.pettyCashData?.closingAudit ? (
        <div style={{ borderTop: '1px dashed black', borderBottom: '1px dashed black', padding: '5px 0', margin: '10px 0', fontSize: '12px', fontFamily: 'monospace' }}>
          <div style={{ marginBottom: '5px', fontWeight: 'bold', textAlign: 'center' }}>CUADRATURA FINAL DE EFECTIVO</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Total Contado en Gaveta:</span>
            <span>{formatMoney(stats.pettyCashData.closingAudit.finalCashCounted || 0)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>(-) Fondo Inicial:</span>
            <span>- {formatMoney(stats.pettyCashData.closingAudit.initialPettyCash || 0)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', borderTop: '1px dashed #666', marginTop: '2px', paddingTop: '2px' }}>
            <span>(=) Recaudación Neta Real:</span>
            <span>{formatMoney(stats.pettyCashData.closingAudit.netCashEarned || 0)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Ventas POS en Efectivo:</span>
            <span>{formatMoney(stats.pettyCashData.closingAudit.systemCashSales || 0)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginTop: '4px', paddingTop: '4px', borderTop: '1px solid black' }}>
            <span>
              {(stats.pettyCashData.closingAudit.difference || 0) === 0
                ? 'DIFERENCIA (CUADRADA):'
                : (stats.pettyCashData.closingAudit.difference || 0) > 0
                  ? 'SOBRANTE DE CAJA (+):'
                  : 'FALTANTE DE CAJA (-):'}
            </span>
            <span>
              {((stats.pettyCashData.closingAudit.difference || 0) > 0 ? '+' : '') +
                formatMoney(stats.pettyCashData.closingAudit.difference || 0)}
            </span>
          </div>
          {stats?.transferSalesTotal > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#333', marginTop: '3px' }}>
              <span>Ventas Transferencia:</span>
              <span>{formatMoney(stats.transferSalesTotal)}</span>
            </div>
          )}
        </div>
      ) : ((stats?.pettyCashTotal || 0) > 0 || (stats?.cashSalesTotal || 0) > 0) ? (
        <div style={{ borderTop: '1px dashed black', borderBottom: '1px dashed black', padding: '5px 0', margin: '10px 0', fontSize: '12px', fontFamily: 'monospace' }}>
          <div style={{ marginBottom: '5px', fontWeight: 'bold', textAlign: 'center' }}>CUADRATURA DE EFECTIVO</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Fondo Inicial (Caja Chica):</span>
            <span>{formatMoney(stats.pettyCashTotal || 0)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Ventas en Efectivo (+):</span>
            <span>{formatMoney(stats.cashSalesTotal || 0)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginTop: '4px', paddingTop: '4px', borderTop: '1px solid black' }}>
            <span>TOTAL EFECTIVO EN CAJA:</span>
            <span>{formatMoney((stats.pettyCashTotal || 0) + (stats.cashSalesTotal || 0))}</span>
          </div>
          {stats?.transferSalesTotal > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#333', marginTop: '3px' }}>
              <span>Ventas Transferencia:</span>
              <span>{formatMoney(stats.transferSalesTotal)}</span>
            </div>
          )}
        </div>
      ) : null}

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

      <div style={{ fontSize: '12px', fontFamily: 'monospace', marginBottom: '10px' }}>
        <div style={{ fontWeight: 'bold', textAlign: 'center', marginBottom: '5px', borderBottom: '1px dashed black', paddingBottom: '3px' }}>DETALLE DE GASTOS</div>
        {expensesSummary && expensesSummary.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '10px' }}>
                <th style={{ width: '65%' }}>Descripción</th>
                <th style={{ width: '35%', textAlign: 'right' }}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {expensesSummary.map((exp, idx) => (
                <tr key={idx} style={{ fontSize: '11px' }}>
                  <td style={{ wordBreak: 'break-word', paddingRight: '5px' }}>{exp.title}</td>
                  <td style={{ textAlign: 'right' }}>{formatMoney(exp.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ textAlign: 'center', fontSize: '10px' }}>No hay gastos registrados</div>
        )}
      </div>

      <div style={{ fontSize: '12px', fontFamily: 'monospace', marginBottom: '10px' }}>
        <div style={{ fontWeight: 'bold', textAlign: 'center', marginBottom: '5px', borderBottom: '1px dashed black', paddingBottom: '3px' }}>RENDICIÓN POR CAJERO</div>
        {cashiersSummary && cashiersSummary.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '10px' }}>
                <th style={{ width: '50%' }}>Cajero</th>
                <th style={{ width: '18%', textAlign: 'center' }}>Vtas</th>
                <th style={{ width: '32%', textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {cashiersSummary.map((c, idx) => (
                <tr key={idx} style={{ fontSize: '11px' }}>
                  <td style={{ wordBreak: 'break-word', paddingRight: '3px' }}>{c.name}</td>
                  <td style={{ textAlign: 'center' }}>{c.salesCount}</td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatMoney(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ textAlign: 'center', fontSize: '10px' }}>Sin ventas registradas</div>
        )}
      </div>

      <div style={{ fontSize: '12px', fontFamily: 'monospace', marginBottom: '10px' }}>
        <div style={{ fontWeight: 'bold', textAlign: 'center', marginBottom: '5px', borderBottom: '1px dashed black', paddingBottom: '3px' }}>INVENTARIO Y SOBRANTES</div>
        {inventorySummary && inventorySummary.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '10px' }}>
                <th style={{ width: '45%' }}>Insumo</th>
                <th style={{ width: '25%', textAlign: 'center' }}>Vend.</th>
                <th style={{ width: '30%', textAlign: 'right' }}>Sobrante</th>
              </tr>
            </thead>
            <tbody>
              {inventorySummary.map((inv, idx) => {
                const purchased = inv.totalPurchased || inv.initialQuantity || 0;
                const current = inv.currentStock !== undefined ? inv.currentStock : purchased;
                const consumed = Math.max(0, purchased - current);
                const remaining = inv.finalCount !== undefined && inv.finalCount !== null ? inv.finalCount : current;
                return (
                  <tr key={idx} style={{ fontSize: '11px' }}>
                    <td style={{ wordBreak: 'break-word', paddingRight: '3px' }}>{inv.name}</td>
                    <td style={{ textAlign: 'center' }}>{consumed}</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{remaining} {inv.unit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ textAlign: 'center', fontSize: '10px' }}>Sin insumos registrados</div>
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
