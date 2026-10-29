import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../../../firebase/config';
import { collection, getDocs, doc, setDoc, updateDoc, query, where, deleteDoc } from 'firebase/firestore';
import { Plus, Trash2, Edit2, Check, X, Package, Sparkles } from 'lucide-react';
import { useModal } from '../../../context/ModalContext';
import { useAuth } from '../../../context/AuthContext';
import { loadDemoEventData } from '../../../utils/eventTestUtils';

const EventMenu = ({ event }) => {
  const { user } = useAuth();
  const { showAlert, showConfirm } = useModal();
  const [items, setItems] = useState([]);
  const [inventoryList, setInventoryList] = useState([]);
  const [loading, setLoading] = useState(true);

  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [hasSubproducts, setHasSubproducts] = useState(false);
  const [subproducts, setSubproducts] = useState([{ name: '', price: '', hasOptions: false, options: [] }]);
  const [hasIngredients, setHasIngredients] = useState(false);
  const [ingredients, setIngredients] = useState([{ inventoryId: '', quantity: '1' }]);
  const [editingItemId, setEditingItemId] = useState(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'eventItems'), where('eventId', '==', event.id));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setItems(list);

      // Fetch inventory items
      const qInv = query(collection(db, 'eventInventory'), where('eventId', '==', event.id));
      const snapInv = await getDocs(qInv);
      const invList = snapInv.docs.map(d => ({ id: d.id, ...d.data() }));
      invList.sort((a, b) => a.name.localeCompare(b.name));
      setInventoryList(invList);
    } catch (error) {
      console.error("Error fetching items:", error);
    } finally {
      setLoading(false);
    }
  }, [event.id]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const resetForm = () => {
    setEditingItemId(null);
    setNewItemName('');
    setNewItemPrice('');
    setHasSubproducts(false);
    setSubproducts([{ name: '', price: '', hasOptions: false, options: [] }]);
    setHasIngredients(false);
    setIngredients([{ inventoryId: '', quantity: '1' }]);
  };

  const handleLoadDemoData = async () => {
    try {
      setLoading(true);
      await loadDemoEventData(event.id, event.courseId, user);
      await fetchItems();
      await showAlert("¡Datos de prueba cargados con éxito! Se han precargado insumos (Panes, Vienesas, Tomates, Paltas, Bebidas) y productos con sus recetas.");
    } catch (error) {
      console.error("Error al cargar datos de prueba:", error);
      await showAlert("Ocurrió un error al cargar los datos demo.");
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!newItemName || newItemPrice === '') return;

    try {
      const cleanIngredients = hasIngredients ? ingredients
        .filter(ing => ing.inventoryId && parseFloat(ing.quantity) > 0)
        .map(ing => {
          const invItem = inventoryList.find(i => i.id === ing.inventoryId);
          return {
            inventoryId: ing.inventoryId,
            name: invItem?.name || '',
            quantity: parseFloat(ing.quantity),
            unit: invItem?.unit || 'unidades'
          };
        }) : [];

      const item = {
        eventId: event.id,
        name: newItemName.trim(),
        price: parseFloat(newItemPrice),
        ingredients: cleanIngredients,
        subproducts: hasSubproducts ? subproducts.filter(sp => sp.name.trim() !== '').map(sp => {
          const cleanOptions = (sp.options || [])
            .map(opt => typeof opt === 'string' ? opt.trim() : (opt.name || '').trim())
            .filter(Boolean);
          return {
            name: sp.name.trim(),
            price: parseFloat(sp.price || 0),
            hasOptions: Boolean(sp.hasOptions && cleanOptions.length > 0),
            options: cleanOptions
          };
        }) : [],
        createdBy: user?.email || user?.displayName || 'Unknown User'
      };

      if (editingItemId) {
        await updateDoc(doc(db, 'eventItems', editingItemId), item);
        setItems(items.map(i => i.id === editingItemId ? { ...i, ...item } : i).sort((a, b) => a.name.localeCompare(b.name)));
        resetForm();
        showAlert("Producto actualizado exitosamente");
      } else {
        const id = 'item_' + Date.now();
        await setDoc(doc(db, 'eventItems', id), item);
        setItems([...items, { id, ...item }].sort((a, b) => a.name.localeCompare(b.name)));
        resetForm();
      }
    } catch (error) {
      console.error("Error adding/updating item:", error);
      showAlert("Hubo un error al guardar el ítem.");
    }
  };

  const handleEditClick = (item) => {
    setEditingItemId(item.id);
    setNewItemName(item.name);
    setNewItemPrice(item.price.toString());

    if (item.ingredients && item.ingredients.length > 0) {
      setHasIngredients(true);
      setIngredients(item.ingredients.map(ing => ({
        inventoryId: ing.inventoryId,
        quantity: (ing.quantity ?? 1).toString()
      })));
    } else {
      setHasIngredients(false);
      setIngredients([{ inventoryId: '', quantity: '1' }]);
    }

    if (item.subproducts && item.subproducts.length > 0) {
      setHasSubproducts(true);
      setSubproducts(item.subproducts.map(sp => ({
        name: sp.name || '',
        price: sp.price !== undefined ? sp.price.toString() : '',
        hasOptions: Boolean(sp.hasOptions || (sp.options && sp.options.length > 0)),
        options: (sp.options || []).map(opt => typeof opt === 'string' ? opt : opt.name || '')
      })));
    } else {
      setHasSubproducts(false);
      setSubproducts([{ name: '', price: '', hasOptions: false, options: [] }]);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteItem = async (id) => {
    if (!(await showConfirm('¿Eliminar este ítem del menú?'))) return;
    try {
      await deleteDoc(doc(db, 'eventItems', id));
      setItems(items.filter(i => i.id !== id));
    } catch (error) {
      console.error("Error deleting item:", error);
    }
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  const availableMenuItems = items.filter(i => i.id !== editingItemId);

  if (loading) return <div>Cargando menú...</div>;

  return (
    <div className="glass-panel" style={{ padding: '2rem' }}>
      <h3 style={{ marginBottom: '1.5rem', color: 'var(--primary)' }}>Menú / Inventario del Evento</h3>

      <form onSubmit={handleAddItem} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <div className="input-group" style={{ flex: 1, minWidth: '200px' }}>
          <label className="input-label">Nombre del Producto (Ej. Promo Completo, Bebida)</label>
          <input
            type="text"
            required
            className="input-field"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
          />
        </div>
        <div className="input-group" style={{ flex: 1, minWidth: '150px' }}>
          <label className="input-label">Precio de Venta ($)</label>
          <input
            type="number"
            min="0"
            required
            className="input-field"
            value={newItemPrice}
            onChange={(e) => setNewItemPrice(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button type="submit" className="btn btn-primary" style={{ padding: '0.65rem 1.5rem' }}>
            {editingItemId ? <><Edit2 size={18} /> Actualizar</> : <><Plus size={18} /> Agregar</>}
          </button>

          {editingItemId && (
            <button
              type="button"
              className="btn btn-outline"
              style={{ padding: '0.65rem 1.5rem' }}
              onClick={resetForm}
            >
              Cancelar
            </button>
          )}
        </div>

        <div style={{ width: '100%', marginTop: '0.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={hasSubproducts}
              onChange={(e) => setHasSubproducts(e.target.checked)}
            />
            Este producto tiene opciones o agregados (ej. Bebida, Palta, Salsa)
          </label>
        </div>

        {hasSubproducts && (
          <div style={{ width: '100%', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-md)', marginTop: '0.5rem' }}>
            <h4 style={{ marginBottom: '1rem' }}>Opciones / Agregados</h4>
            {subproducts.map((sp, idx) => (
              <div
                key={idx}
                style={{
                  padding: '1rem',
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '0.75rem'
                }}
              >
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div className="input-group" style={{ flex: '1 1 180px', marginBottom: 0 }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem', display: 'block' }}>Nombre del agregado</label>
                    <input
                      type="text"
                      placeholder="Ej. Bebida, Salsa, Palta"
                      className="input-field"
                      value={sp.name}
                      onChange={(e) => {
                        const newSp = [...subproducts];
                        newSp[idx].name = e.target.value;
                        setSubproducts(newSp);
                      }}
                    />
                  </div>
                  <div className="input-group" style={{ flex: '1 1 120px', marginBottom: 0 }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem', display: 'block' }}>Precio extra ($)</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0 si ya está incluida"
                      className="input-field"
                      value={sp.price}
                      onChange={(e) => {
                        const newSp = [...subproducts];
                        newSp[idx].price = e.target.value;
                        setSubproducts(newSp);
                      }}
                    />
                  </div>
                  {subproducts.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ padding: '0.65rem 0.75rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.4)', alignSelf: 'flex-end' }}
                      onClick={() => setSubproducts(subproducts.filter((_, i) => i !== idx))}
                      title="Eliminar agregado"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>

                {/* Switch / Checkbox para tipos o sub-opciones */}
                <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px dashed rgba(255,255,255,0.08)' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', color: sp.hasOptions ? 'var(--primary)' : 'var(--text-muted)' }}>
                    <input
                      type="checkbox"
                      checked={!!sp.hasOptions}
                      onChange={(e) => {
                        const newSp = [...subproducts];
                        newSp[idx].hasOptions = e.target.checked;
                        if (e.target.checked && (!newSp[idx].options || newSp[idx].options.length === 0)) {
                          newSp[idx].options = [];
                        }
                        setSubproducts(newSp);
                      }}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    ¿Tiene tipos o sabores a elegir? (ej. Coca Cola, Sprite, Fanta)
                  </label>
                </div>

                {/* Subpanel de tipos / opciones */}
                {sp.hasOptions && (
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    backgroundColor: 'rgba(0,0,0,0.2)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid rgba(99, 102, 241, 0.2)'
                  }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                      Tipos a elegir para "{sp.name || 'este agregado'}":
                    </div>

                    {/* Botones de productos del menú */}
                    {availableMenuItems.length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                          Seleccionar desde productos del menú del evento:
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                          {availableMenuItems.map(mi => {
                            const isIncluded = (sp.options || []).includes(mi.name);
                            return (
                              <button
                                key={mi.id}
                                type="button"
                                onClick={() => {
                                  const newSp = [...subproducts];
                                  const currentOpts = newSp[idx].options || [];
                                  if (isIncluded) {
                                    newSp[idx].options = currentOpts.filter(o => o !== mi.name);
                                  } else {
                                    newSp[idx].options = [...currentOpts, mi.name];
                                  }
                                  setSubproducts(newSp);
                                }}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.3rem',
                                  padding: '0.25rem 0.6rem',
                                  fontSize: '0.75rem',
                                  borderRadius: '20px',
                                  border: isIncluded ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.15)',
                                  backgroundColor: isIncluded ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255,255,255,0.05)',
                                  color: isIncluded ? 'white' : 'var(--text-muted)',
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                {isIncluded ? <Check size={12} color="var(--primary)" /> : <Plus size={12} />}
                                {mi.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Agregar opción manual */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <input
                        type="text"
                        placeholder="O escribe otro tipo (ej. Agua Mineral)..."
                        className="input-field"
                        style={{ fontSize: '0.8rem', padding: '0.4rem 0.6rem', flex: 1 }}
                        id={`custom-opt-${idx}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = e.target.value.trim();
                            if (val) {
                              const newSp = [...subproducts];
                              const currentOpts = newSp[idx].options || [];
                              if (!currentOpts.includes(val)) {
                                newSp[idx].options = [...currentOpts, val];
                                setSubproducts(newSp);
                              }
                              e.target.value = '';
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                        onClick={() => {
                          const input = document.getElementById(`custom-opt-${idx}`);
                          if (input && input.value.trim()) {
                            const val = input.value.trim();
                            const newSp = [...subproducts];
                            const currentOpts = newSp[idx].options || [];
                            if (!currentOpts.includes(val)) {
                              newSp[idx].options = [...currentOpts, val];
                              setSubproducts(newSp);
                            }
                            input.value = '';
                          }
                        }}
                      >
                        <Plus size={14} /> Añadir
                      </button>
                    </div>

                    {/* Lista de opciones configuradas */}
                    <div style={{ marginTop: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                        Opciones configuradas ({(sp.options || []).length}):
                      </span>
                      {(!sp.options || sp.options.length === 0) ? (
                        <span style={{ fontSize: '0.75rem', color: 'var(--warning)', fontStyle: 'italic' }}>
                          No has añadido opciones. Elige arriba o escribe una.
                        </span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                          {sp.options.map((opt, optIdx) => (
                            <span
                              key={optIdx}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                padding: '0.2rem 0.55rem',
                                fontSize: '0.75rem',
                                borderRadius: '12px',
                                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                                border: '1px solid rgba(99, 102, 241, 0.3)',
                                color: 'var(--text-main)'
                              }}
                            >
                              {opt}
                              <button
                                type="button"
                                onClick={() => {
                                  const newSp = [...subproducts];
                                  newSp[idx].options = (newSp[idx].options || []).filter((_, i) => i !== optIdx);
                                  setSubproducts(newSp);
                                }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--danger)',
                                  cursor: 'pointer',
                                  padding: 0,
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                                title="Quitar opción"
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn btn-outline"
              style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
              onClick={() => setSubproducts([...subproducts, { name: '', price: '', hasOptions: false, options: [] }])}
            >
              + Añadir otra opción
            </button>
          </div>
        )}

        {/* Sección de Receta / Descuento de Insumos del Inventario */}
        <div style={{ width: '100%', marginTop: '0.75rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: '500' }}>
            <input
              type="checkbox"
              checked={hasIngredients}
              onChange={(e) => setHasIngredients(e.target.checked)}
              style={{ accentColor: 'var(--primary)', width: '16px', height: '16px' }}
            />
            Descontar insumos del inventario al vender (ej. 1 Vienesa y 1 Pan por cada Completo)
          </label>
        </div>

        {hasIngredients && (
          <div style={{
            width: '100%',
            padding: '1rem',
            backgroundColor: 'rgba(99, 102, 241, 0.05)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            borderRadius: 'var(--radius-md)',
            marginTop: '0.5rem'
          }}>
            <h4 style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
              <Package size={16} /> Insumos a descontar por cada unidad vendida de este producto
            </h4>

            {inventoryList.length === 0 ? (
              <p style={{ color: 'var(--warning)', fontSize: '0.85rem', margin: 0 }}>
                No hay insumos creados en la pestaña <strong>Inventario</strong> aún. Ve primero a la pestaña <strong>Inventario</strong> para registrar "Pan de Completo", "Vienesas", etc.
              </p>
            ) : (
              <div>
                {ingredients.map((ing, idx) => {
                  const selectedInv = inventoryList.find(i => i.id === ing.inventoryId);
                  return (
                    <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
                      <div style={{ flex: '2 1 200px' }}>
                        <select
                          className="input-field"
                          value={ing.inventoryId}
                          onChange={(e) => {
                            const newIngs = [...ingredients];
                            newIngs[idx].inventoryId = e.target.value;
                            setIngredients(newIngs);
                          }}
                        >
                          <option value="">Selecciona insumo a descontar...</option>
                          {inventoryList.map(inv => (
                            <option key={inv.id} value={inv.id}>
                              {inv.name} (Stock: {inv.currentStock} {inv.unit})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={{ flex: '1 1 120px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <input
                          type="number"
                          step="any"
                          min="0.01"
                          placeholder="Cant."
                          className="input-field"
                          value={ing.quantity}
                          onChange={(e) => {
                            const newIngs = [...ingredients];
                            newIngs[idx].quantity = e.target.value;
                            setIngredients(newIngs);
                          }}
                        />
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', minWidth: '40px' }}>
                          {selectedInv ? selectedInv.unit : 'un.'}
                        </span>
                      </div>

                      {ingredients.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ padding: '0.5rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                          onClick={() => setIngredients(ingredients.filter((_, i) => i !== idx))}
                          title="Quitar insumo"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}

                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ marginTop: '0.5rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                  onClick={() => setIngredients([...ingredients, { inventoryId: '', quantity: '1' }])}
                >
                  <Plus size={14} /> Añadir otro insumo a la receta
                </button>
              </div>
            )}
          </div>
        )}
      </form>

      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-color)' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: event.isTestEvent ? '1rem' : 0 }}>
            No hay ítems en el menú todavía. Agrega algunos arriba.
          </p>
          {event.isTestEvent && (
            <button
              type="button"
              onClick={handleLoadDemoData}
              className="btn btn-warning"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 'bold' }}
            >
              <Sparkles size={16} /> Precargar Menú e Insumos Demo (Completos)
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
          {items.map(item => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ display: 'block', fontSize: '1.1rem' }}>{item.name}</strong>
                <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{formatMoney(item.price)}</span>

                {item.ingredients && item.ingredients.length > 0 && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--primary)', marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.35rem', backgroundColor: 'rgba(99,102,241,0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px', width: 'fit-content' }}>
                    <Package size={13} />
                    <span>Descuenta: {item.ingredients.map(ing => `${ing.quantity} ${ing.unit || 'un'} ${ing.name}`).join(' • ')}</span>
                  </div>
                )}

                {item.subproducts && item.subproducts.length > 0 && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Agregados: {item.subproducts.map(sp => {
                      const opts = sp.hasOptions && sp.options && sp.options.length > 0
                        ? ` (${sp.options.join(', ')})`
                        : '';
                      return `${sp.name}${opts} (+${formatMoney(sp.price)})`;
                    }).join(' • ')}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => handleEditClick(item)}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '0.5rem' }}
                  title="Editar producto"
                >
                  <Edit2 size={18} />
                </button>
                <button
                  onClick={() => handleDeleteItem(item.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem' }}
                  title="Eliminar producto"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default EventMenu;
