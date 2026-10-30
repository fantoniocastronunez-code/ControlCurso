/**
 * Servicio de Impresión Térmica para APPCURSO (Formato 58mm / ESC-POS)
 * Diseñado para impresión nítida, ordenada y proporcionada sin desbordes de columnas.
 * 
 * Soporta:
 * 1. 'rawbt': Impresión 100% AUTOMÁTICA en Android vía Intent hacia RawBT (sin diálogo del sistema).
 * 2. 'bluetooth': Impresión directa Web Bluetooth (BLE) desde Google Chrome Android / PC.
 * 3. 'system': Impresión estándar mediante el diálogo de impresión del navegador (window.print).
 */

// Ancho estándar en columnas para impresoras térmicas portátiles de 58mm
export const DEFAULT_PAPER_WIDTH = 40; // 40 caracteres en Fuente B compacta, 28 en Fuente A

// Comandos ESC/POS estándar
const ESC = '\x1b';
const GS = '\x1d';

const CMD_INIT = `${ESC}@`;
const CMD_ALIGN_LEFT = `${ESC}a\x00`;
const CMD_ALIGN_CENTER = `${ESC}a\x01`;
const CMD_ALIGN_RIGHT = `${ESC}a\x02`;
const CMD_BOLD_ON = `${ESC}E\x01`;
const CMD_BOLD_OFF = `${ESC}E\x00`;

// Selección de Fuente: Font B (9x17 dots, compacta y estilizada) vs Font A (12x24 dots, normal)
const CMD_FONT_B = `${ESC}M\x01${ESC}!\x01`; // Pequeña y estilizada como el diálogo del sistema
const CMD_FONT_A = `${ESC}M\x00${ESC}!\x00`; // Normal estándar

// Corte de papel con guillotina
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
  return isAndroid() ? 'rawbt' : 'system';
};

export const setPrinterConfig = (mode) => {
  localStorage.setItem('appcurso_printer_mode', mode);
};

export const getFontSize = () => {
  const saved = localStorage.getItem('appcurso_font_size');
  return saved || 'compact'; // 'compact' por defecto para que la tipografía sea fina y no gigante
};

export const setFontSize = (size) => {
  localStorage.setItem('appcurso_font_size', size);
};

export const getCutterConfig = () => {
  const saved = localStorage.getItem('appcurso_cutter_mode');
  return saved || 'tear'; // 'tear' (manual / sin desperdicio) por defecto
};

export const setCutterConfig = (mode) => {
  localStorage.setItem('appcurso_cutter_mode', mode);
};

export const getPaperWidth = () => {
  const saved = localStorage.getItem('appcurso_paper_width');
  if (saved) return parseInt(saved, 10);
  return getFontSize() === 'compact' ? 40 : 28;
};

export const setPaperWidth = (width) => {
  localStorage.setItem('appcurso_paper_width', String(width));
};

const getFontInit = () => {
  return getFontSize() === 'compact' ? CMD_FONT_B : CMD_FONT_A;
};

const getEndFeed = () => {
  if (getCutterConfig() === 'auto') {
    return '\n\n\n\n' + CMD_CUT;
  }
  // En impresoras portátiles 58mm con corte manual:
  // Solo 2 saltos de línea para que el texto salga por la ranura de corte manual,
  // CERO desperdicio de papel en blanco (elimina los 35mm en blanco).
  return '\n\n';
};

export const formatMoneyCLP = (amount) => {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
};

/**
 * Genera la secuencia de comandos ESC/POS para imprimir un código QR nativo
 * Compatible con impresoras térmicas ESC/POS estándar y RawBT
 * @param {string} data - Texto o URL que contendrá el QR
 * @param {number} moduleSize - Tamaño de módulo en dots (1 a 16, 4 recomendado para 58mm)
 */
