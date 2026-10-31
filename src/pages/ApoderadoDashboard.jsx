import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  LogOut, CheckCircle, Clock, Search, UserPlus, Upload, AlertCircle, MessageCircle,
  Receipt, TrendingDown, Eye, X, Sparkles, ExternalLink, DollarSign 
} from 'lucide-react';
import { db, storage } from '../firebase/config';
import { collection, query, where, getDocs, getDoc, doc, updateDoc, setDoc, or, addDoc, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useNavigate, useLocation } from 'react-router-dom';
import { formatStudentName } from '../utils/nameUtils';
import { formatRut } from '../utils/rutUtils';
import { useModal } from '../context/ModalContext';
import InstallAppGuide from '../components/InstallAppGuide';

const ApoderadoDashboard = () => {
  const { showAlert } = useModal();
  const { user, role, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const impersonateStudentId = location.state?.impersonateStudentId;
  
  const [myStudents, setMyStudents] = useState([]);
  const [activeStudentId, setActiveStudentId] = useState(null);
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Profile completion states
  const [isProfileComplete, setIsProfileComplete] = useState(true);
  const [formalName, setFormalName] = useState('');
  
  // States for search
  const [lastNameSearch, setLastNameSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  
  const [payingDebt, setPayingDebt] = useState(null);
  const [paidAmount, setPaidAmount] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  
  // Settings
  const [transferData, setTransferData] = useState(null);
  const [whatsappContact, setWhatsappContact] = useState('');

  // Course expenses transparency
  const [outcomes, setOutcomes] = useState([]);
  const [outcomesLoading, setOutcomesLoading] = useState(false);
  const [courseStudentsCount, setCourseStudentsCount] = useState(1);
  const [fundsMap, setFundsMap] = useState({});
  const [expenseSearch, setExpenseSearch] = useState('');
  const [previewReceiptUrl, setPreviewReceiptUrl] = useState(null);

  // RUT linking state
  const [linkingStudentId, setLinkingStudentId] = useState(null);
  const [rutInput, setRutInput] = useState('');
  const [rutError, setRutError] = useState('');

  useEffect(() => {
    fetchData();
  }, [user]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 0. Check Profile Completion
      if (!impersonateStudentId) {
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
      } else {
        setIsProfileComplete(true);
      }

      // 0.5 Settings are fetched based on activeStudentId in a separate effect

      // 1. Fetch Students
      let students = [];
      if (impersonateStudentId && (role === 'admin' || role === 'superadmin')) {
        const snap = await getDoc(doc(db, 'students', impersonateStudentId));
        if (snap.exists()) {
          students = [{ id: snap.id, ...snap.data() }];
        }
      } else {
        const qStudents = query(
          collection(db, 'students'), 
          or(
            where('apoderadoEmail', '==', user.email),
            where('apoderadoEmails', 'array-contains', user.email)
          )
        );
        const snapStudents = await getDocs(qStudents);
        students = snapStudents.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      students.sort((a, b) => {
        const aNum = parseInt(a.listNumber) || 999;
        const bNum = parseInt(b.listNumber) || 999;
        return aNum - bNum;
      });
      setMyStudents(students);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (myStudents.length === 0) return;
    
    const studentIds = myStudents.map(s => s.id).slice(0, 30); // max 30 for 'in' query
    const qDebts = query(collection(db, 'debts'), where('studentId', 'in', studentIds));
    
    const unsubscribe = onSnapshot(qDebts, (snapDebts) => {
      const fetchedDebts = snapDebts.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Ordenar: pendientes primero
      fetchedDebts.sort((a, b) => {
        const statusOrder = { pending: 1, partial: 2, review: 3, paid: 4 };
        if (statusOrder[a.status] !== statusOrder[b.status]) {
          return statusOrder[a.status] - statusOrder[b.status];
        }
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      setDebts(fetchedDebts);
    }, (error) => {
      console.error("Error listening to debts:", error);
    });

    return () => unsubscribe();
  }, [myStudents]);

  useEffect(() => {
    if (myStudents.length > 0 && !activeStudentId) {
      setActiveStudentId(myStudents[0].id);
    }
  }, [myStudents, activeStudentId]);

  useEffect(() => {
    if (!activeStudentId) return;
    const student = myStudents.find(s => s.id === activeStudentId);
    if (!student) return;
    const courseId = student.courseId || debts.find(d => d.studentId === student.id)?.courseId;
    if (!courseId) return;

    try {
      const settingsDocRef = doc(db, 'settings', courseId);
      const unsubscribe = onSnapshot(settingsDocRef, (settingsSnap) => {
        if (settingsSnap.exists()) {
          const data = settingsSnap.data();
          if (data.transferData) {
            setTransferData(data.transferData);
          } else {
            setTransferData(null);
          }
          if (data.whatsappContact) {
            setWhatsappContact(data.whatsappContact);
          } else {
            setWhatsappContact('');
          }
        } else {
          setWhatsappContact('');
          setTransferData(null);
        }
      }, (error) => {
        console.error("Error fetching course settings in real-time:", error);
      });

      return () => unsubscribe();
    } catch (error) {
      console.error("Error setting up course settings listener:", error);
    }
  }, [activeStudentId, myStudents, debts]);

  const activeStudent = myStudents.find(s => s.id === activeStudentId);
  const canViewExpenses = Boolean(activeStudent?.showExpensesInPortal);

  useEffect(() => {
    if (!activeStudentId || !canViewExpenses) return;

    const student = myStudents.find(s => s.id === activeStudentId);
    if (!student) return;

    const courseId = student.courseId || debts.find(d => d.studentId === student.id)?.courseId;
    if (!courseId) return;

    let isMounted = true;
    setOutcomesLoading(true);

    const loadCourseExpenses = async () => {
      try {
        // 1. Fetch active students count in course
        const qStudents = query(collection(db, 'students'), where('courseId', '==', courseId));
        const studentsSnap = await getDocs(qStudents);
        const activeCount = studentsSnap.docs.filter(d => d.data().status !== 'retirado').length || 1;

        // 2. Fetch funds to get readable names
        const qFunds = query(collection(db, 'funds'), where('courseId', '==', courseId));
        const fundsSnap = await getDocs(qFunds);
        const fMap = { general: 'Fondo General' };
        fundsSnap.docs.forEach(d => {
          fMap[d.id] = d.data().name || d.id;
        });

        // 3. Fetch outcomes for this course
        const qOutcomes = query(collection(db, 'outcomes'), where('courseId', '==', courseId));
        const outcomesSnap = await getDocs(qOutcomes);
        const loadedOutcomes = outcomesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        loadedOutcomes.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

        if (isMounted) {
          setCourseStudentsCount(activeCount);
          setFundsMap(fMap);
          setOutcomes(loadedOutcomes);
        }
      } catch (err) {
        console.error("Error fetching course outcomes:", err);
      } finally {
        if (isMounted) setOutcomesLoading(false);
      }
    };

    loadCourseExpenses();

    return () => { isMounted = false; };
  }, [activeStudentId, canViewExpenses, myStudents, debts]);

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
  };

  const formatExpenseDate = (dateStr) => {
    if (!dateStr) return 'Sin fecha';
    try {
      const d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T12:00:00');
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('es-CL', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  };

  const getOutcomeBreakdown = (outcome, studentId) => {
    const totalAmount = outcome.amount || 0;
    
    // Check if outcome has explicit student participants
    if (Array.isArray(outcome.participantStudentIds) && outcome.participantStudentIds.length > 0) {
      const assignedCount = outcome.participantStudentIds.length;
      const isAssigned = outcome.participantStudentIds.includes(studentId);
      const percent = assignedCount > 0 ? (100 / assignedCount) : 0;
      const share = isAssigned ? Math.round(totalAmount / assignedCount) : 0;
      return {
        assignedCount,
        percent,
        share,
        isAssigned,
        type: 'specific',
        label: `${assignedCount} alumnos asignados`
      };
    }

    // Check if custom studentsCount was provided
    if (typeof outcome.studentsCount === 'number' && outcome.studentsCount > 0) {
      const assignedCount = outcome.studentsCount;
      const percent = (100 / assignedCount);
      const share = Math.round(totalAmount / assignedCount);
      return {
        assignedCount,
        percent,
        share,
        isAssigned: true,
        type: 'count',
        label: `${assignedCount} alumnos`
      };
    }

    // Default: distributed among all active students in course
    const assignedCount = courseStudentsCount > 0 ? courseStudentsCount : 1;
    const percent = (100 / assignedCount);
    const share = Math.round(totalAmount / assignedCount);
    return {
      assignedCount,
      percent,
      share,
      isAssigned: true,
      type: 'course',
      label: `General (${assignedCount} alumnos)`
    };
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
      filtered.sort((a, b) => {
        const aNum = parseInt(a.listNumber) || 999;
        const bNum = parseInt(b.listNumber) || 999;
        return aNum - bNum;
      });
      setSearchResults(filtered);
    } catch (error) {
      console.error("Error searching students:", error);
    }
  };

  const handleLinkStudent = async (e) => {
    e.preventDefault();
    setRutError('');
    
    // Basic format validation XX.XXX.XXX-X
    const rutRegex = /^[0-9]{1,2}\.[0-9]{3}\.[0-9]{3}-[0-9kK]{1}$/;
    if (!rutRegex.test(rutInput.trim())) {
      setRutError('Formato de RUT inválido. Use el formato XX.XXX.XXX-X');
      return;
    }

    try {
      const studentRef = doc(db, 'students', linkingStudentId);
      const studentSnap = await getDoc(studentRef);
      if (studentSnap.exists()) {
        const data = studentSnap.data();
        
        // Verificamos el RUT
        if (data.rut && data.rut !== rutInput.trim()) {
          setRutError('El RUT ingresado no coincide con nuestros registros.');
          return;
        }

        let emails = data.apoderadoEmails || (data.apoderadoEmail ? [data.apoderadoEmail] : []);
        if (!emails.includes(user.email)) {
          if (emails.length >= 2) {
            setRutError('Este alumno ya tiene 2 apoderados vinculados.');
            return;
          }
          emails.push(user.email);
          // Guardar RUT si es la primera vez
          await updateDoc(studentRef, { 
            apoderadoEmails: emails,
            rut: rutInput.trim()
          });

          // Notificar al superadmin por correo
          try {
            const usersSnap = await getDocs(collection(db, 'users'));
            const superAdmins = [];
            usersSnap.forEach(uDoc => {
              const uData = uDoc.data();
              if (uData.role === 'superadmin' || (uData.roles && uData.roles.global === 'superadmin')) {
                superAdmins.push(uDoc.id); // Document ID is the email
              }
            });

            for (const adminEmail of superAdmins) {
              await addDoc(collection(db, 'mail'), {
                to: adminEmail,
                message: {
                  subject: `Nuevo Apoderado Vinculado: ${data.name}`,
                  html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 10px;">
                      <h2 style="color: #4f46e5;">¡Nuevo Apoderado Vinculado!</h2>
                      <p>Un usuario acaba de vincularse exitosamente a un alumno en el sistema.</p>
                      <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin-top: 20px;">
                        <p style="margin: 5px 0;"><strong>Alumno Reconocido:</strong> ${data.name}</p>
                        <p style="margin: 5px 0;"><strong>Apoderado (Email):</strong> ${user.email}</p>
                        <p style="margin: 5px 0;"><strong>RUT Validado:</strong> ${rutInput.trim()}</p>
                        <p style="margin: 5px 0;"><strong>Fecha y Hora:</strong> ${new Date().toLocaleString('es-CL')}</p>
                      </div>
                      <p style="color: #64748b; font-size: 0.85rem; margin-top: 20px;">Este es un mensaje automático enviado por el portal de ControlCurso.</p>
                    </div>
                  `
                }
              });
            }
          } catch (mailError) {
            console.error("Error sending notification email:", mailError);
          }
        }
        
        // Éxito
        fetchData();
        setLastNameSearch('');
        setSearchResults([]);
        setHasSearched(false);
        setLinkingStudentId(null);
        setRutInput('');
      }
    } catch (error) {
      console.error("Error linking student:", error);
      setRutError('Hubo un error al vincular el alumno.');
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
      await showAlert('Hubo un error al guardar tu nombre.');
    }
  };


  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    if (!paidAmount) {
      await showAlert("Debes ingresar el monto que estás informando.");
      return;
    }

    setUploading(true);
    try {
      let downloadURL = null;

      if (receiptFile) {
        try {
          // Subir archivo a Storage
          const fileExt = receiptFile.name.split('.').pop();
          const fileName = `receipts/${payingDebt.id}_${Date.now()}.${fileExt}`;
          const storageRef = ref(storage, fileName);
          
          await uploadBytes(storageRef, receiptFile);
          downloadURL = await getDownloadURL(storageRef);
        } catch (uploadError) {
          console.error("Error al subir comprobante:", uploadError);
          await showAlert("No pudimos subir tu foto. Error detallado: " + uploadError.message + " | Código: " + uploadError.code + ". Tu pago será registrado de todas formas.");
        }
      }

      // Actualizar la deuda en Firestore
      const updateData = {
        status: 'review', // Pasa a revisión del admin
        paidAmount: (payingDebt.paidAmount || 0) + parseFloat(paidAmount),
        lastPaymentAmount: parseFloat(paidAmount),
        paidAt: new Date().toISOString()
      };
      
      if (downloadURL) {
        updateData.receiptUrl = downloadURL;
      }

      const debtRef = doc(db, 'debts', payingDebt.id);
      await updateDoc(debtRef, updateData);

      // Notificar a superadmin y tesoreros por correo
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        const notifyEmails = new Set();
        usersSnap.forEach(uDoc => {
          const uData = uDoc.data();
          if (uData.role === 'superadmin' || (uData.roles && uData.roles.global === 'superadmin')) {
            notifyEmails.add(uDoc.id);
          }
          if (uData.roles && payingDebt.courseId && uData.roles[payingDebt.courseId] === 'tesorero') {
            notifyEmails.add(uDoc.id);
          }
        });

        for (const adminEmail of notifyEmails) {
          await addDoc(collection(db, 'mail'), {
            to: adminEmail,
            message: {
              subject: `Nuevo Pago por Aprobar: ${payingDebt.studentName}`,
              html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 10px;">
                  <h2 style="color: #4f46e5;">¡Nuevo Comprobante de Pago Recibido!</h2>
                  <p>Un apoderado ha subido un nuevo comprobante de pago que está pendiente de revisión.</p>
                  <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin-top: 20px;">
                    <p style="margin: 5px 0;"><strong>Alumno:</strong> ${payingDebt.studentName}</p>
                    <p style="margin: 5px 0;"><strong>Cuota/Motivo:</strong> ${payingDebt.title}</p>
                    <p style="margin: 5px 0;"><strong>Monto Subido:</strong> $${parseFloat(paidAmount).toLocaleString('es-CL')}</p>
                    <p style="margin: 5px 0;"><strong>Enviado por (Email):</strong> ${user.email}</p>
                    <p style="margin: 5px 0;"><strong>Fecha y Hora:</strong> ${new Date().toLocaleString('es-CL')}</p>
                  </div>
                  <p style="margin-top: 20px;">Por favor, ingresa a la plataforma y dirígete a la sección <strong>Aprobaciones</strong> o <strong>Detalle de Cuota</strong> para verificar el comprobante y aprobar el pago.</p>
                  <p style="color: #64748b; font-size: 0.85rem; margin-top: 20px;">Este es un mensaje automático enviado por el portal de ControlCurso.</p>
                </div>
              `
            }
          });
        }
      } catch (mailError) {
        console.error("Error sending notification email for payment:", mailError);
      }

      // Refrescar localmente
      await showAlert("Comprobante enviado con éxito. Está pendiente de revisión por el administrador.");
      setPayingDebt(null);
      setReceiptFile(null);
      setPaidAmount('');
      fetchData();

    } catch (error) {
      console.error("Error al registrar pago:", error);
      await showAlert("Hubo un error al procesar tu pago. Por favor intenta de nuevo.");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando portal...</div>;
  }

  return (
    <>
    <div className="container animate-fade-in">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <img 
            src="/LOGOAPPCURSO.jpg" 
            alt="Logo" 
            style={{ width: '75px', height: '75px', borderRadius: '8px', objectFit: 'cover', backgroundColor: 'white', padding: 0, border: '1px solid rgba(255,255,255,0.1)' }} 
            onError={(e) => e.target.style.display = 'none'}
          />
          <div>
            <h2 style={{ margin: 0 }}>Mi Portal</h2>
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>Bienvenido, {user?.displayName || user?.email}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {(role === 'admin' || role === 'superadmin') && (
            <button onClick={() => navigate('/admin')} className="btn btn-outline" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
              Volver a Panel Admin
            </button>
          )}
          <InstallAppGuide />
          <button onClick={logout} className="btn btn-outline">
            <LogOut size={18} />
            Salir
          </button>
        </div>
      </header>

      {/* Student Selector Top Bar */}
      {isProfileComplete && myStudents.length > 1 && (
        <div className="tabs-scroll" style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', overflowX: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', paddingBottom: '0.5rem' }}>
          {myStudents.map(student => (
            <button
              key={student.id}
              onClick={() => setActiveStudentId(student.id)}
              className={`btn ${activeStudentId === student.id ? 'btn-primary' : 'btn-outline'}`}
              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {formatStudentName(student)}
            </button>
          ))}
        </div>
      )}

      {/* BANNER URGENTE */}
      {isProfileComplete && debts.some(d => (role === 'superadmin' || d.visibleInPortal !== false) && d.urgentNotice && (d.status === 'pending' || d.status === 'partial')) && (
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
          {/* MODAL RUT */}
          {linkingStudentId && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
              <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '400px', padding: '2rem', backgroundColor: 'var(--bg-main)' }}>
                <h3 style={{ marginBottom: '1rem' }}>Confirmar Identidad</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                  Para proteger la privacidad de los alumnos, debes ingresar el RUT de tu hijo/a para confirmar que eres su apoderado.
                </p>
                {rutError && (
                  <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.9rem' }}>
                    {rutError}
                  </div>
                )}
                <form onSubmit={handleLinkStudent} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">RUT del Alumno</label>
                    <input 
                      type="text" 
                      required
                      className="input-field" 
                      value={rutInput}
                      onChange={(e) => setRutInput(formatRut(e.target.value))}
                      placeholder="Ej. 12.345.678-9"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                    <button type="button" onClick={() => { setLinkingStudentId(null); setRutInput(''); setRutError(''); }} className="btn btn-outline" style={{ flex: 1 }}>
                      Cancelar
                    </button>
                    <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                      Confirmar
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
                  <div key={s.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                    <div style={{ flex: '1 1 auto', minWidth: '200px' }}>
                      <p style={{ fontWeight: '500', fontSize: '1.1rem', wordBreak: 'break-word' }}>{formatStudentName(s)}</p>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {(s.apoderadoEmails?.length > 0) 
                          ? `(Vinculado a: ${s.apoderadoEmails.join(', ')})` 
                          : (s.apoderadoEmail ? `(Vinculado a ${s.apoderadoEmail})` : 'Sin apoderado vinculado')}
                      </p>
                    </div>
                    <button 
                      onClick={() => {
                        setLinkingStudentId(s.id);
                        setRutInput('');
                        setRutError('');
                      }}
                      className="btn btn-outline" 
                      style={{ color: 'var(--success)', borderColor: 'rgba(16,185,129,0.3)', flex: '0 0 auto', whiteSpace: 'nowrap' }}
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
          {myStudents.filter(student => student.id === activeStudentId).map(student => {
            const allStudentDebts = debts.filter(d => d.studentId === student.id);
            const studentDebts = allStudentDebts.filter(d => {
              const baseTitle = d.title.replace('(Saldo Restante)', '').trim();
              
              if (d.status === 'partial') {
                const hasSpecificSaldoRestante = allStudentDebts.some(other => 
                  other.title.includes('(Saldo Restante)') && other.title.includes(baseTitle)
                );
                if (hasSpecificSaldoRestante) return false;
              }

              if (d.title.includes('(Saldo Restante)')) {
                const originalIsPaid = allStudentDebts.some(other => 
                  other.title.trim() === baseTitle && other.status === 'paid'
                );
                if (originalIsPaid) return false;
              }
              
              return true;
            });
            
            return (
              <React.Fragment key={student.id}>
                <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
                <h3 style={{ marginBottom: '1.5rem', color: 'var(--primary)' }}>Estado de Pagos: {formatStudentName(student)}</h3>
                
                {parseFloat(student.balance) > 0 && (
                  <div style={{ padding: '1rem', marginBottom: '1.5rem', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle size={18} /> 
                    <span>
                      Tienes un saldo a favor de <strong>{new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(student.balance)}</strong>. 
                      <span style={{ fontSize: '0.85rem', display: 'block', marginTop: '0.2rem', opacity: 0.8 }}>Este dinero puede ser utilizado por la directiva para descontar futuras cuotas.</span>
                    </span>
                  </div>
                )}
                
                {studentDebts.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>No hay cobros registrados para este alumno.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '1rem' }}>
                    {studentDebts.map(debt => {
                      const paidAmt = debt.paidAmount || 0;
                      const remainingAmount = Math.max(0, debt.amount - paidAmt);
                      const isPartial = paidAmt > 0 && remainingAmount > 0;
                      
                      return (
                      <div key={debt.id} style={{ 
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', 
                        borderLeft: `4px solid ${debt.status === 'paid' ? 'var(--success)' : debt.status === 'review' ? 'var(--warning)' : (debt.status === 'partial' || isPartial) ? '#eab308' : 'var(--danger)'}` 
                      }}>
                        <div>
                          <p style={{ fontWeight: '500', fontSize: '1.1rem', marginBottom: '0.2rem' }}>
                            {debt.title}
                          </p>
                          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {isPartial ? `Saldo Restante: ` : `Monto de la cuota: `} <strong>${isPartial ? remainingAmount : debt.amount}</strong> 
                            {paidAmt > 0 && <span style={{opacity: 0.7}}> (Pagado: ${paidAmt})</span>}
                            <span> • Emitida: {debt.date}</span>
                          </p>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          {(debt.status === 'pending' || debt.status === 'partial' || isPartial) && (
                            <>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: (debt.status === 'partial' || isPartial) ? '#eab308' : 'var(--danger)', fontWeight: '500' }}>
                                <AlertCircle size={18} /> {(debt.status === 'partial' || isPartial) ? 'Pago Parcial (Saldo Pendiente)' : 'Por Pagar'}
                              </div>
                              <button 
                                onClick={() => {
                                  // Update payingDebt to have the correct remaining amount so the modal shows the right value
                                  setPayingDebt({ ...debt, amount: remainingAmount });
                                  setPaidAmount(remainingAmount.toString());
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
                    );
                    })}
                  </div>
                )}
              </div>

              {/* Transparencia de Gastos del Curso */}
              {canViewExpenses && (
                <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
                  {/* Header */}
                  <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                      <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '0.5rem', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', display: 'flex', alignItems: 'center' }}>
                        <Receipt size={22} />
                      </div>
                      <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.3rem' }}>
                        Transparencia de Gastos del Curso
                      </h3>
                    </div>
                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                      Detalle de compras y egresos del curso con la cuota proporcional calculada para <strong>{formatStudentName(student)}</strong>.
                    </p>
                  </div>

                  {/* KPI Financial Summary Cards */}
                  {(() => {
                    const visibleOutcomes = outcomes.filter(o => o.visibleInPortal !== false);

                    const totalCourseExpenses = visibleOutcomes.reduce((sum, o) => sum + (o.amount || 0), 0);
                    const totalStudentExpenses = visibleOutcomes.reduce((sum, o) => {
                      const bd = getOutcomeBreakdown(o, student.id);
                      return sum + (bd.isAssigned ? bd.share : 0);
                    }, 0);

                    const filteredOutcomes = visibleOutcomes.filter(o => {
                      if (!expenseSearch.trim()) return true;
                      const term = expenseSearch.toLowerCase();
                      const titleMatch = (o.title || '').toLowerCase().includes(term);
                      const dateMatch = (o.date || '').toLowerCase().includes(term);
                      const fundMatch = (fundsMap[o.fundId] || '').toLowerCase().includes(term);
                      const responsableMatch = (o.responsable || '').toLowerCase().includes(term);
                      return titleMatch || dateMatch || fundMatch || responsableMatch;
                    });

                    return (
                      <>
                        <div style={{ 
                          display: 'grid', 
                          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', 
                          gap: '1rem', 
                          marginBottom: '1.5rem' 
                        }}>
                          {/* Total Gastos Curso */}
                          <div style={{ padding: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.06)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                            <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <TrendingDown size={14} style={{ color: 'var(--danger)' }} /> Total Gastos del Curso
                            </p>
                            <h3 style={{ margin: 0, color: 'var(--danger)', fontSize: '1.3rem' }}>
                              {formatMoney(totalCourseExpenses)}
                            </h3>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {visibleOutcomes.length} gastos registrados
                            </span>
                          </div>

                          {/* Cuota Alumno */}
                          <div style={{ padding: '1rem', backgroundColor: 'rgba(99, 102, 241, 0.06)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                            <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <Receipt size={14} style={{ color: 'var(--primary)' }} /> Proporcional a este Alumno
                            </p>
                            <h3 style={{ margin: 0, color: 'var(--primary)', fontSize: '1.3rem' }}>
                              {formatMoney(totalStudentExpenses)}
                            </h3>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Suma correspondiente al alumno
                            </span>
                          </div>

                          {/* Alumnos en Curso */}
                          <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                            <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Alumnos Activos en Curso
                            </p>
                            <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.3rem' }}>
                              {courseStudentsCount}
                            </h3>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Base división general (~{(100 / (courseStudentsCount || 1)).toFixed(1)}% c/u)
                            </span>
                          </div>
                        </div>

                        {/* Buscador de Gastos */}
                        <div style={{ marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ position: 'relative', flex: 1, minWidth: '220px', maxWidth: '350px' }}>
                            <input 
                              type="text"
                              className="input-field"
                              placeholder="Buscar gasto por detalle, fecha o fondo..."
                              value={expenseSearch}
                              onChange={(e) => setExpenseSearch(e.target.value)}
                              style={{ width: '100%', paddingLeft: '2.2rem', fontSize: '0.9rem' }}
                            />
                            <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                          </div>
                          {expenseSearch && (
                            <button type="button" onClick={() => setExpenseSearch('')} className="btn btn-outline" style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>
                              Limpiar filtro
                            </button>
                          )}
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                            Mostrando {filteredOutcomes.length} de {visibleOutcomes.length} gastos
                          </span>
                        </div>

                        {/* Listado de Gastos */}
                        {outcomesLoading ? (
                          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                            Cargando registro de gastos del curso...
                          </div>
                        ) : filteredOutcomes.length === 0 ? (
                          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)' }}>
                            {visibleOutcomes.length === 0 ? 'No hay gastos registrados en este curso aún.' : 'No se encontraron gastos que coincidan con la búsqueda.'}
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gap: '0.75rem' }}>
                            {filteredOutcomes.map(outcome => {
                              const bd = getOutcomeBreakdown(outcome, student.id);
                              const receipt = outcome.receiptUrl || outcome.receiptUrls?.[0] || outcome.voucherUrl;

                              return (
                                <div 
                                  key={outcome.id} 
                                  style={{ 
                                    padding: '1rem 1.25rem', 
                                    backgroundColor: 'rgba(255, 255, 255, 0.03)', 
                                    borderRadius: 'var(--radius-md)', 
                                    border: '1px solid var(--border-color)', 
                                    display: 'flex', 
                                    flexWrap: 'wrap', 
                                    alignItems: 'center', 
                                    justifyContent: 'space-between', 
                                    gap: '1rem',
                                    borderLeft: bd.isAssigned ? '4px solid var(--primary)' : '4px solid rgba(255,255,255,0.2)'
                                  }}
                                >
                                  {/* Left: Detalle, Fecha, Fondo */}
                                  <div style={{ flex: '1 1 260px', minWidth: '220px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                                      <h4 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-main)', fontWeight: '600' }}>
                                        {outcome.title}
                                      </h4>
                                      {outcome.fundId && (
                                        <span style={{ 
                                          fontSize: '0.7rem', 
                                          padding: '0.15rem 0.5rem', 
                                          borderRadius: '12px', 
                                          backgroundColor: 'rgba(99, 102, 241, 0.15)', 
                                          color: 'var(--primary)',
                                          fontWeight: '500'
                                        }}>
                                          {fundsMap[outcome.fundId] || outcome.fundId}
                                        </span>
                                      )}
                                    </div>

                                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.825rem', color: 'var(--text-muted)' }}>
                                      <span>📅 {formatExpenseDate(outcome.date)}</span>
                                      {outcome.paymentMethod && <span>💳 {outcome.paymentMethod === 'transfer' ? 'Transferencia' : outcome.paymentMethod === 'cash' ? 'Efectivo' : outcome.paymentMethod}</span>}
                                      {outcome.responsable && <span>👤 {outcome.responsable}</span>}
                                    </div>
                                  </div>

                                  {/* Middle: Gasto Total y Asignación */}
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: '130px' }}>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Gasto Total</span>
                                    <span style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--danger)' }}>
                                      {formatMoney(outcome.amount)}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                      {bd.label} ({bd.percent.toFixed(1)}%)
                                    </span>
                                  </div>

                                  {/* Right: Cuota que le corresponde al alumno */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                    <div style={{ 
                                      textAlign: 'right', 
                                      minWidth: '130px',
                                      padding: '0.5rem 0.75rem',
                                      borderRadius: 'var(--radius-sm)',
                                      backgroundColor: bd.isAssigned ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                                      border: bd.isAssigned ? '1px solid rgba(99, 102, 241, 0.25)' : '1px solid var(--border-color)'
                                    }}>
                                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        Le Corresponde
                                      </span>
                                      {bd.isAssigned ? (
                                        <>
                                          <span style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--text-main)' }}>
                                            {formatMoney(bd.share)}
                                          </span>
                                          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--primary)', fontWeight: '600' }}>
                                            {bd.percent.toFixed(1)}% del gasto
                                          </span>
                                        </>
                                      ) : (
                                        <>
                                          <span style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-muted)' }}>
                                            $0
                                          </span>
                                          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                            No asignado
                                          </span>
                                        </>
                                      )}
                                    </div>

                                    {receipt && (
                                      <button 
                                        type="button"
                                        onClick={() => setPreviewReceiptUrl(receipt)}
                                        className="btn btn-outline"
                                        style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--primary)', borderColor: 'rgba(99, 102, 241, 0.3)' }}
                                        title="Ver boleta o comprobante"
                                      >
                                        <Eye size={15} /> Boleta
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
              </React.Fragment>
            );
          })}

        </>
      )}
        </>
      )}

      <div className="glass-panel" style={{ padding: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <h3 style={{ margin: 0 }}>Información del Curso</h3>
          {whatsappContact && (
            <a 
              href={`https://wa.me/${whatsappContact.replace(/\D/g, '')}`} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="btn btn-primary"
              style={{ backgroundColor: '#25D366', borderColor: '#25D366', padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <MessageCircle size={18} /> Contactar Tesorería
            </a>
          )}
        </div>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem', marginBottom: '1rem' }}>
          Para cualquier duda respecto a los pagos, por favor contacta a la directiva del curso.
        </p>
        <div style={{ padding: '1rem', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--primary)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <AlertCircle size={20} style={{ color: 'var(--primary)' }} />
          <p style={{ margin: 0, color: 'var(--text-main)', fontSize: '0.95rem' }}>
            <strong>Recuerda:</strong> Si no se ven reflejados tus pagos, actualiza la app o recarga la página.
          </p>
        </div>
      </div>
    </div>

    {/* MODAL DE PAGO MOVED OUTSIDE CONTAINER */}
    {payingDebt && (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
        <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', padding: '2rem', backgroundColor: 'var(--bg-main)' }}>
          <h3 style={{ marginBottom: '1rem' }}>Informar Pago</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Estás reportando el pago para <strong>{payingDebt.title}</strong> del alumno <strong>{payingDebt.studentName}</strong>. 
            El monto esperado es de <strong>${payingDebt.amount}</strong>.
          </p>

          {(() => {
            const dataToShow = payingDebt.transferData || transferData;
            if (dataToShow && dataToShow.bank) {
              return (
                <div style={{ backgroundColor: 'rgba(99,102,241,0.05)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(99,102,241,0.2)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--primary)', fontSize: '0.95rem' }}>Datos de Transferencia</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.3rem', color: 'var(--text-main)' }}>
                    {dataToShow.alias && <div><strong>Alias:</strong> {dataToShow.alias}</div>}
                    {dataToShow.bank && <div><strong>Banco:</strong> {dataToShow.bank}</div>}
                    {dataToShow.accountType && <div><strong>Tipo de Cuenta:</strong> {dataToShow.accountType}</div>}
                    {dataToShow.accountNumber && <div><strong>Número:</strong> {dataToShow.accountNumber}</div>}
                    {dataToShow.rut && <div><strong>RUT:</strong> {dataToShow.rut}</div>}
                    {dataToShow.name && <div><strong>Nombre:</strong> {dataToShow.name}</div>}
                    {dataToShow.email && <div><strong>Correo:</strong> {dataToShow.email}</div>}
                  </div>
                </div>
              );
            }
            return null;
          })()}

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
              <label className="input-label">Comprobante (Imagen o PDF) - Opcional</label>
              <input 
                type="file" 
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

    {/* MODAL DE COMPROBANTE DE GASTO */}
    {previewReceiptUrl && (
      <div 
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} 
        onClick={() => setPreviewReceiptUrl(null)}
      >
        <div className="glass-panel" style={{ maxWidth: '650px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '1.5rem', backgroundColor: 'var(--bg-main)', position: 'relative' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
            <h4 style={{ margin: 0 }}>Comprobante de Gasto</h4>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <a href={previewReceiptUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <ExternalLink size={14} /> Abrir original
              </a>
              <button type="button" onClick={() => setPreviewReceiptUrl(null)} className="btn btn-outline" style={{ padding: '0.35rem 0.6rem' }}>
                <X size={16} />
              </button>
            </div>
          </div>
          {previewReceiptUrl.toLowerCase().includes('.pdf') ? (
            <iframe src={previewReceiptUrl} style={{ width: '100%', height: '500px', border: 'none', borderRadius: 'var(--radius-sm)' }} title="Boleta PDF" />
          ) : (
            <img src={previewReceiptUrl} alt="Comprobante" style={{ width: '100%', height: 'auto', maxHeight: '70vh', objectFit: 'contain', borderRadius: 'var(--radius-sm)' }} />
          )}
        </div>
      </div>
    )}
    </>
  );
};

export default ApoderadoDashboard;
