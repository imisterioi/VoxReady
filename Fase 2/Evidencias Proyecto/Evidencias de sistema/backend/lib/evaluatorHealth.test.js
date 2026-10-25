// Comprobación anticipada de disponibilidad de los modelos evaluadores (sin red: fetch inyectado).
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  probeModel,
  preflight,
  shouldProbe,
  healthSnapshot,
  orderByHealth,
  classifyProbe,
  isHardFailure,
  limits,
  reset,
  _state: state,
} = require('./evaluatorHealth');

const ENV = { NVIDIA_API_KEY: 'clave-de-prueba' };
const VALID = { choices: [{ finish_reason: 'stop', message: { content: '{"coherencia":{"a":50},"empatia":{"b":50}}' } }] };
const jsonOk = (body = VALID, status = 200) => ({ ok: status < 300, status, json: async () => body });
const jsonStatus = (status) => async () => jsonOk({}, status);
const never = () =>
  new Promise((_resolve, reject) => {
    // La sonda aborta con AbortController: el doble debe rechazar como un fetch real.
    setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 5);
  });

test('un modelo que responde con JSON válido se marca disponible', async () => {
  const result = await probeModel('m-ok', { fetchImpl: async () => jsonOk(), apiKey: 'k', now: () => 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'OK');
  assert.equal(result.model, 'm-ok');
  assert.ok(Number.isFinite(result.ms));
});

test('HTTP 404, HTTP 410 y timeout se marcan como no disponibles (fallo duro)', async () => {
  for (const [status, expected] of [[404, 'HTTP_404'], [410, 'HTTP_410']]) {
    const result = await probeModel('m', { fetchImpl: jsonStatus(status), apiKey: 'k' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, expected);
    assert.equal(isHardFailure(expected), true);
  }
  const timedOut = await probeModel('m', { fetchImpl: never, apiKey: 'k', timeoutMs: 5 });
  assert.equal(timedOut.reason, 'TIMEOUT');
  assert.equal(isHardFailure('TIMEOUT'), true);
});

test('una respuesta truncada o sin JSON no es un fallo duro (el modelo puede servir con más tokens)', () => {
  assert.equal(classifyProbe({ ok: true, finish: 'length', usable: false }), 'TRUNCATED');
  assert.equal(classifyProbe({ ok: true, finish: 'stop', usable: false }), 'NO_JSON');
  assert.equal(classifyProbe({ errorName: 'AbortError' }), 'TIMEOUT');
  assert.equal(classifyProbe({ errorName: 'TypeError' }), 'NETWORK');
  assert.equal(isHardFailure('TRUNCATED'), false);
  assert.equal(isHardFailure('NO_JSON'), false);
});

test('sin clave no se emite ninguna solicitud', async () => {
  reset();
  let called = 0;
  const result = await preflight({ reason: 'test', env: {}, deps: { apiKey: '', fetchImpl: async () => { called += 1; } } });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'sin_clave');
  assert.equal(called, 0);
  assert.equal(shouldProbe({ env: {} }), false);
  assert.equal(state.runs, 0);
});

test('la comprobación no bloquea: devuelve enseguida mientras la sonda sigue en vuelo', async () => {
  reset();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const promise = preflight({ reason: 'prewarm', models: ['m1'], env: ENV, deps: { fetchImpl: () => pending } });
  assert.equal(typeof promise.then, 'function', 'devuelve una promesa, no espera');
  assert.equal(state.runs, 1, 'la tanda arranca sin que el llamador la espere');
  let settled = false;
  promise.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, 'sigue en vuelo: el llamador no se bloquea');
  release(jsonOk());
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(result.results[0].ok, true);
});

test('no se duplican comprobaciones: una tanda en vuelo y un intervalo mínimo', async () => {
  reset();
  const first = preflight({ reason: 'a', models: ['m1'], env: ENV, deps: { fetchImpl: async () => jsonOk() } });
  const second = preflight({ reason: 'b', models: ['m1'], env: ENV, deps: { fetchImpl: async () => jsonOk() } });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(state.runs, 1, 'la segunda llamada se deduplica');
  assert.equal(b.deduped, true);
  assert.equal(a.ok, true);
  assert.equal(shouldProbe({ env: ENV }), false, 'dentro del intervalo no se vuelve a sondear');
  const third = await preflight({ reason: 'c', models: ['m1'], env: ENV, deps: { fetchImpl: async () => jsonOk() } });
  assert.equal(third.skipped, true);
  assert.equal(state.runs, 1);
  assert.equal(shouldProbe({ env: ENV, now: () => Date.now() + 10 * 60 * 1000 }), true, 'pasado el intervalo sí se sondea');
});

test('una sonda antigua no sobrescribe un resultado más reciente', async () => {
  reset();
  await preflight({ reason: 'nueva', models: ['m1'], env: ENV, force: true, now: () => 5000, deps: { fetchImpl: jsonStatus(410) } });
  assert.equal(healthSnapshot({ now: () => 5000 }).m1.reason, 'HTTP_410');
  // Tanda "antigua" (empezó antes): su resultado no debe reemplazar el reciente.
  await preflight({ reason: 'antigua', models: ['m1'], env: ENV, force: true, now: () => 1000, deps: { fetchImpl: async () => jsonOk() } });
  assert.equal(healthSnapshot({ now: () => 5000 }).m1.reason, 'HTTP_410', 'se conserva el resultado más reciente');
  assert.equal(shouldProbe({ env: ENV, now: () => 5000 }), false, 'una tanda antigua no retrocede el intervalo');
});

test('la disponibilidad se reutiliza SOLO para ordenar: disponibles primero, los caídos siguen', async () => {
  reset();
  const fetchImpl = async (_url, init) => (JSON.parse(init.body).model === 'ok' ? jsonOk() : jsonOk({}, 404));
  await preflight({ reason: 'x', models: ['caido', 'ok'], env: ENV, force: true, deps: { fetchImpl } });

  const models = ['caido', 'ok'];
  assert.deepEqual(orderByHealth(models, { env: ENV }), ['ok', 'caido'], 'los disponibles van primero');
  assert.ok(orderByHealth(models, { env: ENV }).includes('caido'), 'el caído NO se excluye: puede recuperarse');
  assert.equal(limits(ENV).retryTimeoutMs, undefined, 'ya no existe un timeout corto de reintento');
});

test('un resultado antiguo deja de usarse para priorizar (TTL)', async () => {
  reset();
  await preflight({ reason: 'x', models: ['m1'], env: ENV, force: true, now: () => 1000, deps: { fetchImpl: jsonStatus(410) } });
  const old = { env: { ...ENV, AI_EVAL_HEALTH_TTL_MS: '1000' }, now: () => 60000 };
  assert.equal(healthSnapshot(old).m1.fresh, false);
  assert.deepEqual(orderByHealth(['m1', 'm2'], old), ['m1', 'm2'], 'sin datos frescos se conserva el orden dado');
});

test('el registro técnico no expone clave, prompt ni contenido', async () => {
  reset();
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await preflight({
      reason: 'prewarm',
      models: ['m1'],
      env: { NVIDIA_API_KEY: 'clave-secreta' },
      force: true,
      deps: { apiKey: 'clave-secreta', fetchImpl: jsonStatus(410) },
    });
  } finally {
    console.log = original;
  }
  const line = lines.join('\n');
  assert.match(line, /m1:HTTP_410/, 'el motivo y el modelo quedan registrados');
  assert.doesNotMatch(line, /clave-secreta/);
  assert.doesNotMatch(line, /coherencia/);
});

