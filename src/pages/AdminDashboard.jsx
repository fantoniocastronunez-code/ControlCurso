import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, Users, DollarSign, Activity, FileText } from 'lucide-react';
import { db } from '../firebase/config';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';

import UserManagement from '../components/UserManagement';
import StudentManagement from '../components/StudentManagement';
import ExpenseManagement from '../components/ExpenseManagement';
import ExpenseDetail from '../components/ExpenseDetail';
import DebtorsManagement from '../components/DebtorsManagement';

const AdminDashboard = () => {
  const { user, role, logout } = useAuth();
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedExpenseId, setSelectedExpenseId] = useState(null);

  // Estadísticas
  const [stats, setStats] = useState({
    activeStudents: 0,
    totalCollected: 0,
    totalExpected: 0
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
      debtsSnap.forEach(doc => {
        collected += (doc.data().paidAmount || doc.data().amount || 0);
      });

      setStats({
        activeStudents: activeStudentsCount,
        totalCollected: collected,
        totalExpected: expected
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
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2>Panel de Administración</h2>
          <p style={{ color: 'var(--text-muted)' }}>Bienvenido, {user?.displayName} ({role})</p>
        </div>
        <button onClick={logout} className="btn btn-outline">
          <LogOut size={18} />
          Salir
        </button>
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
                    <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{formatMoney(stats.totalCollected)}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Cobros Efectivos (Pagados)</p>
                  </div>
                </div>

                <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ backgroundColor: 'rgba(239,68,68,0.2)', padding: '1rem', borderRadius: '50%', color: 'var(--danger)' }}>
                    <Activity size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{formatMoney(stats.totalExpected)}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Total Emitido en Cuotas</p>
                  </div>
                </div>
              </div>

              <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
                <h3>Gestión Rápida</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Selecciona una acción para administrar el curso.</p>
                
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <button onClick={() => setCurrentView('expenses_add')} className="btn btn-primary">
                    Cobrar Cuota
                  </button>
                  <button onClick={() => setCurrentView('debtors')} className="btn btn-outline" style={{ color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                    Apoderados en Deuda
                  </button>
                  <button onClick={() => setCurrentView('students')} className="btn btn-outline">
                    Gestionar Alumnos
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
      ) : currentView === 'expense_detail' && selectedExpenseId ? (
        <ExpenseDetail expenseId={selectedExpenseId} onBack={() => setCurrentView('dashboard')} />
      ) : null}
    </div>
  );
};

export default AdminDashboard;
