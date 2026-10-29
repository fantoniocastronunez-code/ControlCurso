/**
 * Servicio de Impresión Térmica para APPCURSO (Formato 58mm / ESC-POS)
 * Soporta:
 * 1. 'rawbt': Impresión 100% AUTOMÁTICA en Android vía Intent hacia RawBT (sin diálogo del sistema).
 * 2. 'bluetooth': Impresión directa Web Bluetooth (BLE) desde Google Chrome Android / PC.
 * 3. 'system': Impresión estándar mediante el diálogo de impresión del navegador (window.print).
 */

const LINE_WIDTH = 32;

// Comandos ESC/POS estándar
const ESC = '\x1b';
const GS = '\x1d';

const CMD_INIT = `${ESC}@`;
const CMD_ALIGN_LEFT = `${ESC}a\x00`;
const CMD_ALIGN_CENTER = `${ESC}a\x01`;
const CMD_ALIGN_RIGHT = `${ESC}a\x02`;
const CMD_BOLD_ON = `${ESC}E\x01`;
const CMD_BOLD_OFF = `${ESC}E\x00`;
const CMD_DOUBLE_ON = `${GS}!\x11`;
const CMD_DOUBLE_OFF = `${GS}!\x00`;
const CMD_CUT = `${GS}V\x41\x02`;

// Servicios BLE comunes en impresoras térmicas portátiles
const POS_BLE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
];

let globalBleDevice = null;
let globalBleCharacteristic = null;

export const isAndroid = () => {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
};

export const getPrinterConfig = () => {
  const saved = localStorage.getItem('appcurso_printer_mode');
  if (saved) return saved;
  // Si está en Android, por defecto se recomienda 'rawbt' para evitar el diálogo del sistema
  return isAndroid() ? 'rawbt' : 'system';
};

export const setPrinterConfig = (mode) => {
  localStorage.setItem('appcurso_printer_mode', mode);
};

export const formatMoneyCLP = (amount) => {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
};

const justify = (left, right, width = LINE_WIDTH) => {
  left = String(left || '');
  right = String(right || '');
  const maxLeft = width - right.length - 1;
  if (left.length > maxLeft) {
    left = left.slice(0, maxLeft);
  }
  const spaces = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(spaces) + right;
};

/**
 * Sanitiza texto para que caracteres especiales no se distorsionen en impresoras térmicas
 */
const cleanText = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/[ñ]/g, 'n')
    .replace(/[ÁÀÄÂ]/g, 'A')
    .replace(/[ÉÈËÊ]/g, 'E')
    .replace(/[ÍÌÏÎ]/g, 'I')
    .replace(/[ÓÒÖÔ]/g, 'O')
    .replace(/[ÚÙÜÛ]/g, 'U')
    .replace(/[Ñ]/g, 'N');
};

/**
 * Genera el payload ESC/POS para un ticket de venta
 */
export const buildSaleReceiptPayload = (sale, eventName) => {
  const DOUBLE_LINE = '================================';
  const SEP_LINE = '--------------------------------';

  let p = '';
  p += CMD_INIT;
  p += CMD_ALIGN_CENTER;
  p += CMD_BOLD_ON;
  p += `${cleanText(eventName || 'APPCURSO')}\n`;
  p += CMD_BOLD_OFF;
  p += `Ticket #${sale.correlative}\n`;
  p += `${new Date(sale.createdAt || Date.now()).toLocaleString('es-CL')}\n`;
  p += `${DOUBLE_LINE}\n`;

  p += CMD_ALIGN_LEFT;
  p += `CANT DESCRIPCION           TOTAL\n`;
  p += `${SEP_LINE}\n`;

  if (sale.items && Array.isArray(sale.items)) {
    sale.items.forEach(item => {
      const qtyStr = `${item.quantity}x `;
      const itemTotal = formatMoneyCLP(item.price * item.quantity);
      p += `${justify(`${qtyStr}${cleanText(item.name)}`, itemTotal, LINE_WIDTH)}\n`;

      if (item.selectedSubproducts && item.selectedSubproducts.length > 0) {
        item.selectedSubproducts.forEach(sp => {
          const spTotal = formatMoneyCLP(sp.price * item.quantity);
          p += `${justify(`  + ${cleanText(sp.name)}`, spTotal, LINE_WIDTH)}\n`;
        });
      }
    });
  }

  p += `${SEP_LINE}\n`;
  p += CMD_ALIGN_RIGHT;
  p += CMD_BOLD_ON;
  p += `${CMD_DOUBLE_ON}TOTAL: ${formatMoneyCLP(sale.total)}${CMD_DOUBLE_OFF}\n`;
  p += CMD_BOLD_OFF;
  p += `${DOUBLE_LINE}\n`;

  p += CMD_ALIGN_LEFT;
  p += `Pago: ${sale.paymentMethod === 'cash' ? 'Efectivo' : 'Transferencia'}\n`;
  if (sale.clientName) p += `Cliente: ${cleanText(sale.clientName)}\n`;
  if (sale.cashierName) p += `Cajero/a: ${cleanText(sale.cashierName)}\n`;
  if (sale.saleNote) p += `Nota: ${cleanText(sale.saleNote)}\n`;

  p += `\n`;
  p += CMD_ALIGN_CENTER;
  p += `¡Muchas gracias por su apoyo!\n`;
  p += `\n\n\n\n`;
  p += CMD_CUT;

  return p;
};

