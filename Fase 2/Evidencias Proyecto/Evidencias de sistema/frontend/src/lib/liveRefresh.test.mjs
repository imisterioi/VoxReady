// Pruebas de la detección de notificaciones nuevas del latido.
import assert from 'node:assert/strict';
import test from 'node:test';

import { newUnread } from './liveRefresh.js';

const item = (sessionId, sentAt, unread = true) => ({ sessionId, sentAt, unread });

test('la primera consulta solo registra: no avisa de lo que ya existía', () => {
  const { fresh, keys } = newUnread([item('s1', 'a')], null);
  assert.equal(fresh.length, 0);
  assert.equal(keys.size, 1);
});

test('avisa solo de las no leídas que no estaban antes', () => {
  const first = newUnread([item('s1', 'a')], null);
  const { fresh } = newUnread([item('s1', 'a'), item('s2', 'b')], first.keys);
  assert.deepEqual(fresh.map((i) => i.sessionId), ['s2']);
});

test('una nueva revisión del mismo informe (otra fecha de envío) también es nueva', () => {
  const first = newUnread([item('s1', 'a')], null);
  const { fresh } = newUnread([item('s1', 'b')], first.keys);
  assert.deepEqual(fresh.map((i) => i.sentAt), ['b']);
});

test('las leídas no avisan', () => {
  const first = newUnread([], null);
  const { fresh } = newUnread([item('s1', 'a', false)], first.keys);
  assert.equal(fresh.length, 0);
});
