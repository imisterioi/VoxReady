// Pruebas de los avisos de informe listo (en preparación → sin ver → visto).
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_WATCH_MS,
  clearUnseen,
  markReportReady,
  pendingReports,
  unseenReports,
  unwatchReport,
  watchReport,
} from './reportWatch.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

test('una sesión vigilada aparece en preparación y no se duplica', () => {
  const storage = memoryStorage();
  watchReport('u1', { sessionId: 's1', theme: 'MichiGate' }, { storage, now: 1000 });
  watchReport('u1', { sessionId: 's1', theme: 'MichiGate' }, { storage, now: 2000 });
  assert.deepEqual(pendingReports('u1', { storage, now: 3000 }).map((i) => i.sessionId), ['s1']);
});

test('al quedar listo pasa a «sin ver» y deja de vigilarse', () => {
  const storage = memoryStorage();
  watchReport('u1', { sessionId: 's1', theme: 'MichiGate' }, { storage });
  markReportReady('u1', { sessionId: 's1', theme: 'MichiGate' }, { storage });
  assert.equal(pendingReports('u1', { storage }).length, 0);
  assert.deepEqual(unseenReports('u1', { storage }), [{ sessionId: 's1', theme: 'MichiGate' }]);
});

test('abrir un informe limpia solo ese; entrar a Progreso limpia todos', () => {
  const storage = memoryStorage();
  markReportReady('u1', { sessionId: 's1' }, { storage });
  markReportReady('u1', { sessionId: 's2' }, { storage });
  clearUnseen('u1', 's1', { storage });
  assert.deepEqual(unseenReports('u1', { storage }).map((i) => i.sessionId), ['s2']);
  clearUnseen('u1', null, { storage });
  assert.equal(unseenReports('u1', { storage }).length, 0);
});

test('los avisos no se mezclan entre usuarios del mismo navegador', () => {
  const storage = memoryStorage();
  markReportReady('u1', { sessionId: 's1' }, { storage });
  assert.equal(unseenReports('u2', { storage }).length, 0);
});

test('una sesión que nunca termina deja de vigilarse pasado el máximo', () => {
  const storage = memoryStorage();
  watchReport('u1', { sessionId: 's1' }, { storage, now: 0 });
  assert.equal(pendingReports('u1', { storage, now: MAX_WATCH_MS + 1 }).length, 0);
});

test('dejar de vigilar una sesión desconocida no rompe nada', () => {
  const storage = memoryStorage();
  unwatchReport('u1', 'nada', { storage });
  assert.equal(pendingReports('u1', { storage }).length, 0);
});
