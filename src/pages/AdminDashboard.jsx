import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, Users, DollarSign, Activity, FileText, RefreshCw, Trash2, CreditCard, Search, Menu, X, PlusCircle, Settings, AlertTriangle, CheckCircle } from 'lucide-react';
import { db } from '../firebase/config';
import { collection, getDocs, query, where, addDoc, doc, setDoc, getDoc } from 'firebase/firestore';
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
import StudentSearchModal from '../components/StudentSearchModal';
import MeetingReport from '../components/MeetingReport';
import InstallAppGuide from '../components/InstallAppGuide';
import RegisteredApoderadosModal from '../components/RegisteredApoderadosModal';
import CourseManagement from '../components/CourseManagement';
import ApprovalsManagement from '../components/ApprovalsManagement';
import { useCourse } from '../context/CourseContext';

const AdminDashboard = () => {
  const { user, role, userData, logout } = useAuth();
  const { courses, selectedCourse, changeCourse } = useCourse();
  
  const courseRole = (role === 'superadmin' || userData?.roles?.global === 'superadmin')
    ? 'superadmin'
    : (userData?.roles?.[selectedCourse?.id] || null);
  const { showAlert, showPrompt } = useModal();
  const navigate = useNavigate();
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedExpenseId, setSelectedExpenseId] = useState(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [stats, setStats] = useState({
    activeStudents: 0,
    registeredApoderados: 0,
    totalCollected: 0,
    totalExpected: 0,
    totalAvailable: 0,
    fundsBalances: [],
    allTransactions: [],
    realBankBalance: 0,
    registeredApoderadosList: []
  });
  
  const [selectedFundForHistory, setSelectedFundForHistory] = useState(null);
  const [isApoderadosModalOpen, setIsApoderadosModalOpen] = useState(false);
  
  // Lista de cuotas
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);





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


  const fetchDashboardData = useCallback(async () => {
    if (!selectedCourse) return;
    setLoading(true);
    try {
      const studentsPromise = getDocs(query(collection(db, 'students'), where('courseId', '==', selectedCourse.id)));
      // Note: bankInfo might need to be isolated. For now we use the global settings document, but ideal to migrate to per-course
      const bankInfoPromise = getDoc(doc(db, 'settings', 'bankInfo'));
      const expensesPromise = getDocs(query(collection(db, 'expenses'), where('courseId', '==', selectedCourse.id)));
      const fundsPromise = getDocs(query(collection(db, 'funds'), where('courseId', '==', selectedCourse.id)));
      // Filter by courseId, and locally filter status to avoid composite index requirements
      const debtsPromise = getDocs(query(collection(db, 'debts'), where('courseId', '==', selectedCourse.id)));
      const outcomesPromise = getDocs(query(collection(db, 'outcomes'), where('courseId', '==', selectedCourse.id)));
      const incomesPromise = getDocs(query(collection(db, 'incomes'), where('courseId', '==', selectedCourse.id)));
      const transfersPromise = getDocs(query(collection(db, 'fund_transfers'), where('courseId', '==', selectedCourse.id)));
      
      const usersPromise = (role === 'superadmin' || role === 'admin') 
          ? getDocs(collection(db, 'users')) 
          : Promise.resolve({ docs: [], size: 0, forEach: () => {} });

      const [
        studentsSnap, bankInfoSnap, expensesSnap, fundsSnap, 
        allDebtsSnap, outcomesSnap, incomesSnap, transfersSnap, usersSnap
      ] = await Promise.all([
        studentsPromise, bankInfoPromise, expensesPromise, fundsPromise,
        debtsPromise, outcomesPromise, incomesPromise, transfersPromise, usersPromise
      ]);
      
      // Filter debts by status locally
      const debtsDocs = allDebtsSnap.docs.filter(d => {
        const status = d.data().status;
        return status === 'paid' || status === 'partial';
      });

      // 1. Alumnos Activos
      const activeStudentsCount = studentsSnap.size;

      // 1.2 Real Bank Balance
      const realBankBalance = bankInfoSnap.exists() ? bankInfoSnap.data().realBalance || 0 : 0;

      // 1.5 Apoderados registrados
      let registeredApoderadosCount = 0;
      let registeredApoderadosList = [];
      if (role === 'superadmin' || role === 'admin') {
        usersSnap.forEach(doc => {
          const u = doc.data();
          if (u.roles && u.roles[selectedCourse.id]) {
            registeredApoderadosList.push({ id: doc.id, ...u });
          }
        });
        registeredApoderadosCount = registeredApoderadosList.length;
      }

      // 2. Cuotas / Gastos
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
      const fundsMap = new Map(); // id -> { name, balance }
      fundsSnap.forEach(doc => {
        fundsMap.set(doc.id, { id: doc.id, name: doc.data().name, balance: 0 });
      });
      // Asegurar que exista el Fondo General
      if (!fundsMap.has('general')) {
        fundsMap.set('general', { id: 'general', name: 'Fondo General', balance: 0 });
      }

      // 4. Cobros (Dinero realmente pagado)
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

      const calculatedCashBalance = cashIn - cashOut;
      const calculatedTransferBalance = totalAvailable - calculatedCashBalance;

      setStats({
        activeStudents: activeStudentsCount,
        registeredApoderados: registeredApoderadosCount,
        totalCollected: collected,
        totalExpected: expected,
        totalAvailable,
        fundsBalances,
        allTransactions,
        cashBalance: calculatedCashBalance,
        transferBalance: calculatedTransferBalance,
        realBankBalance,
        registeredApoderadosList
      });
      setExpenses(expensesList);

    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }, [role, selectedCourse]);

  useEffect(() => {
    if (currentView === 'dashboard') {
      fetchDashboardData();
    }
  }, [currentView, fetchDashboardData]);

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const handleUpdateRealBankBalance = async () => {
    const amountStr = await showPrompt("Ingresa el monto real actual que tienes en la cuenta de banco:", stats.realBankBalance);
    if (amountStr === null) return;
    
    const amount = parseFloat(amountStr);
    if (isNaN(amount)) {
      await showAlert("Monto inválido.");
      return;
    }

    setLoading(true);
    try {
      await setDoc(doc(db, 'settings', 'bankInfo'), { realBalance: amount }, { merge: true });
      fetchDashboardData();
    } catch (error) {
      console.error(error);
      await showAlert("Error al actualizar el saldo.");
      setLoading(false);
    }
  };

  return (
    <>
      <div className={`sidebar-overlay ${isSidebarOpen ? 'open' : ''}`} onClick={() => setIsSidebarOpen(false)}></div>
      <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <button className="sidebar-close-btn" onClick={() => setIsSidebarOpen(false)}>
          <X size={24} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
          <img src="/LOGOAPPCURSO.jpg" alt="Logo" style={{ width: '50px', height: '50px', borderRadius: '8px', objectFit: 'cover' }} onError={(e) => e.target.style.display = 'none'} />
          <h3 style={{ margin: 0 }}>Menú</h3>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button onClick={() => { setCurrentView('dashboard'); setIsSidebarOpen(false); }} className="btn btn-outline" style={{ justifyContent: 'flex-start' }}>
            <Activity size={18} /> Panel Principal
          </button>
          <button onClick={() => { setCurrentView('meeting_report'); setIsSidebarOpen(false); }} className="btn btn-outline" style={{ borderColor: '#8b5cf6', color: '#8b5cf6', justifyContent: 'flex-start' }}>
            <FileText size={18} /> Informe Reunión
          </button>
          <button onClick={() => { setCurrentView('outcomes'); setIsSidebarOpen(false); }} className="btn btn-outline" style={{ borderColor: 'rgba(239, 68, 68, 0.3)', color: 'var(--danger)', justifyContent: 'flex-start' }}>
            <DollarSign size={18} /> Historial Gastos
          </button>
          <button onClick={() => { setCurrentView('funds'); setIsSidebarOpen(false); }} className="btn btn-outline" style={{ justifyContent: 'flex-start' }}>
            <CreditCard size={18} /> Administrar Fondos
          </button>
          <button onClick={() => { setCurrentView('events'); setIsSidebarOpen(false); }} className="btn btn-outline" style={{ borderColor: 'rgba(16, 185, 129, 0.3)', color: 'var(--success)', justifyContent: 'flex-start' }}>
            <Activity size={18} /> Eventos y Ventas
          </button>
          {['superadmin', 'admin', 'presidente', 'tesorero'].includes(courseRole) && (
            <>
              <button onClick={() => { setCurrentView('expenses_add'); setIsSidebarOpen(false); }} className="btn btn-outline" style={{ borderColor: 'var(--primary)', color: 'var(--primary)', justifyContent: 'flex-start' }}>
                <PlusCircle size={18} /> Crear Cuota
              </button>
              <button onClick={() => { setCurrentView('debtors'); setIsSidebarOpen(false); }} className="btn btn-outline" style={{ borderColor: 'var(--warning)', color: 'var(--warning)', justifyContent: 'flex-start' }}>
                <AlertTriangle size={18} /> Deudas
              </button>
            </>
          )}
          {['superadmin', 'admin', 'presidente'].includes(courseRole) && (
            <button onClick={() => { setCurrentView('students'); setIsSidebarOpen(false); }} className="btn btn-outline" style={{ borderColor: '#3b82f6', color: '#3b82f6', justifyContent: 'flex-start' }}>
              <Users size={18} /> Alumnos
            </button>
          )}
          {courseRole === 'superadmin' || courseRole === 'tesorero' ? (
            <button onClick={() => { setCurrentView('approvals'); setIsSidebarOpen(false); }} className="btn btn-outline" style={{ borderColor: 'var(--success)', color: 'var(--success)', justifyContent: 'flex-start' }}>
              <CheckCircle size={18} /> Aprobaciones
            </button>
          ) : null}
          {['superadmin', 'admin', 'presidente'].includes(courseRole) && (
            <button onClick={() => { setCurrentView('settings'); setIsSidebarOpen(false); }} className="btn btn-outline" style={{ justifyContent: 'flex-start' }}>
              <Settings size={18} /> Configuración del Curso
            </button>
          )}
          {courseRole === 'superadmin' && (
            <>
              <button onClick={() => { setCurrentView('admins'); setIsSidebarOpen(false); }} className="btn btn-outline" style={{ borderColor: 'var(--warning)', color: 'var(--warning)', justifyContent: 'flex-start' }}>
                <Users size={18} /> Admins
              </button>
              <button onClick={() => { setCurrentView('users'); setIsSidebarOpen(false); }} className="btn btn-outline" style={{ borderColor: '#3b82f6', color: '#3b82f6', justifyContent: 'flex-start' }}>
                <Users size={18} /> Usuarios
              </button>
              <button onClick={() => { setCurrentView('courses'); setIsSidebarOpen(false); }} className="btn btn-outline" style={{ borderColor: '#ec4899', color: '#ec4899', justifyContent: 'flex-start' }}>
                <Activity size={18} /> Cursos
              </button>
            </>
          )}
        </div>
      </div>

      <div className="container animate-fade-in">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button onClick={() => setIsSidebarOpen(true)} className="hamburger-btn">
              <Menu size={24} />
            </button>
            <img 
              src="/LOGOAPPCURSO.jpg" 
              alt="Logo" 
              style={{ width: '75px', height: '75px', borderRadius: '8px', objectFit: 'cover', backgroundColor: 'white', padding: 0, border: '1px solid rgba(255,255,255,0.1)' }} 
              onError={(e) => e.target.style.display = 'none'}
            />
            <div>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                Panel {role === 'superadmin' ? 'SuperAdmin' : 'Admin'}
              </h2>
              {courses.length > 1 || role === 'superadmin' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                  <select 
                    value={selectedCourse?.id || ''} 
                    onChange={(e) => changeCourse(e.target.value)}
                    style={{ 
                      padding: '0.2rem 0.5rem', 
                      borderRadius: 'var(--radius-sm)', 
                      backgroundColor: 'rgba(255,255,255,0.1)', 
                      color: 'var(--text-main)', 
                      border: '1px solid rgba(255,255,255,0.2)',
                      fontSize: '0.9rem'
                    }}
                  >
                    {courses.map(c => (
                      <option key={c.id} value={c.id} style={{ color: '#000' }}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>{selectedCourse?.name || 'Cargando curso...'}</p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Barra de búsqueda interactiva */}
          <div 
            onClick={() => setIsSearchOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              borderRadius: 'var(--radius-md)',
              padding: '0.55rem 1rem',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              transition: 'all 0.2s ease',
              minWidth: '240px'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.09)';
              e.currentTarget.style.borderColor = 'var(--primary)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.4)';
            }}
          >
            <Search size={17} style={{ color: 'var(--primary)' }} />
            <span style={{ fontSize: '0.9rem', color: 'var(--text-main)', opacity: 0.8 }}>Buscar alumno o apoderado...</span>
          </div>

          <button onClick={() => setCurrentView('meeting_report')} className="btn btn-outline" style={{ borderColor: '#8b5cf6', color: '#8b5cf6', display: 'flex', alignItems: 'center', gap: '0.4rem' }} title="Generar informe y PDF para la reunión de apoderados">
            <FileText size={17} />
            Reunión Apoderados
          </button>
          <button onClick={() => navigate('/apoderado')} className="btn btn-outline" style={{ borderColor: 'var(--success)', color: 'var(--success)' }} title="Ver cómo se ve la app para un apoderado">
            Vista Apoderado
          </button>
          <button onClick={() => window.location.reload()} className="btn btn-outline" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }} title="Forzar recarga de la página">
            <RefreshCw size={18} />
            Actualizar
          </button>
          <InstallAppGuide />
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
                  <div 
                    className="glass-panel" 
                    style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'all 0.2s ease' }}
                    onClick={() => setIsApoderadosModalOpen(true)}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                    title="Ver lista de apoderados registrados"
                  >
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

                <div 
                  className="glass-panel" 
                  onClick={handleUpdateRealBankBalance}
                  style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'all 0.2s ease', border: '1px solid rgba(139, 92, 246, 0.3)' }}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                  title="Haz clic para actualizar tu saldo real del banco"
                >
                  <div style={{ backgroundColor: 'rgba(139, 92, 246, 0.2)', padding: '1rem', borderRadius: '50%', color: '#8b5cf6' }}>
                    <CreditCard size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{formatMoney(stats.realBankBalance)}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Dinero Real (Banco)</p>
                  </div>
                </div>

                <div 
                  className="glass-panel" 
                  style={{ 
                    padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', 
                    border: stats.realBankBalance - (stats.transferBalance || 0) === 0 ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)' 
                  }}
                >
                  <div style={{ 
                    backgroundColor: stats.realBankBalance - (stats.transferBalance || 0) === 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)', 
                    padding: '1rem', borderRadius: '50%', 
                    color: stats.realBankBalance - (stats.transferBalance || 0) === 0 ? 'var(--success)' : 'var(--warning)' 
                  }}>
                    <Activity size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.5rem', margin: 0 }}>
                      {formatMoney(stats.realBankBalance - (stats.transferBalance || 0))}
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Diferencia a Cuadrar</p>
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
      ) : currentView === 'courses' ? (
        <CourseManagement onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'users' ? (
        <UserManagement viewMode="users" onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'admins' ? (
        <UserManagement viewMode="admins" onBack={() => setCurrentView('dashboard')} />
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
      ) : currentView === 'meeting_report' ? (
        <MeetingReport onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'approvals' ? (
        <ApprovalsManagement onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'expense_detail' && selectedExpenseId ? (
        <ExpenseDetail expenseId={selectedExpenseId} onBack={() => setCurrentView('dashboard')} />
      ) : null}

    </div>

    {/* Modals are rendered outside the container to avoid positioning issues with transform/animations */}
    {selectedFundForHistory && (
      <FundHistoryModal 
        fund={selectedFundForHistory}
        transactions={stats.allTransactions}
        onClose={() => setSelectedFundForHistory(null)}
      />
    )}

    <RegisteredApoderadosModal 
      isOpen={isApoderadosModalOpen}
      onClose={() => setIsApoderadosModalOpen(false)}
      apoderados={stats.registeredApoderadosList || []}
    />

    {isSearchOpen && (
      <StudentSearchModal 
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
    )}

    {/* Liquid Bottom Navigation */}
    <nav className="bottom-nav">
      {(() => {
        const navItems = [];
        if (['superadmin', 'admin', 'presidente', 'tesorero'].includes(courseRole)) {
          navItems.push({ id: 'expenses_add', icon: PlusCircle, label: 'Crear Cuota' });
          navItems.push({ id: 'debtors', icon: AlertTriangle, label: 'Deudas' });
        }
        if (['superadmin', 'admin', 'presidente'].includes(courseRole)) {
          navItems.push({ id: 'students', icon: Users, label: 'Alumnos' });
          navItems.push({ id: 'settings', icon: Settings, label: 'Config' });
        }
        
        const activeIndex = navItems.findIndex(item => item.id === currentView);
        
        const widthPercent = 100 / navItems.length;
        const indicatorStyle = {
          left: activeIndex >= 0 ? `calc(${activeIndex * widthPercent}% + ${widthPercent/2}% - 25px)` : '-100px'
        };
        
        return (
          <>
            <div className="liquid-indicator" style={indicatorStyle}></div>
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`bottom-nav-item ${currentView === item.id ? 'active' : ''}`}
                onClick={() => setCurrentView(item.id)}
              >
                <item.icon size={22} className="nav-icon" />
                <span className="nav-text">{item.label}</span>
              </button>
            ))}
          </>
        );
      })()}
    </nav>
    </>
  );
};

export default AdminDashboard;
