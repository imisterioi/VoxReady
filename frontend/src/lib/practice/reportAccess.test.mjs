import assert from 'node:assert/strict';
import test from 'node:test';

import { describeStage, reportAccess, resolveReportSessionId, PENDING_MESSAGE, failureMessage, PERMANENT_MESSAGE, TRANSIENT_MESSAGE } from './reportAccess.js';

const session = (extra = {}) => ({ id: 's1', report: null, ...extra });

test('una sesión en proceso NO permite abrir el informe', () => {
  const r = reportAccess({ session: session(), evaluation: { state: 'processing', stage: 'ai' } });
  assert.equal(r.state, 'processing');
  assert.equal(r.canOpen, false);
  assert.match(r.title, /todavía se está generando/);
});

test('una sesión completada permite abrir su informe', () => {
  const r = reportAccess({ session: session({ report: { global: 80 } }), evaluation: { state: 'done' } });
  assert.equal(r.state, 'ready');
  assert.equal(r.canOpen, true);
});

test('una sesión fallida no se presenta como completada', () => {
  const r = reportAccess({ session: session(), evaluation: { state: 'failed', reason: 'AI_UNAVAILABLE' } });
  assert.equal(r.state, 'failed');
  assert.equal(r.canOpen, false);
});

test('un error de consulta nunca se interpreta como completado', () => {
  const r = reportAccess({ error: 'Sin conexión' });
  assert.equal(r.state, 'error');
  assert.equal(r.canOpen, false);
});

test('una sesión sin evaluación no se presenta como lista', () => {
  const r = reportAccess({ session: session(), evaluation: { state: 'idle' } });
  assert.equal(r.state, 'pending');
  assert.equal(r.canOpen, false);
});

test('sin sesión no hay acceso', () => {
  const r = reportAccess({ session: null });
  assert.equal(r.state, 'missing');
  assert.equal(r.canOpen, false);
});

test('el estado interrumpido se trata como fallo recuperable', () => {
  const r = reportAccess({ session: session(), evaluation: { state: 'stalled' } });
  assert.equal(r.state, 'failed');
  assert.match(r.description, /reintentarla/);
});

test('describeStage solo nombra etapas que existen', () => {
  assert.match(describeStage({ stage: 'audio' }), /Transcribiendo/);
  assert.match(describeStage({ stage: 'ai' }), /Evaluando/);
  assert.match(describeStage({ stage: 'done' }), /Preparando el informe/);
  assert.doesNotMatch(describeStage(null), /%|porcentaje/i);
});

// Aislamiento entre sesiones: cada informe pertenece a SU sesion.
const REPORT_A = { areas: [{ key: 'voice', score: 80 }] };
const A = { id: 'A', report: REPORT_A };
const B = { id: 'B', report: null };

test('A con informe valido se puede abrir', () => {
  const r = reportAccess({ session: A, evaluation: { state: 'done' } });
  assert.equal(r.state, 'ready');
  assert.equal(r.canOpen, true);
});

test('B fallida no ofrece informe ni hereda el de A', () => {
  const r = reportAccess({ session: B, evaluation: { state: 'failed', reason: 'TRANSCRIPTION_ANSWER_TRANSCRIPTION_FAILED' } });
  assert.equal(r.state, 'failed');
  assert.equal(r.canOpen, false);
});

test('B sin evaluacion iniciada queda pendiente y explicita', () => {
  const r = reportAccess({ session: B, evaluation: { state: 'idle' } });
  assert.equal(r.state, 'pending');
  assert.equal(r.canOpen, false);
});

test('A sigue accesible desde el historial con su propio id', () => {
  assert.equal(reportAccess({ session: A, evaluation: null }).canOpen, true);
  assert.equal(A.id, 'A');
  assert.equal(A.report, REPORT_A);
});
test('sin sesion indicada no se muestra ningun informe', () => {
  const target = resolveReportSessionId({});
  assert.equal(target.id, null);
  assert.equal(target.source, 'none');
});

