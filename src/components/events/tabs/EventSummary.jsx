import React, { useState, useEffect } from 'react';
import { db } from '../../../firebase/config';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { DollarSign, Activity, FileText, Printer, Package, UserCheck, Users } from 'lucide-react';
import ThermalClosureReceipt from './ThermalClosureReceipt';

const EventSummary = ({ event }) => {
  const [stats, setStats] = useState({
    totalQuotas: 0,
    paidQuotas: 0,
    salesTotal: 0,
    expensesTotal: 0,
    netProfit: 0
  });
  const [itemsSummary, setItemsSummary] = useState([]);
  const [expensesSummary, setExpensesSummary] = useState([]);
  const [inventorySummary, setInventorySummary] = useState([]);
  const [cashiersSummary, setCashiersSummary] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, [event.id]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      // 1. Quotas (debts)
      const qDebts = query(collection(db, 'debts'), where('eventId', '==', event.id));
      const snapDebts = await getDocs(qDebts);
      let totalQ = 0;
      let paidQ = 0;
      snapDebts.forEach(d => {
        const data = d.data();
        totalQ += data.amount || 0;
        paidQ += data.paidAmount || 0;
      });

      // 2. Sales
      const qSales = query(collection(db, 'eventSales'), where('eventId', '==', event.id));
      const snapSales = await getDocs(qSales);
      let salesT = 0;
      const itemsMap = new Map();
      const cashiersMap = new Map();

      snapSales.forEach(d => {
        const data = d.data();
        if (data.status === 'cancelled' || data.status === 'anulada') return;
        salesT += data.total || 0;
        
        // Items global summary
        if (data.items && Array.isArray(data.items)) {
          data.items.forEach(item => {
            let name = item.name;
            if (item.selectedSubproducts && item.selectedSubproducts.length > 0) {
              const spNames = item.selectedSubproducts.map(sp => sp.name).join(', ');
              name = `${item.name} (+${spNames})`;
            }
            
            if (!itemsMap.has(name)) {
              itemsMap.set(name, { name, qty: 0, total: 0 });
            }
            const current = itemsMap.get(name);
            current.qty += item.quantity || 1;
            const itemTotal = (item.unitPrice || item.price || 0) * (item.quantity || 1);
            current.total += itemTotal;
          });
        }

        // Cashiers summary (quien vendió qué cosas)
        const cashierName = (data.cashierName || data.createdBy || 'Cajero General').trim();
        if (!cashiersMap.has(cashierName)) {
          cashiersMap.set(cashierName, {
            name: cashierName,
            salesCount: 0,
            cashTotal: 0,
            transferTotal: 0,
            total: 0,
            productsMap: new Map()
          });
        }
        const cEntry = cashiersMap.get(cashierName);
        cEntry.salesCount += 1;
        cEntry.total += data.total || 0;
        if (data.paymentMethod === 'cash') {
          cEntry.cashTotal += data.total || 0;
        } else {
          cEntry.transferTotal += data.total || 0;
        }

        if (data.items && Array.isArray(data.items)) {
          data.items.forEach(item => {
            const pName = item.name;
            const pQty = item.quantity || 1;
            cEntry.productsMap.set(pName, (cEntry.productsMap.get(pName) || 0) + pQty);
          });
        }
      });
      
      const itemsList = Array.from(itemsMap.values()).sort((a,b) => b.total - a.total);
      setItemsSummary(itemsList);

      const cashiersList = Array.from(cashiersMap.values()).map(c => ({
        ...c,
        productsList: Array.from(c.productsMap.entries()).map(([name, qty]) => ({ name, qty }))
      })).sort((a, b) => b.total - a.total);
      setCashiersSummary(cashiersList);

      // 3. Expenses (outcomes)
      const qOutcomes = query(collection(db, 'outcomes'), where('fundId', '==', event.fundId));
      const snapOutcomes = await getDocs(qOutcomes);
      let expT = 0;
      const expensesList = [];
      snapOutcomes.forEach(d => {
        const data = d.data();
        expT += data.amount || 0;
        expensesList.push({
          title: data.title,
          amount: data.amount
        });
      });
      setExpensesSummary(expensesList);

      // 4. Inventory & Leftovers
      const qInv = query(collection(db, 'eventInventory'), where('eventId', '==', event.id));
      const snapInv = await getDocs(qInv);
      const invList = snapInv.docs.map(d => ({ id: d.id, ...d.data() }));
      invList.sort((a, b) => a.name.localeCompare(b.name));
      setInventorySummary(invList);

      setStats({
        totalQuotas: totalQ,
        paidQuotas: paidQ,
        salesTotal: salesT,
        expensesTotal: expT,
        netProfit: paidQ + salesT - expT
      });

    } catch (error) {
      console.error("Error fetching event stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  if (loading) return <div>Cargando resumen...</div>;

  return (
    <div style={{ position: 'relative' }}>
      <ThermalClosureReceipt 
        event={event} 
        stats={stats} 
        itemsSummary={itemsSummary} 
        expensesSummary={expensesSummary} 
        inventorySummary={inventorySummary}
        cashiersSummary={cashiersSummary}
      />
      
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.5rem' }}>
        <button 
          onClick={() => window.print()}
          className="btn btn-outline"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)', borderColor: 'var(--primary)' }}
        >
          <Printer size={18} /> Imprimir Cierre de Evento
        </button>
      </div>

      {/* Tarjetas Financieras */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: 'rgba(59,130,246,0.2)', padding: '1rem', borderRadius: '50%', color: '#3b82f6' }}>
            <FileText size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', margin: 0 }}>{formatMoney(stats.paidQuotas)}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Recaudado por Cuotas</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--warning)', margin: 0 }}>De {formatMoney(stats.totalQuotas)} esperados</p>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--success)' }}>
            <Activity size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', margin: 0 }}>{formatMoney(stats.salesTotal)}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Total en Ventas POS</p>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: 'rgba(239,68,68,0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--danger)' }}>
            <DollarSign size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', margin: 0 }}>{formatMoney(stats.expensesTotal)}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Gastos Registrados</p>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', backgroundColor: stats.netProfit >= 0 ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)', border: `1px solid ${stats.netProfit >= 0 ? 'var(--success)' : 'var(--danger)'}` }}>
          <div>
            <h3 style={{ fontSize: '1.5rem', margin: 0, color: stats.netProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {formatMoney(stats.netProfit)}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', fontWeight: 'bold' }}>Ganancia Neta (Fondo)</p>
          </div>
        </div>
      </div>

      {/* Sección Rendición y Ventas por Cajero */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={20} /> Rendición y Control de Ventas por Cajero(a)
        </h3>
        
        {cashiersSummary.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
            No hay ventas registradas por cajeros aún.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem 0.5rem' }}>Cajero(a)</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Ventas</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>Efectivo</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>Transferencia</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>Total Recaudado</th>
                  <th style={{ padding: '0.65rem 0.5rem' }}>Productos que vendió</th>
                </tr>
              </thead>
              <tbody>
                {cashiersSummary.map((c, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <UserCheck size={16} color="var(--primary)" />
                        <strong style={{ fontSize: '0.95rem' }}>{c.name}</strong>
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                      <span style={{ fontWeight: '500' }}>{c.salesCount}</span>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                      {formatMoney(c.cashTotal)}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                      {formatMoney(c.transferTotal)}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                      <strong style={{ color: 'var(--success)', fontSize: '0.95rem' }}>{formatMoney(c.total)}</strong>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                        {c.productsList.map((p, pIdx) => (
                          <span 
                            key={pIdx}
                            style={{ 
                              fontSize: '0.75rem', 
                              backgroundColor: 'rgba(99,102,241,0.1)', 
                              border: '1px solid rgba(99,102,241,0.2)',
                              padding: '0.15rem 0.45rem',
                              borderRadius: '12px',
                              color: 'var(--text-main)'
                            }}
                          >
                            <strong>{p.qty}x</strong> {p.name}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sección Balance de Inventario y Sobrantes */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Package size={20} /> Balance de Inventario y Sobrantes del Evento
        </h3>
        
        {inventorySummary.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
            No se registraron insumos en el inventario para este evento.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem 0.5rem' }}>Insumo</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Total Comprado</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Consumido (POS)</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Stock Teórico Restante</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Sobrante Real (Físico)</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Diferencia / Merma</th>
                </tr>
              </thead>
              <tbody>
                {inventorySummary.map(item => {
                  const purchased = item.totalPurchased || item.initialQuantity || 0;
                  const current = item.currentStock !== undefined ? item.currentStock : purchased;
                  const consumed = Math.max(0, purchased - current);
                  const hasPhysical = item.finalCount !== undefined && item.finalCount !== null;
                  const diff = hasPhysical ? (item.finalCount - current) : null;

                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '0.65rem 0.5rem' }}>
                        <strong>{item.name}</strong>
                      </td>
                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        {purchased} {item.unit}
                      </td>
                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        {consumed} {item.unit}
                      </td>
                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                        <strong style={{ color: 'var(--primary)' }}>{current} {item.unit}</strong>
                      </td>
                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                        {hasPhysical ? (
                          <strong style={{ color: 'var(--text-main)' }}>{item.finalCount} {item.unit}</strong>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>
                            (Ver pestaña Inventario)
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                        {!hasPhysical ? (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                        ) : diff === 0 ? (
                          <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>✓ Exacto</span>
                        ) : diff < 0 ? (
                          <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>Merma: {diff} {item.unit}</span>
                        ) : (
                          <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>+{diff} {item.unit}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default EventSummary;
