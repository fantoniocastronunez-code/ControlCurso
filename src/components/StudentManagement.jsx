import React, { useEffect, useState } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { ArrowLeft, UserPlus, CheckCircle, Trash2 } from 'lucide-react';

const StudentManagement = ({ onBack }) => {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  
  const [newName, setNewName] = useState('');
  const [newRut, setNewRut] = useState('');
  const [newApoderadoEmail, setNewApoderadoEmail] = useState('');

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
    } catch (error) {
      console.error("Error al obtener alumnos:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddStudent = async (e) => {
    e.preventDefault();
    if (!newName) return;

    try {
      // Generar un ID simple basado en timestamp o usar autogenerado
      const studentId = 'std_' + Date.now().toString();
      const studentRef = doc(db, 'students', studentId);
      
      const newStudent = {
        name: newName,
        rut: newRut,
        apoderadoEmail: newApoderadoEmail.toLowerCase().trim(),
        createdAt: new Date().toISOString(),
      };
      
      await setDoc(studentRef, newStudent);
      
      setStudents([...students, { id: studentId, ...newStudent }]);
      setNewName('');
      setNewRut('');
      setNewApoderadoEmail('');
      
      setMessage('Alumno agregado correctamente');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error agregando alumno:", error);
      setMessage('Error al agregar alumno');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Seguro que deseas eliminar este alumno?')) return;
    try {
      await deleteDoc(doc(db, 'students', id));
      setStudents(students.filter(s => s.id !== id));
      setMessage('Alumno eliminado');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error eliminando:", error);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando alumnos...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
          <ArrowLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>Gestión de Alumnos</h3>
      </div>

      {message && (
        <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', color: 'var(--success)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={18} /> {message}
        </div>
      )}

      {/* Formulario para agregar alumno */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <UserPlus size={18} /> Añadir Alumno
        </h4>
        <form onSubmit={handleAddStudent} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: '2', minWidth: '200px', marginBottom: 0 }}>
            <label className="input-label">Nombre Completo</label>
            <input 
              type="text" 
              required
              className="input-field" 
              placeholder="Ej. Martín Pérez"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '150px', marginBottom: 0 }}>
            <label className="input-label">RUT (Opcional)</label>
            <input 
              type="text" 
              className="input-field" 
              placeholder="12.345.678-9"
              value={newRut}
              onChange={(e) => setNewRut(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '2', minWidth: '200px', marginBottom: 0 }}>
            <label className="input-label">Email Apoderado</label>
            <input 
              type="email" 
              className="input-field" 
              placeholder="correo@apoderado.com"
              value={newApoderadoEmail}
              onChange={(e) => setNewApoderadoEmail(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: '42px' }}>
            Añadir
          </button>
        </form>
      </div>

      <div className="glass-panel" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <th style={{ padding: '1rem' }}>Nombre Alumno</th>
              <th style={{ padding: '1rem' }}>RUT</th>
              <th style={{ padding: '1rem' }}>Apoderado</th>
              <th style={{ padding: '1rem' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {students.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '1rem', fontWeight: '500' }}>{s.name}</td>
                <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{s.rut || '-'}</td>
                <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{s.apoderadoEmail || 'Sin apoderado'}</td>
                <td style={{ padding: '1rem' }}>
                  <button onClick={() => handleDelete(s.id)} className="btn btn-outline" style={{ padding: '0.4rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {students.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No se encontraron alumnos.
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentManagement;
