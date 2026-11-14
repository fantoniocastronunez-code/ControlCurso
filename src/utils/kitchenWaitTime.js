/**
 * Convierte fechas ISO, timestamps de Firestore o milisegundos a epoch ms.
 * @param {string|number|object|null|undefined} value
 * @returns {number|null}
 */
export function parseSaleTimestampMs(value) {
  if (!value) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value?.toDate === 'function') {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000;
  }
  return null;
}

/**
 * Calcula la mediana de un arreglo numérico no vacío.
 * @param {number[]} values
 * @returns {number|null}
 */
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

const MAX_VALID_SAMPLE_MINUTES = 60;
const MIN_VALID_SAMPLE_MINUTES = 0.2;
const RECENT_SAMPLE_LIMIT = 12;
const STALE_ACTIVE_WINDOW_MINUTES = 180;

/**
 * Calcula el tiempo aproximado de espera por cliente en POS según los tiempos reales
 * de las comandas activas (pendientes/preparando) y las recientemente finalizadas.
 *
 * @param {Array<object>} sales Lista de ventas/comandas del evento
 * @param {number} [nowMs=Date.now()] Momento actual en ms
 * @returns {{
 *   estimatedMinutes: number,
 *   pendingCount: number,
 *   preparingCount: number,
 *   activeQueueCount: number,
 *   oldestActiveMinutes: number,
 *   avgCompletedMinutes: number|null,
 *   completedSampleCount: number,
 *   level: 'idle'|'fast'|'moderate'|'high',
 *   statusLabel: string,
 *   headlineText: string,
 *   summaryText: string
 * }}
 */
export function calculateKitchenWaitMetrics(sales = [], nowMs = Date.now()) {
  const validSales = Array.isArray(sales)
    ? sales.filter((s) => s && s.status !== 'cancelled')
    : [];

  const pendingWaitMinutes = [];
  const preparingWaitMinutes = [];
  const completedCandidates = [];

  for (const sale of validSales) {
    const status = sale.orderStatus || sale.kitchenStatus || 'pending';
    const createdMs = parseSaleTimestampMs(sale.createdAt);

    if (status === 'pending') {
      const waitMin = createdMs !== null ? Math.max(0, (nowMs - createdMs) / 60000) : 0;
      if (waitMin <= STALE_ACTIVE_WINDOW_MINUTES) {
        pendingWaitMinutes.push(waitMin);
      }
    } else if (status === 'preparing') {
      const waitMin = createdMs !== null ? Math.max(0, (nowMs - createdMs) / 60000) : 0;
      if (waitMin <= STALE_ACTIVE_WINDOW_MINUTES) {
        preparingWaitMinutes.push(waitMin);
      }
    } else if ((status === 'ready' || status === 'delivered') && createdMs !== null) {
      const endMs = status === 'ready'
        ? (parseSaleTimestampMs(sale.updatedAt) ?? parseSaleTimestampMs(sale.deliveredAt))
        : (parseSaleTimestampMs(sale.deliveredAt) ?? parseSaleTimestampMs(sale.updatedAt));

      if (endMs !== null && endMs > createdMs) {
        const durationMin = (endMs - createdMs) / 60000;
        if (durationMin >= MIN_VALID_SAMPLE_MINUTES && durationMin <= MAX_VALID_SAMPLE_MINUTES) {
          completedCandidates.push({
            createdMs,
            endMs,
            durationMin
          });
        }
      }
    }
  }

  // Tomar solo las comandas completadas más recientes para reflejar el ritmo actual de cocina
  completedCandidates.sort((a, b) => b.endMs - a.endMs);
  const recentCompleted = completedCandidates.slice(0, RECENT_SAMPLE_LIMIT);
  const completedDurations = recentCompleted.map((c) => c.durationMin);

  const avgCompletedMinutes = completedDurations.length > 0
    ? Math.max(1, Math.round(median(completedDurations)))
    : null;

  // Calcular ritmo promedio entre despachos recientes (para estimar avance de cola)
  let pacePerOrderMinutes = 2;
  if (recentCompleted.length >= 2) {
    const newestEnd = recentCompleted[0].endMs;
    const oldestEnd = recentCompleted[recentCompleted.length - 1].endMs;
    const spanMin = (newestEnd - oldestEnd) / 60000;
    if (spanMin > 0 && spanMin <= 90) {
      const computedPace = spanMin / (recentCompleted.length - 1);
      pacePerOrderMinutes = Math.min(8, Math.max(1, computedPace));
    } else if (avgCompletedMinutes !== null) {
      pacePerOrderMinutes = Math.min(6, Math.max(1.5, avgCompletedMinutes / 2));
    }
  } else if (avgCompletedMinutes !== null) {
    pacePerOrderMinutes = Math.min(6, Math.max(1.5, avgCompletedMinutes / 2));
  }

  const pendingCount = pendingWaitMinutes.length;
  const preparingCount = preparingWaitMinutes.length;
  const activeQueueCount = pendingCount + preparingCount;

  const allActiveWaits = [...pendingWaitMinutes, ...preparingWaitMinutes];
  const oldestActiveMinutes = allActiveWaits.length > 0
    ? Math.max(0, Math.round(Math.max(...allActiveWaits)))
    : 0;

  let estimatedMinutes = 0;
  let level = 'idle';
  let statusLabel = 'Sin cola';
  let headlineText = 'Sin espera';
  let summaryText = 'No hay comandas pendientes ni en preparación';

  if (activeQueueCount === 0 && avgCompletedMinutes === null) {
    estimatedMinutes = 0;
    level = 'idle';
    statusLabel = 'Libre';
    headlineText = 'Sin espera';
    summaryText = 'No hay pedidos en cocina en este momento';
  } else if (activeQueueCount === 0 && avgCompletedMinutes !== null) {
    estimatedMinutes = avgCompletedMinutes;
    level = avgCompletedMinutes <= 5 ? 'fast' : avgCompletedMinutes <= 12 ? 'moderate' : 'high';
    statusLabel = 'Sin fila';
    headlineText = `~${estimatedMinutes} min`;
    summaryText = `Cocina despejada • Promedio reciente: ${avgCompletedMinutes} min`;
  } else {
    const baseWait = avgCompletedMinutes !== null ? avgCompletedMinutes : Math.max(3, oldestActiveMinutes);
    const extraQueueOrders = Math.max(0, pendingCount - 1) + Math.floor(preparingCount / 2);
    const livePressure = oldestActiveMinutes + extraQueueOrders * pacePerOrderMinutes;
    const blended = avgCompletedMinutes !== null
      ? Math.max(baseWait, livePressure * 0.75 + baseWait * 0.25)
      : Math.max(3, livePressure);

    estimatedMinutes = Math.max(1, Math.round(blended));

    if (estimatedMinutes <= 5) {
      level = 'fast';
      statusLabel = 'Rápido';
    } else if (estimatedMinutes <= 12) {
      level = 'moderate';
      statusLabel = 'Moderado';
    } else {
      level = 'high';
      statusLabel = 'Demora alta';
    }

    headlineText = `~${estimatedMinutes} min`;
    const avgPart = avgCompletedMinutes !== null
      ? ` • Prom. comandas: ${avgCompletedMinutes} min`
      : '';
    summaryText = `${activeQueueCount} en cocina • Mayor espera actual: ${oldestActiveMinutes} min${avgPart}`;
  }

  return {
    estimatedMinutes,
    pendingCount,
    preparingCount,
    activeQueueCount,
    oldestActiveMinutes,
    avgCompletedMinutes,
    completedSampleCount: recentCompleted.length,
    level,
    statusLabel,
    headlineText,
    summaryText
  };
}
