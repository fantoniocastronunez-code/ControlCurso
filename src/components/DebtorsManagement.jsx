import React, { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, getDocs, doc, updateDoc, addDoc } from 'firebase/firestore';
import { ArrowLeft, Bell, AlertTriangle, CheckCircle } from 'lucide-react';

const DebtorsManagement = ({ onBack }) => {
  const [debtors, setDebtors] = useState({});
  const [loading, setLoading] = useState(true);
  const [notifying, setNotifying] = useState(null); // guardará el email del que está siendo notificado
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchDebts();
  }, []);

  const fetchDebts = async () => {
    setLoading(true);
    try {
      // 1. Traer todas las deudas pendientes
      const q = query(collection(db, 'debts'), where('status', '==', 'pending'));
      const snapshot = await getDocs(q);
      
      const grouped = {};
      
      snapshot.forEach(docSnap => {
        const debt = { id: docSnap.id, ...docSnap.data() };
        const emails = debt.apoderadoEmails || (debt.apoderadoEmail ? [debt.apoderadoEmail] : []);
        const emailKey = emails.length > 0 ? emails.join(', ') : 'Sin Apoderado';
        
        if (!grouped[emailKey]) {
          grouped[emailKey] = {
            email: emailKey,
            emailsArray: emails,
            totalAmount: 0,
            debts: [],
            students: new Set()
          };
        }
        
        grouped[emailKey].debts.push(debt);
        grouped[emailKey].totalAmount += debt.amount;
        grouped[emailKey].students.add(debt.studentName);
      });

      setDebtors(grouped);
    } catch (error) {
      console.error("Error fetching debts:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleNotify = async (email, data) => {
    if (email === 'Sin Apoderado') {
      alert('No puedes notificar a un alumno sin apoderado vinculado.');
      return;
    }
    
    setNotifying(email);
    try {
      // 1. Marcar las deudas como urgentes para que le salte el banner en la web
      const updatePromises = data.debts.map(debt => {
        const debtRef = doc(db, 'debts', debt.id);
        return updateDoc(debtRef, { 
          urgentNotice: true, 
          notifiedAt: new Date().toISOString() 
        });
      });
      await Promise.all(updatePromises);

      // 2. Generar el correo en la colección `mail` para que Firebase Extension lo envíe
      const studentsList = Array.from(data.students).join(', ');
      const debtsHtmlList = data.debts.map(d => `<li>${d.title} (Alumno: ${d.studentName}): <strong>$${d.amount}</strong></li>`).join('');
      
      await addDoc(collection(db, 'mail'), {
        to: data.emailsArray,
        message: {
          subject: "Aviso Urgente: Cuotas Pendientes - Directiva del Curso",
          text: `Estimado Apoderado, le recordamos que tiene un saldo pendiente de $${data.totalAmount} asociado a los alumnos: ${studentsList}. Por favor, ingrese a la plataforma para regularizar su situación.`,
          html: `
            <h2>Aviso de Cobro Pendiente</h2>
            <p>Estimado Apoderado,</p>
            <p>Le recordamos que tiene cuotas pendientes de pago por un total de <strong>$${data.totalAmount}</strong>.</p>
            <p><strong>Detalle de cuotas:</strong></p>
            <ul>${debtsHtmlList}</ul>
            <p>Por favor, ingrese a la plataforma del curso para subir su comprobante de transferencia lo antes posible.</p>
            <p>Atte. <br>La Directiva del Curso</p>
          `
        }
      });

      setMessage(`Notificación web y correo enviados a ${email}`);
      setTimeout(() => setMessage(''), 4000);
      fetchDebts(); // Refrescar

    } catch (error) {
      console.error("Error notifying:", error);
      alert('Hubo un error al enviar la notificación.');
    } finally {
      setNotifying(null);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando morosos...</div>;
  }

  const debtorsList = Object.values(debtors);

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
          <ArrowLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>Apoderados en Deuda</h3>
      </div>

      {message && (
        <div style={{ backgroundColor: 'rgba(16,185,129,0.2)', color: 'var(--success)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={18} /> {message}
        </div>
      )}

      {debtorsList.length === 0 ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
          <div style={{ backgroundColor: 'rgba(16,185,129,0.1)', padding: '1.5rem', borderRadius: '50%', display: 'inline-block', marginBottom: '1rem', color: 'var(--success)' }}>
            <CheckCircle size={40} />
          </div>
          <h3>¡Todo al día!</h3>
          <p style={{ color: 'var(--text-muted)' }}>No hay apoderados con cuotas pendientes en este momento.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          {debtorsList.map((data, idx) => (
            <div key={idx} className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid var(--danger)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--danger)' }}>{data.email}</h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                    Alumnos: {Array.from(data.students).join(', ')}
                  </p>
                  
                  <div style={{ marginTop: '1rem' }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Detalle:</p>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-main)', fontSize: '0.85rem' }}>
                      {data.debts.map(d => (
                        <li key={d.id} style={{ marginBottom: '0.25rem' }}>
                          {d.title} ({d.studentName}): <strong>{formatMoney(d.amount)}</strong>
                          {d.urgentNotice && <span style={{ color: 'var(--warning)', marginLeft: '0.5rem', fontSize: '0.75rem' }}>(Notificado)</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div style={{ textAlign: 'right', minWidth: '150px' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>Deuda Total</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--danger)', margin: '0 0 1rem 0' }}>
                    {formatMoney(data.totalAmount)}
                  </p>
                  
                  <button 
                    onClick={() => handleNotify(data.email, data)}
                    disabled={notifying === data.email || data.email === 'Sin Apoderado'}
                    className="btn btn-outline" 
                    style={{ color: 'var(--warning)', borderColor: 'rgba(245,158,11,0.3)', width: '100%', justifyContent: 'center' }}
                  >
                    <Bell size={16} /> {notifying === data.email ? 'Enviando...' : 'Notificar Cobro'}
                  </button>
                  {data.email === 'Sin Apoderado' && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                      Vincule a un apoderado primero
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DebtorsManagement;
