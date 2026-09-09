import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../../../firebase/config';
import { collection, getDocs, query, where, doc, updateDoc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { CheckSquare, Square, Search } from 'lucide-react';
import { useModal } from '../../../context/ModalContext';
import { formatStudentName } from '../../../utils/nameUtils';

const EventAttendance = ({ event }) => {
  const { showAlert } = useModal();
  const [localDebts, setLocalDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchDebts = useCallback(async () => {
    setLoading(true);
    try {
      const studentsSnap = await getDocs(collection(db, 'students'));
      const studentsMap = new Map();
      studentsSnap.docs.forEach(d => {
        studentsMap.set(d.id, formatStudentName(d.data()));
      });

      const q = query(collection(db, 'debts'), where('eventId', '==', event.id));
      const snap = await getDocs(q);
      
      const debtsByStudent = {};
      
      snap.docs.forEach(d => {
        const data = d.data();
        if (!debtsByStudent[data.studentId]) {
          debtsByStudent[data.studentId] = {
            studentId: data.studentId,
            studentName: studentsMap.get(data.studentId) || data.studentName,
            mainDebt: null,
            fineDebt: null,
            notAttended: false
          };
        }
        
        if (data.expenseId === `exp_evt_${event.id}`) {
          debtsByStudent[data.studentId].mainDebt = { id: d.id, ...data };
        } else if (data.expenseId === `exp_evt_fine_${event.id}`) {
          debtsByStudent[data.studentId].fineDebt = { id: d.id, ...data };
          debtsByStudent[data.studentId].notAttended = true;
        }
      });
      
      const list = Object.values(debtsByStudent);
      list.sort((a, b) => a.studentName.localeCompare(b.studentName));
      setLocalDebts(list);
      setHasChanges(false);
    } catch (error) {
      console.error("Error fetching attendance:", error);
    } finally {
      setLoading(false);
    }
  }, [event.id]);

  useEffect(() => {
    fetchDebts();
  }, [fetchDebts]);



  const toggleAttendance = (studentData) => {
    const willBeNotAttended = !studentData.notAttended;
    setLocalDebts(prev => prev.map(s => 
      s.studentId === studentData.studentId 
        ? { ...s, notAttended: willBeNotAttended, _modified: true } 
        : s
    ));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fineExpenseId = `exp_evt_fine_${event.id}`;

      let absentCount = 0;
      for (const s of localDebts) {
        if (s.notAttended) absentCount++;
      }

      const modifiedStudents = localDebts.filter(s => s._modified);
      
      // Add or remove fine debts
      for (const s of modifiedStudents) {
        if (s.notAttended) {
          if (!s.fineDebt) {
            const newDebtId = `debt_${fineExpenseId}_${s.studentId}`;
            const mainDebt = s.mainDebt;
            await setDoc(doc(db, 'debts', newDebtId), {
              expenseId: fineExpenseId,
              studentId: s.studentId,
              studentName: s.studentName,
              apoderadoEmails: mainDebt ? mainDebt.apoderadoEmails : [],
              amount: event.noShowAmount,
              status: 'pending',
              title: `Multa Inasistencia: ${event.name}`,
              date: event.date,
              fundId: event.fundId,
              eventId: event.id,
              createdAt: new Date().toISOString()
            });
          }
        } else {
          if (s.fineDebt) {
            await deleteDoc(doc(db, 'debts', s.fineDebt.id));
          }
        }
      }
      
      // Update fine expense
      const fineExpenseRef = doc(db, 'expenses', fineExpenseId);
      const fineSnap = await getDoc(fineExpenseRef);
      
      if (absentCount > 0) {
        if (fineSnap.exists()) {
          await updateDoc(fineExpenseRef, {
            studentsCount: absentCount,
            totalAmount: absentCount * event.noShowAmount
          });
        } else {
          await setDoc(fineExpenseRef, {
            title: `Multa Inasistencia: ${event.name}`,
            date: event.date,
            totalAmount: absentCount * event.noShowAmount,
            amountPerStudent: event.noShowAmount,
            studentsCount: absentCount,
            paidCount: 0,
            fundId: event.fundId,
            eventId: event.id,
            createdAt: new Date().toISOString()
          });
        }
      } else if (fineSnap.exists()) {
        await updateDoc(fineExpenseRef, {
          studentsCount: 0,
          totalAmount: 0
        });
      }

      setHasChanges(false);
      await showAlert("Asistencia y multas actualizadas correctamente.");
      fetchDebts(); // Refresh data from server

    } catch (error) {
      console.error("Error saving attendance:", error);
      await showAlert("Error al actualizar la asistencia.");
    } finally {
      setSaving(false);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const filteredDebts = localDebts.filter(d => d.studentName.toLowerCase().includes(searchTerm.toLowerCase()));

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

        {hasChanges && (
          <button 
            onClick={handleSave} 
            disabled={saving}
            className="btn btn-primary" 
            style={{ padding: '0.5rem 1.5rem', fontWeight: 'bold' }}
          >
            {saving ? 'Guardando...' : 'Guardar Asistencia y Generar Cobros'}
          </button>
        )}
      </div>

      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Todos los alumnos deben pagar la <strong>Cuota Obligatoria ({formatMoney(event.mandatoryAmount)})</strong>. 
        Si desmarcas la asistencia a alguien, se le generará de forma <strong>adicional</strong> una <strong>Multa por Inasistencia ({formatMoney(event.noShowAmount)})</strong>.
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
            {filteredDebts.map(s => {
              const attended = !s.notAttended;
              let statusEl = null;
              if (s.mainDebt) {
                if (s.mainDebt.status === 'paid') statusEl = <span style={{ color: 'var(--success)' }}>Pagado</span>;
                else if (s.mainDebt.status === 'review') statusEl = <span style={{ color: '#3b82f6' }}>En revisión</span>;
                else if (s.mainDebt.status === 'partial') statusEl = <span style={{ color: 'var(--warning)' }}>Parcial</span>;
                else statusEl = <span style={{ color: 'var(--danger)' }}>Pendiente</span>;
              }

              return (
                <tr key={s.studentId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: attended ? 'transparent' : 'rgba(239, 68, 68, 0.05)' }}>
                  <td style={{ padding: '1rem', textAlign: 'center' }}>
                    <button 
                      onClick={() => toggleAttendance(s)}
                      style={{ background: 'none', border: 'none', color: attended ? 'var(--success)' : 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      {attended ? <CheckSquare size={24} /> : <Square size={24} />}
                    </button>
                  </td>
                  <td style={{ padding: '1rem', fontWeight: '500' }}>
                    {s.studentName}
                    {!attended && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', backgroundColor: 'var(--danger)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Inasistente</span>}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    {statusEl}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 'bold' }}>
                    <div style={{ color: 'var(--text)' }}>{formatMoney(event.mandatoryAmount)}</div>
                    {!attended && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>+ {formatMoney(event.noShowAmount)} (Multa)</div>}
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
