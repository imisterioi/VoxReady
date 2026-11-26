// Informes en preparación y listos sin ver, para avisar al vocero aunque salga de «Analizando».
//
// - Al pedir el análisis, la sesión queda «en preparación» (`watchReport`).
// - El layout consulta esas sesiones en segundo plano; cuando el informe está listo, la pasa a
//   «sin ver» (`markReportReady`), muestra un aviso arriba y un contador en la pestaña Progreso.
// - El contador se limpia al entrar a Progreso o al abrir ese informe (`clearUnseen`).
//
// Vive en `localStorage` por usuario (sobrevive a recargas y no se mezcla entre cuentas del
// mismo navegador). `storage` se inyecta para poder probarlo en Node.
// La extensión es explícita para que el módulo también se pueda importar desde Node (pruebas).

export const REPORTS_EVENT = 'voxready:reports';
const PENDING = 'voxready_reports_pending';
const UNSEEN = 'voxready_reports_unseen';
// Un informe que no llega en 2 horas deja de vigilarse (la evaluación quedó en revisión técnica).
export const MAX_WATCH_MS = 2 * 60 * 60 * 1000;

const keyFor = (base, userId) => `${base}:${userId || 'anon'}`;
const defaultStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

function read(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function write(storage, key, list, notify = true) {
  try {
    storage?.setItem(key, JSON.stringify(list));
  } catch {
    /* sin almacenamiento: el aviso no persiste, la app sigue funcionando */
  }
  if (notify && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(REPORTS_EVENT));
  }
}

export function pendingReports(userId, { storage = defaultStorage(), now = Date.now() } = {}) {
  return read(storage, keyFor(PENDING, userId)).filter((item) => now - (item.since || 0) < MAX_WATCH_MS);
}

export function unseenReports(userId, { storage = defaultStorage() } = {}) {
  return read(storage, keyFor(UNSEEN, userId));
}

export function watchReport(userId, { sessionId, theme = '' } = {}, { storage = defaultStorage(), now = Date.now() } = {}) {
  if (!sessionId) return;
  const list = pendingReports(userId, { storage, now }).filter((item) => item.sessionId !== sessionId);
  write(storage, keyFor(PENDING, userId), [...list, { sessionId, theme, since: now }]);
}

export function unwatchReport(userId, sessionId, { storage = defaultStorage() } = {}) {
  const list = read(storage, keyFor(PENDING, userId));
  const next = list.filter((item) => item.sessionId !== sessionId);
  if (next.length !== list.length) write(storage, keyFor(PENDING, userId), next);
}

// El informe quedó listo: deja de vigilarse y suma al contador de «sin ver».
export function markReportReady(userId, { sessionId, theme = '' } = {}, { storage = defaultStorage() } = {}) {
  unwatchReport(userId, sessionId, { storage });
  const list = unseenReports(userId, { storage }).filter((item) => item.sessionId !== sessionId);
  write(storage, keyFor(UNSEEN, userId), [...list, { sessionId, theme }]);
}

// Sin `sessionId` limpia todos (al entrar a Progreso); con él, solo ese informe (al abrirlo).
export function clearUnseen(userId, sessionId = null, { storage = defaultStorage() } = {}) {
  const list = unseenReports(userId, { storage });
  const next = sessionId ? list.filter((item) => item.sessionId !== sessionId) : [];
  if (next.length !== list.length) write(storage, keyFor(UNSEEN, userId), next);
}
