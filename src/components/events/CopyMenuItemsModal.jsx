import React, { useState, useEffect, useRef, useMemo, useId } from 'react';
import { db } from '../../firebase/config';
import { collection, getDocs, doc, query, where, writeBatch } from 'firebase/firestore';
import { Copy, X, Search, Package, AlertTriangle, CheckCircle, ShoppingBag, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCourse } from '../../context/CourseContext';
import { formatEventDate } from '../../utils/eventPdfService';
import { normalizeInventoryName } from '../../utils/inventoryDeductions';
import {
  chunkArray,
  generateUniqueFirestoreId,
  buildInventoryNameMap,
  analyzeSelectedInventoryCompatibility,
  buildMissingInventoryPayload,
  prepareCopiedMenuItemPayload
} from '../../utils/menuCopyUtils';

const formatMoney = (amount) => {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
};

const summarizeSubproducts = (subproducts = []) => {
  if (!Array.isArray(subproducts) || subproducts.length === 0) return '';
  return subproducts
    .map(sp => {
      const opts = sp.hasOptions && Array.isArray(sp.options) && sp.options.length > 0
        ? ` (${sp.options.map(o => (typeof o === 'string' ? o : o.name)).filter(Boolean).join(', ')})`
        : '';
      const extraPrice = parseFloat(sp.price || 0) > 0 ? ` +${formatMoney(sp.price)}` : '';
      return `${sp.name}${opts}${extraPrice}`;
    })
    .join(' • ');
};

const summarizeIngredients = (ingredients = []) => {
  if (!Array.isArray(ingredients) || ingredients.length === 0) return '';
  return ingredients
    .map(ing => `${ing.quantity || 1} ${ing.unit || 'un.'} ${ing.name || 'Insumo'}`.trim())
    .join(' • ');
};

