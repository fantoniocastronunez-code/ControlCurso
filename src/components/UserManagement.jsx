import React, { useEffect, useState, useMemo } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, doc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useCourse } from '../context/CourseContext';
import {
  ArrowLeft, UserCheck, UserPlus, Trash2, Edit2, Save, X,
  AlertTriangle, Layers, Search, RefreshCw, CheckCircle2, Users, Plus
} from 'lucide-react';
import { useModal } from '../context/ModalContext';
import { formatStudentName } from '../utils/nameUtils';

const getStudentEmails = (student) => {
  const raw = Array.isArray(student?.apoderadoEmails) && student.apoderadoEmails.length > 0
    ? student.apoderadoEmails
    : (student?.apoderadoEmail ? [student.apoderadoEmail] : []);
  return raw.map(e => (e || '').toLowerCase().trim()).filter(Boolean);
};

const getUserEmail = (u) => {
  if (u?.email && typeof u.email === 'string' && u.email.trim()) {
    return u.email.toLowerCase().trim();
  }
  if (u?.id && typeof u.id === 'string' && u.id.includes('@')) {
    return u.id.toLowerCase().trim();
  }
  return '';
};

const UserManagement = ({ onBack, viewMode = 'users' }) => {
  const { showConfirm, showAlert } = useModal();
  const { role } = useAuth();
  const { selectedCourse } = useCourse();
  const [users, setUsers] = useState([]);
  const [allStudents, setAllStudents] = useState([]);
  const [allCourses, setAllCourses] = useState([]);
  const [filterCourse, setFilterCourse] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showOnlyDuplicates, setShowOnlyDuplicates] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState('');

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('apoderado');
  const [newStudentId, setNewStudentId] = useState('');

  // Estados para edición
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editCanAccessEvents, setEditCanAccessEvents] = useState(false);
  const [editStudentIds, setEditStudentIds] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);

  useEffect(() => {
    fetchData();
  }, [viewMode]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [coursesSnap, userSnapshot, studentsSnapshot] = await Promise.all([
        getDocs(collection(db, 'courses')),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'students'))
      ]);

      const coursesData = coursesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllCourses(coursesData);

      const userList = userSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUsers(userList);

      const studentsList = studentsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      studentsList.sort((a, b) => {
        const aNum = parseInt(a.listNumber) || 999;
        const bNum = parseInt(b.listNumber) || 999;
        if (aNum !== bNum) return aNum - bNum;
        return formatStudentName(a).localeCompare(formatStudentName(b));
      });
      setAllStudents(studentsList);
    } catch (error) {
      console.error("Error al obtener datos:", error);
    } finally {
      setLoading(false);
    }
  };

  // Mapeo de duplicados por correo normalizado
  const duplicateEmailsMap = useMemo(() => {
    const map = new Map();
    users.forEach(u => {
      const email = getUserEmail(u);
      if (!email) return;
      if (!map.has(email)) map.set(email, []);
      map.get(email).push(u);
    });
    return map;
  }, [users]);

  // Lista de grupos de usuarios duplicados
  const duplicateGroups = useMemo(() => {
    const groups = [];
    duplicateEmailsMap.forEach((docs, email) => {
      if (docs.length > 1) {
        groups.push({ email, docs });
      }
    });
    return groups;
  }, [duplicateEmailsMap]);

  // Mapeo de alumnos vinculados por correo normalizado
  const studentsByEmailMap = useMemo(() => {
    const map = new Map();
    allStudents.forEach(s => {
      const emails = getStudentEmails(s);
      emails.forEach(email => {
        if (!map.has(email)) map.set(email, []);
        map.get(email).push(s);
      });
    });
    return map;
  }, [allStudents]);

  // Obtiene los alumnos vinculados a un usuario tanto por email como por linkedStudentIds
  const getLinkedStudentsForUser = (u) => {
    if (!u) return [];
    const emailLower = getUserEmail(u);
    const byEmail = emailLower ? (studentsByEmailMap.get(emailLower) || []) : [];
    const byIds = Array.isArray(u.linkedStudentIds)
      ? u.linkedStudentIds.map(id => allStudents.find(s => s.id === id)).filter(Boolean)
      : [];
    const mergedMap = new Map();
    byEmail.forEach(s => mergedMap.set(s.id, s));
    byIds.forEach(s => mergedMap.set(s.id, s));
    return Array.from(mergedMap.values());
  };

  // Alumnos ordenados y filtrados según el curso seleccionado en el filtro (o curso actual primero)
  const sortedStudentsForSelect = useMemo(() => {
    const targetCourseId = filterCourse !== 'all' ? filterCourse : selectedCourse?.id;
    return [...allStudents].sort((a, b) => {
      const aInTarget = a.courseId === targetCourseId ? 0 : 1;
      const bInTarget = b.courseId === targetCourseId ? 0 : 1;
      if (aInTarget !== bInTarget) return aInTarget - bInTarget;
      const aNum = parseInt(a.listNumber) || 999;
      const bNum = parseInt(b.listNumber) || 999;
      if (aNum !== bNum) return aNum - bNum;
      return formatStudentName(a).localeCompare(formatStudentName(b));
    });
  }, [allStudents, filterCourse, selectedCourse]);

  const formatStudentOptionLabel = (s) => {
    const courseName = allCourses.find(c => c.id === s.courseId)?.name;
    const numPrefix = s.listNumber ? `#${s.listNumber} ` : '';
    const courseSuffix = courseName && allCourses.length > 1 ? ` (${courseName})` : '';
    const statusSuffix = s.status === 'retirado' ? ' [Retirado]' : '';
    return `${numPrefix}${formatStudentName(s)}${courseSuffix}${statusSuffix}`;
  };

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const isSuperadmin = (u.roles && u.roles['global'] === 'superadmin') || u.role === 'superadmin';
      const rolesKeys = u.roles ? Object.keys(u.roles) : [];
      const emailLower = getUserEmail(u);
      const linkedStudents = getLinkedStudentsForUser(u);

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
        matchesCourse = (u.roles && !!u.roles[filterCourse]) ||
          linkedStudents.some(s => s.courseId === filterCourse) ||
          isSuperadmin;
      }

      // 3. Filter by search (incluye búsqueda por nombre/RUT de alumno vinculado)
      let matchesSearch = true;
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim();
        const name = (u.displayName || u.formalName || '').toLowerCase();
        const studentMatch = linkedStudents.some(s =>
          formatStudentName(s).toLowerCase().includes(term) ||
          (s.name || '').toLowerCase().includes(term) ||
          (s.rut || '').toLowerCase().includes(term)
        );
        matchesSearch = name.includes(term) || emailLower.includes(term) || u.id.toLowerCase().includes(term) || studentMatch;
      }

      // 4. Filter by duplicates only
      let matchesDuplicates = true;
      if (showOnlyDuplicates) {
        matchesDuplicates = duplicateEmailsMap.has(emailLower) && duplicateEmailsMap.get(emailLower).length > 1;
      }

      return matchesMode && matchesCourse && matchesSearch && matchesDuplicates;
    });
  }, [users, viewMode, filterCourse, searchTerm, showOnlyDuplicates, duplicateEmailsMap, studentsByEmailMap, allStudents]);

  // Limpieza y unificación automática de duplicados
  const handleCleanDuplicates = async () => {
    if (duplicateGroups.length === 0) {
      await showAlert("No se detectaron usuarios duplicados para limpiar.");
      return;
    }

    const totalRedundant = duplicateGroups.reduce((acc, g) => acc + (g.docs.length - 1), 0);
    const confirmed = await showConfirm(
      `¿Deseas unificar ${duplicateGroups.length} usuario(s) duplicados (${totalRedundant} registros redundantes)?\n\n` +
      `Se mantendrá la cuenta activa de cada usuario (con su cuenta Google/UID), se combinarán todos sus roles en cursos y datos de perfil en un solo documento, y se eliminarán los registros sobrantes de la base de datos.`
    );
    if (!confirmed) return;

    setCleaning(true);
    let cleanedCount = 0;
    try {
      for (const group of duplicateGroups) {
        const docs = group.docs;
        if (docs.length < 2) continue;

        // Determinar el documento principal a conservar ("winner"):
        // 1. Doc cuyo ID es exactamente igual a su uid (cuenta oficial Google Auth)
        // 2. Doc que tiene campo uid
        // 3. Doc con displayName o formalName
        // 4. El primer doc
        let winner = docs.find(d => d.uid && d.id === d.uid);
        if (!winner) {
          winner = docs.find(d => Boolean(d.uid));
        }
        if (!winner) {
          winner = docs.find(d => Boolean(d.displayName || d.formalName || d.photoURL));
        }
        if (!winner) {
          winner = docs[0];
        }

        const losers = docs.filter(d => d.id !== winner.id);

        // Consolidar roles de todos los documentos sin perder cursos
        const mergedRoles = {};
        docs.forEach(d => {
          if (d.roles && typeof d.roles === 'object') {
            Object.assign(mergedRoles, d.roles);
          }
        });

        // Consolidar otros campos relevantes
        const mergedDisplayName = winner.displayName || docs.find(d => d.displayName)?.displayName || '';
        const mergedFormalName = winner.formalName || docs.find(d => d.formalName)?.formalName || '';
        const mergedCanAccessEvents = docs.some(d => Boolean(d.canAccessEvents));
        const mergedDefaultCourseId = winner.defaultCourseId || docs.find(d => d.defaultCourseId)?.defaultCourseId || '';
        const mergedPhotoURL = winner.photoURL || docs.find(d => d.photoURL)?.photoURL || '';
        const isSuperadmin = docs.some(d => d.role === 'superadmin' || (d.roles && d.roles.global === 'superadmin'));

        const updatedWinnerData = {
          email: group.email,
          displayName: mergedDisplayName,
          formalName: mergedFormalName,
          roles: mergedRoles,
          canAccessEvents: mergedCanAccessEvents,
          preRegistered: !winner.uid,
          updatedAt: new Date().toISOString()
        };

        if (isSuperadmin) {
          updatedWinnerData.role = 'superadmin';
          updatedWinnerData.roles.global = 'superadmin';
        }
        if (mergedDefaultCourseId) updatedWinnerData.defaultCourseId = mergedDefaultCourseId;
        if (mergedPhotoURL) updatedWinnerData.photoURL = mergedPhotoURL;
        if (winner.uid) updatedWinnerData.uid = winner.uid;

        // 1. Actualizar el documento principal
        await setDoc(doc(db, 'users', winner.id), updatedWinnerData, { merge: true });

        // 2. Eliminar documentos redundantes
        for (const loser of losers) {
          await deleteDoc(doc(db, 'users', loser.id));
        }

        cleanedCount++;
      }

      await fetchData();
      setMessage(`${cleanedCount} usuario(s) duplicado(s) han sido unificados y limpiados exitosamente.`);
      setTimeout(() => setMessage(''), 4000);
    } catch (err) {
      console.error("Error al unificar duplicados:", err);
      await showAlert("Ocurrió un error al intentar unificar los usuarios duplicados.");
    } finally {
      setCleaning(false);
    }
  };

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
      const chosenStudent = newStudentId ? allStudents.find(s => s.id === newStudentId) : null;
      const targetCourseId = chosenStudent?.courseId || selectedCourse.id;

      // Chequeo previo para evitar duplicados: si ya existe, actualizamos su doc existente
      const existingUser = users.find(u => (u.email || '').toLowerCase().trim() === emailLower);

      if (existingUser) {
        const updatedRoles = { ...(existingUser.roles || {}) };
        updatedRoles[targetCourseId] = newRole;
        if (selectedCourse?.id && !updatedRoles[selectedCourse.id]) {
          updatedRoles[selectedCourse.id] = newRole;
        }

        const updateData = {
          roles: updatedRoles,
          role: newRole,
          defaultCourseId: existingUser.defaultCourseId || targetCourseId,
          updatedAt: new Date().toISOString()
        };
        if (newName && !existingUser.displayName) {
          updateData.displayName = newName;
        }

        await setDoc(doc(db, 'users', existingUser.id), updateData, { merge: true });

        setUsers(users.map(u => u.id === existingUser.id ? { ...u, ...updateData } : u));
      } else {
        const userRef = doc(db, 'users', emailLower);
        const newUser = {
          email: emailLower,
          displayName: newName,
          roles: {
            [targetCourseId]: newRole
          },
          role: newRole,
          defaultCourseId: targetCourseId,
          createdAt: new Date().toISOString(),
          preRegistered: true
        };

        await setDoc(userRef, newUser);
        setUsers([...users, { id: emailLower, ...newUser }]);
      }

      // Si se seleccionó un alumno al pre-registrar, vincular correo al alumno
      if (chosenStudent) {
        const currentEmails = getStudentEmails(chosenStudent);
        if (!currentEmails.includes(emailLower)) {
          const updatedEmails = [...currentEmails, emailLower];
          await updateDoc(doc(db, 'students', chosenStudent.id), {
            apoderadoEmails: updatedEmails
          });
          setAllStudents(prev => prev.map(s =>
            s.id === chosenStudent.id ? { ...s, apoderadoEmails: updatedEmails } : s
          ));
        }
      }

      setMessage(
        chosenStudent
          ? `Usuario registrado y vinculado al alumno ${formatStudentName(chosenStudent)}`
          : (existingUser ? 'Usuario existente actualizado con el nuevo rol en este curso' : 'Usuario pre-registrado correctamente')
      );

      setNewEmail('');
      setNewName('');
      setNewRole('apoderado');
      setNewStudentId('');
      setTimeout(() => setMessage(''), 3500);
    } catch (error) {
      console.error("Error agregando usuario:", error);
      setMessage('Error al agregar usuario');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleDeleteUser = async (userId, userEmail) => {
    const isDupe = duplicateEmailsMap.get((userEmail || '').toLowerCase().trim())?.length > 1;
    const confirmMsg = isDupe
      ? `¿Eliminar este registro específico (${userId})? El usuario conservará su otro documento en la base de datos.`
      : '¿Seguro que deseas eliminar este usuario? Si ya había iniciado sesión, perderá el acceso hasta que vuelva a iniciar.';

    if (!(await showConfirm(confirmMsg))) return;
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
    const linked = getLinkedStudentsForUser(user);
    setEditingId(user.id);
    setEditName(user.displayName || user.formalName || '');
    setEditCanAccessEvents(user.canAccessEvents || false);
    setEditStudentIds(linked.map(s => s.id));
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName('');
    setEditCanAccessEvents(false);
    setEditStudentIds([]);
  };

  // Persiste inmediatamente los vínculos entre un usuario y la lista de IDs de alumnos en Firestore
  const persistUserStudentLinks = async (userToEdit, nextStudentIds, feedbackMsg = null) => {
    if (!userToEdit) return;
    const userEmail = getUserEmail(userToEdit);
    const currentlyLinked = getLinkedStudentsForUser(userToEdit);
    const originalStudentIds = currentlyLinked.map(s => s.id);

    const removedStudentIds = originalStudentIds.filter(id => !nextStudentIds.includes(id));
    const addedStudentIds = nextStudentIds.filter(id => !originalStudentIds.includes(id));

    const updatedStudentsMap = new Map();

    // 1. Desvincular alumnos quitados o reemplazados en colección 'students'
    for (const stdId of removedStudentIds) {
      const st = allStudents.find(s => s.id === stdId);
      if (!st) continue;
      const nextEmails = userEmail
        ? getStudentEmails(st).filter(e => e !== userEmail)
        : getStudentEmails(st);
      const studentUpdates = {
        apoderadoEmails: nextEmails,
        apoderadoEmail: nextEmails[0] || ''
      };
      await updateDoc(doc(db, 'students', stdId), studentUpdates);
      updatedStudentsMap.set(stdId, studentUpdates);
    }

    // 2. Vincular alumnos agregados o modificados en colección 'students'
    for (const stdId of nextStudentIds) {
      const st = allStudents.find(s => s.id === stdId);
      if (!st) continue;
      const currentEmails = getStudentEmails(st);
      if (userEmail && !currentEmails.includes(userEmail)) {
        const nextEmails = [...currentEmails, userEmail];
        const studentUpdates = {
          apoderadoEmails: nextEmails,
          apoderadoEmail: nextEmails[0] || ''
        };
        await updateDoc(doc(db, 'students', stdId), studentUpdates);
        updatedStudentsMap.set(stdId, studentUpdates);
      } else if (addedStudentIds.includes(stdId)) {
        updatedStudentsMap.set(stdId, {
          apoderadoEmails: currentEmails,
          apoderadoEmail: currentEmails[0] || ''
        });
      }
    }

    // Actualizar estado local de alumnos inmediatamente después de guardar en 'students'
    if (updatedStudentsMap.size > 0) {
      setAllStudents(prev => prev.map(s =>
        updatedStudentsMap.has(s.id) ? { ...s, ...updatedStudentsMap.get(s.id) } : s
      ));
    }

    // 3. Asegurar que el usuario tenga rol en el curso de los alumnos vinculados y guardar linkedStudentIds
    const updatedRoles = { ...(userToEdit.roles || {}) };
    let updatedDefaultCourseId = userToEdit.defaultCourseId || '';
    const fallbackCourseId = filterCourse !== 'all' ? filterCourse : (selectedCourse?.id || '');

    nextStudentIds.forEach(stdId => {
      const st = allStudents.find(s => s.id === stdId);
      const targetCourseId = st?.courseId || fallbackCourseId;
      if (targetCourseId) {
        if (!updatedRoles[targetCourseId]) {
          updatedRoles[targetCourseId] = 'apoderado';
        }
        if (!updatedDefaultCourseId) {
          updatedDefaultCourseId = targetCourseId;
        }
      }
    });

    const userSyncPayload = {
      roles: updatedRoles,
      linkedStudentIds: nextStudentIds,
      updatedAt: new Date().toISOString()
    };
    if (userEmail && !userToEdit.email) {
      userSyncPayload.email = userEmail;
    }
    if (updatedDefaultCourseId) {
      userSyncPayload.defaultCourseId = updatedDefaultCourseId;
    }

    // Sincronizar documento(s) del usuario en 'users' (sin bloquear si el usuario tiene permisos parciales)
    const matchingUserDocs = userEmail
      ? users.filter(u => u.id === userToEdit.id || getUserEmail(u) === userEmail)
      : [userToEdit];

    for (const uDoc of matchingUserDocs) {
      try {
        await setDoc(doc(db, 'users', uDoc.id), {
          ...userSyncPayload,
          roles: { ...(uDoc.roles || {}), ...updatedRoles }
        }, { merge: true });
      } catch (userErr) {
        console.warn("Aviso al sincronizar documento de usuario:", userErr);
      }
    }

    setUsers(prev => prev.map(u => {
      if (u.id === userToEdit.id || (userEmail && getUserEmail(u) === userEmail)) {
        return {
          ...u,
          ...userSyncPayload,
          roles: { ...(u.roles || {}), ...updatedRoles }
        };
      }
      return u;
    }));

    if (feedbackMsg) {
      setMessage(feedbackMsg);
      setTimeout(() => setMessage(''), 3500);
    }
  };

  const handleChangeEditStudent = async (index, newStdId) => {
    const userToEdit = users.find(u => u.id === editingId);
    let nextIds;
    if (!newStdId) {
      // Si selecciona "-- Desvincular alumno --", se quita de la lista
      nextIds = editStudentIds.filter((_, idx) => idx !== index);
    } else {
      if (editStudentIds.includes(newStdId) && editStudentIds[index] !== newStdId) return;
      nextIds = [...editStudentIds];
      nextIds[index] = newStdId;
    }
    setEditStudentIds(nextIds);
    try {
      await persistUserStudentLinks(
        userToEdit,
        nextIds,
        newStdId ? 'Alumno modificado y guardado automáticamente' : 'Alumno desvinculado correctamente'
      );
    } catch (error) {
      console.error("Error guardando cambio de alumno:", error);
      setMessage('Error al guardar cambio de alumno');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleRemoveEditStudent = async (stdId) => {
    const userToEdit = users.find(u => u.id === editingId);
    const nextIds = editStudentIds.filter(id => id !== stdId);
    setEditStudentIds(nextIds);
    try {
      await persistUserStudentLinks(userToEdit, nextIds, 'Alumno desvinculado correctamente');
    } catch (error) {
      console.error("Error desvinculando alumno:", error);
      setMessage('Error al desvincular alumno');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleAddEditStudent = async (stdId) => {
    if (!stdId) return;
    const userToEdit = users.find(u => u.id === editingId);
    if (editStudentIds.includes(stdId)) return;
    const nextIds = [...editStudentIds, stdId];
    setEditStudentIds(nextIds);
    try {
      const st = allStudents.find(s => s.id === stdId);
      await persistUserStudentLinks(
        userToEdit,
        nextIds,
        `Alumno ${st ? formatStudentName(st) : ''} vinculado y guardado correctamente`
      );
    } catch (error) {
      console.error("Error vinculando alumno:", error);
      setMessage('Error al vincular alumno');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleSaveEdit = async () => {
    try {
      const userToEdit = users.find(u => u.id === editingId);
      if (!userToEdit) return;

      await persistUserStudentLinks(userToEdit, editStudentIds);

      const userEmail = getUserEmail(userToEdit);
      const trimmedName = (editName || '').trim();
      const userUpdatePayload = {
        displayName: trimmedName,
        canAccessEvents: editCanAccessEvents,
        updatedAt: new Date().toISOString()
      };
      if (trimmedName) {
        userUpdatePayload.formalName = trimmedName;
      }
      if (userEmail && !userToEdit.email) {
        userUpdatePayload.email = userEmail;
      }

      try {
        await setDoc(doc(db, 'users', editingId), userUpdatePayload, { merge: true });
      } catch (userErr) {
        console.warn("Aviso al actualizar perfil de usuario:", userErr);
      }

      setUsers(prev => prev.map(u =>
        u.id === editingId ? { ...u, ...userUpdatePayload } : u
      ));

      setMessage('Usuario y vínculo de alumno(s) guardados correctamente');
      setTimeout(() => setMessage(''), 3500);
      cancelEditing();
    } catch (error) {
      console.error("Error modificando usuario:", error);
      setMessage('Error al modificar usuario');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Cargando usuarios...</div>;
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.45rem 0.6rem' }} title="Volver al panel">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.4rem' }}>
              Gestión de {viewMode === 'admins' ? 'Administradores' : 'Usuarios'}
            </h3>
            <p style={{ margin: '0.15rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {users.length} registros en total en la base de datos
            </p>
          </div>
        </div>

        <button
          onClick={fetchData}
          className="btn btn-outline"
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
          title="Recargar usuarios desde la base de datos"
        >
          <RefreshCw size={14} /> Recargar
        </button>
      </div>

      {/* Banner de Duplicados Detectados */}
      {duplicateGroups.length > 0 && (
        <div
          className="glass-panel"
          style={{
            padding: '1.25rem 1.5rem',
            marginBottom: '1.5rem',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--warning)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: '1 1 300px' }}>
            <div style={{
              width: '42px', height: '42px', minWidth: '42px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-card-hover)',
              border: '1px solid var(--border-color)',
              color: 'var(--warning)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <AlertTriangle size={22} />
            </div>
            <div>
              <h4 style={{ margin: 0, color: 'var(--warning)', fontSize: '1rem', fontWeight: '600' }}>
                Se detectaron {duplicateGroups.length} correos con registros duplicados
              </h4>
              <p style={{ margin: '0.2rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Existen {duplicateGroups.reduce((acc, g) => acc + g.docs.length, 0)} documentos que comparten el mismo correo (cuentas creadas por Google Auth y pre-registros por correo).
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowOnlyDuplicates(!showOnlyDuplicates)}
              className="btn btn-outline"
              style={{ fontSize: '0.825rem', padding: '0.45rem 0.85rem' }}
            >
              {showOnlyDuplicates ? 'Ver todos los usuarios' : 'Ver solo duplicados'}
            </button>
            <button
              onClick={handleCleanDuplicates}
              disabled={cleaning}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', padding: '0.45rem 1rem' }}
            >
              <Layers size={16} />
              {cleaning ? 'Unificando...' : 'Unificar y Limpiar Duplicados'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros y Buscador */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginBottom: '1.5rem',
        padding: '1rem',
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)'
      }}>
        {/* Buscador */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flex: '1 1 240px',
          backgroundColor: 'var(--bg-card-hover)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.45rem 0.75rem'
        }}>
          <Search size={16} style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Buscar por nombre, email, alumno o Doc ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-main)',
              fontSize: '0.85rem'
            }}
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* Selector de Curso */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Curso:</label>
          <select
            className="input-field"
            style={{ width: 'auto', padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
            value={filterCourse}
            onChange={(e) => setFilterCourse(e.target.value)}
          >
            <option value="all">Todos los cursos</option>
            {allCourses.map(c => (
              <option key={c.id} value={c.id}>{c.name} {c.year}</option>
            ))}
          </select>
        </div>

        {/* Toggle Duplicados */}
        {duplicateGroups.length > 0 && (
          <button
            onClick={() => setShowOnlyDuplicates(!showOnlyDuplicates)}
            className="btn btn-outline"
            style={{
              fontSize: '0.825rem',
              padding: '0.45rem 0.85rem',
              borderColor: showOnlyDuplicates ? 'var(--warning)' : 'var(--border-color)',
              color: showOnlyDuplicates ? 'var(--warning)' : 'var(--text-muted)'
            }}
          >
            {showOnlyDuplicates ? '✓ Mostrando duplicados' : 'Filtrar duplicados'}
          </button>
        )}
      </div>

      {message && (
        <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--success)', color: 'var(--success)', padding: '0.9rem 1.25rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
          <CheckCircle2 size={18} /> {message}
        </div>
      )}

      {/* Formulario para agregar usuario */}
      <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '2rem' }}>
        <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem', fontWeight: '600' }}>
          <UserPlus size={18} style={{ color: 'var(--primary)' }} /> Pre-registrar Usuario
        </h4>
        <form onSubmit={handleAddUser} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: '1', minWidth: '200px', marginBottom: 0 }}>
            <label className="input-label" style={{ fontSize: '0.8rem' }}>Email</label>
            <input
              type="email"
              required
              className="input-field"
              placeholder="correo@ejemplo.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              style={{ fontSize: '0.85rem' }}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '150px', marginBottom: 0 }}>
            <label className="input-label" style={{ fontSize: '0.8rem' }}>Nombre (Opcional)</label>
            <input
              type="text"
              className="input-field"
              placeholder="Juan Pérez"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ fontSize: '0.85rem' }}
            />
          </div>
          <div className="input-group" style={{ flex: '1', minWidth: '210px', marginBottom: 0 }}>
            <label className="input-label" style={{ fontSize: '0.8rem' }}>Alumno a Vincular (Opcional)</label>
            <select
              className="input-field"
              value={newStudentId}
              onChange={(e) => setNewStudentId(e.target.value)}
              style={{ fontSize: '0.85rem' }}
            >
              <option value="">-- Sin alumno vinculado --</option>
              {sortedStudentsForSelect.map(s => (
                <option key={s.id} value={s.id}>
                  {formatStudentOptionLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group" style={{ width: '150px', marginBottom: 0 }}>
            <label className="input-label" style={{ fontSize: '0.8rem' }}>Rol</label>
            <select className="input-field" value={newRole} onChange={(e) => setNewRole(e.target.value)} style={{ fontSize: '0.85rem' }}>
              <option value="apoderado">Apoderado</option>
              <option value="tesorero">Tesorero</option>
              <option value="presidente">Presidente</option>
              <option value="secretario">Secretario</option>
              {role === 'superadmin' && <option value="admin">Administrador</option>}
            </select>
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: '38px', padding: '0 1.25rem', fontSize: '0.85rem' }}>
            Agregar
          </button>
        </form>
      </div>

      {/* Tabla de Usuarios */}
      <div className="table-responsive glass-panel" style={{ overflowX: 'auto', borderRadius: 'var(--radius-lg)' }}>
        <table style={{ width: '100%', minWidth: '820px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card-hover)' }}>
              <th style={{ padding: '0.9rem 1rem', color: 'var(--text-muted)', fontWeight: '600' }}>Usuario</th>
              <th style={{ padding: '0.9rem 1rem', color: 'var(--text-muted)', fontWeight: '600' }}>Email</th>
              <th style={{ padding: '0.9rem 1rem', color: 'var(--text-muted)', fontWeight: '600' }}>Alumno(s) Vinculado(s)</th>
              <th style={{ padding: '0.9rem 1rem', color: 'var(--text-muted)', fontWeight: '600' }}>Rol / Curso</th>
              <th style={{ padding: '0.9rem 1rem', color: 'var(--text-muted)', fontWeight: '600' }}>Estado</th>
              <th style={{ padding: '0.9rem 1rem', color: 'var(--text-muted)', fontWeight: '600' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(u => {
              const emailLower = getUserEmail(u);
              const duplicateDocs = duplicateEmailsMap.get(emailLower) || [];
              const isDuplicate = duplicateDocs.length > 1;
              const linkedStudents = getLinkedStudentsForUser(u);
              const canEditUser = role === 'superadmin' || role === 'admin';

              return (
                <tr
                  key={u.id}
                  style={{
                    borderBottom: '1px solid var(--border-color)',
                    backgroundColor: isDuplicate ? 'rgba(245, 158, 11, 0.03)' : 'transparent'
                  }}
                >
                  {editingId === u.id ? (
                    <>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <input
                            type="text"
                            className="input-field"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            style={{ padding: '0.4rem' }}
                          />
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                            <input
                              type="checkbox"
                              checked={editCanAccessEvents}
                              onChange={(e) => setEditCanAccessEvents(e.target.checked)}
                            />
                            Habilitar Eventos y POS
                          </label>
                        </div>
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{u.email || emailLower}</td>
                      <td style={{ padding: '1rem', minWidth: '250px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                          {editStudentIds.map((stdId, idx) => (
                            <div key={`${stdId}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <select
                                className="input-field"
                                style={{ padding: '0.3rem 0.5rem', fontSize: '0.78rem', flex: 1 }}
                                value={stdId}
                                onChange={(e) => handleChangeEditStudent(idx, e.target.value)}
                              >
                                <option value="">-- Desvincular alumno --</option>
                                {sortedStudentsForSelect.map(s => (
                                  <option key={s.id} value={s.id}>
                                    {formatStudentOptionLabel(s)}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => handleRemoveEditStudent(stdId)}
                                className="btn btn-outline"
                                style={{ padding: '0.25rem 0.4rem', color: 'var(--danger)', borderColor: 'var(--border-color)' }}
                                title="Quitar alumno"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                          <select
                            className="input-field"
                            style={{ padding: '0.3rem 0.5rem', fontSize: '0.78rem', borderStyle: 'dashed', borderColor: 'var(--primary)' }}
                            value=""
                            onChange={(e) => {
                              if (e.target.value) {
                                handleAddEditStudent(e.target.value);
                              }
                            }}
                          >
                            <option value="">+ Agregar alumno...</option>
                            {sortedStudentsForSelect
                              .filter(s => !editStudentIds.includes(s.id))
                              .map(s => (
                                <option key={s.id} value={s.id}>
                                  {formatStudentOptionLabel(s)}
                                </option>
                              ))}
                          </select>
                          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.2rem' }}>
                            <button
                              type="button"
                              onClick={handleSaveEdit}
                              className="btn btn-primary"
                              style={{ padding: '0.28rem 0.65rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                            >
                              <Save size={13} /> Guardar
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditing}
                              className="btn btn-outline"
                              style={{ padding: '0.28rem 0.55rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                            >
                              <X size={13} /> Cerrar
                            </button>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          {((u.roles && u.roles['global'] === 'superadmin') || u.role === 'superadmin') ? (
                            <span style={{ padding: '0.15rem 0.45rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--warning)', color: 'var(--warning)', width: 'max-content' }}>
                              Superadmin (Global)
                            </span>
                          ) : (!u.roles || Object.keys(u.roles).filter(k => k !== 'global').length === 0) ? (
                            <span style={{ padding: '0.15rem 0.45rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--danger)', color: 'var(--danger)', width: 'max-content' }}>
                              Sin Curso
                            </span>
                          ) : (
                            Object.entries(u.roles || {}).map(([cId, r]) => {
                              if (cId === 'global') return null;
                              const cName = allCourses.find(c => c.id === cId)?.name || 'Curso Desconocido';
                              if (viewMode === 'admins' && !['admin', 'presidente', 'tesorero', 'secretario'].includes(r)) return null;
                              if (viewMode === 'users' && r !== 'apoderado') return null;
                              return (
                                <span key={cId} style={{ padding: '0.15rem 0.45rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--text-main)', width: 'max-content' }}>
                                  {r.charAt(0).toUpperCase() + r.slice(1)} - {cName}
                                </span>
                              );
                            })
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '1rem' }}>
                        {u.uid ? (
                          <span style={{ color: 'var(--success)', fontSize: '0.8rem', fontWeight: '500' }}>Activo</span>
                        ) : (
                          <span style={{ color: 'var(--warning)', fontSize: '0.8rem', fontWeight: '500' }}>Pendiente</span>
                        )}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={handleSaveEdit} className="btn btn-outline" style={{ padding: '0.35rem 0.65rem', color: 'var(--success)', gap: '0.35rem', display: 'flex', alignItems: 'center', fontSize: '0.8rem' }}>
                            <Save size={15} /> Guardar
                          </button>
                          <button onClick={cancelEditing} className="btn btn-outline" style={{ padding: '0.35rem 0.5rem', display: 'flex', alignItems: 'center' }}>
                            <X size={15} />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          {u.photoURL ? (
                            <img
                              src={u.photoURL}
                              alt={u.displayName}
                              style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-color)', objectFit: 'cover' }}
                              onClick={(e) => { e.stopPropagation(); setSelectedImage(u.photoURL); }}
                              title="Ver en pantalla completa"
                            />
                          ) : (
                            <div style={{ width: '32px', height: '32px', minWidth: '32px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--text-main)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '600', fontSize: '0.85rem' }}>
                              {u.displayName ? u.displayName[0].toUpperCase() : (u.email ? u.email[0].toUpperCase() : '?')}
                            </div>
                          )}
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: '500', color: 'var(--text-main)' }}>
                                {u.displayName || u.formalName || 'Sin Nombre'}
                              </span>
                              {isDuplicate && (
                                <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)', border: '1px solid rgba(245, 158, 11, 0.3)', fontWeight: '600' }}>
                                  Duplicado ({duplicateDocs.length})
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace', display: 'block', marginTop: '0.1rem' }}>
                              Doc ID: {u.id} {u.uid && u.id === u.uid ? '(Cuenta Google)' : ''}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem', color: 'var(--text-muted)' }}>{u.email}</td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'flex-start' }}>
                          {linkedStudents.length > 0 ? (
                            linkedStudents.map(std => {
                              const cObj = allCourses.find(c => c.id === std.courseId);
                              return (
                                <span
                                  key={std.id}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                    padding: '0.2rem 0.5rem',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.75rem',
                                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                    border: '1px solid rgba(59, 130, 246, 0.3)',
                                    color: 'var(--text-main)',
                                    fontWeight: '500'
                                  }}
                                >
                                  {formatStudentName(std)}
                                  {cObj && (
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                      ({cObj.name})
                                    </span>
                                  )}
                                </span>
                              );
                            })
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              Sin alumno vinculado
                            </span>
                          )}
                          {canEditUser && (
                            <button
                              type="button"
                              onClick={() => startEditing(u)}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                color: 'var(--primary)',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.2rem',
                                fontWeight: '500'
                              }}
                            >
                              <Plus size={12} />
                              {linkedStudents.length > 0 ? 'Modificar / Agregar alumno' : 'Agregar alumno'}
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          {((u.roles && u.roles['global'] === 'superadmin') || u.role === 'superadmin') ? (
                            <span style={{ padding: '0.15rem 0.45rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--warning)', color: 'var(--warning)', width: 'max-content' }}>
                              Superadmin (Global)
                            </span>
                          ) : (!u.roles || Object.keys(u.roles).filter(k => k !== 'global').length === 0) ? (
                            <span style={{ padding: '0.15rem 0.45rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--danger)', color: 'var(--danger)', width: 'max-content' }}>
                              Sin Curso
                            </span>
                          ) : (
                            Object.entries(u.roles || {}).map(([cId, r]) => {
                              if (cId === 'global') return null;
                              const cName = allCourses.find(c => c.id === cId)?.name || 'Curso Desconocido';
                              if (viewMode === 'admins' && !['admin', 'presidente', 'tesorero', 'secretario'].includes(r)) return null;
                              if (viewMode === 'users' && r !== 'apoderado') return null;
                              return (
                                <span key={cId} style={{ padding: '0.15rem 0.45rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--text-main)', width: 'max-content' }}>
                                  {r.charAt(0).toUpperCase() + r.slice(1)} - {cName}
                                </span>
                              );
                            })
                          )}
                          {u.canAccessEvents && (
                            <span style={{ padding: '0.15rem 0.45rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--success)', color: 'var(--success)', width: 'max-content' }}>
                              Acceso Eventos/POS
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        {u.uid ? (
                          <span style={{ color: 'var(--success)', fontSize: '0.8rem', fontWeight: '500' }}>Activo</span>
                        ) : (
                          <span style={{ color: 'var(--warning)', fontSize: '0.8rem', fontWeight: '500' }}>Pendiente</span>
                        )}
                      </td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        {canEditUser ? (
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <button onClick={() => startEditing(u)} className="btn btn-outline" style={{ padding: '0.35rem 0.65rem', color: 'var(--text-main)', gap: '0.35rem', display: 'flex', alignItems: 'center', fontSize: '0.8rem' }}>
                              <Edit2 size={14} /> Editar
                            </button>
                            {role === 'superadmin' && u.role !== 'superadmin' && (
                              <>
                                <select
                                  className="input-field"
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                                  value={u.roles && selectedCourse && u.roles[selectedCourse.id] ? u.roles[selectedCourse.id] : ''}
                                  onChange={(e) => handleRoleChange(u.id, e.target.value)}
                                >
                                  <option value="" disabled>Asignar Rol...</option>
                                  <option value="apoderado">Apoderado</option>
                                  <option value="tesorero">Tesorero</option>
                                  <option value="presidente">Presidente</option>
                                  {role === 'superadmin' && <option value="admin">Admin</option>}
                                </select>
                                <button
                                  onClick={() => handleDeleteUser(u.id, u.email)}
                                  className="btn btn-outline"
                                  style={{ padding: '0.35rem 0.5rem', color: 'var(--danger)', borderColor: 'var(--border-color)' }}
                                  title={isDuplicate ? "Eliminar este registro duplicado" : "Eliminar usuario"}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No modificable</span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredUsers.length === 0 && (
          <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No se encontraron {viewMode === 'admins' ? 'administradores' : 'usuarios'} con los filtros aplicados.
          </div>
        )}
      </div>

      {selectedImage && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.85)',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 10000, padding: '1rem', cursor: 'zoom-out'
        }} onClick={() => setSelectedImage(null)}>
          <img
            src={selectedImage}
            alt="Usuario"
            style={{
              maxWidth: '90%', maxHeight: '90vh',
              borderRadius: 'var(--radius-md)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
              objectFit: 'contain'
            }}
          />
          <button onClick={() => setSelectedImage(null)} style={{
            position: 'absolute', top: '1.5rem', right: '1.5rem',
            background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff',
            cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '0.5rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <X size={24} />
          </button>
        </div>
      )}

    </div>
  );
};

export default UserManagement;
