// Pruebas del bloqueo del idioma durante la práctica (lógica pura, sin navegador).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRACTICE_LOCK_KEY,
  PRACTICE_ROUTES,
  canChangeLanguage,
  clearPracticeLock,
  isPracticeRoute,
  lockedLanguage,
  readPracticeLock,
  withLock,
  writePracticeLock,
} from './practiceLock.js';

// Almacenamiento simulado (sessionStorage en el navegador).
const fakeStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    size: () => map.size,
  };
};

test('las rutas del flujo de práctica están reconocidas', () => {
  for (const route of PRACTICE_ROUTES) {
    assert.equal(isPracticeRoute(route), true, route);
    assert.equal(isPracticeRoute(`${route}/detalle`), true, route);
  }
  for (const outside of ['/vocero', '/vocero/escenarios', '/vocero/progreso', '/admin', '/sistema', '']) {
    assert.equal(isPracticeRoute(outside), false, outside);
  }
});

test('sin bloqueo guardado no hay idioma bloqueado', () => {
  const storage = fakeStorage();
  assert.equal(readPracticeLock(storage), null);
  assert.equal(canChangeLanguage(null), true);
  assert.equal(lockedLanguage(null), null);
  assert.equal(withLock('en', null), 'en');
});

test('el bloqueo guarda el idioma normalizado, la sesión y la marca de tiempo', () => {
  const storage = fakeStorage();
  const stored = writePracticeLock({ language: 'EN', sessionId: 's-1' }, storage);
  assert.equal(stored.language, 'en');
  assert.equal(stored.sessionId, 's-1');
  assert.ok(stored.startedAt > 0);

  const read = readPracticeLock(storage);
  assert.deepEqual(read, stored);
  assert.equal(canChangeLanguage(read), false);
  assert.equal(lockedLanguage(read), 'en');
});

test('un bloqueo con idioma no habilitado se descarta', () => {
  const storage = fakeStorage();
  storage.setItem(PRACTICE_LOCK_KEY, JSON.stringify({ language: 'pt', sessionId: 's-2' }));
  assert.equal(readPracticeLock(storage), null, 'un idioma no habilitado no puede bloquear nada');
  assert.equal(writePracticeLock({ language: 'pt' }, storage), null);
  assert.equal(canChangeLanguage(readPracticeLock(storage)), true);
});

test('un contenido corrupto no rompe la lectura', () => {
  const storage = fakeStorage();
  storage.setItem(PRACTICE_LOCK_KEY, '{no-json');
  assert.equal(readPracticeLock(storage), null);
});

test('el bloqueo manda sobre cualquier preferencia y se puede liberar', () => {
  const storage = fakeStorage();
  const lock = writePracticeLock({ language: 'en' }, storage);
  // Durante la práctica el idioma de la sesión gana a la preferencia del usuario.
  assert.equal(withLock('es', lock), 'en');
  assert.equal(withLock(null, lock), 'en');

  clearPracticeLock(storage);
  assert.equal(readPracticeLock(storage), null);
  assert.equal(storage.size(), 0);
  assert.equal(withLock('es', null), 'es');
});
