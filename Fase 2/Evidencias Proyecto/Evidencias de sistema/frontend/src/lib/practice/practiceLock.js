// Bloqueo del idioma durante una práctica.
//
// REGLA: desde que el vocero entra en la preparación de una práctica hasta que el proceso termina
// (informe disponible) el idioma NO se puede cambiar. El idioma de la práctica es el de la sesión
// (`Session.language`), que el backend congela al crearla.
//
// El bloqueo vive en `sessionStorage` (sobrevive a recargas y a navegar atrás/adelante dentro de la
// misma pestaña) y se libera al salir del flujo de práctica o al quedar el informe listo.
//
// Lógica pura (sin React): se puede probar con un almacenamiento simulado.
// La extensión es explícita para que el módulo también se pueda importar desde Node (pruebas).
import { normalizeLanguage } from '../language.js';

export const PRACTICE_LOCK_KEY = 'voxready_practice_lock';

// Rutas que forman parte del flujo de práctica (preparación → entrevista → análisis → informe).
export const PRACTICE_ROUTES = ['/vocero/preparar', '/vocero/sesion', '/vocero/analizando', '/vocero/informe'];

// ¿La ruta indicada pertenece al flujo de práctica?
export function isPracticeRoute(pathname) {
  const path = String(pathname || '');
  return PRACTICE_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}

const storageOf = (storage) => {
  if (storage) return storage;
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

// Bloqueo activo: { language, sessionId, startedAt } o null si no hay práctica en curso.
export function readPracticeLock(storage = null) {
  const store = storageOf(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(PRACTICE_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const language = normalizeLanguage(parsed?.language);
    // Un bloqueo sin idioma válido no sirve de nada: se descarta.
    if (!language) return null;
    return { language, sessionId: parsed?.sessionId || null, startedAt: parsed?.startedAt || null };
  } catch {
    return null;
  }
}

export function writePracticeLock(lock, storage = null) {
  const store = storageOf(storage);
  const language = normalizeLanguage(lock?.language);
  if (!store || !language) return null;
  const value = { language, sessionId: lock?.sessionId || null, startedAt: lock?.startedAt || Date.now() };
  try {
    store.setItem(PRACTICE_LOCK_KEY, JSON.stringify(value));
  } catch {
    /* almacenamiento no disponible */
  }
  return value;
}

export function clearPracticeLock(storage = null) {
  const store = storageOf(storage);
  try {
    store?.removeItem(PRACTICE_LOCK_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

// Idioma bloqueado (o null si no hay bloqueo).
export function lockedLanguage(lock) {
  return normalizeLanguage(lock?.language);
}

// Idioma activo con el bloqueo aplicado: durante la práctica manda siempre el de la sesión.
export function withLock(fallback, lock) {
  return lockedLanguage(lock) || normalizeLanguage(fallback) || null;
}

// ¿Se puede cambiar el idioma ahora mismo?
export function canChangeLanguage(lock) {
  return !lockedLanguage(lock);
}