export const buildEscPosQrCode = (data, moduleSize = 4) => {
  if (!data) return '';
  const dLen = data.length + 3;
  const pL = String.fromCharCode(dLen & 0xff);
  const pH = String.fromCharCode((dLen >> 8) & 0xff);
  const sizeChar = String.fromCharCode(Math.min(16, Math.max(1, moduleSize)));

  let qr = '';
  // 1. Seleccionar Modelo 2 de QR Code (GS ( k 04 00 31 41 32 00)
  qr += `${GS}(k\x04\x001A2\x00`;
  // 2. Establecer tamaño del módulo (GS ( k 03 00 31 43 size)
  qr += `${GS}(k\x03\x001C${sizeChar}`;
  // 3. Nivel de corrección de error M 15% (GS ( k 03 00 31 45 31)
  qr += `${GS}(k\x03\x001E1`;
  // 4. Guardar datos en el buffer del símbolo (GS ( k pL pH 31 50 30 data)
  qr += `${GS}(k${pL}${pH}1P0${data}`;
  // 5. Imprimir el QR generado (GS ( k 03 00 31 51 30)
  qr += `${GS}(k\x03\x001Q0`;

  return qr;
};

/**
 * Divide un texto en líneas que no superen maxWidth caracteres, respetando palabras
 */
export const wrapText = (text, maxWidth) => {
  if (!text) return [];
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + ' ' + word).length <= maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
};

/**
 * Justifica a la izquierda y a la derecha en una sola línea de ancho exacto
 */
export const justify = (left, right, width = DEFAULT_PAPER_WIDTH) => {
  left = String(left || '');
  right = String(right || '');
  const spaces = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(spaces) + right;
};

/**
 * Sanitiza texto para compatibilidad absoluta con impresoras térmicas estándar
 */
