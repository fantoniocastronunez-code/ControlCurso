import React, { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';
import { ArrowLeft, CheckCircle, Clock, XCircle, FileText, Download, Trash2, Edit2, Save, X } from 'lucide-react';

const ExpenseDetail = ({ expenseId, onBack }) => {
  const [expense, setExpense] = useState(null);
  const [debts, setDebts] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Para ver imagen en grande
  const [selectedReceipt, setSelectedReceipt] = useState(null);

  // Estados de Edición
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({ title: '', totalAmount: '' });

  // Selección Múltiple
  const [selectedDebts, setSelectedDebts] = useState([]);

  useEffect(() => {
    fetchDetail();
  }, [expenseId]);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      // Obtener el gasto
      const expenseRef = doc(db, 'expenses', expenseId);
      const expenseSnap = await getDoc(expenseRef);
      if (expenseSnap.exists()) {
        setExpense({ id: expenseSnap.id, ...expenseSnap.data() });
      }

      // Obtener las deudas de este gasto
      const q = query(collection(db, 'debts'), where('expenseId', '==', expenseId));
      const debtSnap = await getDocs(q);
      const debtsData = debtSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Ordenar: En revisión primero, luego pendientes, luego pagados
      debtsData.sort((a, b) => {
        if (a.status === 'review' && b.status !== 'review') return -1;
        if (a.status !== 'review' && b.status === 'review') return 1;
        if (a.status === 'pending' && b.status === 'paid') return -1;
        if (a.status === 'paid' && b.status === 'pending') return 1;
        return 0;
      });
      
      setDebts(debtsData);

      // Obtener alumnos para revisar sus saldos a favor
      const studentsSnap = await getDocs(collection(db, 'students'));
      const studentsData = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStudents(studentsData);
    } catch (error) {
      console.error("Error fetching expense details:", error);
    } finally {
      setLoading(false);
    }
  };

  const processPayment = async (debtId, method, defaultAmount, isApproval = false) => {
    const debtToPay = debts.find(d => d.id === debtId);
    const amountStr = window.prompt(
      `Confirma el monto ${isApproval ? 'aprobado' : 'pagado en ' + (method === 'cash' ? 'Efectivo' : 'Transferencia')}:`, 
      defaultAmount
    );
    
    if (amountStr === null) return;
    
    const amountPaid = parseFloat(amountStr);
    if (isNaN(amountPaid) || amountPaid <= 0) {
      alert("Monto inválido.");
      return;
    }

    try {
      const debtRef = doc(db, 'debts', debtId);
      
      let creatingRemainder = false;
      if (amountPaid < debtToPay.amount) {
        const confirmSplit = window.confirm(`El monto pagado ($${amountPaid}) es menor a la deuda ($${debtToPay.amount}).\n\n¿Deseas registrar este pago parcial y generar automáticamente una NUEVA deuda por la diferencia ($${debtToPay.amount - amountPaid})?`);
        
        if (confirmSplit) {
          creatingRemainder = true;
          // Crear nueva deuda por la diferencia
          const newDebtRef = doc(collection(db, 'debts'));
          const { id, ...debtData } = debtToPay;
          await setDoc(newDebtRef, {
            ...debtData,
            amount: debtToPay.amount - amountPaid,
            paidAmount: 0,
            status: 'partial',
            paymentMethod: null,
            approvedAt: null,
            receiptUrl: null,
            title: `${debtToPay.title} (Saldo Restante)`
          });
        }
      }

      await updateDoc(debtRef, {
        status: 'paid',
        paidAmount: amountPaid,
        paymentMethod: method,
        approvedAt: new Date().toISOString()
      });

      const expenseRef = doc(db, 'expenses', expenseId);
      const currentPaidCount = expense.paidCount || 0;
      // Si creamos un remanente, el paidCount no debería incrementar, porque la cuota original se dividió y una parte sigue pendiente. 
      // O si incrementamos paidCount, significa que "un pago se realizó". Es mejor incrementarlo para reflejar que esta fracción ya se pagó.
      await updateDoc(expenseRef, {
        paidCount: currentPaidCount + 1
      });

      fetchDetail();
    } catch (error) {
      console.error("Error al procesar pago:", error);
      alert("Hubo un error al procesar el pago.");
    }
  };

  const handleEditDebtAmount = async (debtId) => {
    const debtToEdit = debts.find(d => d.id === debtId);
    if (!debtToEdit) return;

    const newAmountStr = window.prompt("Ingresa el NUEVO Monto a Cobrar para este alumno:", debtToEdit.amount);
    if (newAmountStr === null) return;
    
    const newAmount = parseFloat(newAmountStr);
    if (isNaN(newAmount) || newAmount <= 0) {
      alert("Monto inválido.");
      return;
    }

    setLoading(true);
    try {
      await updateDoc(doc(db, 'debts', debtId), {
        amount: newAmount
      });
      fetchDetail();
    } catch (error) {
      console.error("Error modificando deuda:", error);
      alert("Error al modificar el monto.");
      setLoading(false);
    }
  };

  const handleEditPaidAmount = async (debtId) => {
    const debtToEdit = debts.find(d => d.id === debtId);
    if (!debtToEdit) return;

    const newAmountStr = window.prompt("Ingresa el NUEVO Monto Informado (Pagado) para este alumno:", debtToEdit.paidAmount || 0);
    if (newAmountStr === null) return;
    
    const newAmount = parseFloat(newAmountStr);
    if (isNaN(newAmount) || newAmount < 0) {
      alert("Monto inválido.");
      return;
    }

    setLoading(true);
    try {
      await updateDoc(doc(db, 'debts', debtId), {
        paidAmount: newAmount
      });
      fetchDetail();
    } catch (error) {
      console.error("Error modificando pago:", error);
      alert("Error al modificar el monto pagado.");
      setLoading(false);
    }
  };

  const handleApprovePayment = async (debtId) => {
    const debtToPay = debts.find(d => d.id === debtId);
    await processPayment(debtId, 'transfer', debtToPay.paidAmount || debtToPay.amount, true);
  };

  const handleManualPayment = async (debtId, method) => {
    const debtToPay = debts.find(d => d.id === debtId);
    await processPayment(debtId, method, debtToPay.amount, false);
  };

  const handleBulkPayment = async (method) => {
    if (selectedDebts.length === 0) return;
    if (!window.confirm(`¿Registrar pago masivo a ${selectedDebts.length} alumnos en ${method === 'cash' ? 'Efectivo' : 'Transferencia'}?`)) return;
    
    setLoading(true);
    try {
      let newlyPaidCount = 0;
      for (const debtId of selectedDebts) {
        const debtRef = doc(db, 'debts', debtId);
        const debtToPay = debts.find(d => d.id === debtId);
        await updateDoc(debtRef, {
          status: 'paid',
          paidAmount: debtToPay.amount,
          paymentMethod: method,
          approvedAt: new Date().toISOString()
        });
        newlyPaidCount++;
      }

      const expenseRef = doc(db, 'expenses', expenseId);
      const currentPaidCount = expense.paidCount || 0;
      await updateDoc(expenseRef, {
        paidCount: currentPaidCount + newlyPaidCount
      });

      setSelectedDebts([]);
      fetchDetail();
    } catch (error) {
      console.error("Error al registrar pago masivo:", error);
      alert("Error al registrar los pagos.");
      setLoading(false);
    }
  };

  const handlePayWithBalance = async (debtId) => {
    const debtToPay = debts.find(d => d.id === debtId);
    const student = students.find(s => s.name === debtToPay.studentName);
    
    if (!student || !student.balance || student.balance < debtToPay.amount) {
      alert("El alumno no tiene saldo suficiente a favor.");
      return;
    }

    if(!window.confirm(`¿Usar ${formatMoney(debtToPay.amount)} del saldo a favor de ${student.name}? Le quedarán ${formatMoney(student.balance - debtToPay.amount)} a favor.`)) return;
    
    setLoading(true);
    try {
      // 1. Actualizar deuda
      const debtRef = doc(db, 'debts', debtId);
      await updateDoc(debtRef, {
        status: 'paid',
        paidAmount: debtToPay.amount,
        paymentMethod: 'balance',
        approvedAt: new Date().toISOString()
      });

      // 2. Descontar saldo del estudiante
      const studentRef = doc(db, 'students', student.id);
      await updateDoc(studentRef, {
        balance: student.balance - debtToPay.amount
      });

      // 3. Aumentar el contador del gasto
      const expenseRef = doc(db, 'expenses', expenseId);
      const currentPaidCount = expense.paidCount || 0;
      await updateDoc(expenseRef, {
        paidCount: currentPaidCount + 1
      });

      fetchDetail();
    } catch (error) {
      console.error("Error al registrar pago con saldo:", error);
      alert("Error al registrar el pago.");
      setLoading(false);
    }
  };

  const toggleSelectDebt = (id) => {
    setSelectedDebts(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    const pendings = debts.filter(d => d.status === 'pending' || d.status === 'partial').map(d => d.id);
    if (selectedDebts.length === pendings.length) {
      setSelectedDebts([]);
    } else {
      setSelectedDebts(pendings);
    }
  };

  const handleRejectPayment = async (debtId) => {
    if(!window.confirm('¿Seguro que deseas rechazar este comprobante? El apoderado tendrá que subir uno nuevo.')) return;
    try {
      const debtRef = doc(db, 'debts', debtId);
      await updateDoc(debtRef, {
        status: 'pending',
        receiptUrl: null, // Borramos la ref al comprobante (opcional, pero útil)
        paidAmount: 0
      });
      fetchDetail();
    } catch (error) {
      console.error("Error al rechazar pago:", error);
    }
  };

  const handleDeleteExpense = async () => {
    if (!window.confirm('¿Seguro que deseas ELIMINAR esta cuota? Se borrarán también todas las deudas de los alumnos y los pagos ya realizados desaparecerán del balance general.')) return;
    setLoading(true);
    try {
      // 1. Borrar deudas
      for (const debt of debts) {
        await deleteDoc(doc(db, 'debts', debt.id));
      }
      // 2. Borrar cuota
      await deleteDoc(doc(db, 'expenses', expenseId));
      
      alert('Cuota eliminada correctamente.');
      onBack();
    } catch (error) {
      console.error("Error eliminando cuota:", error);
      alert('Hubo un error al eliminar la cuota.');
      setLoading(false);
    }
  };

  const handleStartEdit = () => {
    setEditData({ title: expense.title, totalAmount: expense.totalAmount });
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!editData.title || !editData.totalAmount) return;
    setLoading(true);
    try {
      const newAmount = Number(editData.totalAmount);
      // 1. Actualizar Cuota
      await updateDoc(doc(db, 'expenses', expenseId), {
        title: editData.title,
        totalAmount: newAmount
      });

      // 2. Actualizar monto en deudas pendientes
      if (newAmount !== expense.totalAmount) {
        for (const debt of debts) {
          if (debt.status === 'pending') {
            await updateDoc(doc(db, 'debts', debt.id), { amount: newAmount });
          }
        }
      }

      setExpense({ ...expense, title: editData.title, totalAmount: newAmount });
      setIsEditing(false);
      fetchDetail();
    } catch (error) {
      console.error("Error editando cuota:", error);
      alert('Hubo un error al editar la cuota.');
      setLoading(false);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  // Calculate statuses
  const studentStatusMap = {};
  debts.forEach(d => {
    if (!studentStatusMap[d.studentId]) {
      studentStatusMap[d.studentId] = { paid: 0, partial: 0, pending: 0, review: 0 };
    }
    studentStatusMap[d.studentId][d.status] = (studentStatusMap[d.studentId][d.status] || 0) + 1;
  });

  let fullyPaidCount = 0;
  let partialCount = 0;
  let unpaidCount = 0;

  Object.values(studentStatusMap).forEach(statusCounts => {
    if (statusCounts.partial > 0 || (statusCounts.pending > 0 && statusCounts.paid > 0)) {
       partialCount++;
    } else if (statusCounts.pending > 0 || statusCounts.review > 0) {
       unpaidCount++;
    } else if (statusCounts.paid > 0) {
       fullyPaidCount++;
    }
  });

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando detalle...</div>;
  }

  if (!expense) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <p>No se encontró la cuota.</p>
        <button onClick={onBack} className="btn btn-outline">Volver</button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Modal de Imagen */}
      {selectedReceipt && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem', flexDirection: 'column' }}>
           <img 
             src={selectedReceipt} 
             alt="Comprobante" 
             style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: 'var(--radius-sm)' }} 
           />
           <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
              <a href={selectedReceipt} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                <Download size={18} /> Abrir Original
              </a>
              <button onClick={() => setSelectedReceipt(null)} className="btn btn-outline">Cerrar</button>
           </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
          <ArrowLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>Detalle de Cuota</h3>
      </div>

      {/* Resumen del Gasto */}
      <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '2rem' }}>
        {isEditing ? (
          <div style={{ flex: 1 }}>
            <div className="input-group">
              <label className="input-label">Título de la Cuota</label>
              <input type="text" className="input-field" value={editData.title} onChange={e => setEditData({...editData, title: e.target.value})} />
            </div>
            <div className="input-group">
              <label className="input-label">Monto por Alumno ($)</label>
              <input type="number" className="input-field" value={editData.totalAmount} onChange={e => setEditData({...editData, totalAmount: e.target.value})} />
              <small style={{ color: 'var(--text-muted)' }}>Esto solo actualizará el cobro de los alumnos que aún no han pagado.</small>
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={handleSaveEdit} className="btn btn-primary" style={{ backgroundColor: 'var(--success)' }}><Save size={18}/> Guardar Cambios</button>
              <button onClick={() => setIsEditing(false)} className="btn btn-outline"><X size={18}/> Cancelar</button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                <h2 style={{ color: 'var(--primary)', margin: 0 }}>{expense.title}</h2>
                <button onClick={handleStartEdit} className="btn btn-outline" style={{ padding: '0.3rem', borderColor: 'var(--primary)', color: 'var(--primary)' }} title="Editar Cuota"><Edit2 size={16}/></button>
                <button onClick={handleDeleteExpense} className="btn btn-outline" style={{ padding: '0.3rem', borderColor: 'rgba(239, 68, 68, 0.3)', color: 'var(--danger)' }} title="Eliminar Cuota"><Trash2 size={16}/></button>
              </div>
              <p style={{ color: 'var(--text-muted)' }}>Emitido el: {expense.date}</p>
            </div>
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
              <p style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0 }}>Total a recaudar: {formatMoney(expense.totalAmount)}</p>
              
              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem', backgroundColor: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Pagados completo</p>
                  <p style={{ margin: 0, fontSize: '1.2rem', color: 'var(--success)', fontWeight: 'bold' }}>{fullyPaidCount}</p>
                </div>
                <div style={{ width: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Pago parcial</p>
                  <p style={{ margin: 0, fontSize: '1.2rem', color: '#eab308', fontWeight: 'bold' }}>{partialCount}</p>
                </div>
                <div style={{ width: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Impagos / Revisión</p>
                  <p style={{ margin: 0, fontSize: '1.2rem', color: 'var(--danger)', fontWeight: 'bold' }}>{unpaidCount}</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h4 style={{ margin: 0 }}>Estado de los Alumnos</h4>
        {selectedDebts.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', backgroundColor: 'rgba(99,102,241,0.1)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)' }}>
            <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{selectedDebts.length} seleccionados</span>
            <div style={{ borderLeft: '1px solid rgba(255,255,255,0.2)', height: '20px' }}></div>
            <span style={{ fontSize: '0.9rem' }}>Marcar como pagado por:</span>
            <button onClick={() => handleBulkPayment('cash')} className="btn btn-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}>Efectivo</button>
            <button onClick={() => handleBulkPayment('transfer')} className="btn btn-outline" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', color: 'var(--primary)', borderColor: 'var(--primary)' }}>Transferencia</button>
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <th style={{ padding: '1rem', width: '40px' }}>
                <input 
                  type="checkbox" 
                  onChange={toggleSelectAll}
                  checked={debts.filter(d => d.status === 'pending' || d.status === 'partial').length > 0 && selectedDebts.length === debts.filter(d => d.status === 'pending' || d.status === 'partial').length}
                  disabled={debts.filter(d => d.status === 'pending' || d.status === 'partial').length === 0}
                  style={{ cursor: 'pointer' }}
                />
              </th>
              <th style={{ padding: '1rem' }}>Alumno</th>
              <th style={{ padding: '1rem' }}>Apoderado</th>
              <th style={{ padding: '1rem' }}>Estado</th>
              <th style={{ padding: '1rem' }}>Monto A Cobrar</th>
              <th style={{ padding: '1rem' }}>Monto Informado</th>
              <th style={{ padding: '1rem' }}>Comprobante</th>
              <th style={{ padding: '1rem' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {debts.map(debt => (
              <tr key={debt.id} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: selectedDebts.includes(debt.id) ? 'rgba(99,102,241,0.05)' : 'transparent' }}>
                <td style={{ padding: '1rem' }}>
                  {(debt.status === 'pending' || debt.status === 'partial') && (
                    <input 
                      type="checkbox" 
                      checked={selectedDebts.includes(debt.id)}
                      onChange={() => toggleSelectDebt(debt.id)}
                      style={{ cursor: 'pointer' }}
                    />
                  )}
                </td>
                <td style={{ padding: '1rem', fontWeight: '500' }}>{debt.studentName}</td>
                <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{debt.apoderadoEmail || 'Sin apoderado'}</td>
                
                <td style={{ padding: '1rem' }}>
                  {debt.status === 'paid' && (
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.85rem', backgroundColor: 'rgba(16, 185, 129, 0.2)', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      <CheckCircle size={14}/> Pagado
                    </span>
                  )}
                  {debt.status === 'review' && (
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.85rem', backgroundColor: 'rgba(245, 158, 11, 0.2)', color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Clock size={14}/> En Revisión
                    </span>
                  )}
                  {debt.status === 'partial' && (
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.85rem', backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#eab308', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}>
                      <Clock size={14}/> Pago Parcial
                    </span>
                  )}
                  {debt.status === 'pending' && (
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.85rem', backgroundColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      <XCircle size={14}/> Pendiente
                    </span>
                  )}
                </td>

                <td style={{ padding: '1rem', fontWeight: 'bold' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {formatMoney(debt.amount)}
                    <button 
                      onClick={() => handleEditDebtAmount(debt.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '0.2rem' }}
                      title="Modificar Monto A Cobrar"
                    >
                      <Edit2 size={14} />
                    </button>
                  </div>
                </td>
                
                <td style={{ padding: '1rem', color: 'var(--success)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {debt.paidAmount ? `+${formatMoney(debt.paidAmount)}` : '-'}
                    {(debt.status === 'paid' || debt.status === 'partial' || debt.status === 'review') && (
                      <button 
                        onClick={() => handleEditPaidAmount(debt.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--success)', cursor: 'pointer', padding: '0.2rem' }}
                        title="Modificar Monto Informado"
                      >
                        <Edit2 size={14} />
                      </button>
                    )}
                  </div>
                </td>

                <td style={{ padding: '1rem' }}>
                  {debt.receiptUrl ? (
                    <button 
                      onClick={() => setSelectedReceipt(debt.receiptUrl)} 
                      className="btn btn-outline" 
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
                    >
                      <FileText size={14}/> Ver Archivo
                    </button>
                  ) : '-'}
                </td>

                <td style={{ padding: '1rem' }}>
                  {debt.status === 'review' ? (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button 
                        onClick={() => handleApprovePayment(debt.id)}
                        className="btn btn-primary" 
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', backgroundColor: 'var(--success)' }}
                        title="Aprobar Pago"
                      >
                        <CheckCircle size={16} /> Aprobar
                      </button>
                      <button 
                        onClick={() => handleRejectPayment(debt.id)}
                        className="btn btn-outline" 
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                        title="Rechazar Comprobante"
                      >
                        <XCircle size={16} /> Rechazar
                      </button>
                    </div>
                  ) : (debt.status === 'pending' || debt.status === 'partial') ? (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button 
                        onClick={() => handleManualPayment(debt.id, 'cash')}
                        className="btn btn-outline" 
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', color: 'var(--primary)', borderColor: 'rgba(99, 102, 241, 0.3)' }}
                        title="Pago Manual en Efectivo"
                      >
                         Efectivo
                      </button>
                      <button 
                        onClick={() => handleManualPayment(debt.id, 'transfer')}
                        className="btn btn-outline" 
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', color: 'var(--primary)', borderColor: 'rgba(99, 102, 241, 0.3)' }}
                        title="Pago Manual con Transferencia"
                      >
                         Transf.
                      </button>
                      {(() => {
                        const student = students.find(s => s.name === debt.studentName);
                        if (student && student.balance >= debt.amount) {
                          return (
                            <button 
                              onClick={() => handlePayWithBalance(debt.id)}
                              className="btn btn-primary" 
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', backgroundColor: 'var(--success)', border: 'none' }}
                              title={`Usar saldo a favor de ${formatMoney(student.balance)}`}
                            >
                               Usar Saldo
                            </button>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                       Procesado {debt.paymentMethod ? `(${debt.paymentMethod === 'cash' ? 'Efectivo' : debt.paymentMethod === 'transfer' ? 'Transf.' : 'Saldo a Favor'})` : ''}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {debts.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No hay detalles para mostrar.
          </div>
        )}
      </div>
    </div>
  );
};

export default ExpenseDetail;
