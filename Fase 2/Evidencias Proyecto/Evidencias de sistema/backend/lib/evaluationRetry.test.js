// Política de reintentos: intervalos, tandas, pausas y tope de 50 intentos (función pura).
const test = require('node:test');
const assert = require('node:assert/strict');

const { nextDelayFor, retryState, limits } = require('./evaluationRetry');

const MIN = 60 * 1000;

test('la espera normal es de 3 minutos', () => {
  const { retryMs, batchPauseMs } = limits();
  assert.equal(retryMs, 3 * MIN);
  assert.equal(batchPauseMs, 15 * MIN);
  assert.equal(nextDelayFor(1), retryMs);
  assert.equal(nextDelayFor(2), retryMs);
  assert.equal(nextDelayFor(4), retryMs);
  assert.equal(nextDelayFor(6), retryMs);
  assert.equal(nextDelayFor(9), retryMs);
  assert.equal(nextDelayFor(49), retryMs);
});

test('cada 5 intentos fallidos se aplica la pausa de 15 minutos', () => {
  const { batchPauseMs } = limits();
  for (const attempts of [5, 10, 15, 20, 45]) {
    assert.equal(nextDelayFor(attempts), batchPauseMs, `intento ${attempts} debe pausar 15 min`);
  }
});

test('a los 50 intentos no se programa nada más', () => {
  assert.equal(nextDelayFor(50), null);
  assert.equal(nextDelayFor(51), null);
  assert.equal(limits().maxAttempts, 50);
});

test('retryState resume el estado persistido de la sesión', () => {
  const now = () => 1000;
  const base = { evalAttempts: 3, evalNextAt: new Date(2000), evalExhausted: false, evalLeaseUntil: new Date(1500) };
  const state = retryState(base, { now });
  assert.equal(state.attempts, 3);
  assert.equal(state.due, false);
  assert.equal(state.exhausted, false);
  assert.equal(state.leaseUntil, 1500);
  assert.equal(retryState({ ...base, evalNextAt: new Date(500) }, { now }).due, true);
  assert.equal(retryState({ ...base, evalAttempts: 50 }, { now }).exhausted, true);
  assert.equal(retryState({ report: { global: 80 }, evalAttempts: 1 }, { now }).hasReport, true);
});
