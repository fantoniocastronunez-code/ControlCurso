import React, { useEffect, useState } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, doc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useCourse } from '../context/CourseContext';
import { ArrowLeft, UserCheck, UserPlus, Trash2, Edit2, Save, X } from 'lucide-react';
import { useModal } from '../context/ModalContext';

const UserManagement = ({ onBack, viewMode = 'users' }) => {
  const { showConfirm } = useModal();
  const { role } = useAuth();
  const { selectedCourse } = useCourse();
  const [users, setUsers] = useState([]);
  const [allCourses, setAllCourses] = useState([]);
  const [filterCourse, setFilterCourse] = useState('all');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('apoderado');

  // Estados para edición
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    fetchData();
  }, [viewMode]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const coursesSnap = await getDocs(collection(db, 'courses'));
      const coursesData = coursesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllCourses(coursesData);

      const usersCollection = collection(db, 'users');
      const userSnapshot = await getDocs(usersCollection);
      
      let userList = userSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUsers(userList);
    } catch (error) {
      console.error("Error al obtener datos:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter(u => {
    const isSuperadmin = (u.roles && u.roles['global'] === 'superadmin') || u.role === 'superadmin';
    const rolesKeys = u.roles ? Object.keys(u.roles) : [];
    
    // 1. Filter by viewMode
    let matchesMode = false;
    if (viewMode === 'admins') {
       matchesMode = isSuperadmin || rolesKeys.some(k => ['admin', 'presidente', 'tesorero', 'secretario'].includes(u.roles[k]));
    } else {
       matchesMode = !isSuperadmin && (!u.roles || Object.keys(u.roles).length === 0 || rolesKeys.some(k => u.roles[k] === 'apoderado'));
    }
    
    // 2. Filter by course
    let matchesCourse = true;
    if (filterCourse !== 'all') {
      matchesCourse = (u.roles && !!u.roles[filterCourse]) || isSuperadmin;
    }
    
    return matchesMode && matchesCourse;
  });

  const handleRoleChange = async (userId, changedRole) => {
    try {
      const userRef = doc(db, 'users', userId);
      const userToUpdate = users.find(u => u.id === userId);
      
      const updatedRoles = { ...(userToUpdate.roles || {}) };
      updatedRoles[selectedCourse.id] = changedRole;

      await updateDoc(userRef, { 
        roles: updatedRoles,
        role: changedRole // backward compatibility
      });
      
      setUsers(users.map(u => u.id === userId ? { ...u, roles: updatedRoles, role: changedRole } : u));
      
      setMessage('Rol actualizado correctamente');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error actualizando el rol:", error);
      setMessage('Error al actualizar rol');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newEmail || !selectedCourse) return;

    try {
      const emailLower = newEmail.toLowerCase().trim();
      const userRef = doc(db, 'users', emailLower);
      const newUser = {
        email: emailLower,
        displayName: newName,
        roles: {
          [selectedCourse.id]: newRole
        },
        role: newRole, // backward compatibility
        defaultCourseId: selectedCourse.id,
        createdAt: new Date().toISOString(),
        preRegistered: true
      };
      
      await setDoc(userRef, newUser);
      
      setUsers([...users, { id: emailLower, ...newUser }]);
      setNewEmail('');
      setNewName('');
      setNewRole('apoderado');
      
      setMessage('Usuario pre-registrado correctamente');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error agregando usuario:", error);
      setMessage('Error al agregar usuario');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!(await showConfirm('¿Seguro que deseas eliminar este usuario? Si ya había iniciado sesión, perderá el acceso hasta que vuelva a iniciar.'))) return;
    try {
      await deleteDoc(doc(db, 'users', userId));
      setUsers(users.filter(u => u.id !== userId));
      setMessage('Usuario eliminado');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error eliminando:", error);
    }
  };

  const startEditing = (user) => {
    setEditingId(user.id);
    setEditName(user.displayName || '');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleSaveEdit = async () => {
    try {
      const userRef = doc(db, 'users', editingId);
      await updateDoc(userRef, {
        displayName: editName
      });
      
      setUsers(users.map(u => 
        u.id === editingId ? { ...u, displayName: editName } : u
      ));
      
      setMessage('Usuario modificado correctamente');
      setTimeout(() => setMessage(''), 3000);
      cancelEditing();
    } catch (error) {
      console.error("Error modificando usuario:", error);
      setMessage('Error al modificar usuario');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando usuarios...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
          <ArrowLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>Gestión de {viewMode === 'admins' ? 'Administradores' : 'Usuarios'}</h3>
      </div>

      <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <label style={{ fontWeight: '500' }}>Filtrar por Curso:</label>
        <select 
          className="input-field" 
          style={{ width: 'auto' }}
          value={filterCourse}
          onChange={(e) => setFilterCourse(e.target.value)}
        >
          <option value="all">Todos los cursos</option>
          {allCourses.map(c => (
            <option key={c.id} value={c.id}>{c.name} {c.year}</option>
          ))}
        </select>
      </div>

      {message && (
        <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', color: 'var(--success)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <UserCheck size={18} /> {message}
        </div>
      )}

      {/* Formulario para agregar usuario */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <UserPlus size={18} /> Pre-registrar Usuario
        </h4>
        <form onSubmit={handleAddUser} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: '1', minWidth: '200px', marginBottom: 0 }}>
            <label className="input-label">Email</label>
            <input 
              type="email" 
              required
              className="input-field" 
              placeholder="correo@ejemplo.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '150px', marginBottom: 0 }}>
            <label className="input-label">Nombre (Opcional)</label>
            <input 
              type="text" 
              className="input-field" 
              placeholder="Juan Pérez"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ width: '150px', marginBottom: 0 }}>
            <label className="input-label">Rol</label>
            <select className="input-field" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="apoderado">Apoderado</option>
              <option value="tesorero">Tesorero</option>
              <option value="presidente">Presidente</option>
              <option value="secretario">Secretario</option>
              {role === 'superadmin' && <option value="admin">Administrador</option>}
            </select>
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: '42px' }}>
            Agregar
          </button>
        </form>
      </div>

      <div className="glass-panel" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <th style={{ padding: '1rem' }}>Nombre</th>
              <th style={{ padding: '1rem' }}>Email</th>
              <th style={{ padding: '1rem' }}>Rol / Curso</th>
              <th style={{ padding: '1rem' }}>Estado</th>
              <th style={{ padding: '1rem' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                {editingId === u.id ? (
                  <>
                    <td style={{ padding: '1rem' }}>
                      <input 
                        type="text" 
                        className="input-field" 
                        value={editName} 
                        onChange={(e) => setEditName(e.target.value)}
                        style={{ padding: '0.4rem' }}
                      />
                    </td>
                    <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{u.email}</td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {((u.roles && u.roles['global'] === 'superadmin') || u.role === 'superadmin') ? (
                          <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', backgroundColor: 'rgba(245, 158, 11, 0.2)', color: 'var(--warning)', width: 'max-content' }}>
                            Superadmin (Global)
                          </span>
                        ) : (!u.roles || Object.keys(u.roles).filter(k => k !== 'global').length === 0) ? (
                            <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', width: 'max-content' }}>
                              Sin Curso
                            </span>
                          ) : (
                            Object.entries(u.roles || {}).map(([cId, r]) => {
                              if (cId === 'global') return null;
                              const cName = allCourses.find(c => c.id === cId)?.name || 'Curso Desconocido';
                              if (viewMode === 'admins' && !['admin', 'presidente', 'tesorero', 'secretario'].includes(r)) return null;
                              if (viewMode === 'users' && r !== 'apoderado') return null;
                              return (
                                <span key={cId} style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', backgroundColor: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)', width: 'max-content' }}>
                                  {r.charAt(0).toUpperCase() + r.slice(1)} - {cName}
                                </span>
                              );
                            })
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      {u.uid ? (
                        <span style={{ color: 'var(--success)', fontSize: '0.85rem' }}>Activo</span>
                      ) : (
                        <span style={{ color: 'var(--warning)', fontSize: '0.85rem' }}>Pendiente</span>
                      )}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={handleSaveEdit} className="btn btn-outline" style={{ padding: '0.4rem 0.75rem', color: 'var(--success)', borderColor: 'rgba(16, 185, 129, 0.3)', gap: '0.5rem', display: 'flex', alignItems: 'center' }}>
                          <Save size={16} /> Guardar
                        </button>
                        <button onClick={cancelEditing} className="btn btn-outline" style={{ padding: '0.4rem 0.75rem', gap: '0.5rem', display: 'flex', alignItems: 'center' }}>
                          <X size={16} />
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {u.photoURL ? (
                          <img src={u.photoURL} alt={u.displayName} style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
                        ) : (
                          <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {u.displayName ? u.displayName[0].toUpperCase() : u.email[0].toUpperCase()}
                          </div>
                        )}
                        <span>{u.displayName || 'Sin Nombre'}</span>
                      </div>
                    </td>
                    <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{u.email}</td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {((u.roles && u.roles['global'] === 'superadmin') || u.role === 'superadmin') ? (
                          <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', backgroundColor: 'rgba(245, 158, 11, 0.2)', color: 'var(--warning)', width: 'max-content' }}>
                            Superadmin (Global)
                          </span>
                        ) : (!u.roles || Object.keys(u.roles).filter(k => k !== 'global').length === 0) ? (
                            <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', width: 'max-content' }}>
                              Sin Curso
                            </span>
                          ) : (
                            Object.entries(u.roles || {}).map(([cId, r]) => {
                              if (cId === 'global') return null;
                              const cName = allCourses.find(c => c.id === cId)?.name || 'Curso Desconocido';
                              if (viewMode === 'admins' && !['admin', 'presidente', 'tesorero', 'secretario'].includes(r)) return null;
                              if (viewMode === 'users' && r !== 'apoderado') return null;
                              return (
                                <span key={cId} style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', backgroundColor: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)', width: 'max-content' }}>
                                  {r.charAt(0).toUpperCase() + r.slice(1)} - {cName}
                                </span>
                              );
                            })
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      {u.uid ? (
                        <span style={{ color: 'var(--success)', fontSize: '0.85rem' }}>Activo</span>
                      ) : (
                        <span style={{ color: 'var(--warning)', fontSize: '0.85rem' }}>Pendiente</span>
                      )}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      {role === 'superadmin' && u.role !== 'superadmin' ? (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={() => startEditing(u)} className="btn btn-outline" style={{ padding: '0.4rem 0.75rem', color: 'var(--primary)', borderColor: 'rgba(99, 102, 241, 0.3)', gap: '0.5rem', display: 'flex', alignItems: 'center' }}>
                            <Edit2 size={16} /> Editar
                          </button>
                          <select 
                          className="input-field" 
                          style={{ padding: '0.25rem' }}
                          value={u.roles && selectedCourse && u.roles[selectedCourse.id] ? u.roles[selectedCourse.id] : ''}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        >
                          <option value="" disabled>Asignar Rol...</option>
                          <option value="apoderado">Apoderado</option>
                          <option value="tesorero">Tesorero</option>
                          <option value="presidente">Presidente</option>
                          {role === 'superadmin' && <option value="admin">Admin</option>}
                        </select>
                          <button onClick={() => handleDeleteUser(u.id)} className="btn btn-outline" style={{ padding: '0.4rem 0.75rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)', gap: '0.5rem', display: 'flex', alignItems: 'center' }}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No modificable</span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {filteredUsers.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No se encontraron {viewMode === 'admins' ? 'administradores' : 'usuarios'}.
          </div>
        )}
      </div>
    </div>
  );
};

export default UserManagement;
