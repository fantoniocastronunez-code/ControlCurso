import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, Users, DollarSign, Activity, FileText, RefreshCw } from 'lucide-react';
import { db } from '../firebase/config';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';

import UserManagement from '../components/UserManagement';
import StudentManagement from '../components/StudentManagement';
import ExpenseManagement from '../components/ExpenseManagement';
import ExpenseDetail from '../components/ExpenseDetail';
import DebtorsManagement from '../components/DebtorsManagement';
import OutcomeManagement from '../components/OutcomeManagement';
import FundManagement from '../components/FundManagement';

const AdminDashboard = () => {
  const { user, role, logout } = useAuth();
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedExpenseId, setSelectedExpenseId] = useState(null);

  const [stats, setStats] = useState({
    activeStudents: 0,
    totalCollected: 0,
    totalExpected: 0,
    totalCash: 0,
    totalTransfer: 0,
    fundsBalances: []
  });
  
  // Lista de cuotas
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentView === 'dashboard') {
      fetchDashboardData();
    }
  }, [currentView]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      // 1. Alumnos Activos
      const studentsSnap = await getDocs(collection(db, 'students'));
      const activeStudentsCount = studentsSnap.size;

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

      // 3. Cobros (Dinero realmente pagado)
      const debtsSnap = await getDocs(query(collection(db, 'debts'), where('status', '==', 'paid')));
      let collected = 0;
      let cashIn = 0;
      let transferIn = 0;
      debtsSnap.forEach(doc => {
        const data = doc.data();
        const amt = data.paidAmount || data.amount || 0;
        collected += amt;
        if (data.paymentMethod === 'cash') cashIn += amt;
        if (data.paymentMethod === 'transfer') transferIn += amt;
        // paymentMethod === 'balance' no suma a cashIn/transferIn porque el dinero físico ya fue ingresado manualmente en Incomes
      });

      // 4. Gastos Directiva (Egresos)
      const outcomesSnap = await getDocs(collection(db, 'outcomes'));
      let cashOut = 0;
      let transferOut = 0;
      outcomesSnap.forEach(doc => {
        const data = doc.data();
        const amt = data.amount || 0;
        if (data.paymentMethod === 'cash') cashOut += amt;
        if (data.paymentMethod === 'transfer') transferOut += amt;
      });

      // 4.5 Ingresos Manuales (Saldos Iniciales/Extras)
      const incomesSnap = await getDocs(collection(db, 'incomes'));
      incomesSnap.forEach(doc => {
        const data = doc.data();
        const amt = data.amount || 0;
        if (data.paymentMethod === 'cash') cashIn += amt;
        if (data.paymentMethod === 'transfer') transferIn += amt;
      });

      // 5. Fondos (Categorías)
      const fundsSnap = await getDocs(collection(db, 'funds'));
      const fundsMap = new Map(); // id -> { name, balance }
      fundsSnap.forEach(doc => {
        fundsMap.set(doc.id, { id: doc.id, name: doc.data().name, balance: 0 });
      });

      // Calcular balances por fondo
      debtsSnap.forEach(doc => {
        const data = doc.data();
        if (data.paymentMethod === 'balance') return; // El dinero físico ya debe estar en algún fondo mediante un 'income'
        
        const amt = data.paidAmount || data.amount || 0;
        const fundId = data.fundId || 'general'; // 'general' para los antiguos
        
        if (!fundsMap.has(fundId)) {
          fundsMap.set(fundId, { id: fundId, name: fundId === 'general' ? 'Fondo General' : 'Fondo Desconocido', balance: 0 });
        }
        fundsMap.get(fundId).balance += amt;
      });

      outcomesSnap.forEach(doc => {
        const data = doc.data();
        const amt = data.amount || 0;
        const fundId = data.fundId || 'general';
        
        if (!fundsMap.has(fundId)) {
          fundsMap.set(fundId, { id: fundId, name: fundId === 'general' ? 'Fondo General' : 'Fondo Desconocido', balance: 0 });
        }
        fundsMap.get(fundId).balance -= amt;
      });

      incomesSnap.forEach(doc => {
        const data = doc.data();
        const amt = data.amount || 0;
        const fundId = data.fundId || 'general';
        
        if (!fundsMap.has(fundId)) {
          fundsMap.set(fundId, { id: fundId, name: fundId === 'general' ? 'Fondo General' : 'Fondo Desconocido', balance: 0 });
        }
        fundsMap.get(fundId).balance += amt;
      });

      // Transferencias entre fondos
      const transfersSnap = await getDocs(collection(db, 'fund_transfers'));
      transfersSnap.forEach(doc => {
        const data = doc.data();
        const amt = data.amount || 0;
        const fromId = data.fromFundId;
        const toId = data.toFundId;

        if (fromId && fundsMap.has(fromId)) fundsMap.get(fromId).balance -= amt;
        if (toId && fundsMap.has(toId)) fundsMap.get(toId).balance += amt;
      });

      const fundsBalances = Array.from(fundsMap.values());

      setStats({
        activeStudents: activeStudentsCount,
        totalCollected: collected,
        totalExpected: expected,
        totalCash: cashIn - cashOut,
        totalTransfer: transferIn - transferOut,
        fundsBalances
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
        <div>
          <h2>Panel de Administración</h2>
          <p style={{ color: 'var(--text-muted)' }}>Bienvenido, {user?.displayName} ({role})</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
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

                <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--success)' }}>
                    <DollarSign size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{formatMoney(stats.totalCash)}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Caja Chica (Efectivo)</p>
                  </div>
                </div>

                <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ backgroundColor: 'rgba(59,130,246,0.2)', padding: '1rem', borderRadius: '50%', color: '#3b82f6' }}>
                    <Activity size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{formatMoney(stats.totalTransfer)}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Banco (Transferencias)</p>
                  </div>
                </div>

                <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ backgroundColor: 'rgba(239,68,68,0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--danger)' }}>
                    <FileText size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{formatMoney(stats.totalCash + stats.totalTransfer)}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Fondo Total Disponible</p>
                  </div>
                </div>
              </div>

              {stats.fundsBalances.length > 0 && (
                <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
                  <h4 style={{ marginBottom: '1rem', color: 'var(--primary)', margin: 0 }}>Distribución por Fondos</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                    {stats.fundsBalances.map(fb => (
                      <div key={fb.id} style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0 0 0.5rem 0' }}>{fb.name}</p>
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
                  <button onClick={() => setCurrentView('expenses_add')} className="btn btn-primary">
                    Cobrar Cuota
                  </button>
                  <button onClick={() => setCurrentView('outcomes')} className="btn btn-outline" style={{ color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                    Registrar Gasto
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
                          <p style={{ fontWeight: 'bold', margin: 0, color: 'var(--primary)' }}>{formatMoney(exp.totalAmount)}</p>
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
      ) : currentView === 'expense_detail' && selectedExpenseId ? (
        <ExpenseDetail expenseId={selectedExpenseId} onBack={() => setCurrentView('dashboard')} />
      ) : null}
    </div>
  );
};

export default AdminDashboard;
