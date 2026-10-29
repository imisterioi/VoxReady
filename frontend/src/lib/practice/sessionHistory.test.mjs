// Historial de prácticas: estados derivados del backend (no de la ausencia de informe).
import test from 'node:test';
import assert from 'node:assert/strict';

import { HISTORY_LABELS, canOpenReport, evaluatedSessions, historyStatus } from './sessionHistory.js';

const session = (extra = {}) => ({ id: 's1', createdAt: new Date().toISOString(), hasReport: false, score: null, areas: [], ...extra });

test('una sesión reciente sin informe sigue en el historial como "en preparación"', () => {
  const status = historyStatus(session({ evaluation: { state: 'processing' } }));
  assert.equal(status.key, 'preparing');
  assert.equal(status.label, HISTORY_LABELS.preparing);
  assert.equal(canOpenReport(session()), false);
});

test('una evaluación con reintento programado también es "en preparación"', () => {
  const status = historyStatus(session({ evaluation: { state: 'retrying', nextAttemptAt: Date.now() + 180000 } }));
  assert.equal(status.key, 'preparing');
  assert.equal(status.label, 'Informe en preparación');
});

test('una sesión sin evaluación solicitada no promete un informe que no viene', () => {
  const status = historyStatus(session());
  assert.equal(status.key, 'idle');
  assert.equal(status.label, HISTORY_LABELS.idle);
});

test('un informe válido se muestra como disponible y se puede abrir', () => {
  const evaluated = session({ hasReport: true, score: 82, areas: [{ key: 'voice', label: 'Tono de voz', score: 82 }] });
  const status = historyStatus(evaluated);
  assert.equal(status.key, 'ready');
  assert.equal(status.label, HISTORY_LABELS.ready);
  assert.equal(canOpenReport(evaluated), true);
});

test('una sesión agotada se identifica con un mensaje comprensible y sin errores internos', () => {
  const status = historyStatus(session({ evaluation: { state: 'exhausted', attempts: 50, maxAttempts: 50 } }));
  assert.equal(status.key, 'exhausted');
  assert.equal(status.label, HISTORY_LABELS.exhausted);
  const visible = `${status.label}`;
  for (const token of ['HTTP', 'modelo', 'AI_UNAVAILABLE', 'Prisma', 'intento', 'exhausted']) {
    assert.ok(!visible.includes(token), `no debe exponer "${token}"`);
  }
});

test('un error definitivo se distingue de una evaluación que está reintentando', () => {
  const failed = historyStatus(session({ evaluation: { state: 'failed', reason: 'AI_UNAVAILABLE' } }));
  const retrying = historyStatus(session({ evaluation: { state: 'retrying' } }));
  assert.equal(failed.key, 'failed');
  assert.notEqual(failed.key, retrying.key);
  assert.equal(failed.label, HISTORY_LABELS.failed);
});

test('las vistas numéricas usan solo sesiones con informe válido', () => {
  const list = [
    session({ id: 'a', hasReport: true, score: 70, areas: [] }),
    session({ id: 'b', evaluation: { state: 'processing' } }),
    session({ id: 'c', score: 55, hasReport: true }),
    session({ id: 'd', evaluation: { state: 'exhausted' } }),
  ];
  assert.deepEqual(evaluatedSessions(list).map((s) => s.id), ['a', 'c']);
  assert.equal(evaluatedSessions(null).length, 0);
});

test('la ausencia de informe o puntuación no descarta la sesión del listado', () => {
  const list = [session({ id: 'x' }), session({ id: 'y', score: null, hasReport: false })];
  // El listado es el array completo que devuelve el backend: se comprueba que el helper de estado
  // no descarta nada (no filtra) y que solo el filtrado numérico excluye.
  assert.equal(list.length, 2);
  assert.equal(list.filter((s) => historyStatus(s).key !== 'ready').length, 2);
  assert.equal(evaluatedSessions(list).length, 0);
});
