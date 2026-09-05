import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, CheckCircle, Clock, Search, UserPlus, Upload, AlertCircle } from 'lucide-react';
import { db, storage } from '../firebase/config';
import { collection, query, where, getDocs, getDoc, doc, updateDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useNavigate } from 'react-router-dom';

const ApoderadoDashboard = () => {
  const { user, role, logout } = useAuth();
  const navigate = useNavigate();
  
  const [myStudents, setMyStudents] = useState([]);
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Profile completion states
  const [isProfileComplete, setIsProfileComplete] = useState(true);
  const [formalName, setFormalName] = useState('');
  
  // States for search
  const [lastNameSearch, setLastNameSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  
  // Payment Modal States
  const [payingDebt, setPayingDebt] = useState(null);
  const [paidAmount, setPaidAmount] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchData();
  }, [user]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 0. Check Profile Completion
      const userDocRef = doc(db, 'users', user.email);
      const userSnap = await getDoc(userDocRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        if (!userData.formalName) {
          setIsProfileComplete(false);
          setLoading(false);
          return; // Stop here if profile is incomplete
        }
      }

      // 1. Fetch Students
      const qStudents = query(collection(db, 'students'), where('apoderadoEmail', '==', user.email));
      const snapStudents = await getDocs(qStudents);
      const students = snapStudents.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMyStudents(students);

      // 2. Fetch Debts
      if (students.length > 0) {
        const qDebts = query(collection(db, 'debts'), where('apoderadoEmail', '==', user.email));
        const snapDebts = await getDocs(qDebts);
        const fetchedDebts = snapDebts.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Ordenar: pendientes primero
        fetchedDebts.sort((a, b) => {
          if (a.status === 'pending' && b.status !== 'pending') return -1;
          if (a.status !== 'pending' && b.status === 'pending') return 1;
          return new Date(b.createdAt) - new Date(a.createdAt);
        });
        setDebts(fetchedDebts);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!lastNameSearch.trim()) return;
    
    setHasSearched(true);
    try {
      const snapshot = await getDocs(collection(db, 'students'));
      const allStudents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const term = lastNameSearch.toLowerCase().trim();
      
      const filtered = allStudents.filter(s => s.name.toLowerCase().includes(term));
      setSearchResults(filtered);
    } catch (error) {
      console.error("Error searching students:", error);
    }
  };

  const handleLinkStudent = async (studentId) => {
    try {
      const studentRef = doc(db, 'students', studentId);
      await updateDoc(studentRef, { apoderadoEmail: user.email });
      fetchData();
      setLastNameSearch('');
      setSearchResults([]);
      setHasSearched(false);
    } catch (error) {
      console.error("Error linking student:", error);
      alert('Hubo un error al vincular el alumno.');
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!formalName.trim()) return;
    try {
      const userDocRef = doc(db, 'users', user.email);
      await updateDoc(userDocRef, { formalName: formalName.trim() });
      setIsProfileComplete(true);
      fetchData(); // Now fetch students and debts
    } catch (error) {
      console.error("Error saving profile:", error);
      alert('Hubo un error al guardar tu nombre.');
    }
  };


  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    if (!receiptFile || !paidAmount) {
      alert("Debes ingresar el monto y adjuntar un comprobante.");
      return;
    }

    setUploading(true);
    try {
      // Subir archivo a Storage
      const fileExt = receiptFile.name.split('.').pop();
      const fileName = `receipts/${payingDebt.id}_${Date.now()}.${fileExt}`;
      const storageRef = ref(storage, fileName);
      
      await uploadBytes(storageRef, receiptFile);
      const downloadURL = await getDownloadURL(storageRef);

      // Actualizar la deuda en Firestore
      const debtRef = doc(db, 'debts', payingDebt.id);
      await updateDoc(debtRef, {
        status: 'review', // Pasa a revisión del admin
        paidAmount: parseFloat(paidAmount),
        receiptUrl: downloadURL,
        paidAt: new Date().toISOString()
      });

      // Refrescar localmente
      alert("Comprobante enviado con éxito. Está pendiente de revisión por el administrador.");
      setPayingDebt(null);
      setReceiptFile(null);
      setPaidAmount('');
      fetchData();

    } catch (error) {
      console.error("Error al subir comprobante:", error);
      alert("Hubo un error al procesar tu pago. Asegúrate de que las reglas de Firebase Storage permitan subidas.");
    } finally {
      setUploading(false);
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
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {(role === 'admin' || role === 'superadmin') && (
            <button onClick={() => navigate('/admin')} className="btn btn-outline" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
              Volver a Panel Admin
            </button>
          )}
          <button onClick={logout} className="btn btn-outline">
            <LogOut size={18} />
            Salir
          </button>
        </div>
      </header>

      {/* BANNER URGENTE */}
      {isProfileComplete && debts.some(d => d.urgentNotice && d.status === 'pending') && (
        <div className="glass-panel" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', padding: '1rem', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '1rem', color: 'var(--danger)' }}>
          <AlertCircle size={24} />
          <div>
            <h4 style={{ margin: 0, fontWeight: 'bold' }}>¡Aviso Urgente de la Directiva!</h4>
            <p style={{ margin: 0, fontSize: '0.9rem' }}>Tienes cuotas pendientes que requieren tu atención inmediata. Por favor, regulariza tu situación subiendo los comprobantes correspondientes.</p>
          </div>
        </div>
      )}

      {!isProfileComplete ? (
        <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center', maxWidth: '500px', margin: '0 auto' }}>
          <div style={{ backgroundColor: 'rgba(99,102,241,0.1)', padding: '1.5rem', borderRadius: '50%', display: 'inline-block', marginBottom: '1.5rem', color: 'var(--primary)' }}>
            <UserPlus size={40} />
          </div>
          <h3 style={{ marginBottom: '1rem' }}>Completa tu Perfil</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
            Para poder gestionar los pagos y vincular a tu alumno, necesitamos que ingreses tu nombre y apellido real.
          </p>

          <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="input-group" style={{ textAlign: 'left' }}>
              <label className="input-label">Nombre y Apellido del Apoderado</label>
              <input 
                type="text" 
                required
                className="input-field" 
                placeholder="Ej. Juan Pérez"
                value={formalName}
                onChange={(e) => setFormalName(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.8rem' }}>
              Guardar y Continuar
            </button>
          </form>
        </div>
      ) : (
        <>
          {/* MODAL DE PAGO */}
      {payingDebt && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', padding: '2rem', backgroundColor: 'var(--bg-main)' }}>
            <h3 style={{ marginBottom: '1rem' }}>Informar Pago</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              Estás reportando el pago para <strong>{payingDebt.title}</strong> del alumno <strong>{payingDebt.studentName}</strong>. 
              El monto esperado es de <strong>${payingDebt.amount}</strong>.
            </p>

            <form onSubmit={handlePaymentSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Monto Transferido ($)</label>
                <input 
                  type="number" 
                  required
                  min="1"
                  className="input-field" 
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  placeholder="Ej. 15000"
                />
              </div>

              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Comprobante (Imagen o PDF)</label>
                <input 
                  type="file" 
                  required
                  accept="image/*,.pdf"
                  className="input-field" 
                  style={{ padding: '0.5rem' }}
                  onChange={(e) => setReceiptFile(e.target.files[0])}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setPayingDebt(null)} className="btn btn-outline" style={{ flex: 1 }}>
                  Cancelar
                </button>
                <button type="submit" disabled={uploading} className="btn btn-primary" style={{ flex: 1 }}>
                  {uploading ? 'Subiendo...' : 'Enviar Comprobante'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                      <UserPlus size={18} /> Soy su apoderado
                    </button>
                  </div>
                ))}
                {searchResults.length === 0 && <p>No se encontraron alumnos.</p>}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {myStudents.map(student => {
            const studentDebts = debts.filter(d => d.studentId === student.id);
            
            return (
              <div key={student.id} className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
                <h3 style={{ marginBottom: '1.5rem', color: 'var(--primary)' }}>Estado de Pagos: {student.name}</h3>
                
                {studentDebts.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>No hay cobros registrados para este alumno.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '1rem' }}>
                    {studentDebts.map(debt => (
                      <div key={debt.id} style={{ 
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', 
                        borderLeft: `4px solid ${debt.status === 'paid' ? 'var(--success)' : debt.status === 'review' ? 'var(--warning)' : 'var(--danger)'}` 
                      }}>
                        <div>
                          <p style={{ fontWeight: '500', fontSize: '1.1rem', marginBottom: '0.2rem' }}>{debt.title}</p>
                          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Monto de la cuota: <strong>${debt.amount}</strong> • Emitida: {debt.date}
                          </p>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          {debt.status === 'pending' && (
                            <>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)', fontWeight: '500' }}>
                                <AlertCircle size={18} /> Por Pagar
                              </div>
                              <button 
                                onClick={() => {
                                  setPayingDebt(debt);
                                  setPaidAmount(debt.amount.toString());
                                }} 
                                className="btn btn-primary" style={{ padding: '0.5rem 1rem' }}
                              >
                                <Upload size={16} /> Subir Comprobante
                              </button>
                            </>
                          )}
                          
                          {debt.status === 'review' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--warning)', fontWeight: '500', padding: '0.5rem 1rem', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: 'var(--radius-sm)' }}>
                              <Clock size={18} /> En revisión (Comprobante enviado)
                            </div>
                          )}
                          
                          {debt.status === 'paid' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--success)', fontWeight: '500', padding: '0.5rem 1rem', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: 'var(--radius-sm)' }}>
                              <CheckCircle size={18} /> Pagado
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
             <button onClick={() => setMyStudents([])} className="btn btn-outline" style={{ fontSize: '0.85rem' }}>
               Vincular a otro alumno
             </button>
          </div>
        </>
      )}
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
