import React, { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { PlusCircle, Edit2, Trash2, Key, Users } from 'lucide-react';
import { useModal } from '../context/ModalContext';

const CourseManagement = () => {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [currentCourse, setCurrentCourse] = useState(null);
  const { showAlert, showConfirm, showPrompt } = useModal();
  
  // Form state
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [inviteCode, setInviteCode] = useState('');

  const fetchCourses = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'courses'));
      const fetchedCourses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setCourses(fetchedCourses);
    } catch (error) {
      console.error(error);
      showAlert("Error al cargar cursos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  const resetForm = () => {
    setName('');
    setGrade('');
    setYear(new Date().getFullYear());
    setInviteCode('');
    setIsEditing(false);
    setCurrentCourse(null);
  };

  const handleEdit = (course) => {
    setName(course.name || '');
    setGrade(course.grade || '');
    setYear(course.year || new Date().getFullYear());
    setInviteCode(course.inviteCode || '');
    setCurrentCourse(course);
    setIsEditing(true);
  };

  const generateInviteCode = () => {
    if (!name || !year) {
      showAlert("Ingresa el nombre y el año para generar un código sugerido.");
      return;
    }
    const cleanName = name.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    setInviteCode(`${cleanName}-${year}-${randomSuffix}`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !inviteCode) {
      showAlert("El nombre y el código de invitación son obligatorios.");
      return;
    }

    try {
      const courseData = {
        name,
        grade,
        year: parseInt(year),
        inviteCode: inviteCode.toUpperCase().trim(),
        updatedAt: new Date().toISOString()
      };

      if (isEditing && currentCourse) {
        await updateDoc(doc(db, 'courses', currentCourse.id), courseData);
        showAlert("Curso actualizado exitosamente.");
      } else {
        courseData.createdAt = new Date().toISOString();
        await addDoc(collection(db, 'courses'), courseData);
        showAlert("Curso creado exitosamente.");
      }
      resetForm();
      fetchCourses();
    } catch (error) {
      console.error("Error saving course:", error);
      showAlert("Hubo un error al guardar el curso.");
    }
  };

  const handleDelete = async (courseId) => {
    const confirm = await showConfirm(
      "¿Estás seguro de eliminar este curso?",
      "Esta acción es irreversible y los usuarios asociados a este curso podrían perder acceso a su información."
    );
    if (!confirm) return;

    try {
      await deleteDoc(doc(db, 'courses', courseId));
      showAlert("Curso eliminado.");
      fetchCourses();
    } catch (error) {
      console.error("Error deleting course:", error);
      showAlert("No se pudo eliminar el curso.");
    }
  };

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Cargando cursos...</div>;

  return (
    <div className="glass-panel" style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2>Gestión de Cursos</h2>
        {!isEditing && (
          <button onClick={() => setIsEditing(true)} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <PlusCircle size={18} /> Nuevo Curso
          </button>
        )}
      </div>

      {isEditing && (
        <form onSubmit={handleSubmit} style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.1)', marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1.5rem' }}>{currentCourse ? 'Editar Curso' : 'Crear Nuevo Curso'}</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <div className="input-group">
              <label className="input-label">Nombre del Curso</label>
              <input 
                type="text" 
                className="input-field" 
                value={name} 
                onChange={e => setName(e.target.value)} 
                placeholder="Ej. Kinder B" 
                required 
              />
            </div>
            <div className="input-group">
              <label className="input-label">Grado / Nivel</label>
              <input 
                type="text" 
                className="input-field" 
                value={grade} 
                onChange={e => setGrade(e.target.value)} 
                placeholder="Ej. Kinder" 
              />
            </div>
            <div className="input-group">
              <label className="input-label">Año</label>
              <input 
                type="number" 
                className="input-field" 
                value={year} 
                onChange={e => setYear(e.target.value)} 
                required 
              />
            </div>
          </div>

          <div className="input-group" style={{ marginBottom: '1.5rem' }}>
            <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Código de Invitación Principal</span>
              <button type="button" onClick={generateInviteCode} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.85rem' }}>
                Generar Sugerencia
              </button>
            </label>
            <input 
              type="text" 
              className="input-field" 
              value={inviteCode} 
              onChange={e => setInviteCode(e.target.value.toUpperCase())} 
              placeholder="Ej. KINDER-B-2026" 
              style={{ textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}
              required 
            />
            <small style={{ color: 'var(--text-muted)', marginTop: '0.5rem', display: 'block' }}>
              Este código lo usarán los apoderados nuevos para vincularse automáticamente a este curso al iniciar sesión.
            </small>
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={resetForm} className="btn btn-outline">Cancelar</button>
            <button type="submit" className="btn btn-primary">{currentCourse ? 'Guardar Cambios' : 'Crear Curso'}</button>
          </div>
        </form>
      )}

      <div className="table-responsive">
        <table className="table">
          <thead>
            <tr>
              <th>Curso</th>
              <th>Año</th>
              <th>Código Invitación</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {courses.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No hay cursos registrados.
                </td>
              </tr>
            ) : (
              courses.map(course => (
                <tr key={course.id}>
                  <td>
                    <strong>{course.name}</strong>
                    {course.grade && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{course.grade}</div>}
                  </td>
                  <td>{course.year}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Key size={14} style={{ color: 'var(--primary)' }} />
                      <span style={{ fontFamily: 'monospace', letterSpacing: '1px', padding: '0.2rem 0.5rem', backgroundColor: 'rgba(99,102,241,0.1)', borderRadius: '4px' }}>
                        {course.inviteCode || 'N/A'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => handleEdit(course)} className="btn-icon" title="Editar">
                        <Edit2 size={18} style={{ color: 'var(--primary)' }} />
                      </button>
                      <button onClick={() => handleDelete(course.id)} className="btn-icon" title="Eliminar">
                        <Trash2 size={18} style={{ color: 'var(--danger)' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CourseManagement;
