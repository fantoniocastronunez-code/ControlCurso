import React from 'react';
import { X, ArrowDownRight, ArrowUpRight, DollarSign, Activity } from 'lucide-react';

const formatMoney = (amount) => {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
};

const FundHistoryModal = ({ fund, transactions, onClose }) => {
  if (!fund) return null;

  // Filtrar transacciones para este fondo
  let fundTransactions = [];
  if (fund.id === 'cash_history') {
    fundTransactions = transactions.filter(t => t.paymentMethod === 'cash');
  } else if (fund.id === 'transfer_history') {
    fundTransactions = transactions.filter(t => t.paymentMethod === 'transfer');
  } else if (fund.id === 'favor_balance') {
    // Para el fondo virtual "Saldos a favor", evitamos mostrar transacciones regulares si no tienen detalle.
    // Usaremos el panel personalizado para mostrar los saldos de cada alumno.
    fundTransactions = transactions.filter(t => t.fundId === fund.id);
  } else {
    fundTransactions = transactions.filter(t => t.fundId === fund.id);
  }
  
  // Ordenar de más reciente a más antiguo
  fundTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(5px)' }}>
      <div className="modal-content animate-fade-in" onClick={e => e.stopPropagation()} style={{ width: '90%', maxWidth: '600px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        
        {/* Header */}
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Historial: {fund.name}</h3>
            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Saldo actual: <strong style={{ color: fund.balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatMoney(fund.balance)}</strong>
            </p>
          </div>
          <button onClick={onClose} className="btn btn-outline" style={{ border: 'none', padding: '0.5rem' }}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          {fund.id === 'favor_balance' ? (
            fund.studentsWithBalance && fund.studentsWithBalance.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <p style={{ color: 'var(--text-muted)', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                  Alumnos con saldo a favor disponible:
                </p>
                {fund.studentsWithBalance.map((student, idx) => (
                  <div key={idx} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between', 
                    padding: '1rem', 
                    backgroundColor: 'rgba(255,255,255,0.03)', 
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ 
                        width: '40px', height: '40px', 
                        borderRadius: '50%', 
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backgroundColor: 'rgba(16, 185, 129, 0.15)',
                        color: 'var(--success)'
                      }}>
                        <DollarSign size={20} />
                      </div>
                      <div>
                        <p style={{ margin: 0, fontWeight: '500', color: 'var(--text-primary)' }}>{student.name}</p>
                      </div>
                    </div>
                    <div style={{ fontWeight: '600', color: 'var(--success)' }}>
                      {formatMoney(student.balance)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>
                No hay alumnos con saldo a favor.
              </div>
            )
          ) : fundTransactions.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>
              No hay movimientos registrados en este fondo.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {fundTransactions.map((tx, idx) => {
                const isPositive = tx.amount > 0;
                
                return (
                  <div key={`${tx.id}-${idx}`} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between', 
                    padding: '1rem', 
                    backgroundColor: 'rgba(255,255,255,0.03)', 
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ 
                        width: '40px', height: '40px', 
                        borderRadius: '50%', 
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backgroundColor: isPositive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: isPositive ? 'var(--success)' : 'var(--danger)'
                      }}>
                        {isPositive ? <ArrowDownRight size={20} /> : <ArrowUpRight size={20} />}
                      </div>
                      
                      <div>
                        <p style={{ margin: 0, fontWeight: '500', color: 'var(--text-primary)' }}>{tx.description}</p>
                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {new Date(tx.date).toLocaleDateString('es-CL', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    
                    <div style={{ fontWeight: '600', color: isPositive ? 'var(--success)' : 'var(--danger)' }}>
                      {isPositive ? '+' : ''}{formatMoney(tx.amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FundHistoryModal;
