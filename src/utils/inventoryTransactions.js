import { doc, runTransaction } from 'firebase/firestore';
import {
  applyStockDelta,
  calculateTotalDeductions,
  getInventoryItemStock,
  normalizeDeductionsMap,
  roundInventoryQuantity
} from './inventoryDeductions';

/**
 * Descuenta insumos en Firestore dentro de una transacción atómica leyendo el `currentStock` real
 * en el servidor al momento de confirmar la venta (evita sobrescrituras con caché local obsoleto).
 *
 * @returns {Promise<Record<string, number>>} Mapa `{ [inventoryId]: newStock }` actualizado.
 */
export const applyInventoryDeductionsTransaction = async (db, rawDeductions, timestamp) => {
  const deductions = normalizeDeductionsMap(rawDeductions);
  const entries = Object.entries(deductions);
  if (entries.length === 0) return {};

  const updatedAt = timestamp || new Date().toISOString();

  return runTransaction(db, async (transaction) => {
    const invRefs = entries.map(([invId]) => doc(db, 'eventInventory', invId));
    const invSnaps = await Promise.all(invRefs.map(ref => transaction.get(ref)));

    const updatedStocks = {};
    invSnaps.forEach((invSnap, index) => {
      if (!invSnap.exists()) return;
      const [invId, qtyToDeduct] = entries[index];
      const liveStock = getInventoryItemStock(invSnap.data());
      const newStock = applyStockDelta(liveStock, -qtyToDeduct);

      transaction.update(invSnap.ref, {
        currentStock: newStock,
        updatedAt
      });
      updatedStocks[invId] = newStock;
    });

    return updatedStocks;
  });
};

/**
 * Anula una venta y repone su inventario atómicamente en Firestore.
 * Verifica `status !== 'cancelled'` dentro de la transacción para impedir reposiciones duplicadas.
 */
export const cancelSaleAndRestoreInventoryTransaction = async (
  db,
  {
    saleRef,
    saleUpdateData = {},
    inventoryList = [],
    menuItems = [],
    timestamp
  }
) => {
  const updatedAt = timestamp || new Date().toISOString();

  return runTransaction(db, async (transaction) => {
    const saleSnap = await transaction.get(saleRef);
    if (!saleSnap.exists()) {
      return { notFound: true, alreadyCancelled: false, updatedStocks: {}, deductionsRestored: {} };
    }

    const liveSale = saleSnap.data();
    if (liveSale.status === 'cancelled') {
      return { notFound: false, alreadyCancelled: true, updatedStocks: {}, deductionsRestored: {} };
    }

    let rawDeductions = liveSale.inventoryDeductions || {};
    if (Object.keys(rawDeductions).length === 0 && Array.isArray(liveSale.items)) {
      rawDeductions = calculateTotalDeductions(liveSale.items, inventoryList, menuItems);
    }

    const deductionsToRestore = normalizeDeductionsMap(rawDeductions);
    const entries = Object.entries(deductionsToRestore);
    const invRefs = entries.map(([invId]) => doc(db, 'eventInventory', invId));
    const invSnaps = await Promise.all(invRefs.map(ref => transaction.get(ref)));

    transaction.update(saleRef, {
      ...saleUpdateData,
      status: 'cancelled'
    });

    const updatedStocks = {};
    invSnaps.forEach((invSnap, index) => {
      if (!invSnap.exists()) return;
      const [invId, qtyToRestore] = entries[index];
      const liveStock = getInventoryItemStock(invSnap.data());
      const restoredStock = applyStockDelta(liveStock, qtyToRestore);

      transaction.update(invSnap.ref, {
        currentStock: restoredStock,
        updatedAt
      });
      updatedStocks[invId] = restoredStock;
    });

    return {
      notFound: false,
      alreadyCancelled: false,
      updatedStocks,
      deductionsRestored: deductionsToRestore
    };
  });
};

/**
 * Edita un insumo de inventario ajustando `initialQuantity`, `totalPurchased` y `currentStock`
 * de forma atómica respecto a ventas concurrentes en POS.
 */
export const adjustInventoryInitialTransaction = async (
  db,
  { itemId, newInitialQuantity, updateFields = {}, timestamp }
) => {
  const invRef = doc(db, 'eventInventory', itemId);
  const updatedAt = timestamp || new Date().toISOString();

  return runTransaction(db, async (transaction) => {
    const invSnap = await transaction.get(invRef);
    if (!invSnap.exists()) {
      throw new Error('El insumo ya no existe en el inventario.');
    }

    const liveItem = invSnap.data();
    const prevInitial = Number(liveItem.initialQuantity ?? 0);
    const safePrevInitial = Number.isFinite(prevInitial) ? prevInitial : 0;
    const qtyDiff = roundInventoryQuantity(newInitialQuantity - safePrevInitial);

    const liveStock = getInventoryItemStock(liveItem);
    const newStock = applyStockDelta(liveStock, qtyDiff);

    const liveTotalPurchasedRaw = Number(liveItem.totalPurchased ?? liveItem.initialQuantity ?? 0);
    const safeTotalPurchased = Number.isFinite(liveTotalPurchasedRaw) ? liveTotalPurchasedRaw : 0;
    const newTotalPurchased = applyStockDelta(safeTotalPurchased, qtyDiff);

    const updateData = {
      ...updateFields,
      initialQuantity: newInitialQuantity,
      totalPurchased: newTotalPurchased,
      currentStock: newStock,
      updatedAt
    };

    transaction.update(invRef, updateData);
    return { ...liveItem, ...updateData };
  });
};

/**
 * Registra reposición de stock en Firestore de forma atómica y numérica.
 */
export const restockInventoryTransaction = async (db, { itemId, extraQty, extraCost = 0, timestamp }) => {
  const safeExtra = roundInventoryQuantity(extraQty);
  if (!(safeExtra > 0)) {
    throw new Error('La cantidad de reposición debe ser mayor a 0.');
  }

  const parsedCost = Number(extraCost);
  const safeExtraCost = Number.isFinite(parsedCost) && parsedCost > 0 ? parsedCost : 0;

  const invRef = doc(db, 'eventInventory', itemId);
  const updatedAt = timestamp || new Date().toISOString();

  return runTransaction(db, async (transaction) => {
    const invSnap = await transaction.get(invRef);
    if (!invSnap.exists()) {
      throw new Error('El insumo ya no existe en el inventario.');
    }

    const liveItem = invSnap.data();
    const liveTotalPurchasedRaw = Number(liveItem.totalPurchased ?? liveItem.initialQuantity ?? 0);
    const safeTotalPurchased = Number.isFinite(liveTotalPurchasedRaw) ? liveTotalPurchasedRaw : 0;
    const newTotalPurchased = applyStockDelta(safeTotalPurchased, safeExtra);

    const liveStock = getInventoryItemStock(liveItem);
    const newCurrentStock = applyStockDelta(liveStock, safeExtra);

    const liveCostRaw = Number(liveItem.cost ?? 0);
    const newTotalCost = roundInventoryQuantity((Number.isFinite(liveCostRaw) ? liveCostRaw : 0) + safeExtraCost);

    const updateData = {
      totalPurchased: newTotalPurchased,
      currentStock: newCurrentStock,
      cost: newTotalCost,
      updatedAt
    };

    transaction.update(invRef, updateData);
    return { ...liveItem, ...updateData };
  });
};
