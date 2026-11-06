import React, { useState } from 'react';
import { X, ArrowDownRight, ArrowUpRight, DollarSign, Download, MinusCircle } from 'lucide-react';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import DiscountBalanceModal from './DiscountBalanceModal';

const formatMoney = (amount) => {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
};

const FundHistoryModal = ({ fund, transactions, onClose, onRefresh }) => {
  const [discountStudent, setDiscountStudent] = useState(null);
  useLockBodyScroll(!!fund);

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

  // Ordenar de más reciente a más antiguo por defecto para la vista
  fundTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  const handleDownloadExcel = () => {
    // Extraer alumno y motivo para poder ordenar como solicitó el usuario
    const parsedTransactions = fundTransactions.map(tx => {
      let alumno = "-";
      let motivo = tx.description;

      const match = tx.description.match(/Pago(?: de (.*?))?:\s*(.*)/);
      if (match) {
        alumno = match[1] ? match[1].trim() : "-";
        motivo = match[2].trim();
      }
      return { ...tx, alumno, motivo };
    });

    // Ordenar por alumno, motivo y monto
    parsedTransactions.sort((a, b) => {
      if (a.alumno !== b.alumno) return a.alumno.localeCompare(b.alumno);
      if (a.motivo !== b.motivo) return a.motivo.localeCompare(b.motivo);
      return b.amount - a.amount; // de mayor a menor monto
    });

    let csvContent = '\uFEFF'; // BOM para que Excel detecte UTF-8 y muestre tildes
    csvContent += "Fecha,Alumno,Motivo,Tipo,Monto\n";

    parsedTransactions.forEach(tx => {
      const date = new Date(tx.date).toLocaleDateString('es-CL', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const alumno = `"${tx.alumno.replace(/"/g, '""')}"`;
      const motivo = `"${tx.motivo.replace(/"/g, '""')}"`;
      const tipo = tx.amount >= 0 ? 'Ingreso' : 'Egreso';
      const monto = tx.amount;
      csvContent += `${date},${alumno},${motivo},${tipo},${monto}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Detalle_${fund.name.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', padding: '1rem 0.5rem 2rem', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div className="modal-content animate-fade-in" onClick={e => e.stopPropagation()} style={{ width: '90%', maxWidth: '600px', maxHeight: '85vh', marginTop: '1rem', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-card)' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.15rem', fontWeight: '600' }}>Historial: {fund.name}</h3>
            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Saldo actual: <strong style={{ color: fund.balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatMoney(fund.balance)}</strong>
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleDownloadExcel} className="btn btn-outline" style={{ padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.825rem' }} title="Descargar ordenado por alumno a Excel">
              <Download size={15} />
              <span>Descargar Excel</span>
            </button>
            <button onClick={onClose} className="btn btn-outline" style={{ padding: '0.4rem 0.5rem', color: 'var(--text-muted)' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
          {fund.id === 'favor_balance' ? (
            fund.studentsWithBalance && fund.studentsWithBalance.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <p style={{ color: 'var(--text-muted)', marginBottom: '0.25rem', fontSize: '0.85rem' }}>
                  Alumnos con saldo a favor disponible:
                </p>
                {fund.studentsWithBalance.map((student, idx) => (
                  <div key={idx} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.85rem 1rem',
                    backgroundColor: 'var(--bg-card-hover)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                      <div style={{
                        width: '36px', height: '36px', minWidth: '36px',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--success)'
                      }}>
                        <DollarSign size={18} />
                      </div>
                      <div>
                        <p style={{ margin: 0, fontWeight: '500', color: 'var(--text-main)', fontSize: '0.9rem' }}>{student.name}</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ fontWeight: '600', color: 'var(--success)' }}>
                        {formatMoney(student.balance)}
                      </div>
                      {student.id && student.balance > 0 && (
                        <button
                          type="button"
                          onClick={() => setDiscountStudent(student)}
                          className="btn btn-outline"
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.75rem',
                            color: '#f59e0b',
                            borderColor: 'rgba(245, 158, 11, 0.4)',
                            backgroundColor: 'rgba(245, 158, 11, 0.08)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            borderRadius: 'var(--radius-sm)'
                          }}
                          title="Descontar una parte o la totalidad de este saldo a favor"
                        >
                          <MinusCircle size={12} /> Descontar
                        </button>
                      )}
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
                    padding: '0.85rem 1rem',
                    backgroundColor: 'var(--bg-card-hover)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                      <div style={{
                        width: '36px', height: '36px', minWidth: '36px',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        color: isPositive ? 'var(--success)' : 'var(--danger)'
                      }}>
                        {isPositive ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
                      </div>

                      <div>
                        <p style={{ margin: 0, fontWeight: '500', color: 'var(--text-main)', fontSize: '0.9rem' }}>{tx.description}</p>
                        <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
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

      {discountStudent && (
        <DiscountBalanceModal
          student={discountStudent}
          onClose={() => setDiscountStudent(null)}
          onSuccess={(newBalance, deductedAmt) => {
            discountStudent.balance = newBalance;
            fund.balance = Math.max(0, (fund.balance || 0) - deductedAmt);
            if (onRefresh) onRefresh();
          }}
        />
      )}
    </div>
  );
};

export default FundHistoryModal;
