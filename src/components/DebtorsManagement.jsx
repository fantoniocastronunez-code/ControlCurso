import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, getDocs, doc, updateDoc, addDoc } from 'firebase/firestore';
import { ArrowLeft, Bell, CheckCircle, Download, CheckSquare, Square } from 'lucide-react';
import { useModal } from '../context/ModalContext';
import { useCourse } from '../context/CourseContext';
import { formatStudentName } from '../utils/nameUtils';
import { jsPDF } from 'jspdf';

const DebtorsManagement = ({ onBack }) => {
  const { showAlert } = useModal();
  const { selectedCourse } = useCourse();
  const [debtors, setDebtors] = useState({});
  const [usersMap, setUsersMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [notifying, setNotifying] = useState(null); // guardará el email del que está siendo notificado
  const [message, setMessage] = useState('');

  const [selectedDebtors, setSelectedDebtors] = useState(new Set());
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const fetchUsers = useCallback(async () => {
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
  }, []);

  const fetchDebts = useCallback(async () => {
    if (!selectedCourse) return;
    try {
      const studentsSnap = await getDocs(query(collection(db, 'students'), where('courseId', '==', selectedCourse.id)));
      const studentsData = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const q = query(collection(db, 'debts'), where('courseId', '==', selectedCourse.id));
      const snapshot = await getDocs(q);
      
      const grouped = {};
      
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.status !== 'pending' && data.status !== 'partial') return;
        
        const debt = { id: docSnap.id, ...data };
        const student = studentsData.find(s => s.id === debt.studentId);
        
        if (student && student.status === 'retirado') return;

        let emails = [];
        if (student) {
          emails = student.apoderadoEmails?.length > 0 ? student.apoderadoEmails : (student.apoderadoEmail ? [student.apoderadoEmail] : []);
        }
        if (emails.length === 0) {
          emails = debt.apoderadoEmails?.length > 0 ? debt.apoderadoEmails : (debt.apoderadoEmail ? [debt.apoderadoEmail] : []);
        }
        
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
        
        const remainingAmount = debt.status === 'partial' ? (debt.amount - (debt.paidAmount || 0)) : debt.amount;
        const normalizedStudentName = student ? formatStudentName(student) : debt.studentName;
        
        grouped[emailKey].debts.push({...debt, remainingAmount, studentName: normalizedStudentName});
        grouped[emailKey].totalAmount += remainingAmount;
        grouped[emailKey].students.add(normalizedStudentName);
      });

      setDebtors(grouped);
    } catch (error) {
      console.error("Error fetching debts:", error);
    }
  }, [selectedCourse]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchUsers(), fetchDebts()]);
    setLoading(false);
  }, [fetchUsers, fetchDebts]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleNotify = async (email, data) => {
    if (email === 'Sin Apoderado') {
      await showAlert('No puedes notificar a un alumno sin apoderado vinculado.');
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
      
      const debtsHtmlList = data.debts.map(d => {
        const amountDisplay = d.status === 'partial' 
          ? `<strong>$${d.remainingAmount}</strong> <span style="font-size:12px; color:#666;">(Saldo Restante)</span>` 
          : `<strong>$${d.remainingAmount || d.amount}</strong>`;
        return `<li style="margin-bottom: 8px; padding: 10px; background: #f9f9f9; border-left: 4px solid #f59e0b; border-radius: 4px;">
          <span style="display:block; font-weight:600; color:#333;">${d.title}</span>
          <span style="display:block; font-size: 13px; color:#555;">Alumno: ${d.studentName}</span>
          <span style="display:block; margin-top: 4px; color:#b91c1c;">${amountDisplay}</span>
        </li>`;
      }).join('');
      
      const logoUrl = `${window.location.origin}/LOGOAPPCURSO.jpg`;
      
      const emailHtml = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
          <div style="background-color: #1e1e2f; padding: 20px; text-align: center;">
            <img src="${logoUrl}" alt="Control Curso" style="max-height: 70px; margin-bottom: 15px; border-radius: 8px; object-fit: cover;" />
            <h2 style="color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 0.5px;">Notificación de Cuotas Pendientes</h2>
          </div>
          <div style="padding: 30px; background-color: #ffffff;">
            <p style="font-size: 16px; color: #333333; margin-top: 0;">Estimado Apoderado,</p>
            <p style="font-size: 15px; color: #555555; line-height: 1.5;">Le recordamos que actualmente mantiene cuotas pendientes de pago en nuestra plataforma por un monto total de <strong style="color: #b91c1c; font-size: 18px;">$${data.totalAmount}</strong>.</p>
            
            <div style="margin: 25px 0;">
              <h3 style="font-size: 14px; text-transform: uppercase; color: #666666; letter-spacing: 1px; border-bottom: 1px solid #eee; padding-bottom: 8px;">Detalle de las cuotas:</h3>
              <ul style="list-style-type: none; padding: 0; margin: 0;">
                ${debtsHtmlList}
              </ul>
            </div>
            
            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 15px; border-radius: 6px; margin-top: 25px;">
              <p style="margin: 0; font-size: 14px; color: #166534; text-align: center;">
                Por favor, ingrese a la <strong>plataforma del curso</strong> para subir su comprobante de transferencia lo antes posible para regularizar su situación.
              </p>
            </div>
            
            <p style="font-size: 14px; color: #888888; margin-top: 30px; margin-bottom: 0;">Atentamente,</p>
            <p style="font-size: 15px; color: #333333; font-weight: bold; margin-top: 5px;">La Tesorería del Curso</p>
          </div>
          <div style="background-color: #f8f9fa; padding: 15px; text-align: center; border-top: 1px solid #eaeaea;">
            <p style="font-size: 12px; color: #999999; margin: 0;">Este es un mensaje automático generado por la plataforma del curso.</p>
          </div>
        </div>
      `;

      await addDoc(collection(db, 'mail'), {
        to: data.emailsArray,
        message: {
          subject: "Aviso Urgente: Cuotas Pendientes - Tesorería del Curso",
          text: `Estimado Apoderado, le recordamos que tiene un saldo pendiente de $${data.totalAmount} asociado a los alumnos: ${studentsList}. Por favor, ingrese a la plataforma para regularizar su situación.`,
          html: emailHtml
        }
      });

      setMessage(`Notificación web y correo enviados a ${email}`);
      setTimeout(() => setMessage(''), 4000);
      fetchDebts(); // Refrescar

    } catch (error) {
      console.error("Error notifying:", error);
      await showAlert('Hubo un error al enviar la notificación.');
    } finally {
      setNotifying(null);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const debtorsList = Object.values(debtors);

  const handleToggleSelect = (email) => {
    const newSet = new Set(selectedDebtors);
    if (newSet.has(email)) {
      newSet.delete(email);
    } else {
      newSet.add(email);
    }
    setSelectedDebtors(newSet);
  };

  const handleSelectAll = () => {
    if (selectedDebtors.size === debtorsList.length) {
      setSelectedDebtors(new Set());
    } else {
      setSelectedDebtors(new Set(debtorsList.map(d => d.email)));
    }
  };

  const generatePDF = async () => {
    if (selectedDebtors.size === 0) {
      await showAlert("Por favor selecciona al menos un apoderado.");
      return;
    }

    setGeneratingPdf(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let y = 15;

      const primaryColor = [99, 102, 241];
      const textMain = [30, 41, 59];
      const textMuted = [100, 116, 139];
      const dangerColor = [239, 68, 68];

      doc.setFillColor(15, 23, 42);
      doc.roundedRect(12, y, pageWidth - 24, 28, 3, 3, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text("Resumen de Deudas Impagas", 18, y + 11);
      
      const today = new Date().toISOString().split('T')[0];
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text(`Fecha del Informe: ${today}  •  Generado automáticamente`, 18, y + 19);

      y += 35;

      const selectedList = debtorsList.filter(d => selectedDebtors.has(d.email));

      selectedList.forEach((data, index) => {
        if (y > pageHeight - 40) {
          doc.addPage();
          y = 15;
        }

        const apoderadoName = data.emailsArray.length > 0 
          ? data.emailsArray.map(e => usersMap[e] || e).join(' / ') 
          : data.email;

        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(14, y, pageWidth - 28, 12, 2, 2, 'FD');

        doc.setTextColor(textMain[0], textMain[1], textMain[2]);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(`Apoderado: ${apoderadoName}`, 18, y + 8);
        
        doc.setTextColor(dangerColor[0], dangerColor[1], dangerColor[2]);
        doc.text(`Total: ${formatMoney(data.totalAmount)}`, pageWidth - 18, y + 8, { align: 'right' });

        y += 16;

        const debtsByStudent = {};
        data.debts.forEach(d => {
          if (!debtsByStudent[d.studentName]) debtsByStudent[d.studentName] = [];
          debtsByStudent[d.studentName].push(d);
        });

        Object.entries(debtsByStudent).forEach(([studentName, studentDebts]) => {
          if (y > pageHeight - 30) {
            doc.addPage();
            y = 15;
          }
          
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(textMain[0], textMain[1], textMain[2]);
          doc.text(`Alumno: ${studentName}`, 18, y);
          y += 6;

          studentDebts.forEach(d => {
            if (y > pageHeight - 20) {
              doc.addPage();
              y = 15;
            }
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
            const debtTitle = `${d.title}${d.status === 'partial' ? ' (Saldo Restante)' : ''}`;
            const titleStr = debtTitle.length > 60 ? debtTitle.substring(0, 57) + '...' : debtTitle;
            doc.text(`• ${titleStr}`, 22, y);
            
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(textMain[0], textMain[1], textMain[2]);
            doc.text(formatMoney(d.remainingAmount || d.amount), pageWidth - 18, y, { align: 'right' });
            y += 5;
          });
          y += 4;
        });

        y += 8;
      });

      doc.save(`Deudas_Apoderados_${today}.pdf`);
      await showAlert("¡PDF de Deudas generado exitosamente!");

    } catch (error) {
      console.error(error);
      await showAlert("Hubo un error al generar el PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando morosos...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
            <ArrowLeft size={18} />
          </button>
          <h3 style={{ margin: 0 }}>Apoderados en Deuda</h3>
        </div>
        
        {debtorsList.length > 0 && (
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button 
              onClick={handleSelectAll}
              className="btn btn-outline"
            >
              {selectedDebtors.size === debtorsList.length ? <Square size={16} /> : <CheckSquare size={16} />}
              {selectedDebtors.size === debtorsList.length ? 'Deseleccionar Todos' : 'Seleccionar Todos'}
            </button>
            <button 
              onClick={generatePDF}
              disabled={generatingPdf || selectedDebtors.size === 0}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <Download size={16} />
              {generatingPdf ? 'Generando...' : `Generar PDF (${selectedDebtors.size})`}
            </button>
          </div>
        )}
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
          {debtorsList.map((data, idx) => {
            const isSelected = selectedDebtors.has(data.email);
            return (
            <div 
              key={idx} 
              className="glass-panel" 
              style={{ 
                padding: '1.5rem', 
                borderLeft: isSelected ? '4px solid var(--primary)' : '4px solid var(--danger)',
                backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.03)' : 'var(--panel-bg)',
                transition: 'all 0.2s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ flex: '1', minWidth: '300px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                    <div 
                      onClick={() => handleToggleSelect(data.email)} 
                      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', color: isSelected ? 'var(--primary)' : 'var(--text-muted)' }}
                    >
                      {isSelected ? <CheckSquare size={22} /> : <Square size={22} />}
                    </div>
                    <h4 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--danger)' }}>
                      {data.emailsArray.length > 0 
                        ? data.emailsArray.map(email => usersMap[email] || email).join(' / ') 
                        : data.email}
                    </h4>
                  </div>
                  {data.email !== 'Sin Apoderado' && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0 2.5rem' }}>
                      {data.email}
                    </p>
                  )}
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem', marginLeft: '2.5rem' }}>
                    Alumnos a cargo: {Array.from(data.students).join(', ')}
                  </p>
                  
                  <div style={{ marginTop: '1.5rem', marginLeft: '2.5rem' }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)' }}>Detalle por Alumno:</p>
                    
                    {(() => {
                      const debtsByStudent = {};
                      data.debts.forEach(d => {
                        if (!debtsByStudent[d.studentName]) debtsByStudent[d.studentName] = [];
                        debtsByStudent[d.studentName].push(d);
                      });
                      
                      return Object.entries(debtsByStudent).map(([studentName, studentDebts]) => {
                        const studentTotal = studentDebts.reduce((sum, d) => sum + (d.remainingAmount || d.amount), 0);
                        return (
                          <div key={studentName} style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', alignItems: 'center' }}>
                              <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>{studentName}</strong>
                              <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--danger)' }}>Total: {formatMoney(studentTotal)}</span>
                            </div>
                            <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                              {studentDebts.map(d => (
                                <li key={d.id} style={{ marginBottom: '0.25rem' }}>
                                  {d.title}{d.status === 'partial' ? ' (Saldo Restante)' : ''}: <strong style={{ color: 'var(--text-main)' }}>{formatMoney(d.remainingAmount || d.amount)}</strong>
                                  {d.urgentNotice && <span style={{ color: 'var(--warning)', marginLeft: '0.5rem', fontSize: '0.75rem' }}>(Notificado)</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      });
                    })()}
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
                    <Bell size={16} /> {notifying === data.email ? 'Enviando...' : 'Notificar Correo y Portal'}
                  </button>
                  {data.email === 'Sin Apoderado' && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                      Vincule a un apoderado primero
                    </p>
                  )}
                </div>
              </div>
            </div>
          )})}
        </div>
      )}
    </div>
  );
};

export default DebtorsManagement;
