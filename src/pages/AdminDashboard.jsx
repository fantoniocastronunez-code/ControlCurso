import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, Users, DollarSign, Activity, FileText, RefreshCw, Calendar, Trash2, CreditCard } from 'lucide-react';
import { db } from '../firebase/config';
import { collection, getDocs, query, where, orderBy, addDoc, doc, setDoc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useModal } from '../context/ModalContext';

import UserManagement from '../components/UserManagement';
import StudentManagement from '../components/StudentManagement';
import ExpenseManagement from '../components/ExpenseManagement';
import ExpenseDetail from '../components/ExpenseDetail';
import DebtorsManagement from '../components/DebtorsManagement';
import OutcomeManagement from '../components/OutcomeManagement';
import FundManagement from '../components/FundManagement';
import EventManagement from '../components/events/EventManagement';
import SettingsManagement from '../components/SettingsManagement';
import FundHistoryModal from '../components/FundHistoryModal';

const AdminDashboard = () => {
  const { user, role, logout } = useAuth();
  const { showAlert, showPrompt } = useModal();
  const navigate = useNavigate();
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedExpenseId, setSelectedExpenseId] = useState(null);
  const [stats, setStats] = useState({
    activeStudents: 0,
    registeredApoderados: 0,
    totalCollected: 0,
    totalExpected: 0,
    totalAvailable: 0,
    fundsBalances: [],
    allTransactions: []
  });
  
  const [selectedFundForHistory, setSelectedFundForHistory] = useState(null);
  
  // Lista de cuotas
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentView === 'dashboard') {
      fetchDashboardData();
    }
  }, [currentView]);



  const handleZeroOutFund = async (fundId, fundName, currentBalance) => {
    if (currentBalance === 0) return;
    if (!window.confirm(`¿Estás seguro de que quieres ajustar el ${fundName}? Se creará un ajuste interno para dejar su saldo en $0.`)) return;

    try {
      if (currentBalance < 0) {
        await addDoc(collection(db, 'incomes'), {
          amount: Math.abs(currentBalance),
          description: `Ajuste automático para balancear ${fundName}`,
          paymentMethod: 'cash',
          fundId: fundId,
          createdAt: new Date().toISOString()
        });
      } else {
        await addDoc(collection(db, 'outcomes'), {
          amount: currentBalance,
          description: `Ajuste automático para balancear ${fundName}`,
          paymentMethod: 'cash',
          fundId: fundId,
          createdAt: new Date().toISOString()
        });
      }
      fetchDashboardData();
      alert(`El ${fundName} ha sido ajustado a $0.`);
    } catch (error) {
      console.error(error);
      alert('Hubo un error al ajustar el fondo.');
    }
  };

  const handleQuickIncome = async () => {
    const titleStr = await showPrompt("Nombre para este ingreso (Ej: Aporte anónimo, Bingo, etc):", "Ingreso Rápido");
    if (!titleStr) return;
    
    const amountStr = await showPrompt(`Monto a sumar para "${titleStr}":`, "");
    if (!amountStr) return;
    
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      await showAlert("Monto inválido.");
      return;
    }
    
    setLoading(true);
    try {
      await addDoc(collection(db, 'incomes'), {
        amount: amount,
        title: titleStr,
        description: 'Monto agregado mediante ingreso rápido',
        paymentMethod: 'cash',
        fundId: 'general',
        createdAt: new Date().toISOString()
      });
      fetchDashboardData();
      await showAlert(`Ingreso "${titleStr}" agregado correctamente al Fondo General.`);
    } catch (error) {
      console.error(error);
      await showAlert("Hubo un error al agregar el dinero.");
      setLoading(false);
    }
  };

  const handleQuickOutcome = async () => {
    const titleStr = await showPrompt("Motivo del gasto (Ej: Cartulinas, Fotocopias, etc):", "Gasto Rápido");
    if (!titleStr) return;
    
    const amountStr = await showPrompt(`Monto gastado en "${titleStr}":`, "");
    if (!amountStr) return;
    
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      await showAlert("Monto inválido.");
      return;
    }

    const dateStr = await showPrompt("Fecha del gasto (Opcional, formato AAAA-MM-DD o déjalo en blanco para hoy):", "");
    let finalDate = new Date().toISOString().split('T')[0];
    
    if (dateStr) {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        finalDate = parsed.toISOString().split('T')[0];
      } else {
        await showAlert("Formato de fecha no válido. Se usará la fecha de hoy.");
      }
    }
    
    setLoading(true);
    try {
      await addDoc(collection(db, 'outcomes'), {
        amount: amount,
        title: titleStr,
        description: 'Gasto registrado rápidamente',
        paymentMethod: 'cash',
        fundId: 'general',
        date: finalDate,
        createdAt: new Date().toISOString()
      });
      fetchDashboardData();
      await showAlert(`Gasto "${titleStr}" registrado correctamente descontado del Fondo General.`);
    } catch (error) {
      console.error(error);
      await showAlert("Hubo un error al registrar el gasto.");
      setLoading(false);
    }
  };

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      // 1. Alumnos Activos
      const studentsSnap = await getDocs(collection(db, 'students'));
      const activeStudentsCount = studentsSnap.size;

      // 1.5 Apoderados registrados
      let registeredApoderadosCount = 0;
      if (role === 'superadmin' || role === 'admin') {
        const usersSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'apoderado')));
        registeredApoderadosCount = usersSnap.size;
      }

      // 2. Cuotas / Gastos
      const expensesSnap = await getDocs(collection(db, 'expenses'));
      let expected = 0;
      const expensesList = [];
      
      expensesSnap.forEach(doc => {
        const data = doc.data();
        expected += (data.totalAmount || 0);
        expensesList.push({ id: doc.id, ...data });
      });
      
      // Ordenar localmente por fecha descendente
      expensesList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // 3. Fondos (Categorías)
      const fundsSnap = await getDocs(collection(db, 'funds'));
      const fundsMap = new Map(); // id -> { name, balance }
      fundsSnap.forEach(doc => {
        fundsMap.set(doc.id, { id: doc.id, name: doc.data().name, balance: 0 });
      });
      // Asegurar que exista el Fondo General
      if (!fundsMap.has('general')) {
        fundsMap.set('general', { id: 'general', name: 'Fondo General', balance: 0 });
      }

      // 4. Cobros (Dinero realmente pagado)
      const debtsSnap = await getDocs(query(collection(db, 'debts'), where('status', 'in', ['paid', 'partial'])));
      const debtsDocs = debtsSnap.docs;
      let collected = 0;
      let cashIn = 0;
      let transferIn = 0;
      const allTransactions = [];
      const expenseCollectedMap = {};
      
      debtsDocs.forEach(doc => {
        const data = doc.data();
        let fundId = data.fundId || 'general';
        
        // Si el fondo fue eliminado, ignorar el dinero por completo
        if (!fundsMap.has(fundId)) return;

        const amt = typeof data.paidAmount === 'number' ? data.paidAmount : (data.amount || 0);
        const expected = data.amount || 0;
        
        const baseAmt = Math.min(amt, expected);
        const overpayAmt = Math.max(0, amt - expected);
        
        collected += amt;
        
        if (data.paymentMethod === 'cash') cashIn += baseAmt;
        if (data.paymentMethod === 'transfer') transferIn += baseAmt;
        
        // El usuario solicitó que todo el saldo a favor (overpay) se cuente como transferencia
        transferIn += overpayAmt;
        
        // Sumar lo recaudado por cada cuota
        if (data.expenseId) {
          if (!expenseCollectedMap[data.expenseId]) expenseCollectedMap[data.expenseId] = 0;
          expenseCollectedMap[data.expenseId] += amt;
        }
      });
      
      // Asignar lo recaudado a cada cuota en la lista
      expensesList.forEach(exp => {
        exp.collectedAmount = expenseCollectedMap[exp.id] || 0;
      });

      // 5. Gastos Directiva (Egresos)
      const outcomesSnap = await getDocs(collection(db, 'outcomes'));
      const outcomesDocs = outcomesSnap.docs;
      let cashOut = 0;
      let transferOut = 0;
      outcomesDocs.forEach(doc => {
        const data = doc.data();
        let fundId = data.fundId || 'general';
        if (!fundsMap.has(fundId)) return;

        const amt = data.amount || 0;
        if (data.paymentMethod === 'cash') cashOut += amt;
        if (data.paymentMethod === 'transfer') transferOut += amt;
      });

      // 6. Ingresos Manuales (Saldos Iniciales/Extras)
      const incomesSnap = await getDocs(collection(db, 'incomes'));
      const incomesDocs = incomesSnap.docs;
      incomesDocs.forEach(docSnap => {
        const data = docSnap.data();
        
        // TEMPORAL: Eliminar registro fantasma de 33000
        if (data.amount === 33000 && data.description && data.description.includes('Ajuste automático')) {
          import('firebase/firestore').then(({ deleteDoc, doc: fsDoc }) => {
            deleteDoc(fsDoc(db, 'incomes', docSnap.id)).catch(console.error);
          });
          return; // Skip this one
        }

        // TEMPORAL: Mover Ingreso Rápido 101970 a banco
        if (data.amount === 101970 && data.title === 'Ingreso Rápido' && data.paymentMethod === 'cash') {
          import('firebase/firestore').then(({ updateDoc, doc: fsDoc }) => {
            updateDoc(fsDoc(db, 'incomes', docSnap.id), { 
              paymentMethod: 'transfer', 
              title: 'Saldo Año Anterior' 
            }).catch(console.error);
          });
          data.paymentMethod = 'transfer';
          data.title = 'Saldo Año Anterior';
        }

        let fundId = data.fundId || 'general';
        if (!fundsMap.has(fundId)) return;

        const amt = data.amount || 0;
        if (data.paymentMethod === 'cash') cashIn += amt;
        if (data.paymentMethod === 'transfer') transferIn += amt;
      });

      // Calcular balances por fondo y llenar transacciones
      debtsDocs.forEach(doc => {
        const data = doc.data();
        let fundId = data.fundId || 'general';
        if (!fundsMap.has(fundId)) return;

        const amt = typeof data.paidAmount === 'number' ? data.paidAmount : (data.amount || 0);
        
        if (data.paymentMethod === 'balance') {
           fundsMap.get(fundId).balance += amt;
           allTransactions.push({ id: doc.id + '_add', fundId: fundId, type: 'debt_payment', amount: amt, paymentMethod: data.paymentMethod, description: `Pago ${data.studentName ? 'de ' + data.studentName : ''}: ${data.title || 'Cuota'} (Saldo a favor)`, date: data.approvedAt || data.paidAt || data.createdAt });
           return;
        }
        
        fundsMap.get(fundId).balance += amt;
        allTransactions.push({ id: doc.id, fundId: fundId, type: 'debt_payment', amount: amt, paymentMethod: data.paymentMethod, description: `Pago ${data.studentName ? 'de ' + data.studentName : ''}: ${data.title || 'Cuota'}`, date: data.approvedAt || data.paidAt || data.createdAt });
      });

      outcomesDocs.forEach(doc => {
        const data = doc.data();
        let fundId = data.fundId || 'general';
        if (!fundsMap.has(fundId)) return;
        
        const amt = data.amount || 0;
        fundsMap.get(fundId).balance -= amt;
        allTransactions.push({ id: doc.id, fundId: fundId, type: 'outcome', amount: -amt, paymentMethod: data.paymentMethod, description: data.title || data.description || 'Gasto', date: data.date || data.createdAt });
      });

      incomesDocs.forEach(docSnap => {
        const data = docSnap.data();
        
        if (data.amount === 33000 && data.description && data.description.includes('Ajuste automático')) {
          return; // Ignorar en historial
        }
        


        let fundId = data.fundId || 'general';
        if (!fundsMap.has(fundId)) return;
        
        const amt = data.amount || 0;
        fundsMap.get(fundId).balance += amt;
        allTransactions.push({ id: docSnap.id, fundId: fundId, type: 'income', amount: amt, paymentMethod: data.paymentMethod, description: data.title || data.description || 'Ingreso', date: data.createdAt });
      });

      // Transferencias entre fondos
      const transfersSnap = await getDocs(collection(db, 'fund_transfers'));
      transfersSnap.forEach(doc => {
        const data = doc.data();
        const amt = data.amount || 0;
        let fromId = data.fromFundId;
        let toId = data.toFundId;

        if (fromId && !fundsMap.has(fromId)) fromId = 'general';
        if (toId && !fundsMap.has(toId)) toId = 'general';

        if (fromId && fundsMap.has(fromId)) {
          fundsMap.get(fromId).balance -= amt;
          allTransactions.push({ id: doc.id + '_out', fundId: fromId, type: 'transfer_out', amount: -amt, description: 'Transferencia saliente', date: data.createdAt });
        }
        if (toId && fundsMap.has(toId)) {
          fundsMap.get(toId).balance += amt;
          allTransactions.push({ id: doc.id + '_in', fundId: toId, type: 'transfer_in', amount: amt, description: 'Transferencia entrante', date: data.createdAt });
        }
      });

      // Calcular Fondo Saldos a Favor
      let totalFavorBalance = 0;
      const studentsWithBalance = [];
      studentsSnap.forEach(doc => {
        const data = doc.data();
        if (data.balance && parseFloat(data.balance) > 0) {
          totalFavorBalance += parseFloat(data.balance);
          studentsWithBalance.push({ name: data.name, balance: parseFloat(data.balance) });
        }
      });
      
      // El usuario solicitó que todo el saldo a favor manual esté físicamente en Transferencias
      transferIn += totalFavorBalance;
      
      if (totalFavorBalance > 0) {
        fundsMap.set('favor_balance', { 
          id: 'favor_balance', 
          name: 'Saldos a Favor (Alumnos)', 
          balance: totalFavorBalance,
          studentsWithBalance
        });
      }

      const fundsBalances = Array.from(fundsMap.values());
      const totalAvailable = fundsBalances.reduce((sum, fund) => sum + fund.balance, 0);

      setStats({
        activeStudents: activeStudentsCount,
        registeredApoderados: registeredApoderadosCount,
        totalCollected: collected,
        totalExpected: expected,
        totalAvailable,
        fundsBalances,
        allTransactions,
        cashBalance: cashIn - cashOut,
        transferBalance: transferIn - transferOut
      });
      setExpenses(expensesList);

    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  return (
    <div className="container animate-fade-in">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <img 
            src="/LOGOAPPCURSO.jpg" 
            alt="Logo" 
            style={{ width: '75px', height: '75px', borderRadius: '8px', objectFit: 'cover', backgroundColor: 'white', padding: 0, border: '1px solid rgba(255,255,255,0.1)' }} 
            onError={(e) => e.target.style.display = 'none'}
          />
          <div>
            <h2 style={{ margin: 0 }}>Panel de Administración</h2>
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>Bienvenido, {user?.displayName} ({role})</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/apoderado')} className="btn btn-outline" style={{ borderColor: 'var(--success)', color: 'var(--success)' }} title="Ver cómo se ve la app para un apoderado">
            Vista Apoderado
          </button>
          <button onClick={() => window.location.reload()} className="btn btn-outline" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }} title="Forzar recarga de la página">
            <RefreshCw size={18} />
            Actualizar
          </button>
          <button onClick={logout} className="btn btn-outline">
            <LogOut size={18} />
            Salir
          </button>
        </div>
      </header>

      {currentView === 'dashboard' ? (
        <>
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando datos...</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ backgroundColor: 'rgba(99,102,241,0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--primary)' }}>
                    <Users size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{stats.activeStudents}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Alumnos Activos</p>
                  </div>
                </div>

                {role === 'superadmin' && (
                  <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--warning)' }}>
                      <Users size={24} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{stats.registeredApoderados}</h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Apoderados Registrados</p>
                    </div>
                  </div>
                )}

                <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', gridColumn: '1 / -1' }}>
                  <div style={{ backgroundColor: 'rgba(239,68,68,0.2)', padding: '1.5rem', borderRadius: '50%', color: 'var(--danger)' }}>
                    <FileText size={32} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '2rem', margin: 0 }}>{formatMoney(stats.totalAvailable)}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '1rem', margin: 0 }}>Fondo Total Disponible (Suma de todos los fondos)</p>
                  </div>
                </div>

                <div 
                  className="glass-panel" 
                  onClick={() => setSelectedFundForHistory({ id: 'cash_history', name: 'Historial de Efectivo (Caja)', balance: stats.cashBalance || 0 })}
                  style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--success)' }}>
                    <DollarSign size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{formatMoney(stats.cashBalance || 0)}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>En Efectivo (Caja)</p>
                  </div>
                </div>

                <div 
                  className="glass-panel" 
                  onClick={() => setSelectedFundForHistory({ id: 'transfer_history', name: 'Historial de Banco (Transferencias)', balance: stats.transferBalance || 0 })}
                  style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  <div style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', padding: '1rem', borderRadius: '50%', color: '#3b82f6' }}>
                    <CreditCard size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{formatMoney(stats.transferBalance || 0)}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>En Banco (Transferencias)</p>
                  </div>
                </div>
              </div>

              {stats.fundsBalances.length > 0 && (
                <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
                  <h4 style={{ marginBottom: '1rem', color: 'var(--primary)', margin: 0 }}>Distribución por Fondos</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                    {stats.fundsBalances.map(fb => (
                      <div 
                        key={fb.id} 
                        style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', position: 'relative', cursor: 'pointer', transition: 'all 0.2s' }}
                        onClick={() => setSelectedFundForHistory(fb)}
                        className="fund-card-hover"
                      >
                        {fb.id === 'general' && fb.balance !== 0 && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleZeroOutFund(fb.id, fb.name, fb.balance); }}
                            style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.7 }}
                            title="Borrar fondo (ajustar a $0)"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0 0 0.5rem 0', paddingRight: '1.5rem' }}>{fb.name}</p>
                        <h4 style={{ margin: 0 }}>{formatMoney(fb.balance)}</h4>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
                <h3>Gestión Rápida</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Selecciona una acción para administrar el curso.</p>
                
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <button onClick={handleQuickIncome} className="btn btn-primary" style={{ backgroundColor: 'var(--success)' }}>
                    + Ingreso Rápido
                  </button>
                  <button onClick={handleQuickOutcome} className="btn btn-primary" style={{ backgroundColor: 'var(--danger)' }}>
                    - Anotar Gasto
                  </button>
                  <button onClick={() => setCurrentView('expenses_add')} className="btn btn-primary">
                    Cobrar Cuota
                  </button>
                  <button onClick={() => setCurrentView('outcomes')} className="btn btn-outline" style={{ color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                    Historial de Gastos
                  </button>
                  <button onClick={() => setCurrentView('debtors')} className="btn btn-outline" style={{ color: 'var(--warning)', borderColor: 'rgba(245, 158, 11, 0.3)' }}>
                    Apoderados en Deuda
                  </button>
                  <button onClick={() => setCurrentView('students')} className="btn btn-outline">
                    Gestionar Alumnos
                  </button>
                  <button onClick={() => setCurrentView('funds')} className="btn btn-outline">
                    Administrar Fondos
                  </button>
                  <button onClick={() => setCurrentView('events')} className="btn btn-outline" style={{ color: 'var(--success)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                    Eventos y Ventas
                  </button>
                  <button onClick={() => setCurrentView('settings')} className="btn btn-outline" style={{ color: '#a855f7', borderColor: 'rgba(168, 85, 247, 0.3)' }}>
                    Configuración del Curso
                  </button>
                  {role === 'superadmin' && (
                     <button 
                       onClick={() => setCurrentView('users')}
                       className="btn btn-outline" 
                       style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
                     >
                       Gestionar Administradores
                     </button>
                  )}
                </div>
              </div>

              <div className="glass-panel" style={{ padding: '2rem' }}>
                <h3 style={{ marginBottom: '1.5rem' }}>Últimas Cuotas Emitidas</h3>
                {expenses.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>No hay cuotas emitidas todavía.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '1rem' }}>
                    {expenses.map(exp => (
                      <div 
                        key={exp.id} 
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'all 0.2s' }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
                        onClick={() => {
                          setSelectedExpenseId(exp.id);
                          setCurrentView('expense_detail');
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                           <div style={{ backgroundColor: 'rgba(99,102,241,0.1)', padding: '0.8rem', borderRadius: '50%', color: 'var(--primary)' }}>
                             <FileText size={20} />
                           </div>
                           <div>
                             <h4 style={{ margin: 0 }}>{exp.title}</h4>
                             <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>Emitido: {exp.date} • {exp.studentsCount} Alumnos</p>
                           </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p style={{ fontWeight: 'bold', margin: 0, color: 'var(--success)' }}>{formatMoney(exp.collectedAmount || 0)}</p>
                          <p style={{ fontSize: '0.85rem', color: exp.paidCount === exp.studentsCount ? 'var(--success)' : 'var(--warning)', margin: 0 }}>
                            {exp.paidCount || 0} de {exp.studentsCount} pagadas
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      ) : currentView === 'users' ? (
        <UserManagement onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'students' ? (
        <StudentManagement onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'expenses_add' ? (
        <ExpenseManagement onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'debtors' ? (
        <DebtorsManagement onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'outcomes' ? (
        <OutcomeManagement onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'funds' ? (
        <FundManagement onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'events' ? (
        <EventManagement onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'settings' ? (
        <SettingsManagement onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'expense_detail' && selectedExpenseId ? (
        <ExpenseDetail expenseId={selectedExpenseId} onBack={() => setCurrentView('dashboard')} />
      ) : null}

      <FundHistoryModal 
        fund={selectedFundForHistory}
        transactions={stats.allTransactions || []}
        onClose={() => setSelectedFundForHistory(null)}
      />
    </div>
  );
};

export default AdminDashboard;