/**
 * Genera el payload ESC/POS para un ticket de prueba
 */
export const buildTestReceiptPayload = (eventName, cashierName) => {
  const DOUBLE_LINE = '================================';
  const SEP_LINE = '--------------------------------';

  let p = '';
  p += CMD_INIT;
  p += CMD_ALIGN_CENTER;
  p += CMD_BOLD_ON;
  p += `*** TEST DE IMPRESORA ***\n`;
  p += `${cleanText(eventName || 'APPCURSO POS')}\n`;
  p += CMD_BOLD_OFF;
  p += `MODO PRUEBA / ENSAYO\n`;
  p += `Fecha: ${new Date().toLocaleString('es-CL')}\n`;
  p += `Cajero/a: ${cleanText(cashierName || 'Cajero de Prueba')}\n`;
  p += `${DOUBLE_LINE}\n`;

  p += CMD_ALIGN_LEFT;
  p += `✓ Formato POS Termico 58mm\n`;
  p += `✓ Impresora conectada y lista\n`;
  p += `✓ Numeros: $1.000 / $25.990\n`;
  p += `✓ Impresion automatica sin dialogo\n`;
  p += `${SEP_LINE}\n`;

  p += CMD_ALIGN_CENTER;
  p += CMD_BOLD_ON;
  p += `¡IMPRESION CORRECTA!\n`;
  p += CMD_BOLD_OFF;
  p += `Ticket de prueba exitoso\n`;
  p += `\n\n\n\n`;
  p += CMD_CUT;

  return p;
};

/**
 * Genera el payload ESC/POS para el cierre de evento / cuadratura
 */
export const buildClosureReceiptPayload = (event, stats, itemsSummary = [], expensesSummary = [], inventorySummary = [], cashiersSummary = []) => {
  const DOUBLE_LINE = '================================';
  const SEP_LINE = '--------------------------------';

  let p = '';
  p += CMD_INIT;
  p += CMD_ALIGN_CENTER;
  p += CMD_BOLD_ON;
  p += `CIERRE DE EVENTO\n`;
  p += `${cleanText(event.name)}\n`;
  p += CMD_BOLD_OFF;
  p += `Fecha: ${new Date(event.date).toLocaleDateString('es-CL')}\n`;
  p += `Impreso: ${new Date().toLocaleString('es-CL')}\n`;
  p += `${DOUBLE_LINE}\n`;

  p += CMD_ALIGN_CENTER;
  p += CMD_BOLD_ON;
  p += `RESUMEN FINANCIERO\n`;
  p += CMD_BOLD_OFF;
  p += CMD_ALIGN_LEFT;
  p += `${justify('Ingresos Cuotas:', formatMoneyCLP(stats?.paidQuotas || 0))}\n`;
  p += `${justify('Ventas POS:', formatMoneyCLP(stats?.salesTotal || 0))}\n`;
  p += `${justify('Gastos Registrados:', '-' + formatMoneyCLP(stats?.expensesTotal || 0))}\n`;
  p += `${SEP_LINE}\n`;
  p += CMD_BOLD_ON;
  p += `${justify('GANANCIA NETA:', formatMoneyCLP(stats?.netProfit || 0))}\n`;
  p += CMD_BOLD_OFF;
  p += `${DOUBLE_LINE}\n`;

  // Ventas por cajero
  if (cashiersSummary && cashiersSummary.length > 0) {
    p += CMD_ALIGN_CENTER;
    p += CMD_BOLD_ON;
    p += `VENTAS POR CAJERO\n`;
    p += CMD_BOLD_OFF;
    p += CMD_ALIGN_LEFT;
    cashiersSummary.forEach(c => {
      p += `${justify(`${cleanText(c.name)} (${c.salesCount} v.)`, formatMoneyCLP(c.total))}\n`;
    });
    p += `${SEP_LINE}\n`;
  }

  // Detalle de ítems vendidos
  if (itemsSummary && itemsSummary.length > 0) {
    p += CMD_ALIGN_CENTER;
    p += CMD_BOLD_ON;
    p += `DETALLE DE VENTAS (POS)\n`;
    p += CMD_BOLD_OFF;
    p += CMD_ALIGN_LEFT;
    itemsSummary.forEach(item => {
      p += `${justify(`${item.qty}x ${cleanText(item.name)}`, formatMoneyCLP(item.total))}\n`;
    });
    p += `${SEP_LINE}\n`;
  }

  // Inventario y Sobrantes
  if (inventorySummary && inventorySummary.length > 0) {
    p += CMD_ALIGN_CENTER;
    p += CMD_BOLD_ON;
    p += `INVENTARIO Y SOBRANTES\n`;
    p += CMD_BOLD_OFF;
    p += CMD_ALIGN_LEFT;
    inventorySummary.forEach(inv => {
      const purchased = inv.totalPurchased || inv.initialQuantity || 0;
      const finalCount = inv.finalPhysicalCount !== undefined ? inv.finalPhysicalCount : inv.currentStock;
      p += `${cleanText(inv.name)}:\n`;
      p += `  Comprado: ${purchased} ${inv.unit}\n`;
      p += `  Sobrante Final: ${finalCount} ${inv.unit}\n`;
    });
    p += `${SEP_LINE}\n`;
  }

  p += `\n`;
  p += CMD_ALIGN_CENTER;
  p += `--- FIN DEL CIERRE ---\n`;
  p += `\n\n\n\n`;
  p += CMD_CUT;

  return p;
};

