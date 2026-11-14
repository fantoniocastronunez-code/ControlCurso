import { normalizeInventoryName } from './inventoryDeductions.js';

/**
 * Divide un arreglo en bloques de tamaño fijo (ej. límite de 30 elementos en cláusulas `in` de Firestore).
 */
export const chunkArray = (items = [], size = 30) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

/**
 * Genera un ID único para documentos creados en lotes sin riesgo de colisiones en el mismo milisegundo.
 */
export const generateUniqueFirestoreId = (prefix = 'doc', index = 0) => {
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now()}_${index}_${rand}`;
};

/**
 * Construye un mapa indexado por nombre normalizado para los insumos de inventario de un evento.
 */
export const buildInventoryNameMap = (inventoryList = []) => {
  const map = new Map();
  if (!Array.isArray(inventoryList)) return map;
  for (const inv of inventoryList) {
    const norm = normalizeInventoryName(inv?.name || '');
    if (norm && !map.has(norm)) {
      map.set(norm, inv);
    }
  }
  return map;
};

const resolveSourceInventoryRef = (inventoryId, fallbackName, fallbackUnit, sourceInventory = []) => {
  const srcInv = inventoryId ? sourceInventory.find(i => i.id === inventoryId) : null;
  const name = (srcInv?.name || fallbackName || '').trim();
  const unit = (srcInv?.unit || fallbackUnit || 'unidades').trim() || 'unidades';
  const normName = normalizeInventoryName(name);
  return { name, unit, normName };
};

/**
 * Recolecta todos los insumos únicos referenciados en la receta base y en los agregados de un producto.
 */
export const collectItemInventoryRefs = (item, sourceInventory = []) => {
  const refsMap = new Map();
  if (!item) return [];

  const addRef = (ref) => {
    if (ref.normName && !refsMap.has(ref.normName)) {
      refsMap.set(ref.normName, ref);
    }
  };

  if (Array.isArray(item.ingredients)) {
    for (const ing of item.ingredients) {
      if (!ing) continue;
      if (!ing.inventoryId && !ing.name) continue;
      addRef(resolveSourceInventoryRef(ing.inventoryId, ing.name, ing.unit, sourceInventory));
    }
  }

  if (Array.isArray(item.subproducts)) {
    for (const sp of item.subproducts) {
      if (!sp) continue;
      if (!sp.hasOptions && sp.inventoryId) {
        addRef(resolveSourceInventoryRef(sp.inventoryId, sp.name, 'unidades', sourceInventory));
      }
      if (sp.hasOptions && Array.isArray(sp.options)) {
        for (const opt of sp.options) {
          if (opt && typeof opt === 'object' && opt.inventoryId) {
            addRef(resolveSourceInventoryRef(opt.inventoryId, opt.name, 'unidades', sourceInventory));
          }
        }
      }
    }
  }

  return Array.from(refsMap.values());
};

/**
 * Analiza qué insumos usados por los productos seleccionados ya existen en el inventario destino
 * y cuáles faltan por crear.
 */
export const analyzeSelectedInventoryCompatibility = (
  selectedItems = [],
  sourceInventory = [],
  targetInventory = []
) => {
  const targetMap = buildInventoryNameMap(targetInventory);
  const matchedSet = new Map();
  const missingMap = new Map();

  for (const item of selectedItems) {
    const refs = collectItemInventoryRefs(item, sourceInventory);
    for (const ref of refs) {
      const targetMatch = targetMap.get(ref.normName);
      if (targetMatch) {
        if (!matchedSet.has(ref.normName)) {
          matchedSet.set(ref.normName, targetMatch.name || ref.name);
        }
      } else if (!missingMap.has(ref.normName)) {
        missingMap.set(ref.normName, ref);
      }
    }
  }

  return {
    matchedNames: Array.from(matchedSet.values()),
    missingRefs: Array.from(missingMap.values())
  };
};

/**
 * Construye el payload de un insumo faltante para crearlo en el inventario del evento destino con stock 0.
 */
export const buildMissingInventoryPayload = (missingRef, { targetEvent, user, now }) => {
  const timestamp = now || new Date().toISOString();
  const createdBy = user?.email || user?.displayName || 'Unknown User';
  return {
    eventId: targetEvent.id,
    courseId: targetEvent.courseId || '',
    name: missingRef.name,
    unit: missingRef.unit || 'unidades',
    initialQuantity: 0,
    totalPurchased: 0,
    currentStock: 0,
    cost: 0,
    notes: 'Insumo copiado desde menú de otro evento (ingresar stock)',
    createdAt: timestamp,
    createdBy
  };
};

/**
 * Prepara el documento de un producto copiado para `eventItems`, reasignando los `inventoryId`
 * al inventario del evento destino para evitar falsos "Agotados" o descuentos sobre otro evento.
 */
export const prepareCopiedMenuItemPayload = (
  sourceItem,
  { targetEvent, sourceInventory = [], targetInventoryMap, user, now }
) => {
  const timestamp = now || new Date().toISOString();
  const createdBy = user?.email || user?.displayName || 'Unknown User';
  const invMap = targetInventoryMap instanceof Map ? targetInventoryMap : buildInventoryNameMap(targetInventoryMap || []);

  const remappedIngredients = Array.isArray(sourceItem?.ingredients)
    ? sourceItem.ingredients
        .map((ing) => {
          if (!ing) return null;
          const ref = resolveSourceInventoryRef(ing.inventoryId, ing.name, ing.unit, sourceInventory);
          if (!ref.normName) return null;
          const targetInv = invMap.get(ref.normName);
          if (!targetInv) return null;
          const qty = parseFloat(ing.quantity);
          return {
            inventoryId: targetInv.id,
            name: targetInv.name || ref.name,
            quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
            unit: targetInv.unit || ref.unit || 'unidades'
          };
        })
        .filter(Boolean)
    : [];

  const remappedSubproducts = Array.isArray(sourceItem?.subproducts)
    ? sourceItem.subproducts
        .filter(sp => sp && (sp.name || '').trim() !== '')
        .map((sp) => {
          const rawOptions = Array.isArray(sp.options) ? sp.options : [];
          const cleanOptions = rawOptions
            .map((opt) => {
              if (typeof opt === 'string') {
                const optTrimmed = opt.trim();
                if (!optTrimmed) return null;
                const matchedInv = invMap.get(normalizeInventoryName(optTrimmed));
                if (matchedInv) {
                  return { name: optTrimmed, inventoryId: matchedInv.id, quantity: 1 };
                }
                return optTrimmed;
              }
              if (!opt || typeof opt !== 'object') return null;
              const optName = (opt.name || '').trim();
              if (!optName) return null;
              const ref = resolveSourceInventoryRef(opt.inventoryId, optName, 'unidades', sourceInventory);
              const matchedInv = ref.normName ? invMap.get(ref.normName) : null;
              const qty = parseFloat(opt.quantity);
              return {
                name: optName,
                inventoryId: matchedInv ? matchedInv.id : '',
                quantity: Number.isFinite(qty) && qty > 0 ? qty : 1
              };
            })
            .filter(Boolean);

          const hasOpts = Boolean(sp.hasOptions && cleanOptions.length > 0);
          let spInvId = '';
          if (!hasOpts) {
            const ref = resolveSourceInventoryRef(sp.inventoryId, sp.name, 'unidades', sourceInventory);
            const matchedInv = ref.normName ? invMap.get(ref.normName) : null;
            if (matchedInv) {
              spInvId = matchedInv.id;
            }
          }

          const spPrice = parseFloat(sp.price || 0);
          const spQty = parseFloat(sp.quantity);
          return {
            name: (sp.name || '').trim(),
            price: Number.isFinite(spPrice) ? spPrice : 0,
            hasOptions: hasOpts,
            inventoryId: spInvId,
            quantity: !hasOpts && Number.isFinite(spQty) && spQty > 0 ? spQty : 1,
            options: cleanOptions
          };
        })
    : [];

  const parsedPrice = parseFloat(sourceItem?.price);

  return {
    eventId: targetEvent.id,
    courseId: targetEvent.courseId || '',
    name: (sourceItem?.name || '').trim(),
    price: Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0,
    ingredients: remappedIngredients,
    subproducts: remappedSubproducts,
    createdAt: timestamp,
    createdBy
  };
};

/**
 * Convierte un producto existente del menú al estado de formulario de `EventMenu` para edición o duplicación.
 */
export const buildMenuFormStateFromItem = (item, { asCopy = false } = {}) => {
  const baseName = (item?.name || '').trim();
  const name = asCopy ? (baseName ? `${baseName} (Copia)` : '') : baseName;
  const price = item?.price !== undefined && item?.price !== null ? item.price.toString() : '';

  const hasIngredients = Boolean(Array.isArray(item?.ingredients) && item.ingredients.length > 0);
  const ingredients = hasIngredients
    ? item.ingredients.map(ing => ({
        inventoryId: ing.inventoryId || '',
        quantity: (ing.quantity ?? 1).toString()
      }))
    : [{ inventoryId: '', quantity: '1' }];

  const hasSubproducts = Boolean(Array.isArray(item?.subproducts) && item.subproducts.length > 0);
  const subproducts = hasSubproducts
    ? item.subproducts.map(sp => ({
        name: sp.name || '',
        price: sp.price !== undefined && sp.price !== null ? sp.price.toString() : '',
        hasOptions: Boolean(sp.hasOptions || (sp.options && sp.options.length > 0)),
        inventoryId: sp.inventoryId || '',
        quantity: sp.quantity !== undefined && sp.quantity !== null ? sp.quantity.toString() : '1',
        options: (sp.options || []).map(opt => {
          if (typeof opt === 'string') {
            return { name: opt, inventoryId: '', quantity: 1 };
          }
          return {
            name: opt?.name || '',
            inventoryId: opt?.inventoryId || '',
            quantity: opt?.quantity || 1
          };
        })
      }))
    : [{ name: '', price: '', hasOptions: false, inventoryId: '', quantity: '1', options: [] }];

  return {
    name,
    price,
    hasIngredients,
    ingredients,
    hasSubproducts,
    subproducts
  };
};
