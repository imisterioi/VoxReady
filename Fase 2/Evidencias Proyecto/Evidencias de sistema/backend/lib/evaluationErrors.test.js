// Pruebas de la clasificación de errores de evaluación: temporal (se reintenta) vs permanente
// (requiere revisión técnica). No cambian la política de reintentos: solo deciden el registro y el
// mensaje del vocero. Ningún mensaje puede exponer códigos, modelos ni proveedores.
const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyEvaluationError, TRANSIENT_MESSAGE, PERMANENT_MESSAGE } = require('./evaluationErrors');

test('un timeout del proveedor es un fallo temporal', () => {
  const result = classifyEvaluationError({ code: 'AI_UNAVAILABLE', reasons: ['tiempo agotado (90000 ms)'] });
  assert.equal(result.kind, 'transient');
  assert.equal(result.needsReview, false);
  assert.equal(result.userMessage, TRANSIENT_MESSAGE);
});

test('un error 5xx, 429 o de red es un fallo temporal', () => {
  for (const reason of ['HTTP 503', 'HTTP 429', 'ECONNRESET', 'respuesta incompleta (límite de tokens)', 'JSON sin puntajes']) {
    const result = classifyEvaluationError({ code: 'AI_UNAVAILABLE', reasons: [reason] });
    assert.equal(result.kind, 'transient', `${reason} debe ser temporal`);
  }
});

test('un modelo inexistente o credenciales rechazadas son un fallo permanente', () => {
  for (const reason of ['HTTP 404', 'HTTP 410', 'HTTP 401', 'HTTP 403']) {
    const result = classifyEvaluationError({ code: 'AI_UNAVAILABLE', reasons: [reason] });
    assert.equal(result.kind, 'permanent', `${reason} debe ser permanente`);
    assert.equal(result.needsReview, true);
    assert.equal(result.userMessage, PERMANENT_MESSAGE);
  }
});

test('la falta de clave o de modelos es un fallo de configuración (permanente)', () => {
  assert.equal(classifyEvaluationError({ code: 'NO_API_KEY' }).kind, 'permanent');
  assert.equal(classifyEvaluationError({ code: 'NO_MODELS' }).kind, 'permanent');
});

test('un audio no separable es un problema de datos (permanente)', () => {
  const result = classifyEvaluationError({ code: 'TRANSCRIPTION_NO_WINDOWS' });
  assert.equal(result.kind, 'permanent');
});

test('si algún motivo es temporal, el fallo se mantiene reintentable', () => {
  const result = classifyEvaluationError({ code: 'AI_UNAVAILABLE', reasons: ['HTTP 404', 'tiempo agotado (20000 ms)'] });
  assert.equal(result.kind, 'transient', 'un modelo caído no debe bloquear a los demás');
});

test('sin motivos y con código desconocido se asume temporal', () => {
  assert.equal(classifyEvaluationError({ code: 'AI_UNAVAILABLE' }).kind, 'transient');
  assert.equal(classifyEvaluationError({}).kind, 'transient');
  assert.equal(classifyEvaluationError().kind, 'transient');
});

test('los mensajes al vocero no exponen detalles técnicos', () => {
  for (const message of [TRANSIENT_MESSAGE, PERMANENT_MESSAGE]) {
    for (const token of ['HTTP', '404', '401', 'modelo', 'nvidia', 'glm', 'timeout', 'API']) {
      assert.ok(!message.includes(token), `no debe exponer "${token}"`);
    }
  }
  assert.match(TRANSIENT_MESSAGE, /se volverá a intentar automáticamente/i);
});
