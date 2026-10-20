import assert from 'node:assert/strict';
import test from 'node:test';

import { describeStage, reportAccess } from './reportAccess.js';

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
