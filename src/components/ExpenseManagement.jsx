import React, { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { ArrowLeft, PlusCircle, CheckCircle } from 'lucide-react';

const ExpenseManagement = ({ onBack }) => {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [totalAmount, setTotalAmount] = useState('');
  const [selectedStudents, setSelectedStudents] = useState(new Set());

  useEffect(() => {
    fetchStudents();
  }, []);

  const fetchStudents = async () => {
    try {
      const studentsCollection = collection(db, 'students');
      const studentSnapshot = await getDocs(studentsCollection);
      const studentList = studentSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setStudents(studentList);
      
      // Por defecto seleccionamos todos
      setSelectedStudents(new Set(studentList.map(s => s.id)));
    } catch (error) {
      console.error("Error al obtener alumnos:", error);
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
    if (!title || !totalAmount || selectedStudents.size === 0) {
      alert('Debes ingresar título, monto y seleccionar al menos un alumno.');
      return;
    }

    setLoading(true);
    try {
      const amount = parseFloat(totalAmount);
      const amountPerStudent = Math.round(amount / selectedStudents.size);
      
      const expenseId = 'exp_' + Date.now().toString();
      const expenseRef = doc(db, 'expenses', expenseId);
      
      const newExpense = {
        title,
        date,
        totalAmount: amount,
        amountPerStudent,
        studentsCount: selectedStudents.size,
        paidCount: 0,
        createdAt: new Date().toISOString()
      };
      
      await setDoc(expenseRef, newExpense);

      // Crear deudas individuales
      for (const studentId of selectedStudents) {
        const student = students.find(s => s.id === studentId);
        const debtId = `debt_${expenseId}_${studentId}`;
        const debtRef = doc(db, 'debts', debtId);
        
        await setDoc(debtRef, {
          expenseId,
          studentId,
          studentName: student.name,
          apoderadoEmail: student.apoderadoEmail || '',
          amount: amountPerStudent,
          status: 'pending', // pending, review, paid
          title,
          date,
          createdAt: new Date().toISOString()
        });
      }

      setMessage('Cuota generada y enviada a los apoderados con éxito.');
      setTimeout(() => {
        setMessage('');
        onBack();
      }, 3000);

    } catch (error) {
      console.error("Error al generar la cuota:", error);
      alert('Error al generar la cuota.');
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
              <label className="input-label">Monto Total a Dividir ($)</label>
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
          </div>

          {totalAmount && selectedStudents.size > 0 && (
            <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'rgba(99, 102, 241, 0.1)', borderRadius: 'var(--radius-md)', border: '1px solid var(--primary)' }}>
              <strong>Cálculo:</strong> Se cobrará <strong>${Math.round(parseFloat(totalAmount) / selectedStudents.size)}</strong> a cada alumno seleccionado.
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
              <label key={student.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: selectedStudents.has(student.id) ? '1px solid var(--primary)' : '1px solid var(--border-color)' }}>
                <input 
                  type="checkbox" 
                  checked={selectedStudents.has(student.id)}
                  onChange={() => handleToggleStudent(student.id)}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }}
                />
                <div>
                  <span style={{ display: 'block', fontWeight: '500' }}>{student.name}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{student.apoderadoEmail || 'Sin apoderado'}</span>
                </div>
              </label>
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
