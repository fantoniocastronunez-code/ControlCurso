import React, { useState, useEffect } from 'react';
import { db } from '../../../firebase/config';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { DollarSign, Activity, FileText, Printer } from 'lucide-react';
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
      snapSales.forEach(d => {
        const data = d.data();
        salesT += data.total || 0;
        
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
      });
      
      const itemsList = Array.from(itemsMap.values()).sort((a,b) => b.total - a.total);
      setItemsSummary(itemsList);

      // 3. Expenses (outcomes)
      const qOutcomes = query(collection(db, 'outcomes'), where('fundId', '==', event.fundId));
      const snapOutcomes = await getDocs(qOutcomes);
      let expT = 0;
      snapOutcomes.forEach(d => {
        expT += d.data().amount || 0;
      });

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
      <ThermalClosureReceipt event={event} stats={stats} itemsSummary={itemsSummary} />
      
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.5rem' }}>
        <button 
          onClick={() => window.print()}
          className="btn btn-outline"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)', borderColor: 'var(--primary)' }}
        >
          <Printer size={18} /> Imprimir Cierre de Evento
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
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
    </div>
  );
};

export default EventSummary;
