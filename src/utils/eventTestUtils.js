import { db } from '../firebase/config';
import { collection, doc, setDoc, getDocs, updateDoc, deleteDoc, query, where } from 'firebase/firestore';

/**
 * Precarga datos de prueba para un evento (Panes, Vienesas, Tomates, Bebidas y Completos)
 */
export const loadDemoEventData = async (eventId, courseId, user) => {
  const userName = user?.email || user?.displayName || 'Modo Prueba';
  const now = new Date().toISOString();

  // 1. Insumos de Inventario
  const inventoryItems = [
    {
      id: `inv_pan_${eventId}`,
      eventId,
      courseId: courseId || '',
      name: 'Pan de Completo',
      unit: 'unidades',
      initialQuantity: 50,
      totalPurchased: 50,
      currentStock: 50,
      cost: 6000,
      notes: 'Bolsas de pan para completos (Prueba)',
      createdAt: now,
      createdBy: userName
    },
    {
      id: `inv_vienesa_${eventId}`,
      eventId,
      courseId: courseId || '',
      name: 'Vienesas',
      unit: 'unidades',
      initialQuantity: 50,
      totalPurchased: 50,
      currentStock: 50,
      cost: 8500,
      notes: 'Paquetes de vienesas tradicionales (Prueba)',
      createdAt: now,
      createdBy: userName
    },
    {
      id: `inv_tomate_${eventId}`,
      eventId,
      courseId: courseId || '',
      name: 'Tomates',
      unit: 'kilos',
      initialQuantity: 5,
      totalPurchased: 5,
      currentStock: 5,
      cost: 4500,
      notes: 'Tomate picado para completos (Prueba)',
      createdAt: now,
      createdBy: userName
    },
    {
      id: `inv_palta_${eventId}`,
      eventId,
      courseId: courseId || '',
      name: 'Paltas',
      unit: 'kilos',
      initialQuantity: 4,
      totalPurchased: 4,
      currentStock: 4,
      cost: 11000,
      notes: 'Palta molida (Prueba)',
      createdAt: now,
      createdBy: userName
    },
    {
      id: `inv_bebida_${eventId}`,
      eventId,
      courseId: courseId || '',
      name: 'Bebidas en Lata',
      unit: 'unidades',
      initialQuantity: 30,
      totalPurchased: 30,
      currentStock: 30,
      cost: 15000,
      notes: 'Lata 350ml Coca Cola, Fanta, Sprite (Prueba)',
      createdAt: now,
      createdBy: userName
    },
    {
      id: `inv_te_verde_${eventId}`,
      eventId,
      courseId: courseId || '',
      name: 'Té Verde',
      unit: 'unidades',
      initialQuantity: 20,
      totalPurchased: 20,
      currentStock: 20,
      cost: 3000,
      notes: 'Bolsitas de Té Verde (Prueba)',
      createdAt: now,
      createdBy: userName
    },
    {
      id: `inv_te_negro_${eventId}`,
      eventId,
      courseId: courseId || '',
      name: 'Té Negro Ceylan',
      unit: 'unidades',
      initialQuantity: 25,
      totalPurchased: 25,
      currentStock: 25,
      cost: 3500,
      notes: 'Bolsitas de Té Negro (Prueba)',
      createdAt: now,
      createdBy: userName
    }
  ];

  for (const inv of inventoryItems) {
    await setDoc(doc(db, 'eventInventory', inv.id), inv);
  }

  // 2. Productos del Menú vinculados a los insumos
  const menuItems = [
    {
      id: `item_completo_${eventId}`,
      eventId,
      courseId: courseId || '',
      name: 'Completo Italiano',
      price: 2500,
      ingredients: [
        { inventoryId: `inv_pan_${eventId}`, name: 'Pan de Completo', quantity: 1, unit: 'unidades' },
        { inventoryId: `inv_vienesa_${eventId}`, name: 'Vienesas', quantity: 1, unit: 'unidades' }
      ],
      subproducts: [
        {
          name: 'Salsas',
          price: 0,
          hasOptions: true,
          options: ['Mayo Casera', 'Ketchup', 'Mostaza']
        }
      ],
      createdBy: userName
    },
    {
      id: `item_promo_${eventId}`,
      eventId,
      courseId: courseId || '',
      name: 'Promo 2 Completos + Bebida',
      price: 5500,
      ingredients: [
        { inventoryId: `inv_pan_${eventId}`, name: 'Pan de Completo', quantity: 2, unit: 'unidades' },
        { inventoryId: `inv_vienesa_${eventId}`, name: 'Vienesas', quantity: 2, unit: 'unidades' },
        { inventoryId: `inv_bebida_${eventId}`, name: 'Bebidas en Lata', quantity: 1, unit: 'unidades' }
      ],
      subproducts: [
        {
          name: 'Tipo de Bebida',
          price: 0,
          hasOptions: true,
          options: ['Coca Cola', 'Sprite', 'Fanta', 'Zero']
        }
      ],
      createdBy: userName
    },
    {
      id: `item_bebida_${eventId}`,
      eventId,
      courseId: courseId || '',
      name: 'Bebida en Lata',
      price: 1200,
      ingredients: [
        { inventoryId: `inv_bebida_${eventId}`, name: 'Bebidas en Lata', quantity: 1, unit: 'unidades' }
      ],
      subproducts: [
        {
          name: 'Sabor',
          price: 0,
          hasOptions: true,
          options: ['Coca Cola', 'Sprite', 'Fanta']
        }
      ],
      createdBy: userName
    },
    {
      id: `item_te_${eventId}`,
      eventId,
      courseId: courseId || '',
      name: 'Té Caliente',
      price: 1000,
      ingredients: [],
      subproducts: [
        {
          name: 'Variedad de Té',
          price: 0,
          hasOptions: true,
          options: [
            { name: 'Té Verde', inventoryId: `inv_te_verde_${eventId}`, quantity: 1 },
            { name: 'Té Negro Ceylan', inventoryId: `inv_te_negro_${eventId}`, quantity: 1 }
          ]
        }
      ],
      createdBy: userName
    }
  ];

  for (const item of menuItems) {
    await setDoc(doc(db, 'eventItems', item.id), item);
  }

  return { inventoryItems, menuItems };
};

/**
 * Reinicia las ventas de prueba y restaura el stock inicial de inventario
 */
export const resetTestEventData = async (eventId) => {
  // 1. Eliminar ventas emitidas
  const qSales = query(collection(db, 'eventSales'), where('eventId', '==', eventId));
  const snapSales = await getDocs(qSales);
  for (const sDoc of snapSales.docs) {
    await deleteDoc(sDoc.ref);
  }

  // 2. Eliminar ingresos de venta asociados
  const qIncomes = query(collection(db, 'incomes'), where('eventId', '==', eventId));
  const snapIncomes = await getDocs(qIncomes);
  for (const iDoc of snapIncomes.docs) {
    await deleteDoc(iDoc.ref);
  }

  // 3. Restaurar stock de inventario al inicial
  const qInv = query(collection(db, 'eventInventory'), where('eventId', '==', eventId));
  const snapInv = await getDocs(qInv);
  for (const invDoc of snapInv.docs) {
    const data = invDoc.data();
    const initial = data.totalPurchased || data.initialQuantity || 0;
    await updateDoc(invDoc.ref, {
      currentStock: initial,
      finalCount: null,
      finalNotes: '',
      updatedAt: new Date().toISOString()
    });
  }
};