/**
 * Convierte un string binario a Base64
 */
export const stringToBase64 = (str) => {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

/**
 * Dispara la impresión hacia RawBT en Android mediante su URI Intent
 * Imprime 100% automáticamente sin abrir el diálogo de Android si RawBT está configurado en auto-print.
 */
export const printViaRawBT = (payloadString) => {
  const base64Data = stringToBase64(payloadString);
  const intentUrl = `intent:base64,${base64Data}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dru.a402d.rawbtprinter;end;`;

  // Crear un link invisible y activarlo
  const a = document.createElement('a');
  a.href = intentUrl;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      document.body.removeChild(a);
    } catch {
      // Ignorar si ya fue removido
    }
  }, 300);
};

/**
 * Conecta directamente a una impresora Bluetooth Low Energy (BLE)
 */
export const connectWebBluetooth = async () => {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth no está soportado en este navegador. Utiliza Google Chrome o activa el modo RawBT.');
  }

  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: POS_BLE_SERVICES
  });

  const server = await device.gatt.connect();

  let primaryService = null;
  for (const sId of POS_BLE_SERVICES) {
    try {
      primaryService = await server.getPrimaryService(sId);
      if (primaryService) break;
    } catch {
      // Intentar el siguiente servicio
    }
  }

  if (!primaryService) {
    const services = await server.getPrimaryServices();
    if (services.length > 0) primaryService = services[0];
  }

  if (!primaryService) {
    throw new Error('No se encontró el servicio de impresión térmica en el dispositivo seleccionado.');
  }

  const characteristics = await primaryService.getCharacteristics();
  const writeChar = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);

  if (!writeChar) {
    throw new Error('No se encontró la característica de escritura en la impresora Bluetooth.');
  }

  globalBleDevice = device;
  globalBleCharacteristic = writeChar;

  device.addEventListener('gattserverdisconnected', () => {
    globalBleDevice = null;
    globalBleCharacteristic = null;
  });

  return device.name || 'Impresora Bluetooth';
};

export const getConnectedBluetoothDevice = () => {
  return globalBleDevice ? (globalBleDevice.name || 'Impresora Conectada') : null;
};

export const disconnectWebBluetooth = () => {
  if (globalBleDevice && globalBleDevice.gatt.connected) {
    globalBleDevice.gatt.disconnect();
  }
  globalBleDevice = null;
  globalBleCharacteristic = null;
};

/**
 * Envía datos binarios a la impresora BLE conectada
 */
export const printViaWebBluetooth = async (payloadString) => {
  if (!globalBleCharacteristic) {
    throw new Error('No hay ninguna impresora Bluetooth conectada. Conéctala en Ajustes de Impresora.');
  }

  const bytes = new Uint8Array(payloadString.length);
  for (let i = 0; i < payloadString.length; i++) {
    bytes[i] = payloadString.charCodeAt(i) & 0xff;
  }

  const CHUNK_SIZE = 100;
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.slice(i, i + CHUNK_SIZE);
    if (globalBleCharacteristic.properties.writeWithoutResponse) {
      await globalBleCharacteristic.writeValueWithoutResponse(chunk);
    } else {
      await globalBleCharacteristic.writeValue(chunk);
    }
  }
};
