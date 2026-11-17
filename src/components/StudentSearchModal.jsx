import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs } from 'firebase/firestore';
import {
  Search, X, User, AlertCircle, CheckCircle, ArrowRight, Sparkles,
  ChevronDown, ChevronUp, Edit2, RotateCcw, Clock, Eye, Check, XCircle, AlertTriangle
} from 'lucide-react';
import { formatStudentName } from '../utils/nameUtils';
import StudentDetailModal, {
  filterAndSortStudentDebts,
  getRequiresApprovalForStudent,
  executeMarkDebtPaid,
  executePayAllPending,
  executeRejectReviewDebt,
  executeEditDebtAmount,
  executeEditPaidAmount,
  executeTogglePaymentMethod,
  executeCancelPayment,
  executePayDebtWithBalance
} from './StudentDetailModal';
import { useModal } from '../context/ModalContext';
import { useAuth } from '../context/AuthContext';
import { useCourse } from '../context/CourseContext';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';

const normalizeText = (text) => {
  if (!text) return '';
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
};

const StudentSearchModal = ({ isOpen, onClose, onSelectStudent: _onSelectStudent, onUpdate }) => {
  const { showAlert, showConfirm, showPrompt } = useModal();
  const { user, role, userData } = useAuth();
  const { selectedCourse } = useCourse();

  const [searchTerm, setSearchTerm] = useState('');
  const [students, setStudents] = useState([]);
  const [usersMap, setUsersMap] = useState({});
  const [debtsMap, setDebtsMap] = useState({}); // studentId -> { pendingCount, totalPending, paidCount, totalPaid, partialCount }
  const [studentDebtsMap, setStudentDebtsMap] = useState({}); // studentId -> Debt[]
  const [loading, setLoading] = useState(true);
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [expandedOverrides, setExpandedOverrides] = useState({});
  const [processingDebtId, setProcessingDebtId] = useState(null);
  const [previewReceipt, setPreviewReceipt] = useState(null);

  useLockBodyScroll(isOpen);

  const fetchSearchData = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      // 1. Fetch Users (for apoderados names)
      const usersSnap = await getDocs(collection(db, 'users'));
      const uMap = {};
      usersSnap.forEach(docSnap => {
        const data = docSnap.data();
        const displayName = data.formalName || data.displayName || data.email;
        uMap[docSnap.id] = displayName;
        if (data.email) {
          uMap[data.email.toLowerCase()] = displayName;
        }
      });
      setUsersMap(uMap);

      // 2. Fetch Students
      const studentsSnap = await getDocs(collection(db, 'students'));
      const sList = studentsSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      sList.sort((a, b) => {
        const aNum = parseInt(a.listNumber) || 999;
        const bNum = parseInt(b.listNumber) || 999;
        return aNum - bNum;
      });
      setStudents(sList);

      // 3. Fetch Debts & group per student
      const debtsSnap = await getDocs(collection(db, 'debts'));
      const rawDebtsByStudent = {};
      debtsSnap.forEach(docSnap => {
        const d = { id: docSnap.id, ...docSnap.data() };
        if (!d.studentId) return;
        if (!rawDebtsByStudent[d.studentId]) {
          rawDebtsByStudent[d.studentId] = [];
        }
        rawDebtsByStudent[d.studentId].push(d);
      });

      const sDebtsMap = {};
      const dMap = {};

      Object.entries(rawDebtsByStudent).forEach(([studentId, rawList]) => {
        const filteredList = filterAndSortStudentDebts(rawList);
        sDebtsMap[studentId] = filteredList;

        const summary = {
          pendingCount: 0,
          totalPending: 0,
          paidCount: 0,
          totalPaid: 0,
          partialCount: 0
        };

        filteredList.forEach(d => {
          const amt = d.amount || 0;
          const paidAmt = (typeof d.paidAmount === 'number' && d.paidAmount > 0) ? d.paidAmount : (d.status === 'paid' ? amt : 0);

          if (d.status === 'pending' || d.status === 'review') {
            summary.pendingCount += 1;
            summary.totalPending += amt;
          } else if (d.status === 'partial') {
            summary.partialCount += 1;
            summary.totalPending += Math.max(0, amt - paidAmt);
            summary.totalPaid += paidAmt;
          } else if (d.status === 'paid') {
            summary.paidCount += 1;
            summary.totalPaid += paidAmt;
          }
        });

        dMap[studentId] = summary;
      });

      setStudentDebtsMap(sDebtsMap);
      setDebtsMap(dMap);
    } catch (error) {
      console.error("Error cargando datos para búsqueda:", error);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchSearchData(true);
    }
  }, [isOpen, fetchSearchData]);

  const handleCloseModal = () => {
    setSearchTerm('');
    setSelectedStudentId(null);
    setExpandedOverrides({});
    setPreviewReceipt(null);
    onClose();
  };

  const selectedStudentForDetail = useMemo(
    () => students.find(s => s.id === selectedStudentId) || null,
    [students, selectedStudentId]
  );

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
  };

  const runSearchDebtAction = async (actionKey, actionFn) => {
    if (processingDebtId) return;
    setProcessingDebtId(actionKey);
    try {
      const result = await actionFn();
      if (result?.updated) {
        await fetchSearchData(false);
        onUpdate?.();
      }
    } catch (error) {
      console.error("Error procesando cuota desde buscador:", error);
      await showAlert("Ocurrió un error al procesar la operación.");
    } finally {
      setProcessingDebtId(null);
    }
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

  const autoExpandSearch = searchTerm.trim().length > 0 && filteredStudents.length <= 5;

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          zIndex: 999,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '1rem',
          overflowY: 'auto'
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) handleCloseModal();
        }}
      >
        <div
          className="glass-panel animate-fade-in"
          style={{
            width: '100%',
            maxWidth: '820px',
            marginTop: '1.5rem',
            marginBottom: '2rem',
            padding: '1.5rem',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
            position: 'relative'
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: '38px', height: '38px', minWidth: '38px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-main)' }}>
                <Search size={18} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-main)', fontWeight: '600' }}>Buscador de Alumnos y Apoderados</h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Escribe el nombre del alumno, apoderado o RUT para revisar, modificar o marcar cuotas como pagadas
                </p>
              </div>
            </div>
            <button
              onClick={handleCloseModal}
              className="btn btn-outline"
              style={{ padding: '0.35rem 0.5rem', color: 'var(--text-muted)', borderColor: 'var(--border-color)' }}
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
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setExpandedOverrides({});
              }}
              autoFocus
              style={{
                width: '100%',
                padding: '0.85rem 2.8rem 0.85rem 2.8rem',
                fontSize: '0.95rem',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-card-hover)',
                border: '1px solid var(--border-color)'
              }}
            />
            <Search
              size={18}
              style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
            />
            {searchTerm && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setExpandedOverrides({});
                }}
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
          <div style={{ maxHeight: '68vh', overflowY: 'auto', display: 'grid', gap: '0.75rem', paddingRight: '0.25rem' }}>
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
                const studentDebts = studentDebtsMap[student.id] || [];
                const emails = student.apoderadoEmails || (student.apoderadoEmail ? [student.apoderadoEmail] : []);
                const hasPending = debtInfo.pendingCount > 0 || debtInfo.partialCount > 0;
                const isExpanded = expandedOverrides[student.id] !== undefined ? expandedOverrides[student.id] : autoExpandSearch;
                const requiresApproval = getRequiresApprovalForStudent({ role, userData, student, selectedCourse });
                const payablePendings = studentDebts.filter(d => d.status === 'pending' || d.status === 'partial');

                const toggleExpand = () => {
                  setExpandedOverrides(prev => ({
                    ...prev,
                    [student.id]: !isExpanded
                  }));
                };

                return (
                  <div
                    key={student.id}
                    onClick={toggleExpand}
                    style={{
                      padding: '0.85rem 1rem',
                      backgroundColor: 'var(--bg-card-hover)',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${isExpanded ? 'var(--primary)' : 'var(--border-color)'}`,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem'
                    }}
                    onMouseOver={(e) => {
                      if (!isExpanded) e.currentTarget.style.borderColor = 'var(--border-color-focus)';
                    }}
                    onMouseOut={(e) => {
                      if (!isExpanded) e.currentTarget.style.borderColor = 'var(--border-color)';
                    }}
                  >
                    {/* Top row: Name, List Num, and Actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          padding: '0.15rem 0.45rem',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--bg-card)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-muted)'
                        }}>
                          N° {student.listNumber || '-'}
                        </span>
                        <h4 style={{ margin: 0, color: 'var(--text-main)', fontSize: '0.95rem', fontWeight: '600' }}>
                          {formatStudentName(student)}
                        </h4>
                        {student.rut && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            ({student.rut})
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand();
                          }}
                          className="btn btn-outline"
                          style={{
                            padding: '0.25rem 0.6rem',
                            fontSize: '0.75rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            borderColor: isExpanded ? 'var(--primary)' : 'var(--border-color)',
                            color: isExpanded ? 'var(--primary)' : 'var(--text-main)'
                          }}
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          {isExpanded ? 'Ocultar Cuotas' : `Gestionar Cuotas (${studentDebts.length})`}
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedStudentId(student.id);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--primary)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            fontSize: '0.8rem',
                            fontWeight: '500',
                            cursor: 'pointer',
                            padding: '0.25rem'
                          }}
                        >
                          Ficha Completa <ArrowRight size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Middle row: Linked Apoderados */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.825rem', color: 'var(--text-muted)' }}>
                      <User size={13} style={{ flexShrink: 0 }} />
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
                          padding: '0.15rem 0.5rem',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.725rem',
                          fontWeight: '600',
                          backgroundColor: 'var(--bg-card)',
                          color: 'var(--danger)',
                          border: '1px solid var(--danger)'
                        }}>
                          <AlertCircle size={12} />
                          Deuda: {formatMoney(debtInfo.totalPending)} ({debtInfo.pendingCount + debtInfo.partialCount} {debtInfo.pendingCount + debtInfo.partialCount === 1 ? 'cuota' : 'cuotas'})
                        </span>
                      ) : (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          padding: '0.15rem 0.5rem',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.725rem',
                          fontWeight: '600',
                          backgroundColor: 'var(--bg-card)',
                          color: 'var(--success)',
                          border: '1px solid var(--success)'
                        }}>
                          <CheckCircle size={12} />
                          Al día
                        </span>
                      )}

                      {debtInfo.totalPaid > 0 && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          padding: '0.15rem 0.5rem',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.725rem',
                          fontWeight: '500',
                          backgroundColor: 'var(--bg-card)',
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border-color)'
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

                    {/* Expanded Inline Cuotas Panel */}
                    {isExpanded && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          marginTop: '0.5rem',
                          paddingTop: '0.75rem',
                          borderTop: '1px solid var(--border-color)',
                          cursor: 'default',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.6rem'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main)' }}>
                            Cuotas del Alumno ({studentDebts.length})
                          </span>

                          {payablePendings.length > 1 && (
                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                disabled={Boolean(processingDebtId)}
                                onClick={() => runSearchDebtAction(`all_cash_${student.id}`, () =>
                                  executePayAllPending({
                                    debts: studentDebts,
                                    student,
                                    method: 'cash',
                                    requiresApproval,
                                    user,
                                    selectedCourse,
                                    showConfirm,
                                    showAlert
                                  })
                                )}
                                className="btn btn-outline"
                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', color: 'var(--success)', borderColor: 'rgba(16, 185, 129, 0.45)', backgroundColor: 'rgba(16, 185, 129, 0.08)' }}
                              >
                                Pagar Todas (Efectivo)
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(processingDebtId)}
                                onClick={() => runSearchDebtAction(`all_transfer_${student.id}`, () =>
                                  executePayAllPending({
                                    debts: studentDebts,
                                    student,
                                    method: 'transfer',
                                    requiresApproval,
                                    user,
                                    selectedCourse,
                                    showConfirm,
                                    showAlert
                                  })
                                )}
                                className="btn btn-outline"
                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', color: 'var(--primary)', borderColor: 'rgba(99, 102, 241, 0.45)', backgroundColor: 'rgba(99, 102, 241, 0.08)' }}
                              >
                                Pagar Todas (Transf.)
                              </button>
                            </div>
                          )}
                        </div>

                        {studentDebts.length === 0 ? (
                          <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)', backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-color)' }}>
                            Este alumno no tiene cuotas registradas.
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gap: '0.5rem' }}>
                            {studentDebts.map(d => {
                              const isPaid = d.status === 'paid';
                              const isPartial = d.status === 'partial';
                              const isReview = d.status === 'review';
                              const debtAmount = d.amount || 0;
                              const paidAmount = d.paidAmount || 0;
                              const remaining = isPartial ? Math.max(0, debtAmount - paidAmount) : debtAmount;
                              const isBusy = Boolean(processingDebtId);
                              const methodLabel = d.paymentMethod === 'transfer' ? 'Transferencia' : d.paymentMethod === 'cash' ? 'Efectivo' : d.paymentMethod === 'balance' ? 'Saldo a Favor' : 'Pagado';

                              return (
                                <div
                                  key={d.id}
                                  style={{
                                    padding: '0.65rem 0.8rem',
                                    backgroundColor: 'var(--bg-card)',
                                    borderRadius: 'var(--radius-sm)',
                                    border: '1px solid var(--border-color)',
                                    borderLeft: `4px solid ${isPaid ? 'var(--success)' : isReview ? 'var(--warning)' : isPartial ? '#f59e0b' : 'var(--danger)'}`,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.4rem'
                                  }}
                                >
                                  {/* Cuota Header */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                      <span style={{ fontWeight: '600', fontSize: '0.88rem', color: 'var(--text-main)' }}>
                                        {d.title}
                                      </span>
                                      <span style={{
                                        fontSize: '0.7rem',
                                        padding: '0.1rem 0.4rem',
                                        borderRadius: '10px',
                                        fontWeight: '600',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.2rem',
                                        backgroundColor: isPaid
                                          ? 'rgba(16, 185, 129, 0.15)'
                                          : isReview
                                            ? 'rgba(245, 158, 11, 0.15)'
                                            : isPartial
                                              ? 'rgba(234, 179, 8, 0.15)'
                                              : 'rgba(239, 68, 68, 0.15)',
                                        color: isPaid
                                          ? 'var(--success)'
                                          : isReview
                                            ? 'var(--warning)'
                                            : isPartial
                                              ? '#eab308'
                                              : 'var(--danger)'
                                      }}>
                                        {isReview && <Clock size={11} />}
                                        {isPaid ? 'Pagada' : isReview ? 'En Revisión' : isPartial ? 'Pago Parcial' : 'Pendiente'}
                                      </span>
                                      {d.visibleInPortal === false && (
                                        <span style={{ fontSize: '0.68rem', padding: '0.08rem 0.35rem', borderRadius: '4px', backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                                          Oculta en portal
                                        </span>
                                      )}
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                                      <span style={{ fontWeight: '700', fontSize: '0.92rem', color: isPaid ? 'var(--success)' : 'var(--danger)' }}>
                                        {isPaid ? formatMoney(paidAmount || debtAmount) : formatMoney(remaining)}
                                      </span>
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => runSearchDebtAction(d.id, () =>
                                          executeEditDebtAmount({
                                            debt: d,
                                            student,
                                            selectedCourse,
                                            showPrompt,
                                            showAlert
                                          })
                                        )}
                                        style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '0.1rem', display: 'inline-flex', alignItems: 'center' }}
                                        title="Modificar monto a cobrar"
                                      >
                                        <Edit2 size={12} />
                                      </button>
                                    </div>
                                  </div>

                                  {isPartial && (
                                    <div style={{ fontSize: '0.75rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                      <AlertTriangle size={12} />
                                      Abonado: {formatMoney(paidAmount)} de {formatMoney(debtAmount)}
                                    </div>
                                  )}

                                  {/* Cuota Actions */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                      <span>{d.date || (d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '-')}</span>
                                      {d.receiptUrl && (
                                        <button
                                          type="button"
                                          onClick={() => setPreviewReceipt(d.receiptUrl)}
                                          style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.75rem', padding: 0 }}
                                        >
                                          <Eye size={12} /> Ver Comprobante
                                        </button>
                                      )}
                                    </div>

                                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                      {isPaid ? (
                                        <>
                                          <button
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() => runSearchDebtAction(d.id, () =>
                                              executeTogglePaymentMethod({ debt: d, showAlert })
                                            )}
                                            style={{
                                              fontSize: '0.72rem',
                                              padding: '0.15rem 0.5rem',
                                              borderRadius: '12px',
                                              backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                              color: 'var(--success)',
                                              border: '1px solid rgba(16, 185, 129, 0.25)',
                                              cursor: d.paymentMethod === 'balance' ? 'default' : 'pointer'
                                            }}
                                            title={d.paymentMethod === 'balance' ? 'Pagado con Saldo a Favor' : 'Clic para cambiar entre Efectivo y Transferencia'}
                                          >
                                            {methodLabel}
                                          </button>
                                          <button
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() => runSearchDebtAction(d.id, () =>
                                              executeEditPaidAmount({
                                                debt: d,
                                                student,
                                                selectedCourse,
                                                showPrompt,
                                                showAlert
                                              })
                                            )}
                                            className="btn btn-outline"
                                            style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem', color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.4)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                                            title="Modificar monto pagado"
                                          >
                                            <Edit2 size={11} /> Modificar Pago
                                          </button>
                                          <button
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() => runSearchDebtAction(d.id, () =>
                                              executeCancelPayment({ debt: d, student, showConfirm })
                                            )}
                                            className="btn btn-outline"
                                            style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.35)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                                            title="Cancelar pago y volver a Pendiente"
                                          >
                                            <RotateCcw size={11} /> Cancelar Pago
                                          </button>
                                        </>
                                      ) : (
                                        <>
                                          {isReview && (
                                            <>
                                              <button
                                                type="button"
                                                disabled={isBusy}
                                                onClick={() => runSearchDebtAction(d.id, () =>
                                                  executeMarkDebtPaid({
                                                    debt: d,
                                                    student,
                                                    method: 'transfer',
                                                    isApproval: true,
                                                    requiresApproval,
                                                    user,
                                                    selectedCourse,
                                                    showPrompt,
                                                    showAlert
                                                  })
                                                )}
                                                className="btn btn-primary"
                                                style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem', backgroundColor: 'var(--success)', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                                              >
                                                <Check size={11} /> Aprobar
                                              </button>
                                              <button
                                                type="button"
                                                disabled={isBusy}
                                                onClick={() => runSearchDebtAction(d.id, () =>
                                                  executeRejectReviewDebt({ debt: d, showConfirm, showAlert })
                                                )}
                                                className="btn btn-outline"
                                                style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.4)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                                              >
                                                <XCircle size={11} /> Rechazar
                                              </button>
                                            </>
                                          )}

                                          <button
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() => runSearchDebtAction(d.id, () =>
                                              executeMarkDebtPaid({
                                                debt: d,
                                                student,
                                                method: 'cash',
                                                requiresApproval,
                                                user,
                                                selectedCourse,
                                                showPrompt,
                                                showAlert
                                              })
                                            )}
                                            className="btn btn-outline"
                                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', color: 'var(--primary)', borderColor: 'rgba(99, 102, 241, 0.35)' }}
                                            title="Marcar pagada en Efectivo"
                                          >
                                            Efectivo
                                          </button>
                                          <button
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() => runSearchDebtAction(d.id, () =>
                                              executeMarkDebtPaid({
                                                debt: d,
                                                student,
                                                method: 'transfer',
                                                requiresApproval,
                                                user,
                                                selectedCourse,
                                                showPrompt,
                                                showAlert
                                              })
                                            )}
                                            className="btn btn-outline"
                                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', color: 'var(--primary)', borderColor: 'rgba(99, 102, 241, 0.35)' }}
                                            title="Marcar pagada por Transferencia"
                                          >
                                            Transf.
                                          </button>
                                          <button
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() => runSearchDebtAction(d.id, () =>
                                              executeEditPaidAmount({
                                                debt: d,
                                                student,
                                                selectedCourse,
                                                showPrompt,
                                                showAlert
                                              })
                                            )}
                                            className="btn btn-outline"
                                            style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem', color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.4)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                                            title="Registrar abono parcial o modificar monto pagado"
                                          >
                                            <Edit2 size={11} /> Abonar / Modificar
                                          </button>
                                          {(student.balance || 0) > 0 && (
                                            <button
                                              type="button"
                                              disabled={isBusy}
                                              onClick={() => runSearchDebtAction(d.id, () =>
                                                executePayDebtWithBalance({
                                                  debt: d,
                                                  student,
                                                  selectedCourse,
                                                  showConfirm,
                                                  showAlert
                                                })
                                              )}
                                              className="btn btn-outline"
                                              style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem', color: 'var(--success)', borderColor: 'rgba(16, 185, 129, 0.4)', backgroundColor: 'rgba(16, 185, 129, 0.08)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                                              title={`Usar saldo a favor (${formatMoney(student.balance)})`}
                                            >
                                              <Sparkles size={11} /> Usar Saldo
                                            </button>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Receipt Lightbox */}
      {previewReceipt && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            zIndex: 1100,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '1rem'
          }}
          onClick={() => setPreviewReceipt(null)}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewReceipt(null)}
              style={{
                position: 'absolute',
                top: '-2.5rem',
                right: 0,
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <X size={18} />
            </button>
            <img
              src={previewReceipt}
              alt="Comprobante de pago"
              style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: '8px', objectFit: 'contain' }}
            />
          </div>
        </div>
      )}

      {/* Complete Student Payment Detail Modal */}
      {selectedStudentForDetail && (
        <StudentDetailModal
          student={selectedStudentForDetail}
          usersMap={usersMap}
          isModal={true}
          onClose={() => setSelectedStudentId(null)}
          onUpdate={() => {
            fetchSearchData(false);
            onUpdate?.();
          }}
        />
      )}
    </>
  );
};

export default StudentSearchModal;
