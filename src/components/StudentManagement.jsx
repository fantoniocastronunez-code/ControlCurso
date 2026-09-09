import React, { useEffect, useState, useMemo } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { ArrowLeft, UserPlus, CheckCircle, Trash2, Edit2, X, Save, Image as ImageIcon, Eye, Search } from 'lucide-react';
import BulkImport from './BulkImport';
import StudentDetailModal from './StudentDetailModal';
import { useNavigate } from 'react-router-dom';

import { formatStudentName } from '../utils/nameUtils';
import { formatRut } from '../utils/rutUtils';
import { useModal } from '../context/ModalContext';
import { useAuth } from '../context/AuthContext';

const StudentManagement = ({ onBack }) => {
  const { showConfirm, showAlert } = useModal();
  const { role } = useAuth();
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [usersMap, setUsersMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastNamePaternal, setNewLastNamePaternal] = useState('');
  const [newLastNameMaternal, setNewLastNameMaternal] = useState('');
  const [newApoderadoEmail1, setNewApoderadoEmail1] = useState('');
  const [newApoderadoEmail2, setNewApoderadoEmail2] = useState('');
  const [newListNumber, setNewListNumber] = useState('');
  const [newBalance, setNewBalance] = useState('');
  const [newRut, setNewRut] = useState('');
  
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);

  // Estados para edición
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({ firstName: '', lastNamePaternal: '', lastNameMaternal: '', apoderadoEmail1: '', apoderadoEmail2: '', listNumber: '', balance: '', rut: '' });

  const filteredStudents = useMemo(() => {
    if (!tableSearch) return students;
    const term = tableSearch.toLowerCase();
    return students.filter(s => {
      const fullName = formatStudentName(s).toLowerCase();
      const rut = (s.rut || '').toLowerCase();
      return fullName.includes(term) || rut.includes(term);
    });
  }, [students, tableSearch]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([fetchUsers(), fetchStudents()]);
    setLoading(false);
  };

  const fetchUsers = async () => {
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const map = {};
      usersSnap.forEach(doc => {
        const data = doc.data();
        if (data.formalName) {
          map[doc.id] = data.formalName;
        } else if (data.displayName) {
          map[doc.id] = data.displayName;
        }
      });
      setUsersMap(map);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  const fetchStudents = async () => {
    try {
      const studentsCollection = collection(db, 'students');
      const studentSnapshot = await getDocs(studentsCollection);
      const studentList = studentSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      // Ordenar por número de lista si existe
      studentList.sort((a, b) => {
        const aNum = parseInt(a.listNumber) || 999;
        const bNum = parseInt(b.listNumber) || 999;
        return aNum - bNum;
      });
      setStudents(studentList);
    } catch (error) {
      console.error("Error al obtener alumnos:", error);
    }
  };

  const handleAddStudent = async (e) => {
    e.preventDefault();
    if (!newFirstName || !newLastNamePaternal) return;

    try {
      const studentId = 'std_' + Date.now().toString();
      const studentRef = doc(db, 'students', studentId);
      
      const emails = [newApoderadoEmail1.toLowerCase().trim(), newApoderadoEmail2.toLowerCase().trim()].filter(e => e);
      
      const fullName = `${newFirstName} ${newLastNamePaternal} ${newLastNameMaternal}`.trim();

      const newStudent = {
        name: fullName,
        firstName: newFirstName.trim(),
        lastNamePaternal: newLastNamePaternal.trim(),
        lastNameMaternal: newLastNameMaternal.trim(),
        apoderadoEmails: emails,
        listNumber: newListNumber,
        balance: Number(newBalance) || 0,
        rut: newRut.trim(),
        createdAt: new Date().toISOString(),
      };
      
      await setDoc(studentRef, newStudent);
      
      setStudents([...students, { id: studentId, ...newStudent }].sort((a, b) => {
        const aNum = parseInt(a.listNumber) || 999;
        const bNum = parseInt(b.listNumber) || 999;
        return aNum - bNum;
      }));
      setNewFirstName('');
      setNewLastNamePaternal('');
      setNewLastNameMaternal('');
      setNewApoderadoEmail1('');
      setNewApoderadoEmail2('');
      setNewListNumber('');
      setNewBalance('');
      setNewRut('');
      
      setMessage('Alumno agregado correctamente');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error agregando alumno:", error);
      setMessage('Error al agregar alumno');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleDelete = async (id) => {
    if (!(await showConfirm('¿Seguro que deseas eliminar este alumno?'))) return;
    try {
      await deleteDoc(doc(db, 'students', id));
      setStudents(students.filter(s => s.id !== id));
      setMessage('Alumno eliminado');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error("Error eliminando:", error);
    }
  };

  const startEditing = (student) => {
    setEditingId(student.id);
    const emails = student.apoderadoEmails || (student.apoderadoEmail ? [student.apoderadoEmail] : []);
    setEditData({
      firstName: student.firstName || student.name || '',
      lastNamePaternal: student.lastNamePaternal || '',
      lastNameMaternal: student.lastNameMaternal || '',
      apoderadoEmail1: emails[0] || '',
      apoderadoEmail2: emails[1] || '',
      listNumber: student.listNumber || '',
      balance: student.balance || 0,
      rut: student.rut || ''
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditData({ firstName: '', lastNamePaternal: '', lastNameMaternal: '', apoderadoEmail1: '', apoderadoEmail2: '', listNumber: '', balance: '', rut: '' });
  };

  const handleSaveEdit = async () => {
    if (!editData.firstName || !editData.lastNamePaternal) return;
    try {
      const studentRef = doc(db, 'students', editingId);
      const emails = [editData.apoderadoEmail1.toLowerCase().trim(), editData.apoderadoEmail2.toLowerCase().trim()].filter(e => e);
      const fullName = `${editData.firstName} ${editData.lastNamePaternal} ${editData.lastNameMaternal}`.trim();
      
      await updateDoc(studentRef, {
        name: fullName,
        firstName: editData.firstName.trim(),
        lastNamePaternal: editData.lastNamePaternal.trim(),
        lastNameMaternal: editData.lastNameMaternal.trim(),
        apoderadoEmails: emails,
        listNumber: editData.listNumber,
        balance: Number(editData.balance) || 0,
        rut: editData.rut.trim()
      });
      
      let updatedList = students.map(s => 
        s.id === editingId ? { ...s, ...editData, apoderadoEmails: emails, balance: Number(editData.balance) || 0, rut: editData.rut.trim() } : s
      );
      updatedList.sort((a, b) => {
        const aNum = parseInt(a.listNumber) || 999;
        const bNum = parseInt(b.listNumber) || 999;
        return aNum - bNum;
      });
      setStudents(updatedList);
      
      setMessage('Alumno modificado correctamente');
      setTimeout(() => setMessage(''), 3000);
      cancelEditing();
    } catch (error) {
      console.error("Error modificando alumno:", error);
      setMessage('Error al modificar alumno');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando alumnos...</div>;
  }

  return (
    <div className="container animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <button onClick={onBack} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ArrowLeft size={18} /> Volver al Panel
        </button>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            onClick={() => setShowBulkImport(!showBulkImport)} 
            className="btn btn-outline"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderColor: 'var(--primary)', color: 'var(--primary)' }}
          >
            {showBulkImport ? 'Ocultar Carga Masiva' : 'Carga Masiva Excel/Texto'}
          </button>
        </div>
      </div>

      {message && (
        <div style={{ padding: '1rem', backgroundColor: 'rgba(16, 185, 129, 0.2)', color: 'var(--success)', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={18} /> {message}
        </div>
      )}

      {showBulkImport && (
        <div style={{ marginBottom: '2rem' }}>
          <BulkImport 
            onBack={() => setShowBulkImport(false)} 
            onImportSuccess={() => {
              setShowBulkImport(false);
              fetchStudents();
            }} 
          />
        </div>
      )}

      {/* Formulario para agregar alumno */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <UserPlus size={18} /> Añadir Alumno
        </h4>
        <form onSubmit={handleAddStudent} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: '1', minWidth: '120px', marginBottom: 0 }}>
            <label className="input-label">Nombres</label>
            <input 
              type="text" 
              required
              className="input-field" 
              placeholder="Ej. Martín"
              value={newFirstName}
              onChange={(e) => setNewFirstName(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '120px', marginBottom: 0 }}>
            <label className="input-label">A. Paterno</label>
            <input 
              type="text" 
              required
              className="input-field" 
              placeholder="Ej. Pérez"
              value={newLastNamePaternal}
              onChange={(e) => setNewLastNamePaternal(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '120px', marginBottom: 0 }}>
            <label className="input-label">A. Materno</label>
            <input 
              type="text" 
              className="input-field" 
              placeholder="Ej. Gómez"
              value={newLastNameMaternal}
              onChange={(e) => setNewLastNameMaternal(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '130px', marginBottom: 0 }}>
            <label className="input-label">RUT</label>
            <input 
              type="text" 
              className="input-field" 
              placeholder="XX.XXX.XXX-X"
              value={newRut}
              onChange={(e) => setNewRut(formatRut(e.target.value))}
            />
          </div>
          <div className="input-group" style={{ flex: '0.5', minWidth: '80px', marginBottom: 0 }}>
            <label className="input-label">N° Lista</label>
            <input 
              type="number" 
              className="input-field" 
              placeholder="Ej. 1"
              value={newListNumber}
              onChange={(e) => setNewListNumber(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '150px', marginBottom: 0 }}>
            <label className="input-label">Email Apoderado 1</label>
            <input 
              type="email" 
              className="input-field" 
              placeholder="correo1@apoderado.com"
              value={newApoderadoEmail1}
              onChange={(e) => setNewApoderadoEmail1(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '150px', marginBottom: 0 }}>
            <label className="input-label">Email Apoderado 2</label>
            <input 
              type="email" 
              className="input-field" 
              placeholder="correo2@apoderado.com (Opc.)"
              value={newApoderadoEmail2}
              onChange={(e) => setNewApoderadoEmail2(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '120px', marginBottom: 0 }}>
            <label className="input-label">Saldo a Favor ($)</label>
            <input 
              type="number" 
              className="input-field" 
              placeholder="Ej. 10000"
              value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: '42px' }}>
            Añadir
          </button>
        </form>
      </div>

      {/* Buscador de Alumnos en la tabla */}
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1', maxWidth: '400px' }}>
          <input 
            type="text" 
            className="input-field" 
            placeholder="Buscar por nombre, RUT, apoderado o N° lista..." 
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: '2.5rem' }}
          />
          <Search size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          {tableSearch && (
            <button
              onClick={() => setTableSearch('')}
              style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {filteredStudents.length} de {students.length} alumnos
        </span>
      </div>

      <div className="glass-panel" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <th style={{ padding: '1rem', width: '80px' }}>N°</th>
              <th style={{ padding: '1rem' }}>Nombre Alumno</th>
              <th style={{ padding: '1rem' }}>RUT</th>
              <th style={{ padding: '1rem' }}>Apoderado</th>
              <th style={{ padding: '1rem' }}>Saldo a Favor</th>
              <th style={{ padding: '1rem' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.map(s => (
              <React.Fragment key={s.id}>
                <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: selectedStudent?.id === s.id ? 'rgba(99, 102, 241, 0.05)' : 'transparent' }}>
                  {editingId === s.id ? (
                  <>
                    <td style={{ padding: '1rem', verticalAlign: 'top' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>N° Lista</label>
                      <input 
                        type="number" 
                        className="input-field" 
                        value={editData.listNumber} 
                        onChange={(e) => setEditData({...editData, listNumber: e.target.value})}
                        style={{ padding: '0.4rem', width: '60px', marginTop: '0.2rem' }}
                      />
                    </td>
                    <td style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', verticalAlign: 'top' }}>
                      <div>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nombres</label>
                        <input 
                          type="text" 
                          className="input-field" 
                          placeholder="Nombres"
                          value={editData.firstName} 
                          onChange={(e) => setEditData({...editData, firstName: e.target.value})}
                          style={{ padding: '0.4rem', marginTop: '0.2rem', width: '100%' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>A. Paterno</label>
                        <input 
                          type="text" 
                          className="input-field" 
                          placeholder="A. Paterno"
                          value={editData.lastNamePaternal} 
                          onChange={(e) => setEditData({...editData, lastNamePaternal: e.target.value})}
                          style={{ padding: '0.4rem', marginTop: '0.2rem', width: '100%' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>A. Materno</label>
                        <input 
                          type="text" 
                          className="input-field" 
                          placeholder="A. Materno"
                          value={editData.lastNameMaternal} 
                          onChange={(e) => setEditData({...editData, lastNameMaternal: e.target.value})}
                          style={{ padding: '0.4rem', marginTop: '0.2rem', width: '100%' }}
                        />
                      </div>
                    </td>
                    <td style={{ padding: '1rem', verticalAlign: 'top' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>RUT</label>
                      <input 
                        type="text" 
                        className="input-field" 
                        value={editData.rut} 
                        onChange={(e) => setEditData({...editData, rut: formatRut(e.target.value)})}
                        style={{ padding: '0.4rem', marginTop: '0.2rem', width: '100%' }}
                      />
                    </td>
                    <td style={{ padding: '1rem', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div>
                          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Email Apdo. 1</label>
                          <input 
                            type="email" 
                            className="input-field" 
                            placeholder="Email 1"
                            value={editData.apoderadoEmail1} 
                            onChange={(e) => setEditData({...editData, apoderadoEmail1: e.target.value})}
                            style={{ padding: '0.4rem', marginTop: '0.2rem', width: '100%' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Email Apdo. 2</label>
                          <input 
                            type="email" 
                            className="input-field" 
                            placeholder="Email 2"
                            value={editData.apoderadoEmail2} 
                            onChange={(e) => setEditData({...editData, apoderadoEmail2: e.target.value})}
                            style={{ padding: '0.4rem', marginTop: '0.2rem', width: '100%' }}
                          />
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '1rem', verticalAlign: 'top' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Saldo a Favor ($)</label>
                      <input 
                        type="number" 
                        className="input-field" 
                        value={editData.balance} 
                        onChange={(e) => setEditData({...editData, balance: e.target.value})}
                        style={{ padding: '0.4rem', width: '100px', marginTop: '0.2rem' }}
                      />
                    </td>
                    <td style={{ padding: '1rem', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.2rem' }}>
                        <button onClick={handleSaveEdit} className="btn btn-primary" style={{ padding: '0.4rem 0.75rem', gap: '0.5rem', display: 'flex', alignItems: 'center' }}>
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
                    <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{s.listNumber || '-'}</td>
                    <td style={{ padding: '1rem', fontWeight: '500' }}>
                      <button 
                        onClick={() => setSelectedStudent(selectedStudent?.id === s.id ? null : s)}
                        style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: '500', padding: 0, fontSize: 'inherit', textAlign: 'left', textDecoration: 'underline' }}
                      >
                        {formatStudentName(s)}
                      </button>
                    </td>
                    <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{s.rut || '-'}</td>
                    <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>
                      {s.apoderadoEmails?.length > 0 
                        ? s.apoderadoEmails.map(email => usersMap[email] || email).join(', ') 
                        : (s.apoderadoEmail ? (usersMap[s.apoderadoEmail] || s.apoderadoEmail) : 'Sin apoderado')}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      {s.balance > 0 ? (
                        <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>{formatMoney(s.balance)}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {role === 'superadmin' && (
                          <button 
                            onClick={() => navigate('/apoderado', { state: { impersonateStudentId: s.id } })}
                            className="btn btn-outline" 
                            style={{ padding: '0.4rem 0.75rem', color: 'var(--success)', borderColor: 'rgba(16, 185, 129, 0.3)', gap: '0.5rem', display: 'flex', alignItems: 'center' }}
                            title="Ver portal como apoderado"
                          >
                            <Eye size={16} /> Portal
                          </button>
                        )}
                        <button onClick={() => startEditing(s)} className="btn btn-outline" style={{ padding: '0.4rem 0.75rem', color: 'var(--primary)', borderColor: 'rgba(99, 102, 241, 0.3)', gap: '0.5rem', display: 'flex', alignItems: 'center' }}>
                          <Edit2 size={16} /> Editar
                        </button>
                        <button onClick={() => handleDelete(s.id)} className="btn btn-outline" style={{ padding: '0.4rem 0.75rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)', gap: '0.5rem', display: 'flex', alignItems: 'center' }}>
                          <Trash2 size={16} /> Eliminar
                        </button>
                      </div>
                    </td>
                  </>
                )}
                </tr>
                
                {/* Fila expandible para la ficha del alumno */}
                {selectedStudent?.id === s.id && (
                  <tr>
                    <td colSpan="6" style={{ padding: 0 }}>
                      <StudentDetailModal 
                        student={selectedStudent} 
                        usersMap={usersMap} 
                        onClose={() => setSelectedStudent(null)} 
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {filteredStudents.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No se encontraron alumnos.
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentManagement;
