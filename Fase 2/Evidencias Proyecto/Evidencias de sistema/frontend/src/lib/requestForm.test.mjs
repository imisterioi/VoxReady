import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_REQUEST_TYPE,
  MAX_DAYS,
  REQUEST_TYPES,
  buildRequestPayload,
  emptyRequestForm,
  requestType,
  suggestedExtensionDays,
  switchRequestType,
  validateRequestForm,
} from './requestForm.js';

test('solo se ofrecen los tipos que el backend admite', () => {
  assert.deepEqual(REQUEST_TYPES.map((t) => t.value), ['RECORDINGS', 'ANONYMIZE', 'RETENTION_EXTENSION']);
  assert.equal(requestType('RECORDINGS').endpoint, '/api/deletion-requests');
  assert.equal(requestType('ANONYMIZE').endpoint, '/api/deletion-requests');
  assert.equal(requestType('RETENTION_EXTENSION').endpoint, '/api/retention-requests');
  assert.equal(requestType('INVENTADO'), null);
});

test('cada tipo declara los campos que necesita', () => {
  assert.deepEqual(requestType('RECORDINGS').fields, ['targetUserId', 'reason']);
  assert.deepEqual(requestType('ANONYMIZE').fields, ['targetUserId', 'reason']);
  assert.deepEqual(requestType('RETENTION_EXTENSION').fields, ['requestedDays', 'reason']);
});

test('el formulario arranca vacío y con el primer tipo', () => {
  assert.deepEqual(emptyRequestForm(), { type: DEFAULT_REQUEST_TYPE, targetUserId: '', requestedDays: '', reason: '' });
});

test('cambiar de tipo limpia los campos del tipo anterior', () => {
  const conVocero = { type: 'ANONYMIZE', targetUserId: 'u-1', requestedDays: '', reason: 'motivo' };
  const extension = switchRequestType('RETENTION_EXTENSION');
  assert.equal(extension.type, 'RETENTION_EXTENSION');
  assert.equal(extension.targetUserId, '', 'el vocero del tipo anterior no se arrastra');
  assert.equal(extension.requestedDays, '');

  const vuelta = switchRequestType('RECORDINGS');
  assert.equal(vuelta.targetUserId, '');
  assert.equal(vuelta.requestedDays, '', 'el plazo del tipo anterior no se arrastra');
  assert.equal(vuelta.reason, '');
  assert.notEqual(conVocero.targetUserId, vuelta.targetUserId);
});

test('el cuerpo de una solicitud de privacidad solo lleva sus campos', () => {
  const payload = buildRequestPayload({ type: 'ANONYMIZE', targetUserId: 'u-1', requestedDays: '365', reason: '  Derecho al olvido  ' });
  assert.equal(payload.endpoint, '/api/deletion-requests');
  assert.deepEqual(payload.body, { targetUserId: 'u-1', scope: 'ANONYMIZE', reason: 'Derecho al olvido' });
  assert.equal('requestedDays' in payload.body, false, 'no se envía el plazo de otro tipo');
});

test('el cuerpo de una extensión solo lleva sus campos', () => {
  const payload = buildRequestPayload({ type: 'RETENTION_EXTENSION', targetUserId: 'u-1', requestedDays: '180', reason: '' });
  assert.equal(payload.endpoint, '/api/retention-requests');
  assert.deepEqual(payload.body, { requestedDays: 180, reason: '' });
  assert.equal('targetUserId' in payload.body, false, 'no se envía el vocero de otro tipo');
  assert.equal('scope' in payload.body, false);
});

test('una solicitud de privacidad exige vocero', () => {
  const sinVocero = validateRequestForm({ type: 'RECORDINGS', targetUserId: '' });
  assert.equal(sinVocero.ok, false);
  assert.match(sinVocero.error, /vocero/i);
  assert.equal(buildRequestPayload({ type: 'RECORDINGS', targetUserId: '' }), null, 'sin vocero no hay cuerpo que enviar');
});

test('una extensión exige un plazo válido y mayor que el vigente', () => {
  const actual = { currentDays: 90 };
  assert.equal(validateRequestForm({ type: 'RETENTION_EXTENSION', requestedDays: '' }, actual).ok, false);
  assert.equal(validateRequestForm({ type: 'RETENTION_EXTENSION', requestedDays: '90' }, actual).ok, false);
  assert.match(validateRequestForm({ type: 'RETENTION_EXTENSION', requestedDays: '90' }, actual).error, /mayor que el plazo vigente/i);
  assert.equal(validateRequestForm({ type: 'RETENTION_EXTENSION', requestedDays: '91' }, actual).ok, true);
  assert.equal(validateRequestForm({ type: 'RETENTION_EXTENSION', requestedDays: String(MAX_DAYS + 1) }, actual).ok, false);
  assert.equal(buildRequestPayload({ type: 'RETENTION_EXTENSION', requestedDays: '10' }, actual), null);
});

test('el motivo es opcional y se envía sin espacios sobrantes', () => {
  const sinMotivo = buildRequestPayload({ type: 'RECORDINGS', targetUserId: 'u-2' });
  assert.deepEqual(sinMotivo.body, { targetUserId: 'u-2', scope: 'RECORDINGS', reason: '' });
});

test('un tipo desconocido no produce cuerpo (no se envía nada raro)', () => {
  assert.equal(buildRequestPayload({ type: 'OTRO', targetUserId: 'u-1' }), null);
  assert.equal(validateRequestForm({ type: 'OTRO' }).ok, false);
});

test('el plazo sugerido es el doble del vigente, dentro del máximo', () => {
  assert.equal(suggestedExtensionDays(90), 180);
  assert.equal(suggestedExtensionDays(0), 2);
  assert.equal(suggestedExtensionDays(MAX_DAYS), MAX_DAYS);
});
