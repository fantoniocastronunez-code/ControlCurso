import React, { useState } from 'react';
import { db } from '../firebase';
import { collection, getDocs, doc, updateDoc, setDoc } from 'firebase/firestore';

const COURSE_ID = 'kinder-b-2026';
const COURSE_NAME = 'Kinder B';

const MigrateDB = () => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const runMigration = async () => {
    setLoading(true);
    setStatus('Iniciando migración...');
    try {
      // 1. Create the Course document
      setStatus(`Creando curso: ${COURSE_ID}`);
      await setDoc(doc(db, 'courses', COURSE_ID), {
        name: COURSE_NAME,
        grade: 'Kinder',
        year: 2026,
        inviteCode: 'KINDER-B-CALDR-2026',
        createdAt: new Date().toISOString()
      });

      // 2. Add courseId to all entities
      const collectionsToUpdate = [
        'students', 'debts', 'expenses', 'funds', 
        'outcomes', 'incomes', 'fund_transfers', 
        'events', 'eventItems', 'eventSales'
      ];

      for (const collName of collectionsToUpdate) {
        setStatus(`Actualizando colección: ${collName}...`);
        const snap = await getDocs(collection(db, collName));
        for (const d of snap.docs) {
          if (!d.data().courseId) {
            await updateDoc(doc(db, collName, d.id), { courseId: COURSE_ID });
          }
        }
      }

      // 3. Migrate Users
      setStatus('Actualizando usuarios y roles...');
      const usersSnap = await getDocs(collection(db, 'users'));
      for (const d of usersSnap.docs) {
        const data = d.data();
        if (!data.roles || !data.roles[COURSE_ID]) {
          const roles = data.roles || {};
          if (data.role === 'superadmin') {
            roles['global'] = 'superadmin';
          } else {
            roles[COURSE_ID] = data.role || 'apoderado';
          }
          await updateDoc(doc(db, 'users', d.id), { 
            roles: roles,
            defaultCourseId: COURSE_ID
          });
        }
      }

      setStatus('¡Migración completada exitosamente! Puedes recargar la página.');
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '1rem', background: 'rgba(255,0,0,0.1)', border: '1px solid red', marginBottom: '1rem', borderRadius: '8px' }}>
      <h4>[ZONA DE PELIGRO] Script de Migración Multicurso</h4>
      <p style={{ fontSize: '0.85rem' }}>Status: {status}</p>
      <button 
        onClick={runMigration} 
        disabled={loading} 
        className="btn btn-primary"
        style={{ background: 'red', borderColor: 'red' }}
      >
        {loading ? 'Migrando...' : 'EJECUTAR MIGRACIÓN AHORA'}
      </button>
    </div>
  );
};

export default MigrateDB;