export const cleanText = (str) => {
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
 * Formatea un producto del carrito respetando el ancho de la columna sin cortar precios
 */
const formatItemLine = (qty, name, priceFormatted, width) => {
  const qtyPrefix = `${qty}x `;
  const priceStr = ` ${priceFormatted}`;
  const maxNameWidth = width - qtyPrefix.length - priceStr.length;

  const nameWords = wrapText(name, Math.max(8, maxNameWidth));
  let output = '';

  if (nameWords.length <= 1) {
    const singleName = nameWords[0] || name;
    output += `${justify(`${qtyPrefix}${singleName}`, priceFormatted, width)}\n`;
  } else {
    // Primera línea: Cantidad y primera parte del nombre
    output += `${qtyPrefix}${nameWords[0]}\n`;
    // Líneas intermedias si las hay
    for (let i = 1; i < nameWords.length - 1; i++) {
      output += `   ${nameWords[i]}\n`;
    }
    // Última línea con el final del nombre y el precio a la derecha
    const lastPart = nameWords[nameWords.length - 1];
    output += `${justify(`   ${lastPart}`, priceFormatted, width)}\n`;
  }

  return output;
};

/**
 * Genera el payload ESC/POS para un ticket de venta
 * Formato compacto, tipografía proporcionada (sin fuentes gigantes) y márgenes exactos
 */
export const buildSaleReceiptPayload = (sale, eventName, width = getPaperWidth()) => {
  const DOUBLE_LINE = '='.repeat(width);
  const SEP_LINE = '-'.repeat(width);

  let p = '';
  p += CMD_INIT;
  p += getFontInit();

  // 1. Encabezado Centrado
  p += CMD_ALIGN_CENTER;
  p += CMD_BOLD_ON;
  const headerLines = wrapText(cleanText(eventName || 'APPCURSO'), width);
  headerLines.forEach(l => { p += `${l}\n`; });
  p += CMD_BOLD_OFF;

  p += `Ticket #${sale.correlative}\n`;
  p += `${new Date(sale.createdAt || Date.now()).toLocaleString('es-CL')}\n`;
  p += `${DOUBLE_LINE}\n`;

  // 2. Tabla de Productos
  p += CMD_ALIGN_LEFT;
  p += `${justify('C   Item', 'Total', width)}\n`;
  p += `${SEP_LINE}\n`;

  if (sale.items && Array.isArray(sale.items)) {
    sale.items.forEach(item => {
      const itemTotal = formatMoneyCLP((item.unitPrice || item.price) * item.quantity);
      p += formatItemLine(item.quantity, cleanText(item.name), itemTotal, width);

      // Subproductos / Toppings
      if (item.selectedSubproducts && item.selectedSubproducts.length > 0) {
        item.selectedSubproducts.forEach(sp => {
          const spPrice = sp.price > 0 ? `+${formatMoneyCLP(sp.price * item.quantity)}` : '$0';
          const maxSpNameWidth = width - 4 - spPrice.length - 1;
          const spLines = wrapText(cleanText(sp.name), Math.max(6, maxSpNameWidth));
          
          if (spLines.length <= 1) {
            p += `${justify(`   + ${spLines[0] || sp.name}`, spPrice, width)}\n`;
          } else {
            p += `   + ${spLines[0]}\n`;
            for (let j = 1; j < spLines.length - 1; j++) {
              p += `     ${spLines[j]}\n`;
            }
            p += `${justify(`     ${spLines[spLines.length - 1]}`, spPrice, width)}\n`;
          }
        });
      }
    });
  }

  p += `${SEP_LINE}\n`;

  // 3. Total (En negrita y tamaño normal nítido, sin estirar la tipografía)
  p += CMD_ALIGN_LEFT;
  p += CMD_BOLD_ON;
  p += `${justify('TOTAL:', formatMoneyCLP(sale.total), width)}\n`;
  p += CMD_BOLD_OFF;
  p += `${DOUBLE_LINE}\n`;

  // 4. Detalles del Pago y Cajero
  p += `Pago: ${sale.paymentMethod === 'cash' ? 'Efectivo' : 'Transferencia'}\n`;
  if (sale.clientName) {
    const clientLines = wrapText(`Cliente: ${cleanText(sale.clientName)}`, width);
    clientLines.forEach(l => { p += `${l}\n`; });
  }
  if (sale.cashierName) {
    const cashierLines = wrapText(`Cajero/a: ${cleanText(sale.cashierName)}`, width);
    cashierLines.forEach(l => { p += `${l}\n`; });
  }
  if (sale.saleNote) {
    const noteLines = wrapText(`Nota: ${cleanText(sale.saleNote)}`, width);
    noteLines.forEach(l => { p += `${l}\n`; });
  }

  // 5. Código QR para Seguimiento en Vivo del Pedido
  if (sale.id) {
    const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const baseUrl = isLocal || typeof window === 'undefined' || !window.location?.origin
      ? 'https://control-curso.vercel.app'
      : window.location.origin;
    const orderUrl = `${baseUrl}/pedido/${sale.id}`;

    p += `\n`;
    p += CMD_ALIGN_CENTER;
    p += buildEscPosQrCode(orderUrl, 4);
    p += `\n`;
    p += CMD_BOLD_ON;
    p += `SIGUE EL ESTADO DE TU PEDIDO\n`;
    p += CMD_BOLD_OFF;
    p += `Escanea con tu celular\n`;
    p += `Ticket #${sale.correlative}\n`;
  }

  // 6. Pie de Ticket
  p += `\n`;
  p += CMD_ALIGN_CENTER;
  p += `¡Gracias por su colaboracion!\n`;
  p += getEndFeed();

  return p;
};

/**
 * Genera el payload ESC/POS para un ticket de prueba
 */
export const buildTestReceiptPayload = (eventName, cashierName, width = getPaperWidth()) => {
  const DOUBLE_LINE = '='.repeat(width);
  const SEP_LINE = '-'.repeat(width);

  let p = '';
  p += CMD_INIT;
  p += getFontInit();
  p += CMD_ALIGN_CENTER;
  p += CMD_BOLD_ON;
  p += `*** TEST DE IMPRESORA ***\n`;
  const nameLines = wrapText(cleanText(eventName || 'APPCURSO POS'), width);
  nameLines.forEach(l => { p += `${l}\n`; });
  p += CMD_BOLD_OFF;

  p += `MODO PRUEBA / ENSAYO\n`;
  p += `Fecha: ${new Date().toLocaleString('es-CL')}\n`;
  if (cashierName) {
    p += `Cajero/a: ${cleanText(cashierName)}\n`;
  }
  p += `${DOUBLE_LINE}\n`;

  p += CMD_ALIGN_LEFT;
  p += `Tipografia: ${getFontSize() === 'compact' ? 'Compacta (Font B)' : 'Normal (Font A)'}\n`;
  p += `Columnas: ${width} caracteres\n`;
  p += `Corte: ${getCutterConfig() === 'auto' ? 'Automatico' : 'Manual (0 desperdicio)'}\n`;
  p += `Numeros: $1.000 / $25.990\n`;
  p += `${SEP_LINE}\n`;

  // QR de Prueba
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const baseUrl = isLocal || typeof window === 'undefined' || !window.location?.origin
    ? 'https://control-curso.vercel.app'
    : window.location.origin;
  const testOrderUrl = `${baseUrl}/pedido/test-preview`;
  p += CMD_ALIGN_CENTER;
  p += buildEscPosQrCode(testOrderUrl, 4);
  p += `\n`;
  p += CMD_BOLD_ON;
  p += `QR DE PEDIDO LISTO\n`;
  p += CMD_BOLD_OFF;
  p += `Escanea para ver estado\n`;

  p += CMD_ALIGN_CENTER;
  p += CMD_BOLD_ON;
  p += `¡IMPRESION CORRECTA!\n`;
  p += CMD_BOLD_OFF;
  p += `Ticket ordenado y alineado\n`;
  p += getEndFeed();

  return p;
};

/**
 * Genera el payload ESC/POS para el cierre de evento / cuadratura
 */
export const buildClosureReceiptPayload = (event, stats, itemsSummary = [], expensesSummary = [], inventorySummary = [], cashiersSummary = [], width = getPaperWidth()) => {
  const DOUBLE_LINE = '='.repeat(width);
  const SEP_LINE = '-'.repeat(width);

  let p = '';
  p += CMD_INIT;
  p += getFontInit();
  p += CMD_ALIGN_CENTER;
  p += CMD_BOLD_ON;
  p += `CIERRE DE EVENTO\n`;
  const nameLines = wrapText(cleanText(event.name), width);
  nameLines.forEach(l => { p += `${l}\n`; });
  p += CMD_BOLD_OFF;

  p += `Fecha: ${new Date(event.date).toLocaleDateString('es-CL')}\n`;
  p += `Impreso: ${new Date().toLocaleString('es-CL')}\n`;
  p += `${DOUBLE_LINE}\n`;

  // Resumen Financiero
  p += CMD_ALIGN_CENTER;
  p += CMD_BOLD_ON;
  p += `RESUMEN FINANCIERO\n`;
  p += CMD_BOLD_OFF;
  p += CMD_ALIGN_LEFT;
  p += `${justify('Ingresos Cuotas:', formatMoneyCLP(stats?.paidQuotas || 0), width)}\n`;
  p += `${justify('Ventas POS:', formatMoneyCLP(stats?.salesTotal || 0), width)}\n`;
  p += `${justify('Gastos Registrados:', '-' + formatMoneyCLP(stats?.expensesTotal || 0), width)}\n`;
  p += `${SEP_LINE}\n`;
  p += CMD_BOLD_ON;
  p += `${justify('GANANCIA NETA:', formatMoneyCLP(stats?.netProfit || 0), width)}\n`;
  p += CMD_BOLD_OFF;
  p += `${DOUBLE_LINE}\n`;

  // Cuadratura de Efectivo en Caja
  if ((stats?.pettyCashTotal || 0) > 0 || (stats?.cashSalesTotal || 0) > 0) {
    p += CMD_ALIGN_CENTER;
    p += CMD_BOLD_ON;
    p += `CUADRATURA DE EFECTIVO\n`;
    p += CMD_BOLD_OFF;
    p += CMD_ALIGN_LEFT;
    p += `${justify('Fondo Inicial (Caja Chica):', formatMoneyCLP(stats?.pettyCashTotal || 0), width)}\n`;
    p += `${justify('Ventas en Efectivo (+):', formatMoneyCLP(stats?.cashSalesTotal || 0), width)}\n`;
    p += `${SEP_LINE}\n`;
    p += CMD_BOLD_ON;
    const expectedCashInBox = (stats?.pettyCashTotal || 0) + (stats?.cashSalesTotal || 0);
    p += `${justify('TOTAL EFECTIVO EN CAJA:', formatMoneyCLP(expectedCashInBox), width)}\n`;
    p += CMD_BOLD_OFF;
    if (stats?.transferSalesTotal) {
      p += `${justify('Ventas Transferencia:', formatMoneyCLP(stats.transferSalesTotal), width)}\n`;
    }
    p += `${DOUBLE_LINE}\n`;
  }

  // Ventas por cajero
  if (cashiersSummary && cashiersSummary.length > 0) {
    p += CMD_ALIGN_CENTER;
    p += CMD_BOLD_ON;
    p += `VENTAS POR CAJERO\n`;
    p += CMD_BOLD_OFF;
    p += CMD_ALIGN_LEFT;
    cashiersSummary.forEach(c => {
      p += `${justify(`${cleanText(c.name)} (${c.salesCount}v)`, formatMoneyCLP(c.total), width)}\n`;
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
      p += `${justify(`${item.qty}x ${cleanText(item.name)}`, formatMoneyCLP(item.total), width)}\n`;
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
  p += getEndFeed();

  return p;
};

/**
 * Genera el payload ESC/POS para el comprobante de apertura de Caja Chica
 */
export const buildPettyCashReceiptPayload = (eventName, pettyCashData, cashierName, width = getPaperWidth()) => {
  const DOUBLE_LINE = '='.repeat(width);
  const SEP_LINE = '-'.repeat(width);

  let p = '';
  p += CMD_INIT;
  p += getFontInit();
  p += CMD_ALIGN_CENTER;
  p += CMD_BOLD_ON;
  p += `APERTURA DE CAJA CHICA\n`;
  const nameLines = wrapText(cleanText(eventName || 'APPCURSO POS'), width);
  nameLines.forEach(l => { p += `${l}\n`; });
  p += CMD_BOLD_OFF;

  p += `Fecha: ${new Date(pettyCashData?.createdAt || Date.now()).toLocaleString('es-CL')}\n`;
  if (cashierName) {
    p += `Cajero/a: ${cleanText(cashierName)}\n`;
  }
  p += `${DOUBLE_LINE}\n`;

  // Billetes
  const bills = pettyCashData?.bills || {};
  const BILL_VALUES = [20000, 10000, 5000, 2000, 1000];
  const hasBills = BILL_VALUES.some(v => (bills[v] || 0) > 0);

  if (hasBills) {
    p += CMD_BOLD_ON;
    p += CMD_ALIGN_LEFT;
    p += `DESGLOSE BILLETES:\n`;
    p += CMD_BOLD_OFF;
    BILL_VALUES.forEach(v => {
      const qty = bills[v] || 0;
      if (qty > 0) {
        const sub = qty * v;
        const label = `  ${formatMoneyCLP(v)} x ${qty}`;
        p += `${justify(label, formatMoneyCLP(sub), width)}\n`;
      }
    });
    p += `${SEP_LINE}\n`;
  }

  // Monedas
  const coins = pettyCashData?.coins || {};
  const COIN_VALUES = [500, 100, 50, 10];
  const hasCoins = COIN_VALUES.some(v => (coins[v] || 0) > 0);

  if (hasCoins) {
    p += CMD_BOLD_ON;
    p += CMD_ALIGN_LEFT;
    p += `DESGLOSE MONEDAS:\n`;
    p += CMD_BOLD_OFF;
    COIN_VALUES.forEach(v => {
      const qty = coins[v] || 0;
      if (qty > 0) {
        const sub = qty * v;
        const label = `  ${formatMoneyCLP(v)} x ${qty}`;
        p += `${justify(label, formatMoneyCLP(sub), width)}\n`;
      }
    });
    p += `${SEP_LINE}\n`;
  }

  p += CMD_BOLD_ON;
  p += CMD_ALIGN_LEFT;
  p += `${justify('TOTAL CAJA CHICA:', formatMoneyCLP(pettyCashData?.total || 0), width)}\n`;
  p += CMD_BOLD_OFF;
  p += `${DOUBLE_LINE}\n`;

  if (pettyCashData?.note) {
    p += `Nota: ${cleanText(pettyCashData.note)}\n`;
    p += `${SEP_LINE}\n`;
  }

  p += CMD_ALIGN_CENTER;
  p += `Firma Responsable: __________________\n`;
  p += getEndFeed();

  return p;
};

/**
 * Genera el payload ESC/POS para el Arqueo / Cuadratura de Efectivo en Caja
 */
export const buildCashAuditReceiptPayload = (eventName, pettyCashTotal, cashSalesTotal, transferSalesTotal, totalSales, cashierName, width = getPaperWidth()) => {
  const DOUBLE_LINE = '='.repeat(width);
  const SEP_LINE = '-'.repeat(width);

  let p = '';
  p += CMD_INIT;
  p += getFontInit();
  p += CMD_ALIGN_CENTER;
  p += CMD_BOLD_ON;
  p += `ARQUEO DE EFECTIVO EN CAJA\n`;
  const nameLines = wrapText(cleanText(eventName || 'APPCURSO POS'), width);
  nameLines.forEach(l => { p += `${l}\n`; });
  p += CMD_BOLD_OFF;

  p += `Fecha: ${new Date().toLocaleString('es-CL')}\n`;
  if (cashierName) {
    p += `Cajero/a: ${cleanText(cashierName)}\n`;
  }
  p += `${DOUBLE_LINE}\n`;

  p += CMD_ALIGN_LEFT;
  p += `${justify('Fondo Inicial (Caja Chica):', formatMoneyCLP(pettyCashTotal || 0), width)}\n`;
  p += `${justify('Ventas en Efectivo (+):', formatMoneyCLP(cashSalesTotal || 0), width)}\n`;
  p += `${SEP_LINE}\n`;

  p += CMD_BOLD_ON;
  const totalCashExpected = (pettyCashTotal || 0) + (cashSalesTotal || 0);
  p += `${justify('TOTAL EFECTIVO EN CAJA:', formatMoneyCLP(totalCashExpected), width)}\n`;
  p += CMD_BOLD_OFF;
  p += `${DOUBLE_LINE}\n`;

  p += `${justify('Ventas Transferencia:', formatMoneyCLP(transferSalesTotal || 0), width)}\n`;
  p += `${justify('Total Ventas POS:', formatMoneyCLP(totalSales || 0), width)}\n`;
  p += `${SEP_LINE}\n`;

  p += CMD_ALIGN_CENTER;
  p += `Verificacion de Caja Conforme\n`;
  p += `Firma: ________________________\n`;
  p += getEndFeed();

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
 */
export const printViaRawBT = (payloadString) => {
  const base64Data = stringToBase64(payloadString);
  const intentUrl = `intent:base64,${base64Data}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dru.a402d.rawbtprinter;end;`;

  const a = document.createElement('a');
  a.href = intentUrl;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      document.body.removeChild(a);
    } catch {
      // Ignorar
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
      // Siguiente
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
