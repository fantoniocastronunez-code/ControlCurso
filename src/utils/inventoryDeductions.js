/**
 * Utilidades para la resolución y deducción de insumos del inventario,
 * tanto para recetas de productos base como para opciones y agregados (subproducts).
 */

/**
 * Normaliza cadenas para comparación flexible sin acentos, mayúsculas ni caracteres especiales.
 * Ej: "Té Verde" -> "teverde", "Té" -> "te", "Bebida en Lata!" -> "bebidaenlata"
 */
export const normalizeInventoryName = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
};

export const roundInventoryQuantity = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 10000) / 10000;
};

/**
 * Parsea una cantidad asegurando un número estrictamente positivo.
 * Si el campo viene vacío o indefinido usa `fallbackWhenEmpty` (por compatibilidad heredada);
 * si viene explícitamente <= 0 o inválido devuelve 0 para impedir restas/sumas negativas.
 */
export const parsePositiveQuantity = (value, fallbackWhenEmpty = 1) => {
  if (value === undefined || value === null || value === '') {
    return fallbackWhenEmpty;
  }
  const num = parseFloat(value);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return num;
};

/**
 * Normaliza un mapa `{ [inventoryId]: qty }` dejando solo cantidades finitas > 0.
 */
export const normalizeDeductionsMap = (rawDeductions = {}) => {
  const clean = {};
  if (!rawDeductions || typeof rawDeductions !== 'object') return clean;

  for (const [invId, rawQty] of Object.entries(rawDeductions)) {
    if (!invId) continue;
    const qty = roundInventoryQuantity(parseFloat(rawQty));
    if (Number.isFinite(qty) && qty > 0) {
      clean[invId] = qty;
    }
  }
  return clean;
};

/**
 * Aplica un delta numérico (+/-) sobre un stock o acumulado asegurando coerción numérica y piso 0.
 */
export const applyStockDelta = (currentValue, delta) => {
  const base = Number(currentValue);
  const diff = Number(delta);
  const safeBase = Number.isFinite(base) ? base : 0;
  const safeDiff = Number.isFinite(diff) ? diff : 0;
  return Math.max(0, roundInventoryQuantity(safeBase + safeDiff));
};

/**
 * Devuelve el stock numérico disponible de un insumo de eventInventory,
 * manteniendo consistencia entre currentStock y campos heredados (totalPurchased/initialQuantity).
 */
export const getInventoryItemStock = (inv) => {
  if (!inv || typeof inv !== 'object') return 0;
  if (inv.currentStock !== undefined && inv.currentStock !== null && inv.currentStock !== '') {
    const num = Number(inv.currentStock);
    return Number.isFinite(num) ? num : 0;
  }
  const fallback = Number(inv.totalPurchased ?? inv.initialQuantity ?? 0);
  return Number.isFinite(fallback) ? fallback : 0;
};

const findInventoryDeduction = (inventoryId, quantity, fallbackName, inventoryList = []) => {
  if (!inventoryId || inventoryId === '__none__') return null;
  const safeQty = parsePositiveQuantity(quantity, 0);
  if (!(safeQty > 0)) return [];
  const invItem = inventoryList.find(i => i.id === inventoryId);
  // Si el insumo ya no existe en el inventario del evento, no descontar ni marcar falsos "Agotado".
  if (!invItem) return [];
  return [{
    inventoryId: invItem.id,
    name: invItem.name || fallbackName || 'Insumo agregado',
    quantity: safeQty,
    unit: invItem.unit || 'un.'
  }];
};

/**
 * Resuelve qué insumos de inventario debe descontar un subproducto / agregado seleccionado.
 * Prioridad de resolución:
 * 1. subproduct.inventoryId explícito en la selección
 * 2. Si el producto base tiene definido inventoryId para ese agregado u opción en item.subproducts
 *    (si se definió explícitamente con inventoryId vacío '', se respeta "No descontar")
 * 3. Coincidencia automática exacta por nombre para opciones heredadas sin propiedad inventoryId
 * 4. Coincidencia exacta con otro producto del menú (eventItems) que tenga su propia receta
 *
 * @param {Object} subproduct - Subproducto seleccionado en el carrito { baseName, name, selectedOption, inventoryId, quantity }
 * @param {Object} item - Ítem del menú al que pertenece
 * @param {Array} inventoryList - Lista de insumos de eventInventory
 * @param {Array} menuItemsList - Lista de productos de eventItems
 * @returns {Array<{ inventoryId: string, name: string, quantity: number, unit: string }>}
 */