test('la sesion del enlace manda sobre la practica reciente', () => {
  const target = resolveReportSessionId({ paramId: 'A', recentId: 'B' });
  assert.equal(target.id, 'A');
  assert.equal(target.source, 'url');
});

test('si la practica reciente fallo se muestra SU estado, no el informe de otra', () => {
  const target = resolveReportSessionId({ recentId: 'B' });
  assert.equal(target.id, 'B');
  assert.equal(target.source, 'recent');
  const r = reportAccess({ session: B, evaluation: { state: 'failed' } });
  assert.equal(r.canOpen, false);
  assert.equal(r.state, 'failed');
});

test('una practica reciente en curso queda pendiente, sin informe', () => {
  const r = reportAccess({ session: B, evaluation: { state: 'processing', stage: 'audio' } });
  assert.equal(r.canOpen, false);
  assert.equal(r.state, 'processing');
});

test('un reintento programado se muestra como espera, nunca como error tecnico', () => {
  const r = reportAccess({ session: session(), evaluation: { state: 'retrying', attempts: 2, nextAttemptAt: Date.now() + 180000 } });
  assert.equal(r.state, 'pending');
  assert.equal(r.canOpen, false);
  assert.match(r.title, /disponible m/i);
  const visible = `${r.title} ${r.description}`;
  for (const token of ['HTTP', 'modelo', 'AI_UNAVAILABLE', 'nvidia', 'glm', 'intento']) {
    assert.ok(!visible.includes(token), `no debe exponer "${token}"`);
  }
});

test('una sesion agotada tambien se muestra como espera discreta', () => {
  const r = reportAccess({ session: session(), evaluation: { state: 'exhausted', attempts: 50, maxAttempts: 50 } });
  assert.equal(r.state, 'pending');
  assert.equal(r.canOpen, false);
  assert.match(r.description, /No necesitas hacer nada/i);
});

test('el estado de espera describe una etapa legible', () => {
  assert.match(describeStage({ stage: 'pending' }), /informe/i);
  assert.match(describeStage({ stage: 'exhausted' }), /informe/i);
});


test('el aviso de espera indica que el informe estará en «Mi progreso»', () => {
  const r = reportAccess({ session: session(), evaluation: { state: 'retrying', attempts: 1 } });
  assert.equal(r.state, 'pending');
  assert.match(r.description, /Mi progreso/);
  assert.match(r.description, /segundo plano/);
  assert.match(PENDING_MESSAGE, /No necesitas hacer nada/);
});

test('un fallo permanente no se presenta como un simple retraso', () => {
  const r = reportAccess({ session: session(), evaluation: { state: 'retrying', attempts: 1, errorKind: 'permanent' } });
  assert.equal(r.state, 'pending');
  assert.equal(r.description, PERMANENT_MESSAGE);
  assert.match(r.description, /revisando/i);
  assert.doesNotMatch(r.description, /automáticamente/i);
});

test('un fallo temporal explica que se reintentará solo', () => {
  const r = reportAccess({ session: session(), evaluation: { state: 'failed', errorKind: 'transient' } });
  assert.equal(r.state, 'failed');
  assert.equal(r.description, TRANSIENT_MESSAGE);
  assert.match(r.description, /se volverá a intentar automáticamente/i);
});

test('sin clasificación se asume temporal y nunca se exponen detalles técnicos', () => {
  const r = reportAccess({ session: session(), evaluation: { state: 'failed', reason: 'AI_UNAVAILABLE' } });
  assert.equal(r.description, failureMessage(null));
  const visible = `${r.title} ${r.description}`;
  for (const token of ['HTTP', '404', 'modelo', 'nvidia', 'glm', 'timeout', 'AI_UNAVAILABLE']) {
    assert.ok(!visible.includes(token), `no debe exponer "${token}"`);
  }
});

