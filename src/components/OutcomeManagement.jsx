import React, { useEffect, useState } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where } from 'firebase/firestore';
import { ArrowLeft, CheckCircle, Trash2, TrendingDown, Edit2, Calculator, CheckSquare, Sparkles, RotateCcw, Save, AlertTriangle, ShieldCheck, Check } from 'lucide-react';
import { useModal } from '../context/ModalContext';

import { useCourse } from '../context/CourseContext';

const OutcomeManagement = ({ onBack }) => {
  const { showAlert, showConfirm } = useModal();
  const { selectedCourse } = useCourse();
  const [outcomes, setOutcomes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  
  const [newTitle, setNewTitle] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newMethod, setNewMethod] = useState('cash');
  const [selectedFundId, setSelectedFundId] = useState('general');
  const [newDate, setNewDate] = useState('');
  
  const [editingOutcomeId, setEditingOutcomeId] = useState(null);
  const [editOutcomeTitle, setEditOutcomeTitle] = useState('');
  const [editOutcomeAmount, setEditOutcomeAmount] = useState('');
  const [editOutcomeDate, setEditOutcomeDate] = useState('');
  const [editOutcomeMethod, setEditOutcomeMethod] = useState('cash');
  const [editOutcomeFund, setEditOutcomeFund] = useState('general');

  // Modo Auditoría
  const [isAuditMode, setIsAuditMode] = useState(false);
  const [auditChecks, setAuditChecks] = useState({});
  const [auditManualAmounts, setAuditManualAmounts] = useState({});

  const [funds, setFunds] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      if (!selectedCourse) return;
      try {
        // 1. Obtener Gastos
        const qOutcomes = query(collection(db, 'outcomes'), where('courseId', '==', selectedCourse.id));
        const snapshot = await getDocs(qOutcomes);
        const list = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        // Ordenar por fecha, más reciente primero
        list.sort((a, b) => new Date(b.date) - new Date(a.date));
        setOutcomes(list);

        // 2. Obtener Fondos
        const qFunds = query(collection(db, 'funds'), where('courseId', '==', selectedCourse.id));
        const fundsSnapshot = await getDocs(qFunds);
        const fundsList = fundsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setFunds(fundsList);
        // Mantener selectedFundId en 'general' o dejar que el usuario elija
      } catch (error) {
        console.error("Error al obtener datos:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [selectedCourse]);

  const handleAddOutcome = async (e) => {
    e.preventDefault();
    if (!newTitle || !newAmount) {
       await showAlert("Faltan datos obligatorios (motivo o monto).");
       return;
    }

    try {
      const outcomeId = 'out_' + Date.now().toString();
      const outcomeRef = doc(db, 'outcomes', outcomeId);
      
      const newOutcome = {
        title: newTitle,
        amount: parseFloat(newAmount),
        paymentMethod: newMethod,
        fundId: selectedFundId || 'general',
        courseId: selectedCourse.id,
        date: newDate || new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString()
      };
      
      await setDoc(outcomeRef, newOutcome);
      
      setOutcomes([{ id: outcomeId, ...newOutcome }, ...outcomes]);
      setNewTitle('');
      setNewAmount('');
      setNewMethod('cash');
      setNewDate('');
      
      setMessage('Gasto registrado correctamente');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error registrando gasto:", error);
      setMessage('Error al registrar el gasto');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleSaveEdit = async (id) => {
    if (!editOutcomeTitle || !editOutcomeAmount) return;
    try {
      const updatedData = {
        title: editOutcomeTitle,
        amount: parseFloat(editOutcomeAmount),
        date: editOutcomeDate || new Date().toISOString().split('T')[0],
        paymentMethod: editOutcomeMethod,
        fundId: editOutcomeFund
      };
      
      await updateDoc(doc(db, 'outcomes', id), updatedData);
      
      setOutcomes(outcomes.map(o => o.id === id ? { ...o, ...updatedData } : o).sort((a, b) => new Date(b.date) - new Date(a.date)));
      setEditingOutcomeId(null);
      setMessage('Gasto actualizado correctamente');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error actualizando gasto:", error);
    }
  };

  const handleDelete = async (id) => {
    if (!(await showConfirm('¿Seguro que deseas eliminar este gasto? El dinero volverá a los fondos.'))) return;
    try {
      await deleteDoc(doc(db, 'outcomes', id));
      setOutcomes(outcomes.filter(o => o.id !== id));
      setMessage('Gasto eliminado');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error eliminando:", error);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  // Cálculos y Helpers del Modo Auditoría
  const systemTotalOutcomes = React.useMemo(() => {
    return outcomes.reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);
  }, [outcomes]);

  const auditTotalManual = React.useMemo(() => {
    return Object.entries(auditManualAmounts).reduce((sum, [, val]) => {
      const num = parseFloat(val);
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  }, [auditManualAmounts]);

  const auditTickedCount = React.useMemo(() => {
    return outcomes.filter(o => !!auditChecks[o.id]).length;
  }, [outcomes, auditChecks]);

  const auditDifference = auditTotalManual - systemTotalOutcomes;

  const handleToggleAuditCheck = (id) => {
    const isCurrentlyChecked = !!auditChecks[id];
    const newCheckState = !isCurrentlyChecked;
    
    setAuditChecks(prev => ({ ...prev, [id]: newCheckState }));

    if (newCheckState && (auditManualAmounts[id] === undefined || auditManualAmounts[id] === '')) {
      const outcome = outcomes.find(o => o.id === id);
      if (outcome) {
        setAuditManualAmounts(prev => ({ ...prev, [id]: outcome.amount }));
      }
    }
  };

  const handleAuditManualAmountChange = (id, val) => {
    setAuditManualAmounts(prev => ({ ...prev, [id]: val }));
    if (val !== '' && !auditChecks[id]) {
      setAuditChecks(prev => ({ ...prev, [id]: true }));
    }
  };

  const handleAutoFillAudit = () => {
    const newAmounts = {};
    const newChecks = {};
    outcomes.forEach(o => {
      newAmounts[o.id] = o.amount;
      newChecks[o.id] = true;
    });
    setAuditManualAmounts(newAmounts);
    setAuditChecks(newChecks);
  };

  const handleToggleAllAuditChecks = () => {
    const allChecked = outcomes.every(o => auditChecks[o.id]);
    const newChecks = {};
    outcomes.forEach(o => {
      newChecks[o.id] = !allChecked;
    });
    setAuditChecks(newChecks);
  };

  const handleClearAudit = () => {
    setAuditChecks({});
    setAuditManualAmounts({});
  };

  const handleAcceptAllAudit = async () => {
    if (Object.keys(auditManualAmounts).length === 0) {
      await showAlert("No hay montos manuales ingresados. Ingresa al menos uno o usa 'Copiar del Sistema'.");
      return;
    }

    if (!(await showConfirm(`¿Estás seguro de reemplazar TODOS los montos en sistema por las sumas manuales auditadas?\n\n⚠️ ATENCIÓN: Cualquier gasto que NO tenga un monto manual ingresado quedará en $0. La Suma Registrada en Sistema pasará a ser exactamente la Suma Manual Auditada.`))) return;

    setLoading(true);
    try {
      let updatedCount = 0;
      for (const o of outcomes) {
        const manualAmtStr = auditManualAmounts[o.id];
        
        let manualAmt = 0;
        if (manualAmtStr !== undefined && manualAmtStr !== '') {
          manualAmt = parseFloat(manualAmtStr);
          if (isNaN(manualAmt) || manualAmt < 0) manualAmt = 0;
        }

        await updateDoc(doc(db, 'outcomes', o.id), {
          amount: manualAmt
        });
        
        updatedCount++;
      }
      
      await showAlert(`Se ha reemplazado la suma del sistema con éxito. ${updatedCount} registros actualizados.`);
      
      setAuditChecks({});
      setAuditManualAmounts({});
      
      fetchData();
    } catch (error) {
      console.error("Error al actualizar montos de auditoría masivos:", error);
      await showAlert("Error al guardar los montos auditados.");
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando gastos...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
            <ArrowLeft size={18} />
          </button>
          <h3 style={{ margin: 0 }}>Historial y Registro de Gastos</h3>
        </div>

        <button 
          onClick={() => setIsAuditMode(!isAuditMode)}
          className={`btn ${isAuditMode ? 'btn-primary' : 'btn-outline'}`}
          style={{ 
            backgroundColor: isAuditMode ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
            borderColor: isAuditMode ? '#8b5cf6' : 'var(--border-color)',
            color: isAuditMode ? '#c4b5fd' : 'var(--text-main)',
            display: 'flex', alignItems: 'center', gap: '0.5rem'
          }}
        >
          <ShieldCheck size={18} />
          {isAuditMode ? 'Modo Auditoría Activo' : 'Activar Modo Auditoría'}
        </button>
      </div>

      {isAuditMode && (
        <div className="glass-panel animate-fade-in" style={{ padding: '1.5rem', marginBottom: '2rem', border: '1px solid rgba(139, 92, 246, 0.4)', background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(88, 28, 135, 0.2) 100%)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ backgroundColor: 'rgba(139, 92, 246, 0.25)', padding: '0.6rem', borderRadius: '10px', color: '#a78bfa' }}>
                <Calculator size={22} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#c4b5fd' }}>Panel de Auditoría de Gastos</h3>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Verifica que cada gasto registrado concuerde con las boletas/facturas.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button 
                onClick={handleToggleAllAuditChecks}
                className="btn btn-outline"
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', borderColor: '#8b5cf6', color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <CheckSquare size={15} />
                {auditTickedCount === outcomes.length ? 'Desmarcar Todos' : 'Tickear Todos'}
              </button>
              <button 
                onClick={handleAutoFillAudit}
                className="btn btn-outline"
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', borderColor: 'var(--primary)', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Sparkles size={15} />
                Copiar del Sistema
              </button>
              <button 
                onClick={handleClearAudit}
                className="btn btn-outline"
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <RotateCcw size={15} />
                Limpiar
              </button>
              <button 
                onClick={handleAcceptAllAudit}
                className="btn btn-primary"
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', backgroundColor: '#8b5cf6', border: 'none', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 'bold' }}
                disabled={Object.keys(auditManualAmounts).length === 0}
              >
                <Save size={15} />
                Aceptar Suma Auditada
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Suma Registrada en Sistema</span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.35rem', color: 'var(--text-main)' }}>
                {formatMoney(systemTotalOutcomes)}
              </h3>
            </div>

            <div style={{ padding: '1rem', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
              <span style={{ fontSize: '0.8rem', color: '#c4b5fd' }}>Suma Manual Auditada</span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.35rem', color: '#a78bfa' }}>
                {formatMoney(auditTotalManual)}
              </h3>
            </div>

            <div style={{ 
              padding: '1rem', 
              backgroundColor: auditDifference === 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.15)', 
              borderRadius: 'var(--radius-md)', 
              border: auditDifference === 0 ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.4)' 
            }}>
              <span style={{ fontSize: '0.8rem', color: auditDifference === 0 ? 'var(--success)' : 'var(--danger)' }}>
                Diferencia de Cuadratura
              </span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.35rem', color: auditDifference === 0 ? 'var(--success)' : 'var(--danger)' }}>
                {auditDifference > 0 ? `+${formatMoney(auditDifference)}` : formatMoney(auditDifference)}
              </h3>
            </div>
          </div>
        </div>
      )}

      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
        Registra aquí las compras o pagos que realiza la directiva usando los fondos del curso. Esto restará del saldo disponible en caja.
      </p>

      {message && (
        <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', color: 'var(--success)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={18} /> {message}
        </div>
      )}

      {/* Formulario para agregar egreso */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)' }}>
          <TrendingDown size={18} /> Registrar Nuevo Gasto
        </h4>
        <form onSubmit={handleAddOutcome} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: '2', minWidth: '200px', marginBottom: 0 }}>
            <label className="input-label">Motivo / Descripción</label>
            <input 
              type="text" 
              required
              className="input-field" 
              placeholder="Ej. Compra de cartulinas"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '150px', marginBottom: 0 }}>
            <label className="input-label">Fecha (Opcional)</label>
            <input 
              type="date" 
              className="input-field" 
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '150px', marginBottom: 0 }}>
            <label className="input-label">Monto ($)</label>
            <input 
              type="number" 
              required
              min="1"
              className="input-field" 
              placeholder="Ej. 15000"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '150px', marginBottom: 0 }}>
            <label className="input-label">Medio de Pago</label>
            <select 
              className="input-field" 
              value={newMethod}
              onChange={(e) => setNewMethod(e.target.value)}
            >
              <option value="cash">Efectivo (Caja Chica)</option>
              <option value="transfer">Transferencia (Cuenta)</option>
            </select>
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '150px', marginBottom: 0 }}>
            <label className="input-label">Fondo de Origen (Opcional)</label>
            <select 
              className="input-field" 
              value={selectedFundId}
              onChange={(e) => setSelectedFundId(e.target.value)}
            >
              <option value="general">Fondo General</option>
              {funds.filter(f => !f.isLocked && f.id !== 'general').map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-outline" style={{ height: '42px', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
            Registrar Gasto
          </button>
        </form>
      </div>

      <div className="glass-panel" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              {isAuditMode && <th style={{ padding: '1rem' }}>Audit.</th>}
              <th style={{ padding: '1rem' }}>Fecha</th>
              <th style={{ padding: '1rem' }}>Motivo</th>
              <th style={{ padding: '1rem' }}>{isAuditMode ? 'Monto Sistema' : 'Monto'}</th>
              {isAuditMode && <th style={{ padding: '1rem' }}>Monto Manual ($)</th>}
              {isAuditMode && <th style={{ padding: '1rem' }}>Cuadratura</th>}
              <th style={{ padding: '1rem' }}>Medio/Fondo</th>
              <th style={{ padding: '1rem' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map(o => {
              const f = funds.find(fund => fund.id === o.fundId);
              return (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  {editingOutcomeId === o.id ? (
                    <>
                      <td style={{ padding: '1rem' }}>
                        <input type="date" className="input-field" value={editOutcomeDate} onChange={e => setEditOutcomeDate(e.target.value)} style={{ margin: 0, padding: '0.4rem 0.5rem', minWidth: '120px' }} />
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <input type="text" className="input-field" value={editOutcomeTitle} onChange={e => setEditOutcomeTitle(e.target.value)} style={{ margin: 0, padding: '0.4rem 0.5rem' }} />
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <input type="number" className="input-field" value={editOutcomeAmount} onChange={e => setEditOutcomeAmount(e.target.value)} style={{ margin: 0, padding: '0.4rem 0.5rem', width: '100px' }} />
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <select className="input-field" value={editOutcomeMethod} onChange={e => setEditOutcomeMethod(e.target.value)} style={{ margin: '0 0 0.5rem 0', padding: '0.4rem 0.5rem' }}>
                          <option value="cash">Efectivo</option>
                          <option value="transfer">Transferencia</option>
                        </select>
                        <select className="input-field" value={editOutcomeFund} onChange={e => setEditOutcomeFund(e.target.value)} style={{ margin: 0, padding: '0.4rem 0.5rem' }}>
                          <option value="general">Fondo General</option>
                          {funds.filter(fd => !fd.isLocked && fd.id !== 'general').map(fd => (
                            <option key={fd.id} value={fd.id}>{fd.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={() => handleSaveEdit(o.id)} className="btn btn-primary" style={{ padding: '0.4rem 0.75rem', backgroundColor: 'var(--success)' }}>
                            <CheckCircle size={16} /> Guardar
                          </button>
                          <button onClick={() => setEditingOutcomeId(null)} className="btn btn-outline" style={{ padding: '0.4rem 0.75rem' }}>Cancelar</button>
                        </div>
                      </td>
                    </>
                  ) : isAuditMode ? (
                    <>
                      <td style={{ padding: '1rem' }}>
                        <div 
                          onClick={(e) => { e.stopPropagation(); handleToggleAuditCheck(o.id); }}
                          style={{
                            width: '24px', height: '24px', borderRadius: '6px', 
                            border: `2px solid ${auditChecks[o.id] ? '#8b5cf6' : 'var(--border-color)'}`,
                            backgroundColor: auditChecks[o.id] ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                          }}
                        >
                          {auditChecks[o.id] && <Check size={16} color="#8b5cf6" />}
                        </div>
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{o.date}</td>
                      <td style={{ padding: '1rem', fontWeight: '500' }}>{o.title}</td>
                      <td style={{ padding: '1rem', color: 'var(--danger)', fontWeight: 'bold' }}>{formatMoney(o.amount)}</td>
                      
                      <td style={{ padding: '1rem' }}>
                        <input
                          type="number"
                          className="input-field"
                          placeholder="$ 0"
                          value={auditManualAmounts[o.id] !== undefined ? auditManualAmounts[o.id] : ''}
                          onChange={(e) => handleAuditManualAmountChange(o.id, e.target.value)}
                          style={{
                            width: '100px', margin: 0, padding: '0.4rem 0.5rem',
                            borderColor: auditManualAmounts[o.id] !== undefined ? '#8b5cf6' : 'var(--border-color)',
                            backgroundColor: auditManualAmounts[o.id] !== undefined ? 'rgba(139,92,246,0.05)' : 'transparent'
                          }}
                        />
                      </td>

                      <td style={{ padding: '1rem' }}>
                        {(() => {
                          const manualVal = parseFloat(auditManualAmounts[o.id]);
                          if (isNaN(manualVal)) {
                            return <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Sin ingresar</span>;
                          }
                          const sysAmt = parseFloat(o.amount) || 0;
                          const diff = manualVal - sysAmt;
                          if (diff === 0) {
                            return (
                              <span style={{ 
                                fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '10px', 
                                backgroundColor: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '0.2rem'
                              }}>
                                <Check size={13} /> OK ($0)
                              </span>
                            );
                          }
                          return (
                            <span style={{ 
                              fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '10px', 
                              backgroundColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--danger)', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '0.2rem'
                            }}>
                              <AlertTriangle size={13} /> {diff > 0 ? `+${formatMoney(diff)}` : formatMoney(diff)}
                            </span>
                          );
                        })()}
                      </td>

                      <td style={{ padding: '1rem' }}>
                        <div style={{ fontSize: '0.9rem' }}>{o.paymentMethod === 'cash' ? '💵 Efectivo' : '🏦 Transferencia'}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{f ? f.name : 'Fondo General'}</div>
                      </td>

                      <td style={{ padding: '1rem' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleAuditCheck(o.id); }}
                          className="btn btn-outline"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', borderColor: auditChecks[o.id] ? 'var(--success)' : '#8b5cf6', color: auditChecks[o.id] ? 'var(--success)' : '#c4b5fd' }}
                        >
                          {auditChecks[o.id] ? '✔ Listo' : 'Verificar'}
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{o.date}</td>
                      <td style={{ padding: '1rem', fontWeight: '500' }}>{o.title}</td>
                      <td style={{ padding: '1rem', color: 'var(--danger)', fontWeight: 'bold' }}>- {formatMoney(o.amount)}</td>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ fontSize: '0.9rem' }}>{o.paymentMethod === 'cash' ? '💵 Efectivo' : '🏦 Transferencia'}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{f ? f.name : 'Fondo General'}</div>
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={() => { 
                            setEditingOutcomeId(o.id); 
                            setEditOutcomeTitle(o.title); 
                            setEditOutcomeAmount(o.amount); 
                            setEditOutcomeDate(o.date); 
                            setEditOutcomeMethod(o.paymentMethod || 'cash'); 
                            setEditOutcomeFund(o.fundId || 'general'); 
                          }} className="btn btn-outline" style={{ padding: '0.4rem 0.75rem', gap: '0.5rem', display: 'flex', alignItems: 'center' }}>
                            <Edit2 size={16} /> Editar
                          </button>
                          <button onClick={() => handleDelete(o.id)} className="btn btn-outline" style={{ padding: '0.4rem 0.75rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)', gap: '0.5rem', display: 'flex', alignItems: 'center' }}>
                            <Trash2 size={16} /> Eliminar
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {outcomes.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No se han registrado gastos aún.
          </div>
        )}
      </div>
    </div>
  );
};

export default OutcomeManagement;
