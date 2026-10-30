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

/**
 * Resuelve qué insumos de inventario debe descontar un subproducto / agregado seleccionado.
 * Prioridad de resolución:
 * 1. subproduct.inventoryId explícito en la selección
 * 2. Si el producto base tiene definido inventoryId para ese agregado u opción en item.subproducts
 * 3. Coincidencia automática por nombre en la lista de insumos de eventInventory
 * 4. Coincidencia con otro producto del menú (eventItems) que tenga su propia receta
 *
 * @param {Object} subproduct - Subproducto seleccionado en el carrito { baseName, name, selectedOption, inventoryId, quantity }
 * @param {Object} item - Ítem del menú al que pertenece
 * @param {Array} inventoryList - Lista de insumos de eventInventory
 * @param {Array} menuItemsList - Lista de productos de eventItems
 * @returns {Array<{ inventoryId: string, name: string, quantity: number, unit: string }>}
 */
export const resolveSubproductDeductions = (subproduct, item, inventoryList = [], menuItemsList = []) => {
  if (!subproduct) return [];

  const subQty = Math.max(0.001, parseFloat(subproduct.quantity) || 1);

  // 1. Si el subproducto ya tiene un inventoryId explícito
  if (subproduct.inventoryId) {
    const invItem = inventoryList.find(i => i.id === subproduct.inventoryId);
    return [{
      inventoryId: subproduct.inventoryId,
      name: invItem?.name || subproduct.name || 'Insumo agregado',
      quantity: subQty,
      unit: invItem?.unit || 'un.'
    }];
  }

  // 2. Buscar en la definición del producto original (en item.subproducts)
  if (item && item.subproducts && Array.isArray(item.subproducts)) {
    const spDef = item.subproducts.find(sp =>
      sp.name === subproduct.baseName ||
      sp.name === subproduct.name ||
      (subproduct.name && subproduct.name.startsWith(sp.name))
    );

    if (spDef) {
      // 2a. Si tiene opciones y se seleccionó una opción
      if (spDef.hasOptions && subproduct.selectedOption && Array.isArray(spDef.options)) {
        const optDef = spDef.options.find(opt => {
          const optName = typeof opt === 'string' ? opt : opt.name;
          return optName === subproduct.selectedOption;
        });

        if (optDef && typeof optDef === 'object' && optDef.inventoryId) {
          const invItem = inventoryList.find(i => i.id === optDef.inventoryId);
          return [{
            inventoryId: optDef.inventoryId,
            name: invItem?.name || optDef.name || subproduct.selectedOption,
            quantity: (parseFloat(optDef.quantity) || 1) * subQty,
            unit: invItem?.unit || 'un.'
          }];
        }
      }

      // 2b. Si el subproducto en sí tiene inventoryId (sin opciones)
      if (!spDef.hasOptions && spDef.inventoryId) {
        const invItem = inventoryList.find(i => i.id === spDef.inventoryId);
        return [{
          inventoryId: spDef.inventoryId,
          name: invItem?.name || spDef.name,
          quantity: (parseFloat(spDef.quantity) || 1) * subQty,
          unit: invItem?.unit || 'un.'
        }];
      }
    }
  }

  // 3. Coincidencia automática por nombre contra la lista de inventario (insumos)
  // Probamos nombres candidatos en orden de especificidad:
  const candidateNames = [
    subproduct.selectedOption,
    subproduct.baseName,
    subproduct.name
  ].filter(Boolean);

  for (const candidate of candidateNames) {
    const normCand = normalizeInventoryName(candidate);
    if (!normCand) continue;

    // Coincidencia exacta normalizada
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

  // Coincidencia parcial (ej. si el insumo es "Té" o "Té Verde" y el candidato es "Té Verde" o "Té")
  for (const candidate of candidateNames) {
    const normCand = normalizeInventoryName(candidate);
    if (!normCand) continue;

    const matchPartial = inventoryList.find(inv => {
      const normInv = normalizeInventoryName(inv.name);
      if (!normInv || normInv.length < 2) return false;
      return normCand.includes(normInv) || normInv.includes(normCand);
    });

    if (matchPartial) {
      return [{
        inventoryId: matchPartial.id,
        name: matchPartial.name,
        quantity: subQty,
        unit: matchPartial.unit || 'un.'
      }];
    }
  }

  // 4. Coincidencia con otro producto del menú que tenga receta/ingredientes
  for (const candidate of candidateNames) {
    const normCand = normalizeInventoryName(candidate);
    if (!normCand) continue;

    const matchedMenu = menuItemsList.find(mi =>
      mi.id !== item?.id && normalizeInventoryName(mi.name) === normCand
    );
    if (matchedMenu && matchedMenu.ingredients && matchedMenu.ingredients.length > 0) {
      return matchedMenu.ingredients.map(ing => ({
        inventoryId: ing.inventoryId,
        name: ing.name,
        quantity: (parseFloat(ing.quantity) || 1) * subQty,
        unit: ing.unit || 'un.'
      }));
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
    const itemQty = cartItem.quantity || 1;

    // 1. Insumos del producto base
    if (cartItem.ingredients && Array.isArray(cartItem.ingredients)) {
      cartItem.ingredients.forEach(ing => {
        if (ing.inventoryId) {
          const qty = (parseFloat(ing.quantity) || 0) * itemQty;
          deductions[ing.inventoryId] = (deductions[ing.inventoryId] || 0) + qty;
        }
      });
    }

    // 2. Insumos de los agregados
    if (cartItem.selectedSubproducts && Array.isArray(cartItem.selectedSubproducts)) {
      cartItem.selectedSubproducts.forEach(sp => {
        const spDeductions = resolveSubproductDeductions(sp, cartItem, inventoryList, menuItemsList);
        spDeductions.forEach(subDeduct => {
          if (subDeduct.inventoryId) {
            const qty = (parseFloat(subDeduct.quantity) || 1) * itemQty;
            deductions[subDeduct.inventoryId] = (deductions[subDeduct.inventoryId] || 0) + qty;
          }
        });
      });
    }
  });

  return deductions;
};

/**
 * Obtiene la información de stock para un subproducto u opción específica.
 * @returns {{ hasStockLimit: boolean, availableStock: number, unit: string, limitingName: string }}
 */
export const getSubproductStockInfo = (spDef, opt, parentItem, inventoryList = [], menuItemsList = []) => {
  const dummySp = {
    baseName: spDef?.name || '',
    name: typeof opt === 'string' ? opt : (opt?.name || spDef?.name || ''),
    selectedOption: opt ? (typeof opt === 'string' ? opt : opt.name) : null,
    inventoryId: typeof opt === 'object' ? opt?.inventoryId : (spDef?.inventoryId || null),
    quantity: typeof opt === 'object' ? (opt?.quantity || 1) : (spDef?.quantity || 1)
  };

  const deductions = resolveSubproductDeductions(dummySp, parentItem, inventoryList, menuItemsList);

  if (!deductions || deductions.length === 0) {
    return { hasStockLimit: false, availableStock: Infinity, unit: '', limitingName: '' };
  }

  let minStock = Infinity;
  let limitingUnit = 'un.';
  let limitingName = '';

  for (const d of deductions) {
    const inv = inventoryList.find(i => i.id === d.inventoryId);
    const stock = inv ? (inv.currentStock || 0) : 0;
    const avail = Math.floor(stock / (d.quantity || 1));
    if (avail < minStock) {
      minStock = avail;
      limitingUnit = inv?.unit || d.unit || 'un.';
      limitingName = inv?.name || d.name || '';
    }
  }

  return {
    hasStockLimit: minStock !== Infinity,
    availableStock: Math.max(0, minStock === Infinity ? 0 : minStock),
    unit: limitingUnit,
    limitingName
  };
};