const CopyMenuItemsModal = ({
  isOpen,
  onClose,
  targetEvent,
  existingItems = [],
  onCopied,
  onNavigateToMenu
}) => {
  const { user } = useAuth();
  const { courses } = useCourse();

  const dialogRef = useRef(null);
  const submittingRef = useRef(false);
  const sourceInvLoadedRef = useRef(new Set());

  const headingId = useId();
  const sourceSelectId = useId();
  const searchInputId = useId();
  const legendId = useId();
  const copyInvCheckboxId = useId();

  const [loading, setLoading] = useState(false);
  const [loadingSourceInv, setLoadingSourceInv] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [sourceEvents, setSourceEvents] = useState([]);
  const [itemsByEventId, setItemsByEventId] = useState({});
  const [selectedSourceEventId, setSelectedSourceEventId] = useState('');
  const [sourceInventoryByEventId, setSourceInventoryByEventId] = useState({});
  const [targetItems, setTargetItems] = useState(existingItems);
  const [targetInventory, setTargetInventory] = useState([]);

  const [selectedItemIds, setSelectedItemIds] = useState(() => new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [copyMissingInventory, setCopyMissingInventory] = useState(false);

  // Sincronizar apertura/cierre con el <dialog> nativo (top-layer real incluso en POS Pantalla Completa)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.returnValue = '';
      dialog.close();
    }
  }, [isOpen]);

  // Fallback de light-dismiss para navegadores sin soporte nativo de `closedby="any"` (Safari)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;

    const isOutside = (e) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };

    let pressedOutside = false;
    const handlePointerDown = (e) => {
      pressedOutside = isOutside(e);
    };
    const handlePointerUp = (e) => {
      if (!submittingRef.current && pressedOutside && isOutside(e) && dialog.open) {
        dialog.close();
      }
      pressedOutside = false;
    };

    dialog.addEventListener('pointerdown', handlePointerDown);
    dialog.addEventListener('pointerup', handlePointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', handlePointerDown);
      dialog.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  // Cargar eventos disponibles, menús y estado actualizado del evento destino al abrir
  useEffect(() => {
    if (!isOpen || !targetEvent?.id) return;

    let cancelled = false;
    const loadModalData = async () => {
      setLoading(true);
      setErrorMessage('');
      setSearchTerm('');
      setCopyMissingInventory(false);
      setSelectedSourceEventId('');
      setSourceInventoryByEventId({});
      setSelectedItemIds(new Set());
      sourceInvLoadedRef.current = new Set();

      try {
        const courseNameById = new Map((courses || []).map(c => [c.id, c.name || c.title || '']));
        const accessibleCourseIds = Array.from(
          new Set([targetEvent.courseId, ...(courses || []).map(c => c.id)].filter(Boolean))
        );

        let allAccessibleEvents = [];
        if (accessibleCourseIds.length > 0) {
          const courseChunks = chunkArray(accessibleCourseIds, 30);
          const eventSnaps = await Promise.all(
            courseChunks.map(chunk =>
              getDocs(query(collection(db, 'events'), where('courseId', 'in', chunk)))
            )
          );
          eventSnaps.forEach(snap => {
            snap.docs.forEach(d => {
              allAccessibleEvents.push({
                id: d.id,
                ...d.data(),
                courseName: courseNameById.get(d.data().courseId) || ''
              });
            });
          });
        } else {
          const snap = await getDocs(collection(db, 'events'));
          allAccessibleEvents = snap.docs.map(d => ({
            id: d.id,
            ...d.data(),
            courseName: courseNameById.get(d.data().courseId) || ''
          }));
        }

        const otherEvents = allAccessibleEvents.filter(ev => ev.id !== targetEvent.id);

        // Orden preliminar: mismo curso primero y más recientes primero
        otherEvents.sort((a, b) => {
          const aSame = a.courseId === targetEvent.courseId ? 1 : 0;
          const bSame = b.courseId === targetEvent.courseId ? 1 : 0;
          if (aSame !== bSame) return bSame - aSame;
          return new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0);
        });

        // Consultar ítems del menú para los eventos candidatos (y estado fresco del evento destino)
        const candidateIds = otherEvents.slice(0, 60).map(e => e.id);
        const idChunks = chunkArray(candidateIds, 30);

        const [itemSnaps, freshTargetItemsSnap, freshTargetInvSnap] = await Promise.all([
          Promise.all(
            idChunks.map(chunk =>
              getDocs(query(collection(db, 'eventItems'), where('eventId', 'in', chunk)))
            )
          ),
          getDocs(query(collection(db, 'eventItems'), where('eventId', '==', targetEvent.id))),
          getDocs(query(collection(db, 'eventInventory'), where('eventId', '==', targetEvent.id)))
        ]);

        if (cancelled) return;

        const groupedItems = {};
        itemSnaps.forEach(snap => {
          snap.docs.forEach(d => {
            const data = { id: d.id, ...d.data() };
            if (!groupedItems[data.eventId]) groupedItems[data.eventId] = [];
            groupedItems[data.eventId].push(data);
          });
        });

        Object.values(groupedItems).forEach(list => {
          list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        });

        const freshTargetItems = freshTargetItemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const freshTargetInv = freshTargetInvSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Orden final: eventos con ítems primero, mismo curso primero, más recientes primero
        const sortedEvents = [...otherEvents].sort((a, b) => {
          const aHas = (groupedItems[a.id]?.length || 0) > 0 ? 1 : 0;
          const bHas = (groupedItems[b.id]?.length || 0) > 0 ? 1 : 0;
          if (aHas !== bHas) return bHas - aHas;
          const aSame = a.courseId === targetEvent.courseId ? 1 : 0;
          const bSame = b.courseId === targetEvent.courseId ? 1 : 0;
          if (aSame !== bSame) return bSame - aSame;
          return new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0);
        });

        const firstWithItems = sortedEvents.find(ev => (groupedItems[ev.id]?.length || 0) > 0);
        const initialSourceId = firstWithItems ? firstWithItems.id : '';
        const freshTargetNames = new Set(
          freshTargetItems
            .map(item => normalizeInventoryName(item?.name || ''))
            .filter(Boolean)
        );
        const initialSelected = new Set(
          (groupedItems[initialSourceId] || [])
            .filter(item => !freshTargetNames.has(normalizeInventoryName(item?.name || '')))
            .map(item => item.id)
        );

        setTargetItems(freshTargetItems);
        setTargetInventory(freshTargetInv);
        setItemsByEventId(groupedItems);
        setSourceEvents(sortedEvents);
        setSelectedSourceEventId(initialSourceId);
        setSelectedItemIds(initialSelected);
      } catch (err) {
        console.error('Error cargando eventos para copiar menú:', err);
        if (!cancelled) {
          setErrorMessage('No se pudieron cargar los menús de otros eventos. Intenta nuevamente.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadModalData();
    return () => {
      cancelled = true;
    };
  }, [isOpen, targetEvent?.id, targetEvent?.courseId, courses]);

  const targetNormalizedNames = useMemo(() => {
    return new Set(
      (targetItems || [])
        .map(item => normalizeInventoryName(item?.name || ''))
        .filter(Boolean)
    );
  }, [targetItems]);

  const sourceItems = useMemo(() => {
    if (!selectedSourceEventId) return [];
    return itemsByEventId[selectedSourceEventId] || [];
  }, [itemsByEventId, selectedSourceEventId]);

  const sourceInventory = useMemo(() => {
    if (!selectedSourceEventId) return [];
    return sourceInventoryByEventId[selectedSourceEventId] || [];
  }, [selectedSourceEventId, sourceInventoryByEventId]);

  const handleSelectSourceEvent = (nextEventId) => {
    setSelectedSourceEventId(nextEventId);
    setSearchTerm('');
    const nextItems = itemsByEventId[nextEventId] || [];
    const defaultSelected = new Set(
      nextItems
        .filter(item => !targetNormalizedNames.has(normalizeInventoryName(item?.name || '')))
        .map(item => item.id)
    );
    setSelectedItemIds(defaultSelected);
  };

  // Cargar inventario del evento origen seleccionado
  useEffect(() => {
    if (!isOpen || !selectedSourceEventId) return;
    if (sourceInvLoadedRef.current.has(selectedSourceEventId)) return;

    let cancelled = false;
    const loadSourceInventory = async () => {
      setLoadingSourceInv(true);
      try {
        const snap = await getDocs(
          query(collection(db, 'eventInventory'), where('eventId', '==', selectedSourceEventId))
        );
        if (cancelled) return;
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        sourceInvLoadedRef.current.add(selectedSourceEventId);
        setSourceInventoryByEventId(prev => ({ ...prev, [selectedSourceEventId]: list }));
      } catch (err) {
        console.warn('Error cargando inventario del evento origen:', err);
        if (!cancelled) {
          setSourceInventoryByEventId(prev => ({ ...prev, [selectedSourceEventId]: [] }));
        }
      } finally {
        if (!cancelled) setLoadingSourceInv(false);
      }
    };

    loadSourceInventory();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedSourceEventId]);

  const filteredSourceItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return sourceItems;
    return sourceItems.filter(item => {
      const nameMatch = (item.name || '').toLowerCase().includes(term);
      const spMatch = summarizeSubproducts(item.subproducts).toLowerCase().includes(term);
      return nameMatch || spMatch;
    });
  }, [sourceItems, searchTerm]);

  const selectedItems = useMemo(() => {
    return sourceItems.filter(item => selectedItemIds.has(item.id));
  }, [sourceItems, selectedItemIds]);

  const inventoryCompatibility = useMemo(() => {
    return analyzeSelectedInventoryCompatibility(selectedItems, sourceInventory, targetInventory);
  }, [selectedItems, sourceInventory, targetInventory]);

  const hasAnyExistingOverlap = useMemo(() => {
    return sourceItems.some(item => targetNormalizedNames.has(normalizeInventoryName(item?.name || '')));
  }, [sourceItems, targetNormalizedNames]);

  const selectedSourceEvent = useMemo(() => {
    return sourceEvents.find(ev => ev.id === selectedSourceEventId) || null;
  }, [sourceEvents, selectedSourceEventId]);

  const eventsWithItemsCount = useMemo(() => {
    return sourceEvents.filter(ev => (itemsByEventId[ev.id]?.length || 0) > 0).length;
  }, [sourceEvents, itemsByEventId]);

  const handleToggleItem = (itemId) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      filteredSourceItems.forEach(item => next.add(item.id));
      return next;
    });
  };

  const handleSelectOnlyNew = () => {
    setSelectedItemIds(
      new Set(
        filteredSourceItems
          .filter(item => !targetNormalizedNames.has(normalizeInventoryName(item?.name || '')))
          .map(item => item.id)
      )
    );
  };

  const handleClearSelection = () => {
    setSelectedItemIds(new Set());
  };

  const handleDialogClose = () => {
    if (dialogRef.current) {
      dialogRef.current.returnValue = '';
    }
    if (isOpen) {
      onClose();
    }
  };

  const handleRequestClose = () => {
    if (submitting) return;
    if (dialogRef.current?.open) {
      dialogRef.current.returnValue = '';
      dialogRef.current.close();
    } else {
      onClose();
    }
  };

  const handleCopySelected = async () => {
    if (!targetEvent?.id || selectedItems.length === 0 || submitting) return;

    setSubmitting(true);
    submittingRef.current = true;
    setErrorMessage('');

    try {
      const now = new Date().toISOString();
      const targetInvMap = buildInventoryNameMap(targetInventory);
      const writeOps = [];
      let createdInventoryCount = 0;

      if (copyMissingInventory && inventoryCompatibility.missingRefs.length > 0) {
        inventoryCompatibility.missingRefs.forEach((missingRef, idx) => {
          if (targetInvMap.has(missingRef.normName)) return;
          const invId = generateUniqueFirestoreId('inv', idx);
          const invPayload = buildMissingInventoryPayload(missingRef, { targetEvent, user, now });
          writeOps.push({
            ref: doc(db, 'eventInventory', invId),
            data: invPayload
          });
          targetInvMap.set(missingRef.normName, { id: invId, ...invPayload });
          createdInventoryCount += 1;
        });
      }

      selectedItems.forEach((srcItem, idx) => {
        const itemId = generateUniqueFirestoreId('item', idx);
        const itemPayload = prepareCopiedMenuItemPayload(srcItem, {
          targetEvent,
          sourceInventory,
          targetInventoryMap: targetInvMap,
          user,
          now
        });
        writeOps.push({
          ref: doc(db, 'eventItems', itemId),
          data: itemPayload
        });
      });

      const opChunks = chunkArray(writeOps, 400);
      for (const ops of opChunks) {
        const batch = writeBatch(db);
        ops.forEach(op => batch.set(op.ref, op.data));
        await batch.commit();
      }

      // Cerrar el <dialog> nativo de inmediato para liberar el top-layer antes de mostrar alertas
      if (dialogRef.current?.open) {
        dialogRef.current.returnValue = '';
        dialogRef.current.close();
      }
      onClose();

      if (onCopied) {
        await onCopied({
          copiedCount: selectedItems.length,
          createdInventoryCount,
          sourceEventName: selectedSourceEvent?.name || ''
        });
      }
    } catch (err) {
      console.error('Error al copiar ítems del menú:', err);
      setErrorMessage('Ocurrió un error al copiar los productos. Revisa tu conexión e intenta nuevamente.');
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  const showCoursePrefix = (courses || []).length > 1;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      className="app-modal-dialog"
      {...{ closedby: 'any' }}
      onCancel={(e) => {
        if (submitting) {
          e.preventDefault();
        }
      }}
      onClose={handleDialogClose}
    >
      {isOpen && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '90vh',
            width: '100%'
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '1.15rem 1.35rem',
              borderBottom: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-surface-elevated)',
              flexShrink: 0
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', minWidth: 0 }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  minWidth: '36px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(37, 99, 235, 0.15)',
                  border: '1px solid rgba(37, 99, 235, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--primary)'
                }}
              >
                <Copy size={18} aria-hidden="true" />
              </div>
              <div style={{ minWidth: 0 }}>
                <h2 id={headingId} style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)' }}>
                  Copiar Menú / Ítems de otro Evento
                </h2>
                <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Importa productos, precios, opciones y recetas hacia <strong>{targetEvent?.name}</strong>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleRequestClose}
              disabled={submitting}
              aria-label="Cerrar ventana"
              style={{
                background: 'transparent',
                border: '1px solid transparent',
                color: 'var(--text-muted)',
                cursor: submitting ? 'not-allowed' : 'pointer',
                padding: '0.4rem',
                borderRadius: 'var(--radius-sm)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '32px',
                minHeight: '32px'
              }}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {/* Body */}
          <div
            style={{
              padding: '1.25rem 1.35rem',
              overflowY: 'auto',
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem'
            }}
          >
            {errorMessage && (
              <div
                role="alert"
                style={{
                  padding: '0.75rem 0.9rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  color: '#fca5a5',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                <span>{errorMessage}</span>
              </div>
            )}

            {loading ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Buscando eventos y menús disponibles...
              </div>
            ) : eventsWithItemsCount === 0 ? (
              <div
                style={{
                  padding: '2rem 1.25rem',
                  textAlign: 'center',
                  borderRadius: 'var(--radius-md)',
                  border: '1px dashed var(--border-color)',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)'
                }}
              >
                <ShoppingBag size={36} aria-hidden="true" style={{ color: 'var(--text-muted)', opacity: 0.6, marginBottom: '0.65rem' }} />
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', color: 'var(--text-main)', fontWeight: '500' }}>
                  No hay otros eventos con productos en su menú todavía.
                </p>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Cuando crees productos en un evento, podrás copiarlos fácilmente en futuros eventos desde aquí.
                </p>
                {onNavigateToMenu && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: '1rem' }}
                    onClick={() => {
                      handleRequestClose();
                      onNavigateToMenu();
                    }}
                  >
                    Ir a Menú / Ítems <ArrowRight size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Selector de evento de origen */}
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label htmlFor={sourceSelectId} className="input-label">
                    Seleccionar evento de origen
                  </label>
                  <select
                    id={sourceSelectId}
                    autoFocus
                    className="input-field"
                    value={selectedSourceEventId}
                    onChange={(e) => handleSelectSourceEvent(e.target.value)}
                  >
                    {sourceEvents.map(ev => {
                      const count = itemsByEventId[ev.id]?.length || 0;
                      const courseTag = showCoursePrefix && ev.courseName ? ` [${ev.courseName}]` : '';
                      const testTag = ev.isTestEvent ? ' [Prueba]' : '';
                      const dateLabel = ev.date ? ` — ${formatEventDate(ev.date)}` : '';
                      return (
                        <option key={ev.id} value={ev.id} disabled={count === 0}>
                          {ev.name}{dateLabel}{courseTag}{testTag} ({count} {count === 1 ? 'ítem' : 'ítems'})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Buscador y acciones masivas */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.5rem'
                  }}
                >
                  <div style={{ position: 'relative', flex: '1 1 200px', minWidth: '180px' }}>
                    <label htmlFor={searchInputId} className="visually-hidden">
                      Buscar producto del menú origen
                    </label>
                    <Search
                      size={14}
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        left: '0.65rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-muted)',
                        pointerEvents: 'none'
                      }}
                    />
                    <input
                      id={searchInputId}
                      type="search"
                      className="input-field"
                      placeholder="Filtrar productos..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ width: '100%', padding: '0.4rem 0.65rem 0.4rem 2rem', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem' }}
                      onClick={handleSelectAllVisible}
                    >
                      Todos
                    </button>
                    {hasAnyExistingOverlap && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem' }}
                        onClick={handleSelectOnlyNew}
                      >
                        Solo nuevos
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem' }}
                      onClick={handleClearSelection}
                    >
                      Ninguno
                    </button>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>
                      <strong>{selectedItems.length}</strong> de {sourceItems.length}
                    </span>
                  </div>
                </div>

                {/* Lista de productos seleccionables (fieldset sin <ul>/<li> para accesibilidad) */}
                <fieldset
                  style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.65rem',
                    margin: 0,
                    maxHeight: '280px',
                    overflowY: 'auto',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)'
                  }}
                >
                  <legend id={legendId} className="visually-hidden">
                    Productos disponibles para copiar desde el evento seleccionado
                  </legend>

                  {filteredSourceItems.length === 0 ? (
                    <p style={{ margin: '1rem 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      No hay productos que coincidan con "{searchTerm}".
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      {filteredSourceItems.map(item => {
                        const isSelected = selectedItemIds.has(item.id);
                        const alreadyExists = targetNormalizedNames.has(normalizeInventoryName(item?.name || ''));
                        const spSummary = summarizeSubproducts(item.subproducts);
                        const ingSummary = summarizeIngredients(item.ingredients);
                        const checkboxId = `copy-item-${item.id}`;

                        return (
                          <label
                            key={item.id}
                            htmlFor={checkboxId}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '0.7rem',
                              padding: '0.65rem 0.75rem',
                              borderRadius: 'var(--radius-sm)',
                              border: isSelected
                                ? '1px solid rgba(37, 99, 235, 0.55)'
                                : '1px solid rgba(255, 255, 255, 0.06)',
                              backgroundColor: isSelected
                                ? 'rgba(37, 99, 235, 0.12)'
                                : 'rgba(255, 255, 255, 0.02)',
                              cursor: 'pointer',
                              transition: 'background-color 0.15s ease, border-color 0.15s ease'
                            }}
                          >
                            <input
                              id={checkboxId}
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleItem(item.id)}
                              style={{
                                marginTop: '0.2rem',
                                width: '17px',
                                height: '17px',
                                accentColor: 'var(--primary)',
                                flexShrink: 0,
                                cursor: 'pointer'
                              }}
                            />

                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  gap: '0.5rem',
                                  flexWrap: 'wrap'
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                  <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>
                                    {item.name}
                                  </strong>
                                  {alreadyExists && (
                                    <span
                                      style={{
                                        fontSize: '0.7rem',
                                        padding: '0.1rem 0.45rem',
                                        borderRadius: '4px',
                                        backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                        border: '1px solid rgba(245, 158, 11, 0.35)',
                                        color: '#fcd34d',
                                        fontWeight: '600'
                                      }}
                                    >
                                      Ya existe en este menú
                                    </span>
                                  )}
                                </div>
                                <strong style={{ fontSize: '0.9rem', color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                                  {formatMoney(item.price)}
                                </strong>
                              </div>

                              {spSummary && (
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                  Opciones: {spSummary}
                                </div>
                              )}
                              {ingSummary && (
                                <div
                                  style={{
                                    fontSize: '0.76rem',
                                    color: '#93c5fd',
                                    marginTop: '0.2rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.3rem'
                                  }}
                                >
                                  <Package size={12} aria-hidden="true" style={{ flexShrink: 0 }} />
                                  <span>Receta: {ingSummary}</span>
                                </div>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </fieldset>

                {/* Compatibilidad de insumos del inventario */}
                {!loadingSourceInv &&
                  selectedItems.length > 0 &&
                  (inventoryCompatibility.matchedNames.length > 0 || inventoryCompatibility.missingRefs.length > 0) && (
                    <div
                      style={{
                        padding: '0.85rem 1rem',
                        borderRadius: 'var(--radius-md)',
                        border: inventoryCompatibility.missingRefs.length > 0
                          ? '1px solid rgba(245, 158, 11, 0.35)'
                          : '1px solid rgba(16, 185, 129, 0.3)',
                        backgroundColor: inventoryCompatibility.missingRefs.length > 0
                          ? 'rgba(245, 158, 11, 0.08)'
                          : 'rgba(16, 185, 129, 0.08)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        fontSize: '0.82rem'
                      }}
                    >
                      {inventoryCompatibility.matchedNames.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', color: '#6ee7b7' }}>
                          <CheckCircle size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                          <span>
                            Insumos encontrados en este evento (se vincularán automáticamente):{' '}
                            <strong>{inventoryCompatibility.matchedNames.join(', ')}</strong>
                          </span>
                        </div>
                      )}

                      {inventoryCompatibility.missingRefs.length > 0 && (
                        <>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', color: '#fcd34d' }}>
                            <Package size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                            <span>
                              Insumos en las recetas que aún no existen en este evento:{' '}
                              <strong>{inventoryCompatibility.missingRefs.map(r => r.name).join(', ')}</strong>
                            </span>
                          </div>

                          <label
                            htmlFor={copyInvCheckboxId}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '0.55rem',
                              cursor: 'pointer',
                              color: 'var(--text-main)',
                              marginTop: '0.15rem'
                            }}
                          >
                            <input
                              id={copyInvCheckboxId}
                              type="checkbox"
                              checked={copyMissingInventory}
                              onChange={(e) => setCopyMissingInventory(e.target.checked)}
                              style={{
                                marginTop: '0.15rem',
                                width: '16px',
                                height: '16px',
                                accentColor: 'var(--warning)',
                                flexShrink: 0
                              }}
                            />
                            <span>
                              <strong>Crear estos insumos faltantes en Inventario (stock inicial 0)</strong>
                              <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                {copyMissingInventory
                                  ? 'Las recetas quedarán vinculadas; recuerda cargar su stock inicial en Inventario antes de vender.'
                                  : 'Si lo dejas desmarcado, los productos se copiarán sin bloquear ventas por stock en 0.'}
                              </span>
                            </span>
                          </label>
                        </>
                      )}
                    </div>
                  )}
              </>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.95rem 1.35rem',
              borderTop: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-surface-elevated)',
              flexShrink: 0
            }}
          >
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleRequestClose}
              disabled={submitting}
            >
              Cancelar
            </button>
            {eventsWithItemsCount > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading || submitting || selectedItems.length === 0}
                onClick={handleCopySelected}
              >
                <Copy size={16} aria-hidden="true" />
                {submitting
                  ? 'Copiando...'
                  : `Copiar ${selectedItems.length} ${selectedItems.length === 1 ? 'ítem' : 'ítems'}`}
              </button>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
};

export default CopyMenuItemsModal;
