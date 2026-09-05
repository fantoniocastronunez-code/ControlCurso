import React, { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';
import { ArrowLeft, PlusCircle, CheckCircle } from 'lucide-react';
import { useModal } from '../context/ModalContext';
import { formatStudentName } from '../utils/nameUtils';

const ExpenseManagement = ({ onBack }) => {
  const { showAlert } = useModal();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [totalAmount, setTotalAmount] = useState('');
  const [calculationMode, setCalculationMode] = useState('divide');
  const [selectedStudents, setSelectedStudents] = useState(new Set());
  const [customAmounts, setCustomAmounts] = useState({});
  const [balanceToUse, setBalanceToUse] = useState({});
  
  const [funds, setFunds] = useState([]);
  const [selectedFundId, setSelectedFundId] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Fetch students
      const studentsCollection = collection(db, 'students');
      const studentSnapshot = await getDocs(studentsCollection);
      const studentList = studentSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      studentList.sort((a, b) => {
        const aNum = parseInt(a.listNumber) || 999;
        const bNum = parseInt(b.listNumber) || 999;
        return aNum - bNum;
      });
      setStudents(studentList);
      setSelectedStudents(new Set(studentList.map(s => s.id)));

      // Fetch funds
      const fundsCollection = collection(db, 'funds');
      const fundsSnapshot = await getDocs(fundsCollection);
      const fundsList = fundsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      fundsList.sort((a, b) => a.name.localeCompare(b.name));
      setFunds(fundsList);
      if (fundsList.length > 0) {
        setSelectedFundId(fundsList[0].id);
      }
    } catch (error) {
      console.error("Error al obtener datos:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStudent = (id) => {
    const newSelected = new Set(selectedStudents);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedStudents(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedStudents.size === students.length) {
      setSelectedStudents(new Set()); // Deseleccionar todos
    } else {
      setSelectedStudents(new Set(students.map(s => s.id))); // Seleccionar todos
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title || selectedStudents.size === 0 || !selectedFundId) {
      await showAlert('Debes ingresar título, seleccionar fondo y al menos un alumno.');
      return;
    }
    if (calculationMode !== 'custom' && !totalAmount) {
      await showAlert('Debes ingresar el monto.');
      return;
    }

    if (calculationMode === 'custom') {
      for (const id of selectedStudents) {
        if (!customAmounts[id] || isNaN(parseFloat(customAmounts[id])) || parseFloat(customAmounts[id]) <= 0) {
          await showAlert('Debes ingresar un monto válido mayor a 0 para cada alumno seleccionado en modo personalizado.');
          return;
        }
      }
    }

    setLoading(true);
    try {
      let amountPerStudent;
      let finalTotalAmount;

      if (calculationMode === 'divide') {
        const inputAmount = parseFloat(totalAmount);
        amountPerStudent = Math.round(inputAmount / selectedStudents.size);
        finalTotalAmount = inputAmount;
      } else if (calculationMode === 'perStudent') {
        const inputAmount = parseFloat(totalAmount);
        amountPerStudent = inputAmount;
        finalTotalAmount = inputAmount * selectedStudents.size;
      } else {
        // custom
        amountPerStudent = 'Variable';
        finalTotalAmount = Array.from(selectedStudents).reduce((sum, id) => sum + parseFloat(customAmounts[id]), 0);
      }
      
      const expenseId = 'exp_' + Date.now().toString();
      const expenseRef = doc(db, 'expenses', expenseId);
      
      const newExpense = {
        title,
        date,
        totalAmount: finalTotalAmount,
        amountPerStudent,
        studentsCount: selectedStudents.size,
        paidCount: 0,
        fundId: selectedFundId,
        createdAt: new Date().toISOString()
      };
      
      await setDoc(expenseRef, newExpense);

      // Crear deudas individuales
      for (const studentId of selectedStudents) {
        const student = students.find(s => s.id === studentId);
        const debtId = `debt_${expenseId}_${studentId}`;
        const debtRef = doc(db, 'debts', debtId);
        
        const finalStudentAmount = calculationMode === 'custom' ? parseFloat(customAmounts[studentId]) : amountPerStudent;
        
        let status = 'pending';
        let paidAmount = 0;
        let paymentMethod = null;
        let approvedAt = null;

        const requestedBalance = parseFloat(balanceToUse[studentId]) || 0;
        if (requestedBalance > 0 && student.balance > 0) {
            // Cap the balance used to the final debt amount, and to what the student actually has
            const amountToUse = Math.min(requestedBalance, finalStudentAmount, student.balance);
            if (amountToUse > 0) {
                paidAmount = amountToUse;
                paymentMethod = 'balance';
                approvedAt = new Date().toISOString();
                
                if (amountToUse >= finalStudentAmount) {
                    status = 'paid';
                } else {
                    status = 'partial';
                }

                // Deduct from student
                const studentRef = doc(db, 'students', student.id);
                await updateDoc(studentRef, {
                    balance: student.balance - amountToUse
                });
            }
        }
        
        await setDoc(debtRef, {
          expenseId,
          studentId,
          studentName: student.name,
          apoderadoEmails: student.apoderadoEmails || (student.apoderadoEmail ? [student.apoderadoEmail] : []),
          amount: finalStudentAmount,
          status, // pending, review, paid, partial
          paidAmount,
          paymentMethod,
          approvedAt,
          title,
          date,
          fundId: selectedFundId,
          createdAt: new Date().toISOString()
        });
      }

      // Re-calculate how many were fully paid to update the expense record
      let fullyPaidCount = 0;
      for (const studentId of selectedStudents) {
          const finalStudentAmount = calculationMode === 'custom' ? parseFloat(customAmounts[studentId]) : amountPerStudent;
          const requestedBalance = parseFloat(balanceToUse[studentId]) || 0;
          const student = students.find(s => s.id === studentId);
          if (requestedBalance > 0 && student && student.balance > 0) {
              const amountToUse = Math.min(requestedBalance, finalStudentAmount, student.balance);
              if (amountToUse >= finalStudentAmount) fullyPaidCount++;
          }
      }
      
      if (fullyPaidCount > 0) {
          await updateDoc(expenseRef, {
              paidCount: fullyPaidCount
          });
      }

      setMessage('Cuota generada y enviada a los apoderados con éxito.');
      setTimeout(() => {
        setMessage('');
        onBack();
      }, 3000);

    } catch (error) {
      console.error("Error al generar la cuota:", error);
      await showAlert('Error al generar la cuota.');
    } finally {
      setLoading(false);
    }
  };

  if (loading && students.length === 0) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando datos...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
          <ArrowLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>Generar Cobro / Cuota</h3>
      </div>

      {message && (
        <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', color: 'var(--success)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={18} /> {message}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
          <h4 style={{ marginBottom: '1.5rem', color: 'var(--primary)' }}>Datos del Cobro</h4>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
            <div className="input-group">
              <label className="input-label">Motivo o Título</label>
              <input 
                type="text" 
                required
                className="input-field" 
                placeholder="Ej. Cuota Aniversario, Materiales..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            
            <div className="input-group">
              <label className="input-label">Modo de Cálculo</label>
              <select 
                className="input-field"
                value={calculationMode}
                onChange={(e) => {
                  setCalculationMode(e.target.value);
                  if (e.target.value === 'custom') {
                    setTotalAmount('');
                  }
                }}
              >
                <option value="divide">Monto Total a Dividir</option>
                <option value="perStudent">Monto Fijo por Alumno</option>
                <option value="custom">Monto Personalizado por Alumno</option>
              </select>
            </div>

            {calculationMode !== 'custom' && (
              <div className="input-group">
                <label className="input-label">
                  {calculationMode === 'divide' ? 'Monto Total a Dividir ($)' : 'Monto por Alumno ($)'}
                </label>
                <input 
                  type="number" 
                  required
                  min="1"
                  className="input-field" 
                  placeholder="Ej. 50000"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                />
              </div>
            )}

            <div className="input-group">
              <label className="input-label">Fecha Límite / Emisión</label>
              <input 
                type="date" 
                required
                className="input-field" 
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div className="input-group">
              <label className="input-label">Fondo Destino</label>
              <select 
                className="input-field"
                value={selectedFundId}
                onChange={(e) => setSelectedFundId(e.target.value)}
                required
              >
                <option value="" disabled>Selecciona un fondo...</option>
                {funds.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
          </div>

          {calculationMode !== 'custom' && totalAmount && selectedStudents.size > 0 && (
            <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'rgba(99, 102, 241, 0.1)', borderRadius: 'var(--radius-md)', border: '1px solid var(--primary)' }}>
              <strong>Resumen:</strong> 
              {calculationMode === 'divide' ? (
                <span> Se cobrará <strong>${Math.round(parseFloat(totalAmount) / selectedStudents.size)}</strong> a cada alumno (Total a recaudar: ${parseFloat(totalAmount)}).</span>
              ) : (
                <span> Se cobrará <strong>${parseFloat(totalAmount)}</strong> a cada alumno (Total a recaudar: ${parseFloat(totalAmount) * selectedStudents.size}).</span>
              )}
            </div>
          )}
          
          {calculationMode === 'custom' && selectedStudents.size > 0 && (
            <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'rgba(99, 102, 241, 0.1)', borderRadius: 'var(--radius-md)', border: '1px solid var(--primary)' }}>
              <strong>Resumen:</strong> Total a recaudar: <strong>${Array.from(selectedStudents).reduce((sum, id) => sum + (parseFloat(customAmounts[id]) || 0), 0)}</strong>
            </div>
          )}
        </div>

        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h4 style={{ color: 'var(--primary)', margin: 0 }}>Alumnos Involucrados</h4>
            <button type="button" onClick={handleSelectAll} className="btn btn-outline" style={{ fontSize: '0.85rem', padding: '0.4rem 0.75rem' }}>
              {selectedStudents.size === students.length ? 'Deseleccionar Todos' : 'Seleccionar Todos'}
            </button>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
            {students.map(student => (
              <div key={student.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)', border: selectedStudents.has(student.id) ? '1px solid var(--primary)' : '1px solid var(--border-color)' }}>
                <div onClick={() => handleToggleStudent(student.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', flex: 1 }}>
                  <input 
                    type="checkbox" 
                    checked={selectedStudents.has(student.id)}
                    onChange={() => handleToggleStudent(student.id)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  <div>
                    <span style={{ display: 'block', fontWeight: '500' }}>{student.listNumber || '-'}. {formatStudentName(student)}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {student.apoderadoEmails?.length > 0 ? student.apoderadoEmails.join(', ') : (student.apoderadoEmail || 'Sin apoderado')}
                    </span>
                  </div>
                </div>
                {calculationMode === 'custom' && selectedStudents.has(student.id) && (
                  <input 
                    type="number"
                    min="1"
                    placeholder="Monto $"
                    className="input-field"
                    style={{ width: '100px', padding: '0.25rem 0.5rem' }}
                    value={customAmounts[student.id] || ''}
                    onChange={(e) => setCustomAmounts({...customAmounts, [student.id]: e.target.value})}
                  />
                )}
              </div>
              {selectedStudents.has(student.id) && student.balance > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', marginLeft: '2.5rem', backgroundColor: 'rgba(16, 185, 129, 0.05)', padding: '0.5rem', borderRadius: 'var(--radius-sm)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--success)' }}>Saldo a favor: <strong>${student.balance}</strong></span>
                  <div style={{ height: '15px', width: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Usar para pagar:</label>
                  <input 
                    type="number"
                    min="0"
                    max={student.balance}
                    className="input-field"
                    placeholder="$"
                    style={{ width: '80px', padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                    value={balanceToUse[student.id] || ''}
                    onChange={(e) => {
                        const val = Math.min(Number(e.target.value), student.balance);
                        setBalanceToUse({...balanceToUse, [student.id]: val || ''});
                    }}
                  />
                  <button type="button" onClick={() => setBalanceToUse({...balanceToUse, [student.id]: student.balance})} className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderColor: 'var(--success)', color: 'var(--success)' }}>
                    Todo
                  </button>
                </div>
              )}
            </div>
            ))}
            {students.length === 0 && (
              <p style={{ color: 'var(--text-muted)' }}>No hay alumnos registrados aún.</p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ padding: '0.75rem 2rem', fontSize: '1.1rem' }}>
            {loading ? 'Procesando...' : <><PlusCircle size={20}/> Generar Cobros</>}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ExpenseManagement;
