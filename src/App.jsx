import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CourseProvider } from './context/CourseContext';
import { ModalProvider } from './context/ModalContext';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import ApoderadoDashboard from './pages/ApoderadoDashboard';
import VersionChecker from './components/VersionChecker';
import './App.css';

// Componente para proteger rutas según rol
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, role, userData, loading } = useAuth();
  
  if (loading) return (
    <div className="loading-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-color)' }}>
      <img src="/LOGOAPPCURSO.jpg" alt="Cargando" style={{ width: '120px', height: '120px', borderRadius: '50%', marginBottom: '1rem', objectFit: 'cover' }} className="animate-pulse" />
      <h2 style={{ color: 'var(--primary)', margin: 0 }}>Cargando App...</h2>
    </div>
  );
  
  if (!user) return <Navigate to="/login" replace />;

  const hasNoRoles = userData && (!userData.roles || Object.keys(userData.roles).length === 0);
  
  if (hasNoRoles) {
    return <Navigate to="/login" replace />;
  }
  
  const hasAdminRole = role === 'superadmin' || (userData && userData.roles && Object.values(userData.roles).some(r => ['admin', 'superadmin', 'presidente', 'tesorero'].includes(r)));
  const hasApoderadoRole = userData && userData.roles && Object.values(userData.roles).some(r => r === 'apoderado');

  const isAllowed = allowedRoles.some(r => {
    if (r === 'admin' || r === 'presidente' || r === 'tesorero' || r === 'superadmin') return hasAdminRole;
    if (r === 'apoderado') return hasApoderadoRole || hasAdminRole; // Admins can impersonate
    return false;
  });

  if (!isAllowed) {
    // Redirect based on their role if they try to access something they shouldn't
    return <Navigate to={hasAdminRole ? '/admin' : '/apoderado'} replace />;
  }
  
  return children;
};

const AppRoutes = () => {
  const { user, role, userData } = useAuth();
  const hasNoRoles = user && userData && (!userData.roles || Object.keys(userData.roles).length === 0);

  return (
    <Routes>
      <Route
        path="/" 
        element={
          user && !hasNoRoles ? (
            <Navigate to={
              role === 'superadmin' || (userData && userData.roles && Object.values(userData.roles).some(r => ['admin', 'superadmin', 'presidente', 'tesorero'].includes(r))) 
                ? '/admin' 
                : '/apoderado'
            } replace />
          ) : (
            <Navigate to="/login" replace />
          )
        } 
      />
      
      <Route path="/login" element={<Login />} />
      
      <Route
        path="/admin/*" 
        element={
          <ProtectedRoute allowedRoles={['superadmin', 'admin', 'presidente', 'tesorero']}>
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
    <ModalProvider>
      <AuthProvider>
        <CourseProvider>
          <BrowserRouter>
            <VersionChecker />
            <AppRoutes />
          </BrowserRouter>
        </CourseProvider>
      </AuthProvider>
    </ModalProvider>
  );
}

export default App;