export const resolveSubproductDeductions = (subproduct, item, inventoryList = [], menuItemsList = []) => {
  if (!subproduct) return [];

  const subQty = parsePositiveQuantity(subproduct.quantity, 1);
  if (!(subQty > 0)) return [];

  // 1. Si el subproducto ya tiene un inventoryId explícito
  if (subproduct.inventoryId) {
    const resolved = findInventoryDeduction(subproduct.inventoryId, subQty, subproduct.name, inventoryList);
    if (resolved !== null) return resolved;
    return [];
  }

  // 2. Buscar en la definición del producto original (en item.subproducts)
  let hasExplicitNoDeduction = false;
  if (item && item.subproducts && Array.isArray(item.subproducts)) {
    const byIndex = Number.isInteger(subproduct.spIndex) ? item.subproducts[subproduct.spIndex] : null;
    const spDef = (byIndex && (!subproduct.baseName || byIndex.name === subproduct.baseName))
      ? byIndex
      : item.subproducts.find(sp =>
          sp && (
            (subproduct.baseName && sp.name === subproduct.baseName) ||
            sp.name === subproduct.name ||
            (subproduct.name && sp.name && subproduct.name.startsWith(`${sp.name} (`))
          )
        );

    if (spDef) {
      // 2a. Si tiene opciones y se seleccionó una opción
      if (spDef.hasOptions && subproduct.selectedOption && Array.isArray(spDef.options)) {
        const optDef = spDef.options.find(opt => {
          const optName = typeof opt === 'string' ? opt : opt?.name;
          return optName === subproduct.selectedOption;
        });

        if (optDef && typeof optDef === 'object') {
          if (optDef.inventoryId) {
            const optQty = parsePositiveQuantity(optDef.quantity, 1);
            const resolved = findInventoryDeduction(
              optDef.inventoryId,
              optQty * subQty,
              optDef.name || subproduct.selectedOption,
              inventoryList
            );
            return resolved || [];
          }
          if (Object.prototype.hasOwnProperty.call(optDef, 'inventoryId')) {
            // La opción fue configurada explícitamente sin descuento de inventario.
            return [];
          }
        }
      }

      // 2b. Si el subproducto en sí tiene inventoryId (sin opciones) o fue dejado en "No descontar"
      if (!spDef.hasOptions) {
        if (spDef.inventoryId) {
          const spQty = parsePositiveQuantity(spDef.quantity, 1);
          const resolved = findInventoryDeduction(
            spDef.inventoryId,
            spQty * subQty,
            spDef.name,
            inventoryList
          );
          return resolved || [];
        }
        if (Object.prototype.hasOwnProperty.call(spDef, 'inventoryId')) {
          hasExplicitNoDeduction = true;
        }
      }
    }
  }

  if (hasExplicitNoDeduction) {
    return [];
  }

  // 3. Coincidencia automática exacta por nombre contra la lista de inventario (solo opciones heredadas sin inventoryId)
  // Sin coincidencia parcial por subcadena para evitar falsos cruces (ej. "tomate" con "Té" o "Tomates").
  const candidateNames = [
    subproduct.selectedOption,
    subproduct.baseName,
    subproduct.name
  ].filter(Boolean);

  for (const candidate of candidateNames) {
    const normCand = normalizeInventoryName(candidate);
    if (!normCand) continue;

    const matchExact = inventoryList.find(inv => normalizeInventoryName(inv.name) === normCand);
    if (matchExact) {
      return [{
        inventoryId: matchExact.id,
        name: matchExact.name,
        quantity: subQty,
        unit: matchExact.unit || 'un.'
      }];
    }
  }

  // 4. Coincidencia exacta con otro producto del menú que tenga receta/ingredientes
  for (const candidate of candidateNames) {
    const normCand = normalizeInventoryName(candidate);
    if (!normCand) continue;

    const matchedMenu = menuItemsList.find(mi =>
      mi.id !== item?.id && normalizeInventoryName(mi.name) === normCand
    );
    if (matchedMenu && matchedMenu.ingredients && matchedMenu.ingredients.length > 0) {
      return matchedMenu.ingredients
        .filter(ing => ing?.inventoryId && inventoryList.some(i => i.id === ing.inventoryId))
        .map(ing => ({
          inventoryId: ing.inventoryId,
          name: ing.name,
          quantity: parsePositiveQuantity(ing.quantity, 0) * subQty,
          unit: ing.unit || 'un.'
        }))
        .filter(d => d.quantity > 0);
    }
  }

  return [];
};

