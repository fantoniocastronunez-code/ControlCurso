import React, { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ArrowLeft, Save, Landmark, PlusCircle, Trash2, Edit2 } from 'lucide-react';
import { useModal } from '../context/ModalContext';

const SettingsManagement = ({ onBack }) => {
  const { showAlert, showConfirm } = useModal();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [accounts, setAccounts] = useState([]);
  
  // Modal/Form state
  const [isEditing, setIsEditing] = useState(false);
  const [currentAccount, setCurrentAccount] = useState({
    id: '',
    alias: '',
    bank: '',
    accountType: '',
    accountNumber: '',
    rut: '',
    name: '',
    email: ''
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const docRef = doc(db, 'settings', 'general');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.transferAccounts) {
          setAccounts(data.transferAccounts);
        } else if (data.transferData) {
          // Migration from old single account
          setAccounts([{ ...data.transferData, id: 'acc_legacy', alias: 'Cuenta Principal' }]);
        }
      }
    } catch (error) {
      console.error("Error fetching settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAccounts = async (newAccounts) => {
    setSaving(true);
    try {
      const docRef = doc(db, 'settings', 'general');
      await setDoc(docRef, { transferAccounts: newAccounts }, { merge: true });
      setAccounts(newAccounts);
      await showAlert("Cuentas actualizadas correctamente.");
      setIsEditing(false);
    } catch (error) {
      console.error("Error saving settings:", error);
      await showAlert("Error al guardar la configuración.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitAccount = (e) => {
    e.preventDefault();
    if (!currentAccount.alias || !currentAccount.bank || !currentAccount.accountNumber) {
      showAlert("Por favor, completa al menos el Alias, Banco y Número de Cuenta.");
      return;
    }
    
    let newAccounts;
    if (currentAccount.id) {
      // Edit
      newAccounts = accounts.map(a => a.id === currentAccount.id ? currentAccount : a);
    } else {
      // Add
      newAccounts = [...accounts, { ...currentAccount, id: 'acc_' + Date.now() }];
    }
    handleSaveAccounts(newAccounts);
  };

  const handleEdit = (acc) => {
    setCurrentAccount(acc);
    setIsEditing(true);
  };

  const handleDelete = async (id) => {
    if (!(await showConfirm('¿Estás seguro de eliminar esta cuenta? Las cuotas pasadas mantendrán los datos intactos.'))) return;
    const newAccounts = accounts.filter(a => a.id !== id);
    handleSaveAccounts(newAccounts);
  };

  const handleAddNew = () => {
    setCurrentAccount({
      id: '',
      alias: '',
      bank: '',
      accountType: '',
      accountNumber: '',
      rut: '',
      name: '',
      email: ''
    });
    setIsEditing(true);
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando configuración...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-outline" style={{ padding: '0.5rem' }}>
          <ArrowLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>Configuración del Curso</h3>
      </div>

      {!isEditing ? (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
              <Landmark size={24} />
              <h4 style={{ margin: 0 }}>Cuentas para Transferencias</h4>
            </div>
            <button onClick={handleAddNew} className="btn btn-primary" style={{ padding: '0.5rem 1rem' }}>
              <PlusCircle size={18} /> Agregar Cuenta
            </button>
          </div>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Puedes agregar múltiples cuentas bancarias. Al crear una cuota, podrás elegir a cuál de estas cuentas deben transferir los apoderados.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {accounts.map(acc => (
              <div key={acc.id} style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                  <h4 style={{ margin: 0, color: 'var(--primary)' }}>{acc.alias}</h4>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => handleEdit(acc)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} title="Editar">
                      <Edit2 size={16} />
                    </button>
                    <button onClick={() => handleDelete(acc.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }} title="Eliminar">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', display: 'grid', gap: '0.3rem' }}>
                  <div><strong>Banco:</strong> {acc.bank}</div>
                  <div><strong>N° Cuenta:</strong> {acc.accountNumber} ({acc.accountType})</div>
                  <div><strong>Titular:</strong> {acc.name}</div>
                  <div><strong>RUT:</strong> {acc.rut}</div>
                  {acc.email && <div><strong>Correo:</strong> {acc.email}</div>}
                </div>
              </div>
            ))}
            {accounts.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                No hay cuentas configuradas.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: '2rem', maxWidth: '600px' }}>
          <h4 style={{ marginBottom: '1.5rem', color: 'var(--primary)' }}>{currentAccount.id ? 'Editar Cuenta' : 'Nueva Cuenta Bancaria'}</h4>
          
          <form onSubmit={handleSubmitAccount} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Alias (Nombre interno para identificarla)</label>
              <input type="text" className="input-field" value={currentAccount.alias} onChange={e => setCurrentAccount({...currentAccount, alias: e.target.value})} placeholder="Ej. Cuenta Directiva, Cuenta Fondos Extra..." required />
            </div>

            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Banco</label>
              <input type="text" className="input-field" value={currentAccount.bank} onChange={e => setCurrentAccount({...currentAccount, bank: e.target.value})} placeholder="Ej. Banco Estado" required />
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Tipo de Cuenta</label>
                <input type="text" className="input-field" value={currentAccount.accountType} onChange={e => setCurrentAccount({...currentAccount, accountType: e.target.value})} placeholder="Ej. Cuenta RUT" />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Número de Cuenta</label>
                <input type="text" className="input-field" value={currentAccount.accountNumber} onChange={e => setCurrentAccount({...currentAccount, accountNumber: e.target.value})} placeholder="Ej. 12345678" required />
              </div>
            </div>

            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">RUT</label>
              <input type="text" className="input-field" value={currentAccount.rut} onChange={e => setCurrentAccount({...currentAccount, rut: e.target.value})} placeholder="Ej. 12.345.678-9" />
            </div>

            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Nombre del Titular</label>
              <input type="text" className="input-field" value={currentAccount.name} onChange={e => setCurrentAccount({...currentAccount, name: e.target.value})} placeholder="Ej. Juan Pérez" />
            </div>

            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Correo Electrónico (Opcional)</label>
              <input type="email" className="input-field" value={currentAccount.email} onChange={e => setCurrentAccount({...currentAccount, email: e.target.value})} placeholder="Ej. tesorero@curso.cl" />
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button type="button" onClick={() => setIsEditing(false)} className="btn btn-outline" style={{ flex: 1 }}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex: 1 }}>
                <Save size={18} />
                {saving ? 'Guardando...' : 'Guardar Cuenta'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default SettingsManagement;
