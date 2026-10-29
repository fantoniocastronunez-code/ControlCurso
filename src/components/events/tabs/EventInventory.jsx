import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../../../firebase/config';
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { 
  Package, Plus, Trash2, Edit2, AlertTriangle, CheckCircle, 
  DollarSign, RefreshCw, ClipboardList, Save, Check, X, Info
} from 'lucide-react';
import { useModal } from '../../../context/ModalContext';
import { useAuth } from '../../../context/AuthContext';

const UNIT_OPTIONS = [
  'unidades',
  'kilos',
  'paquetes',
  'litros',
  'latas',
  'porciones',
  'cajas',
  'otro'
];

const EventInventory = ({ event }) => {
  const { user } = useAuth();
  const { showAlert, showConfirm } = useModal();
  
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);

  // Formulario Nuevo / Edición
  const [editingItemId, setEditingItemId] = useState(null);
  const [name, setName] = useState('');
  const [initialQuantity, setInitialQuantity] = useState('');
  const [unit, setUnit] = useState('unidades');
  const [customUnit, setCustomUnit] = useState('');
  const [cost, setCost] = useState('');
  const [recordExpense, setRecordExpense] = useState(false);
  const [notes, setNotes] = useState('');

  // Modal Reabastecer (Comprar más insumos durante el evento)
  const [restockItem, setRestockItem] = useState(null);
  const [restockQuantity, setRestockQuantity] = useState('');
  const [restockCost, setRestockCost] = useState('');
  const [restockRecordExpense, setRestockRecordExpense] = useState(false);

  // Estado del conteo físico de cierre / sobrantes
  const [physicalCounts, setPhysicalCounts] = useState({});
  const [finalNotesMap, setFinalNotesMap] = useState({});
  const [savingClosure, setSavingClosure] = useState(false);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'eventInventory'), where('eventId', '==', event.id));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setInventory(list);

      // Inicializar mapa de conteo físico si ya existía
      const initialPhysical = {};
      const initialNotes = {};
      list.forEach(item => {
        if (item.finalCount !== undefined && item.finalCount !== null) {
          initialPhysical[item.id] = item.finalCount;
        }
        if (item.finalNotes) {
          initialNotes[item.id] = item.finalNotes;
        }
      });
      setPhysicalCounts(initialPhysical);
      setFinalNotesMap(initialNotes);
    } catch (error) {
      console.error("Error al obtener inventario del evento:", error);
    } finally {
      setLoading(false);
    }
  }, [event.id]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const resetForm = () => {
    setEditingItemId(null);
    setName('');
    setInitialQuantity('');
    setUnit('unidades');
    setCustomUnit('');
    setCost('');
    setRecordExpense(false);
    setNotes('');
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    if (!name.trim() || initialQuantity === '') {
      showAlert("Por favor ingresa el nombre y la cantidad inicial.");
      return;
    }

    const qty = parseFloat(initialQuantity);
    if (isNaN(qty) || qty < 0) {
      showAlert("La cantidad debe ser un número mayor o igual a 0.");
      return;
    }

    const effectiveUnit = unit === 'otro' ? (customUnit.trim() || 'unidades') : unit;
    const costNum = cost ? parseFloat(cost) : 0;

    try {
      if (editingItemId) {
        // Actualización de ítem existente
        const currentItem = inventory.find(i => i.id === editingItemId);
        const qtyDiff = qty - (currentItem?.initialQuantity || 0);
        const newStock = Math.max(0, (currentItem?.currentStock ?? 0) + qtyDiff);

        const updateData = {
          name: name.trim(),
          unit: effectiveUnit,
          initialQuantity: qty,
          currentStock: newStock,
          cost: costNum,
          notes: notes.trim(),
          updatedAt: new Date().toISOString(),
          updatedBy: user?.email || user?.displayName || 'Unknown'
        };

        await updateDoc(doc(db, 'eventInventory', editingItemId), updateData);
        setInventory(prev => prev.map(i => i.id === editingItemId ? { ...i, ...updateData } : i));
        showAlert("Insumo actualizado exitosamente.");
        resetForm();
      } else {
        // Nuevo ítem en inventario
        const itemId = 'inv_' + Date.now();
        const newItem = {
          eventId: event.id,
          courseId: event.courseId || '',
          name: name.trim(),
          unit: effectiveUnit,
          initialQuantity: qty,
          totalPurchased: qty,
          currentStock: qty,
          cost: costNum,
          notes: notes.trim(),
          createdAt: new Date().toISOString(),
          createdBy: user?.email || user?.displayName || 'Unknown'
        };

        await setDoc(doc(db, 'eventInventory', itemId), newItem);

        // Si marcó registrar costo como gasto del evento y hay un monto válido
        if (recordExpense && costNum > 0 && event.fundId) {
          const outcomeId = 'out_' + Date.now();
          await setDoc(doc(db, 'outcomes', outcomeId), {
            title: `Compra Insumo: ${name.trim()} (${qty} ${effectiveUnit})`,
            amount: costNum,
            date: new Date().toISOString().split('T')[0],
            paymentMethod: 'cash',
            responsable: user?.displayName || user?.email || 'Tesorero',
            fundId: event.fundId,
            eventId: event.id,
            courseId: event.courseId || '',
            inventoryId: itemId,
            createdAt: new Date().toISOString(),
            createdBy: user?.email || user?.displayName || 'Unknown User'
          });
        }

        setInventory(prev => [...prev, { id: itemId, ...newItem }].sort((a, b) => a.name.localeCompare(b.name)));
        showAlert("Insumo registrado exitosamente en el inventario.");
        resetForm();
      }
    } catch (error) {
      console.error("Error al guardar insumo:", error);
      showAlert("Ocurrió un error al guardar el insumo.");
    }
  };

  const handleEditClick = (item) => {
    setEditingItemId(item.id);
    setName(item.name);
    setInitialQuantity(item.initialQuantity.toString());
    if (UNIT_OPTIONS.includes(item.unit)) {
      setUnit(item.unit);
      setCustomUnit('');
    } else {
      setUnit('otro');
      setCustomUnit(item.unit || '');
    }
    setCost(item.cost ? item.cost.toString() : '');
    setNotes(item.notes || '');
    setRecordExpense(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteItem = async (item) => {
    const confirm = await showConfirm(`¿Estás seguro de eliminar "${item.name}" del inventario?`);
    if (!confirm) return;

    try {
      await deleteDoc(doc(db, 'eventInventory', item.id));
      setInventory(prev => prev.filter(i => i.id !== item.id));
      showAlert("Insumo eliminado.");
    } catch (error) {
      console.error("Error al eliminar insumo:", error);
      showAlert("Hubo un error al eliminar el insumo.");
    }
  };

  // Reabastecimiento durante el evento
  const handleRestockSubmit = async (e) => {
    e.preventDefault();
    if (!restockItem) return;

    const extraQty = parseFloat(restockQuantity);
    if (isNaN(extraQty) || extraQty <= 0) {
      showAlert("Ingresa una cantidad válida mayor a 0.");
      return;
    }

    const extraCostNum = restockCost ? parseFloat(restockCost) : 0;

    try {
      const newTotalPurchased = (restockItem.totalPurchased || restockItem.initialQuantity || 0) + extraQty;
      const newCurrentStock = (restockItem.currentStock || 0) + extraQty;
      const newTotalCost = (restockItem.cost || 0) + extraCostNum;

      const updateData = {
        totalPurchased: newTotalPurchased,
        currentStock: newCurrentStock,
        cost: newTotalCost,
        updatedAt: new Date().toISOString()
      };

      await updateDoc(doc(db, 'eventInventory', restockItem.id), updateData);

      // Si seleccionó registrar como gasto
      if (restockRecordExpense && extraCostNum > 0 && event.fundId) {
        const outcomeId = 'out_' + Date.now();
        await setDoc(doc(db, 'outcomes', outcomeId), {
          title: `Reabastecimiento: ${restockItem.name} (+${extraQty} ${restockItem.unit})`,
          amount: extraCostNum,
          date: new Date().toISOString().split('T')[0],
          paymentMethod: 'cash',
          responsable: user?.displayName || user?.email || 'Tesorero',
          fundId: event.fundId,
          eventId: event.id,
          courseId: event.courseId || '',
          inventoryId: restockItem.id,
          createdAt: new Date().toISOString(),
          createdBy: user?.email || user?.displayName || 'Unknown User'
        });
      }

      setInventory(prev => prev.map(i => i.id === restockItem.id ? { ...i, ...updateData } : i));
      showAlert(`Se añadieron +${extraQty} ${restockItem.unit} a ${restockItem.name}.`);
      setRestockItem(null);
      setRestockQuantity('');
      setRestockCost('');
      setRestockRecordExpense(false);
    } catch (error) {
      console.error("Error al reabastecer:", error);
      showAlert("Hubo un error al reabastecer el inventario.");
    }
  };

  // Guardar inventario final (sobrantes post-evento)
  const handleSaveFinalClosure = async () => {
    setSavingClosure(true);
    try {
      const updates = [];
      for (const item of inventory) {
        const countVal = physicalCounts[item.id];
        const notesVal = finalNotesMap[item.id] || '';
        
        const countNum = countVal !== undefined && countVal !== '' && countVal !== null 
          ? parseFloat(countVal) 
          : null;

        const docRef = doc(db, 'eventInventory', item.id);
        const updatePayload = {
          finalCount: countNum,
          finalNotes: notesVal.trim(),
          closedAt: new Date().toISOString(),
          closedBy: user?.email || user?.displayName || 'Unknown'
        };

        updates.push(updateDoc(docRef, updatePayload));
      }

      await Promise.all(updates);
      await fetchInventory();
      showAlert("¡Conteo físico de sobrantes guardado exitosamente!");
    } catch (error) {
      console.error("Error al guardar conteo final:", error);
      showAlert("Hubo un error al guardar el conteo final de sobrantes.");
    } finally {
      setSavingClosure(false);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
  };

  if (loading) return <div>Cargando inventario...</div>;

  const totalCost = inventory.reduce((sum, i) => sum + (i.cost || 0), 0);
  const lowStockCount = inventory.filter(i => (i.currentStock || 0) <= 10 && (i.currentStock || 0) > 0).length;
  const outOfStockCount = inventory.filter(i => (i.currentStock || 0) <= 0).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Tarjetas de Estadísticas de Inventario */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: 'rgba(99,102,241,0.15)', padding: '0.75rem', borderRadius: '50%', color: 'var(--primary)' }}>
            <Package size={22} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.3rem' }}>{inventory.length}</h3>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Insumos Registrados</span>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: 'rgba(16,185,129,0.15)', padding: '0.75rem', borderRadius: '50%', color: 'var(--success)' }}>
            <DollarSign size={22} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.3rem' }}>{formatMoney(totalCost)}</h3>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Costo Total Insumos</span>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: 'rgba(245,158,11,0.15)', padding: '0.75rem', borderRadius: '50%', color: 'var(--warning)' }}>
            <AlertTriangle size={22} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.3rem', color: lowStockCount > 0 ? 'var(--warning)' : 'inherit' }}>{lowStockCount}</h3>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Bajo Stock (≤ 10)</span>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: 'rgba(239,68,68,0.15)', padding: '0.75rem', borderRadius: '50%', color: 'var(--danger)' }}>
            <AlertTriangle size={22} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.3rem', color: outOfStockCount > 0 ? 'var(--danger)' : 'inherit' }}>{outOfStockCount}</h3>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Agotados (0)</span>
          </div>
        </div>
      </div>

      {/* Formulario de Registro / Edición de Insumo */}
      <div className="glass-panel" style={{ padding: '1.75rem' }}>
        <h3 style={{ marginBottom: '1.25rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Package size={20} />
          {editingItemId ? 'Editar Insumo de Inventario' : 'Registrar Compra / Stock Inicial'}
        </h3>
        
        <form onSubmit={handleSaveItem}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Nombre del Insumo *</label>
              <input 
                type="text"
                required
                className="input-field"
                placeholder="Ej. Pan de Completo, Vienesas, Tomate..."
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Cantidad Comprada / Inicial *</label>
              <input 
                type="number"
                step="any"
                min="0"
                required
                className="input-field"
                placeholder="Ej. 100"
                value={initialQuantity}
                onChange={(e) => setInitialQuantity(e.target.value)}
              />
            </div>

            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Unidad de Medida</label>
              <select 
                className="input-field"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                {UNIT_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            {unit === 'otro' && (
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Especificar Unidad</label>
                <input 
                  type="text"
                  className="input-field"
                  placeholder="Ej. gramos, botellas, sobres..."
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value)}
                />
              </div>
            )}

            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Costo Total Compra ($)</label>
              <input 
                type="number"
                min="0"
                className="input-field"
                placeholder="Ej. 15000 (opcional)"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Notas / Proveedor (Opcional)</label>
              <input 
                type="text"
                className="input-field"
                placeholder="Ej. Panadería San José, Paquetes de 20 un..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {!editingItemId && cost && parseFloat(cost) > 0 && event.fundId && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                <input 
                  type="checkbox"
                  checked={recordExpense}
                  onChange={(e) => setRecordExpense(e.target.checked)}
                  style={{ accentColor: 'var(--primary)', width: '16px', height: '16px' }}
                />
                <span>Registrar este costo automáticamente como <strong>Gasto del Evento</strong> en la pestaña Gastos</span>
              </label>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="submit" className="btn btn-primary" style={{ padding: '0.65rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {editingItemId ? <><Edit2 size={16} /> Actualizar Insumo</> : <><Plus size={16} /> Agregar al Inventario</>}
            </button>
            {editingItemId && (
              <button type="button" className="btn btn-outline" onClick={resetForm} style={{ padding: '0.65rem 1.25rem' }}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Listado de Insumos y Stock Actual */}
      <div className="glass-panel" style={{ padding: '1.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--primary)' }}>Stock de Insumos en Vivo</h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Cada vez que vendas en el Punto de Venta (POS) un completo o producto vinculado, el stock se descontará automáticamente.
            </p>
          </div>
          <button 
            type="button" 
            onClick={fetchInventory} 
            className="btn btn-outline" 
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <RefreshCw size={14} /> Actualizar Stock
          </button>
        </div>

        {inventory.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
            <Package size={40} style={{ opacity: 0.4, marginBottom: '0.75rem' }} />
            <p style={{ margin: 0 }}>No hay insumos registrados en el inventario.</p>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem' }}>
              Agrega los insumos que compraste arriba (ej. Panes, Vienesas) para controlar su stock.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Insumo</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Comprado</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Consumido (POS)</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Stock Disponible</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Costo</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map(item => {
                  const purchased = item.totalPurchased || item.initialQuantity || 0;
                  const current = item.currentStock !== undefined ? item.currentStock : purchased;
                  const consumed = Math.max(0, purchased - current);

                  let stockBadgeColor = 'var(--success)';
                  let stockBadgeBg = 'rgba(16,185,129,0.15)';
                  let stockStatusText = 'Disponible';

                  if (current <= 0) {
                    stockBadgeColor = 'var(--danger)';
                    stockBadgeBg = 'rgba(239,68,68,0.15)';
                    stockStatusText = 'Agotado';
                  } else if (current <= 10) {
                    stockBadgeColor = 'var(--warning)';
                    stockBadgeBg = 'rgba(245,158,11,0.15)';
                    stockStatusText = 'Bajo Stock';
                  }

                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '0.85rem 0.5rem' }}>
                        <strong style={{ display: 'block', fontSize: '0.95rem' }}>{item.name}</strong>
                        {item.notes && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.notes}</span>}
                      </td>
                      <td style={{ padding: '0.85rem 0.5rem', textAlign: 'center' }}>
                        <span style={{ fontWeight: '500' }}>{purchased} {item.unit}</span>
                      </td>
                      <td style={{ padding: '0.85rem 0.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <span>{consumed} {item.unit}</span>
                      </td>
                      <td style={{ padding: '0.85rem 0.5rem', textAlign: 'center' }}>
                        <span style={{ 
                          display: 'inline-flex', 
                          alignItems: 'center', 
                          gap: '0.35rem', 
                          padding: '0.3rem 0.75rem', 
                          borderRadius: '20px', 
                          backgroundColor: stockBadgeBg, 
                          color: stockBadgeColor, 
                          fontWeight: 'bold',
                          fontSize: '0.85rem'
                        }}>
                          {current} {item.unit} ({stockStatusText})
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 0.5rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                        {item.cost ? formatMoney(item.cost) : '—'}
                      </td>
                      <td style={{ padding: '0.85rem 0.5rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setRestockItem(item);
                              setRestockQuantity('');
                              setRestockCost('');
                              setRestockRecordExpense(false);
                            }}
                            className="btn btn-outline"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', borderColor: 'var(--primary)', color: 'var(--primary)' }}
                            title="Comprar más unidades (Reabastecer)"
                          >
                            + Reabastecer
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditClick(item)}
                            className="btn btn-outline"
                            style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}
                            title="Editar insumo"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteItem(item)}
                            className="btn btn-outline"
                            style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(239,68,68,0.4)', color: 'var(--danger)' }}
                            title="Eliminar insumo"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Reabastecer */}
      {restockItem && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1100
        }}>
          <div className="glass-panel" style={{ width: '90%', maxWidth: '450px', padding: '2rem' }}>
            <h3 style={{ marginBottom: '0.5rem', color: 'var(--primary)' }}>
              Reabastecer: {restockItem.name}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Stock actual: <strong>{restockItem.currentStock || 0} {restockItem.unit}</strong>. Ingresa las unidades adicionales compradas.
            </p>

            <form onSubmit={handleRestockSubmit}>
              <div className="input-group" style={{ marginBottom: '1rem' }}>
                <label className="input-label">Cantidad Adicional a Sumar ({restockItem.unit}) *</label>
                <input 
                  type="number" 
                  step="any"
                  min="0.1"
                  required
                  className="input-field" 
                  placeholder="Ej. 30"
                  value={restockQuantity}
                  onChange={(e) => setRestockQuantity(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="input-group" style={{ marginBottom: '1rem' }}>
                <label className="input-label">Costo de la Compra Adicional ($)</label>
                <input 
                  type="number" 
                  min="0"
                  className="input-field" 
                  placeholder="Ej. 5000 (opcional)"
                  value={restockCost}
                  onChange={(e) => setRestockCost(e.target.value)}
                />
              </div>

              {restockCost && parseFloat(restockCost) > 0 && event.fundId && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', marginBottom: '1.5rem', color: 'var(--text-main)' }}>
                  <input 
                    type="checkbox"
                    checked={restockRecordExpense}
                    onChange={(e) => setRestockRecordExpense(e.target.checked)}
                    style={{ accentColor: 'var(--primary)', width: '16px', height: '16px' }}
                  />
                  <span>Registrar automáticamente como Gasto del Evento en Gastos</span>
                </label>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button 
                  type="button" 
                  className="btn btn-outline" 
                  onClick={() => setRestockItem(null)}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                >
                  Confirmar Reabastecimiento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cierre de Inventario / Conteo Físico de Sobrantes */}
      <div className="glass-panel" style={{ padding: '1.75rem', border: '1px solid rgba(99,102,241,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ClipboardList size={20} /> Cierre de Inventario y Conteo de Sobrantes
            </h3>
            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Al terminar el evento y cerrar caja, anota el conteo físico de lo que realmente sobró de cada cosa para calcular mermas y diferencias con respecto al stock teórico del sistema.
            </p>
          </div>
          <button 
            type="button"
            onClick={handleSaveFinalClosure}
            disabled={savingClosure || inventory.length === 0}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.25rem' }}
          >
            <Save size={16} /> {savingClosure ? 'Guardando...' : 'Guardar Conteo de Sobrantes'}
          </button>
        </div>

        {inventory.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No hay insumos para inventariar al cierre.</p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Insumo</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Comprado</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Vendido (POS)</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Stock Teórico Restante</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Sobrante Real Físico</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Diferencia / Merma</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Observaciones del Sobrante</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map(item => {
                  const purchased = item.totalPurchased || item.initialQuantity || 0;
                  const current = item.currentStock !== undefined ? item.currentStock : purchased;
                  const consumed = Math.max(0, purchased - current);
                  const theoreticalRemaining = current;

                  const currentPhysical = physicalCounts[item.id];
                  const hasPhysical = currentPhysical !== undefined && currentPhysical !== '' && currentPhysical !== null;
                  const physicalNum = hasPhysical ? parseFloat(currentPhysical) : null;
                  const diff = hasPhysical ? (physicalNum - theoreticalRemaining) : null;

                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <strong>{item.name}</strong>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        {purchased} {item.unit}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        {consumed} {item.unit}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                        <strong style={{ color: 'var(--primary)' }}>{theoreticalRemaining} {item.unit}</strong>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          <input 
                            type="number"
                            step="any"
                            min="0"
                            placeholder="0"
                            className="input-field"
                            style={{ width: '85px', textAlign: 'center', padding: '0.35rem 0.5rem', fontSize: '0.85rem' }}
                            value={physicalCounts[item.id] !== undefined ? physicalCounts[item.id] : ''}
                            onChange={(e) => {
                              setPhysicalCounts({
                                ...physicalCounts,
                                [item.id]: e.target.value
                              });
                            }}
                          />
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{item.unit}</span>
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                        {!hasPhysical ? (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>Sin registrar</span>
                        ) : diff === 0 ? (
                          <span style={{ color: 'var(--success)', fontWeight: 'bold', fontSize: '0.85rem' }}>
                            ✓ Exacto (0 mermas)
                          </span>
                        ) : diff < 0 ? (
                          <span style={{ color: 'var(--danger)', fontWeight: 'bold', fontSize: '0.85rem' }}>
                            Merma: {diff} {item.unit}
                          </span>
                        ) : (
                          <span style={{ color: '#38bdf8', fontWeight: 'bold', fontSize: '0.85rem' }}>
                            Extra: +{diff} {item.unit}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <input 
                          type="text"
                          placeholder="Ej. 2 panes quemados..."
                          className="input-field"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem' }}
                          value={finalNotesMap[item.id] || ''}
                          onChange={(e) => {
                            setFinalNotesMap({
                              ...finalNotesMap,
                              [item.id]: e.target.value
                            });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};

export default EventInventory;
