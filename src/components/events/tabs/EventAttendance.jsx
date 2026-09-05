import React, { useState, useEffect } from 'react';
import { db } from '../../../firebase/config';
import { collection, getDocs, query, where, doc, updateDoc } from 'firebase/firestore';
import { CheckSquare, Square, Search } from 'lucide-react';
import { useModal } from '../../../context/ModalContext';

const EventAttendance = ({ event }) => {
  const { showAlert } = useModal();
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchDebts();
  }, [event.id]);

  const fetchDebts = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'debts'), where('eventId', '==', event.id));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.studentName.localeCompare(b.studentName));
      setDebts(list);
    } catch (error) {
      console.error("Error fetching attendance:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleAttendance = async (debt) => {
    // Si attended es false o undefined, significa que asistió originalmente (por defecto todos asisten al crearlo)
    // Usaremos un flag explícito 'notAttended' para saber si se le aplicó la multa.
    const isCurrentlyNotAttended = debt.notAttended === true;
    const willBeNotAttended = !isCurrentlyNotAttended;
    
    const newAmount = willBeNotAttended ? event.noShowAmount : event.mandatoryAmount;
    const newTitle = willBeNotAttended 
      ? `Multa Inasistencia: ${event.name}` 
      : `Cuota Obligatoria: ${event.name}`;

    try {
      await updateDoc(doc(db, 'debts', debt.id), {
        notAttended: willBeNotAttended,
        amount: newAmount,
        title: newTitle
      });

      setDebts(prev => prev.map(d => 
        d.id === debt.id 
          ? { ...d, notAttended: willBeNotAttended, amount: newAmount, title: newTitle } 
          : d
      ));
    } catch (error) {
      console.error("Error toggling attendance:", error);
      showAlert("Error al actualizar la asistencia.");
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const filteredDebts = debts.filter(d => d.studentName.toLowerCase().includes(searchTerm.toLowerCase()));

  if (loading) return <div>Cargando lista de asistencia...</div>;

  return (
    <div className="glass-panel" style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h3 style={{ margin: 0, color: 'var(--primary)' }}>Control de Asistencia y Cuotas</h3>
        
        <div className="search-bar" style={{ flex: '1', maxWidth: '300px' }}>
          <Search size={18} style={{ color: 'var(--text-muted)', marginLeft: '10px' }} />
          <input 
            type="text" 
            placeholder="Buscar alumno..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', background: 'transparent', border: 'none', color: 'white', outline: 'none' }}
          />
        </div>
      </div>

      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Por defecto, todos los alumnos tienen asignada la <strong>Cuota Obligatoria ({formatMoney(event.mandatoryAmount)})</strong>. 
        Si desmarcas la casilla de asistencia, se les aplicará automáticamente la <strong>Multa por Inasistencia ({formatMoney(event.noShowAmount)})</strong>.
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              <th style={{ padding: '1rem', width: '100px', textAlign: 'center' }}>¿Asistió?</th>
              <th style={{ padding: '1rem' }}>Alumno</th>
              <th style={{ padding: '1rem' }}>Estado Pago</th>
              <th style={{ padding: '1rem', textAlign: 'right' }}>Deuda Asignada</th>
            </tr>
          </thead>
          <tbody>
            {filteredDebts.map(debt => {
              const attended = !debt.notAttended;
              return (
                <tr key={debt.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: attended ? 'transparent' : 'rgba(239, 68, 68, 0.05)' }}>
                  <td style={{ padding: '1rem', textAlign: 'center' }}>
                    <button 
                      onClick={() => toggleAttendance(debt)}
                      style={{ background: 'none', border: 'none', color: attended ? 'var(--success)' : 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      {attended ? <CheckSquare size={24} /> : <Square size={24} />}
                    </button>
                  </td>
                  <td style={{ padding: '1rem', fontWeight: '500' }}>
                    {debt.studentName}
                    {!attended && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', backgroundColor: 'var(--danger)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Inasistente</span>}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    {debt.status === 'paid' && <span style={{ color: 'var(--success)' }}>Pagado</span>}
                    {debt.status === 'partial' && <span style={{ color: 'var(--warning)' }}>Abono parcial</span>}
                    {debt.status === 'review' && <span style={{ color: '#3b82f6' }}>En revisión</span>}
                    {debt.status === 'pending' && <span style={{ color: 'var(--danger)' }}>Pendiente</span>}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 'bold', color: attended ? 'var(--text)' : 'var(--danger)' }}>
                    {formatMoney(debt.amount)}
                  </td>
                </tr>
              );
            })}
            {filteredDebts.length === 0 && (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No se encontraron registros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default EventAttendance;
