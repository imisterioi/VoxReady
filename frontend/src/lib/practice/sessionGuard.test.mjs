import assert from 'node:assert/strict';
import test from 'node:test';

import { discardUnusedSession, shouldDiscardSession } from './sessionGuard.js';

// Una sesión creada por una práctica que no llegó a empezar NO debe quedarse en la base:
// eso era el registro `CREATED` vacío que aparecía junto a la sesión realmente usada.

test('descarta la sesión cuando la práctica no llegó a empezar', () => {
  assert.equal(shouldDiscardSession({ sessionId: 's1', interviewStarted: false, finishing: false }), true);
});

test('no descarta nada si no hay sesión creada (doble montaje de React)', () => {
  assert.equal(shouldDiscardSession({ sessionId: null, interviewStarted: false, finishing: false }), false);
  assert.equal(shouldDiscardSession({}), false);
});

test('nunca descarta una sesión cuya entrevista ya empezó: puede tener datos', () => {
  assert.equal(shouldDiscardSession({ sessionId: 's1', interviewStarted: true, finishing: false }), false);
  assert.equal(shouldDiscardSession({ sessionId: 's1', interviewStarted: true, finishing: true }), false);
});

test('no descarta mientras se está cerrando la entrevista (esa sesión se evalúa)', () => {
  assert.equal(shouldDiscardSession({ sessionId: 's1', interviewStarted: false, finishing: true }), false);
});

test('discardUnusedSession elimina por API y avisa de la sesión descartada', async () => {
  const deleted = [];
  const notified = [];
  const ok = await discardUnusedSession({
    sessionId: 's9',
    interviewStarted: false,
    finishing: false,
    del: async (id) => deleted.push(id),
    onDiscarded: (id) => notified.push(id),
  });
  assert.equal(ok, true);
  assert.deepEqual(deleted, ['s9']);
  assert.deepEqual(notified, ['s9']);
});

test('no llama a la API cuando no corresponde descartar', async () => {
  let calls = 0;
  const del = async () => {
    calls += 1;
  };
  assert.equal(await discardUnusedSession({ sessionId: null, del }), false);
  assert.equal(await discardUnusedSession({ sessionId: 's1', interviewStarted: true, del }), false);
  assert.equal(await discardUnusedSession({ sessionId: 's1', finishing: true, del }), false);
  assert.equal(calls, 0);
});

test('un fallo al descartar no propaga el error ni marca la sesión como descartada', async () => {
  const notified = [];
  const ok = await discardUnusedSession({
    sessionId: 's1',
    del: async () => {
      throw new Error('sin conexión');
    },
    onDiscarded: (id) => notified.push(id),
  });
  assert.equal(ok, false);
  assert.deepEqual(notified, []);
});
