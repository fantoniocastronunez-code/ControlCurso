import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs } from 'firebase/firestore';
import { Search, X, User, UserCheck, AlertCircle, CheckCircle, DollarSign, ArrowRight, ShieldAlert, Sparkles } from 'lucide-react';
import { formatStudentName } from '../utils/nameUtils';
import StudentDetailModal from './StudentDetailModal';

const normalizeText = (text) => {
  if (!text) return '';
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
};

const StudentSearchModal = ({ isOpen, onClose, onSelectStudent }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [students, setStudents] = useState([]);
  const [usersMap, setUsersMap] = useState({});
  const [debtsMap, setDebtsMap] = useState({}); // studentId -> { pendingCount, totalPending, paidCount, totalPaid }
  const [loading, setLoading] = useState(true);
  const [selectedStudentForDetail, setSelectedStudentForDetail] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchSearchData();
    } else {
      setSearchTerm('');
      setSelectedStudentForDetail(null);
    }
  }, [isOpen]);

  const fetchSearchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Users (for apoderados names)
      const usersSnap = await getDocs(collection(db, 'users'));
      const uMap = {};
      usersSnap.forEach(doc => {
        const data = doc.data();
        const displayName = data.formalName || data.displayName || data.email;
        uMap[doc.id] = displayName;
        if (data.email) {
          uMap[data.email.toLowerCase()] = displayName;
        }
      });
      setUsersMap(uMap);

      // 2. Fetch Students
      const studentsSnap = await getDocs(collection(db, 'students'));
      const sList = studentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      sList.sort((a, b) => {
        const aNum = parseInt(a.listNumber) || 999;
        const bNum = parseInt(b.listNumber) || 999;
        return aNum - bNum;
      });
      setStudents(sList);

      // 3. Fetch Debts summary
      const debtsSnap = await getDocs(collection(db, 'debts'));
      const dMap = {};
      debtsSnap.forEach(doc => {
        const d = doc.data();
        if (!d.studentId) return;
        if (!dMap[d.studentId]) {
          dMap[d.studentId] = {
            pendingCount: 0,
            totalPending: 0,
            paidCount: 0,
            totalPaid: 0,
            partialCount: 0
          };
        }

        const amt = d.amount || 0;
        const paidAmt = typeof d.paidAmount === 'number' ? d.paidAmount : (d.status === 'paid' ? amt : 0);

        if (d.status === 'pending' || d.status === 'review') {
          dMap[d.studentId].pendingCount += 1;
          dMap[d.studentId].totalPending += amt;
        } else if (d.status === 'partial') {
          dMap[d.studentId].partialCount += 1;
          dMap[d.studentId].totalPending += Math.max(0, amt - paidAmt);
          dMap[d.studentId].totalPaid += paidAmt;
        } else if (d.status === 'paid') {
          dMap[d.studentId].paidCount += 1;
          dMap[d.studentId].totalPaid += amt;
        }
      });
      setDebtsMap(dMap);
    } catch (error) {
      console.error("Error cargando datos para búsqueda:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const filteredStudents = useMemo(() => {
    if (!searchTerm.trim()) {
      return students;
    }
    const cleanSearch = normalizeText(searchTerm);

    return students.filter(student => {
      // 1. Check student name fields
      const formattedName = normalizeText(formatStudentName(student));
      const rawName = normalizeText(student.name);
      const firstName = normalizeText(student.firstName);
      const lastNameP = normalizeText(student.lastNamePaternal);
      const lastNameM = normalizeText(student.lastNameMaternal);
      const rut = normalizeText(student.rut);
      const listNum = normalizeText(student.listNumber);

      if (
        formattedName.includes(cleanSearch) ||
        rawName.includes(cleanSearch) ||
        firstName.includes(cleanSearch) ||
        lastNameP.includes(cleanSearch) ||
        lastNameM.includes(cleanSearch) ||
        rut.includes(cleanSearch) ||
        listNum === cleanSearch
      ) {
        return true;
      }

      // 2. Check apoderados emails and names
      const emails = student.apoderadoEmails || (student.apoderadoEmail ? [student.apoderadoEmail] : []);
      for (const email of emails) {
        const cleanEmail = normalizeText(email);
        if (cleanEmail.includes(cleanSearch)) return true;

        const apoderadoName = normalizeText(usersMap[email.toLowerCase()] || usersMap[email] || '');
        if (apoderadoName.includes(cleanSearch)) return true;
      }

      return false;
    });
  }, [students, usersMap, searchTerm]);

  if (!isOpen) return null;

  return (
    <>
      <div 
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 999,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '1rem',
          overflowY: 'auto'
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div 
          className="glass-panel animate-fade-in"
          style={{
            width: '100%',
            maxWidth: '750px',
            marginTop: '2rem',
            marginBottom: '2rem',
            padding: '1.5rem',
            backgroundColor: 'var(--bg-main)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
            position: 'relative'
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ backgroundColor: 'rgba(99, 102, 241, 0.2)', padding: '0.6rem', borderRadius: '10px', color: 'var(--primary)' }}>
                <Search size={22} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Buscador de Alumnos y Apoderados</h3>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Escribe el nombre del alumno, apoderado o RUT para ver su detalle completo de pagos
                </p>
              </div>
            </div>
            <button 
              onClick={onClose} 
              className="btn btn-outline" 
              style={{ padding: '0.5rem', borderRadius: '50%', minWidth: '36px', height: '36px' }}
              title="Cerrar buscador"
            >
              <X size={18} />
            </button>
          </div>

          {/* Search Input Bar */}
          <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
            <input 
              type="text"
              className="input-field"
              placeholder="Buscar por alumno, apoderado, RUT o N° lista..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                padding: '0.85rem 2.8rem 0.85rem 2.8rem',
                fontSize: '1rem',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(99, 102, 241, 0.4)'
              }}
            />
            <Search 
              size={18} 
              style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} 
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                style={{
                  position: 'absolute',
                  right: '0.75rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '0.25rem'
                }}
              >
                <X size={18} />
              </button>
            )}
          </div>

          {/* Results count & badges */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            <span>
              {loading ? 'Cargando registros...' : `${filteredStudents.length} ${filteredStudents.length === 1 ? 'alumno encontrado' : 'alumnos encontrados'}`}
            </span>
            {searchTerm && (
              <span>Filtrado por "{searchTerm}"</span>
            )}
          </div>

          {/* Results list */}
          <div style={{ maxHeight: '60vh', overflowY: 'auto', display: 'grid', gap: '0.75rem', paddingRight: '0.25rem' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                Cargando información de alumnos y pagos...
              </div>
            ) : filteredStudents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-color)' }}>
                <p style={{ margin: '0 0 0.5rem 0', fontWeight: '500', color: 'var(--text-main)' }}>No se encontraron alumnos ni apoderados</p>
                <p style={{ margin: 0, fontSize: '0.85rem' }}>Verifica que el nombre o correo esté bien escrito.</p>
              </div>
            ) : (
              filteredStudents.map(student => {
                const debtInfo = debtsMap[student.id] || { pendingCount: 0, totalPending: 0, paidCount: 0, totalPaid: 0, partialCount: 0 };
                const emails = student.apoderadoEmails || (student.apoderadoEmail ? [student.apoderadoEmail] : []);
                const hasPending = debtInfo.pendingCount > 0 || debtInfo.partialCount > 0;
                
                return (
                  <div
                    key={student.id}
                    onClick={() => setSelectedStudentForDetail(student)}
                    style={{
                      padding: '1rem 1.25rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.6rem'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.08)';
                      e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.4)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    {/* Top row: Name, List Num, and Action */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ 
                          fontSize: '0.75rem', 
                          fontWeight: '600', 
                          padding: '0.2rem 0.5rem', 
                          borderRadius: '4px', 
                          backgroundColor: 'rgba(255,255,255,0.08)',
                          color: 'var(--text-muted)'
                        }}>
                          N° {student.listNumber || '-'}
                        </span>
                        <h4 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.05rem' }}>
                          {formatStudentName(student)}
                        </h4>
                        {student.rut && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            ({student.rut})
                          </span>
                        )}
                      </div>

                      <span style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem', fontWeight: '500', flexShrink: 0 }}>
                        Ver Pagos <ArrowRight size={15} />
                      </span>
                    </div>

                    {/* Middle row: Linked Apoderados */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      <User size={14} style={{ flexShrink: 0 }} />
                      <span>
                        {emails.length === 0 ? (
                          <span style={{ fontStyle: 'italic', opacity: 0.7 }}>Sin apoderado asignado</span>
                        ) : (
                          emails.map((email, idx) => {
                            const apName = usersMap[email.toLowerCase()] || usersMap[email];
                            return (
                              <span key={idx}>
                                {idx > 0 && ' • '}
                                <strong style={{ color: 'var(--text-main)', fontWeight: '500' }}>
                                  {apName || email}
                                </strong>
                                {apName && apName !== email && (
                                  <span style={{ opacity: 0.8, fontSize: '0.75rem', marginLeft: '0.25rem' }}>({email})</span>
                                )}
                              </span>
                            );
                          })
                        )}
                      </span>
                    </div>

                    {/* Bottom row: Financial status badges */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
                      {hasPending ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          padding: '0.25rem 0.6rem',
                          borderRadius: '20px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          backgroundColor: 'rgba(239, 68, 68, 0.15)',
                          color: 'var(--danger)',
                          border: '1px solid rgba(239, 68, 68, 0.3)'
                        }}>
                          <AlertCircle size={13} />
                          Deuda: {formatMoney(debtInfo.totalPending)} ({debtInfo.pendingCount + debtInfo.partialCount} {debtInfo.pendingCount + debtInfo.partialCount === 1 ? 'cuota' : 'cuotas'})
                        </span>
                      ) : (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          padding: '0.25rem 0.6rem',
                          borderRadius: '20px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          backgroundColor: 'rgba(16, 185, 129, 0.15)',
                          color: 'var(--success)',
                          border: '1px solid rgba(16, 185, 129, 0.3)'
                        }}>
                          <CheckCircle size={13} />
                          Al día
                        </span>
                      )}

                      {debtInfo.totalPaid > 0 && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          padding: '0.25rem 0.6rem',
                          borderRadius: '20px',
                          fontSize: '0.75rem',
                          fontWeight: '500',
                          backgroundColor: 'rgba(99, 102, 241, 0.1)',
                          color: '#818cf8',
                          border: '1px solid rgba(99, 102, 241, 0.2)'
                        }}>
                          Pagado: {formatMoney(debtInfo.totalPaid)}
                        </span>
                      )}

                      {student.balance > 0 && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          padding: '0.25rem 0.6rem',
                          borderRadius: '20px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          backgroundColor: 'rgba(16, 185, 129, 0.2)',
                          color: 'var(--success)',
                          border: '1px solid rgba(16, 185, 129, 0.4)'
                        }}>
                          <Sparkles size={12} /> Saldo a favor: {formatMoney(student.balance)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Complete Student Payment Detail Modal */}
      {selectedStudentForDetail && (
        <StudentDetailModal 
          student={selectedStudentForDetail}
          usersMap={usersMap}
          isModal={true}
          onClose={() => setSelectedStudentForDetail(null)}
        />
      )}
    </>
  );
};

export default StudentSearchModal;