/**
 * Calcula todas las deducciones de un carrito de compras (insumos base + agregados).
 * @returns {Record<string, number>} Mapa { [inventoryId]: totalCantidadADescontar }
 */
export const calculateTotalDeductions = (cartList = [], inventoryList = [], menuItemsList = []) => {
  const deductions = {};

  if (!cartList || !Array.isArray(cartList)) return deductions;

  cartList.forEach(cartItem => {
    const itemQty = parsePositiveQuantity(cartItem?.quantity, 1);
    if (!(itemQty > 0)) return;

    // 1. Insumos del producto base
    if (cartItem.ingredients && Array.isArray(cartItem.ingredients)) {
      cartItem.ingredients.forEach(ing => {
        if (ing?.inventoryId && inventoryList.some(inv => inv.id === ing.inventoryId)) {
          const qty = parsePositiveQuantity(ing.quantity, 0) * itemQty;
          if (qty > 0) {
            deductions[ing.inventoryId] = roundInventoryQuantity((deductions[ing.inventoryId] || 0) + qty);
          }
        }
      });
    }

    // 2. Insumos de los agregados
    if (cartItem.selectedSubproducts && Array.isArray(cartItem.selectedSubproducts)) {
      cartItem.selectedSubproducts.forEach(sp => {
        const spDeductions = resolveSubproductDeductions(sp, cartItem, inventoryList, menuItemsList);
        spDeductions.forEach(subDeduct => {
          if (subDeduct.inventoryId) {
            const qty = parsePositiveQuantity(subDeduct.quantity, 1) * itemQty;
            if (qty > 0) {
              deductions[subDeduct.inventoryId] = roundInventoryQuantity((deductions[subDeduct.inventoryId] || 0) + qty);
            }
          }
        });
      });
    }
  });

  return normalizeDeductionsMap(deductions);
};

/**
 * Obtiene la información de stock para un subproducto u opción específica.
 * @returns {{ hasStockLimit: boolean, availableStock: number, unit: string, limitingName: string }}
 */
export const getSubproductStockInfo = (spDef, opt, parentItem, inventoryList = [], menuItemsList = []) => {
  const isObjOpt = Boolean(opt && typeof opt === 'object');
  const effectiveParentItem = parentItem || (spDef ? { subproducts: [spDef] } : null);
  const dummySp = {
    baseName: spDef?.name || '',
    name: typeof opt === 'string' ? opt : (opt?.name || spDef?.name || ''),
    selectedOption: opt ? (typeof opt === 'string' ? opt : opt.name) : null,
    inventoryId: isObjOpt ? (opt.inventoryId || null) : (spDef?.inventoryId || null),
    quantity: isObjOpt ? parsePositiveQuantity(opt.quantity, 1) : parsePositiveQuantity(spDef?.quantity, 1)
  };

  const deductions = resolveSubproductDeductions(dummySp, effectiveParentItem, inventoryList, menuItemsList);

  if (!deductions || deductions.length === 0) {
    return { hasStockLimit: false, availableStock: Infinity, unit: '', limitingName: '' };
  }

  let minStock = Infinity;
  let limitingUnit = 'un.';
  let limitingName = '';

  for (const d of deductions) {
    const inv = inventoryList.find(i => i.id === d.inventoryId);
    if (!inv) continue;
    const qty = parseFloat(d.quantity);
    if (!(qty > 0)) continue;
    const stock = getInventoryItemStock(inv);
    const avail = Math.floor(stock / qty);
    if (avail < minStock) {
      minStock = avail;
      limitingUnit = inv.unit || d.unit || 'un.';
      limitingName = inv.name || d.name || '';
    }
  }

  return {
    hasStockLimit: minStock !== Infinity,
    availableStock: minStock === Infinity ? Infinity : Math.max(0, minStock),
    unit: limitingUnit,
    limitingName
  };
};

