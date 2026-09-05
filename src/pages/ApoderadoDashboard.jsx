import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, CheckCircle, Clock, Search, UserPlus } from 'lucide-react';
import { db } from '../firebase/config';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';

const ApoderadoDashboard = () => {
  const { user, logout } = useAuth();
  
  const [myStudents, setMyStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // States for search
  const [lastNameSearch, setLastNameSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');

  useEffect(() => {
    fetchMyStudents();
  }, [user]);

  const fetchMyStudents = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'students'), 
        where('apoderadoEmail', '==', user.email)
      );
      const snapshot = await getDocs(q);
      const students = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMyStudents(students);
    } catch (error) {
      console.error("Error fetching my students:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!lastNameSearch.trim()) return;
    
    setHasSearched(true);
    setSearchMessage('Buscando...');
    
    try {
      // Firebase no soporta una busqueda 'LIKE' de SQL facilmente para substrings en medio del nombre.
      // Para un curso con poca gente, es totalmente seguro traer todos y filtrar en el frontend.
      const snapshot = await getDocs(collection(db, 'students'));
      const allStudents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const term = lastNameSearch.toLowerCase().trim();
      
      const filtered = allStudents.filter(s => {
        // Filtrar aquellos cuyo nombre contenga el texto buscado y que no tengan un apoderado aún
        // (Opcional: permitir reclamar si ya tiene apoderado? Mejor no por ahora, o sí si queremos sobreescribir)
        // Para este caso, mostraremos todos los que coincidan con el apellido
        return s.name.toLowerCase().includes(term);
      });
      
      setSearchResults(filtered);
      if (filtered.length === 0) {
        setSearchMessage('No se encontraron alumnos con ese apellido.');
      } else {
        setSearchMessage('');
      }
    } catch (error) {
      console.error("Error searching students:", error);
      setSearchMessage('Hubo un error al buscar.');
    }
  };

  const handleLinkStudent = async (studentId) => {
    try {
      const studentRef = doc(db, 'students', studentId);
      await updateDoc(studentRef, {
        apoderadoEmail: user.email
      });
      // Refrescar mis alumnos
      fetchMyStudents();
      // Limpiar búsqueda
      setLastNameSearch('');
      setSearchResults([]);
      setHasSearched(false);
    } catch (error) {
      console.error("Error linking student:", error);
      alert('Hubo un error al vincular el alumno.');
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando portal...</div>;
  }

  return (
    <div className="container animate-fade-in">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2>Mi Portal</h2>
          <p style={{ color: 'var(--text-muted)' }}>Bienvenido, {user?.displayName || user?.email}</p>
        </div>
        <button onClick={logout} className="btn btn-outline">
          <LogOut size={18} />
          Salir
        </button>
      </header>

      {myStudents.length === 0 ? (
        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', textAlign: 'center' }}>
          <div style={{ backgroundColor: 'rgba(99,102,241,0.1)', padding: '1.5rem', borderRadius: '50%', display: 'inline-block', marginBottom: '1rem', color: 'var(--primary)' }}>
            <Search size={40} />
          </div>
          <h3 style={{ marginBottom: '0.5rem' }}>No tienes alumnos vinculados</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', maxWidth: '500px', margin: '0 auto 2rem auto' }}>
            Para ver el estado de los pagos, primero debes vincular a tu hijo/a a tu cuenta. Ingresa sus apellidos para buscarlo en la lista del curso.
          </p>

          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '1rem', justifyContent: 'center', maxWidth: '400px', margin: '0 auto' }}>
            <input 
              type="text" 
              className="input-field" 
              placeholder="Ej. Pérez"
              value={lastNameSearch}
              onChange={(e) => setLastNameSearch(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-primary">Buscar</button>
          </form>

          {hasSearched && (
            <div style={{ marginTop: '2rem', textAlign: 'left' }}>
              {searchMessage ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>{searchMessage}</p>
              ) : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  <h4 style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Resultados encontrados:</h4>
                  {searchResults.map(s => (
                    <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                      <div>
                        <p style={{ fontWeight: '500', fontSize: '1.1rem' }}>{s.name}</p>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          {s.apoderadoEmail ? `(Ya vinculado a ${s.apoderadoEmail})` : 'Sin apoderado vinculado'}
                        </p>
                      </div>
                      <button 
                        onClick={() => handleLinkStudent(s.id)}
                        className="btn btn-outline" 
                        style={{ color: 'var(--success)', borderColor: 'rgba(16,185,129,0.3)' }}
                      >
                        <UserPlus size={18} />
                        Soy su apoderado
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {myStudents.map(student => (
            <div key={student.id} className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
              <h3 style={{ marginBottom: '1.5rem', color: 'var(--primary)' }}>Estado de Pagos: {student.name}</h3>
              
              <div style={{ display: 'grid', gap: '1rem' }}>
                {/* Por ahora estos datos son fijos como demostración del diseño */}
                {/* Pago Completado */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--success)' }}>
                  <div>
                    <p style={{ fontWeight: '500' }}>Cuota Septiembre (Mock)</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Pagado el 02 de Septiembre, 2026</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--success)' }}>
                    <CheckCircle size={18} />
                    <span style={{ fontWeight: '500' }}>Al día</span>
                  </div>
                </div>

                {/* Pago Pendiente */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--warning)' }}>
                  <div>
                    <p style={{ fontWeight: '500' }}>Cuota Octubre (Mock)</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Vence el 05 de Octubre, 2026</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--warning)' }}>
                    <Clock size={18} />
                    <span style={{ fontWeight: '500' }}>Pendiente</span>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Botón para vincular a otro hijo si tienen más de uno */}
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
             <button onClick={() => {
                setMyStudents([]); // Truco temporal para forzar la vista de búsqueda
             }} className="btn btn-outline" style={{ fontSize: '0.85rem' }}>
               Vincular a otro alumno
             </button>
          </div>
        </>
      )}

      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h3>Información del Curso</h3>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          Para cualquier duda respecto a los pagos, por favor contacta a la directiva del curso.
        </p>
      </div>
    </div>
  );
};

export default ApoderadoDashboard;
