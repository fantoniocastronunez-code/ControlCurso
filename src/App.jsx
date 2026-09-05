import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import ApoderadoDashboard from './pages/ApoderadoDashboard';
import './App.css';

// Componente para proteger rutas según rol
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, role, loading } = useAuth();
  
  if (loading) return <div className="loading-screen">Cargando...</div>;
  
  if (!user) return <Navigate to="/login" replace />;
  
  if (allowedRoles && !allowedRoles.includes(role)) {
    // Redirect based on their role if they try to access something they shouldn't
    return <Navigate to={role === 'superadmin' || role === 'admin' ? '/admin' : '/apoderado'} replace />;
  }
  
  return children;
};

const AppRoutes = () => {
  const { user, role } = useAuth();

  return (
    <Routes>
      <Route 
        path="/" 
        element={
          user ? (
            <Navigate to={role === 'superadmin' || role === 'admin' ? '/admin' : '/apoderado'} replace />
          ) : (
            <Navigate to="/login" replace />
          )
        } 
      />
      
      <Route path="/login" element={<Login />} />
      
      <Route 
        path="/admin/*" 
        element={
          <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
            <AdminDashboard />
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/apoderado/*" 
        element={
          <ProtectedRoute allowedRoles={['apoderado', 'admin', 'superadmin']}>
            <ApoderadoDashboard />
          </ProtectedRoute>
        } 
      />
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
