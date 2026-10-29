// Pruebas de dbRetry: reintentos limitados con espera progresiva solo para errores transitorios.
const test = require('node:test');
const assert = require('node:assert/strict');
const { withRetry, isTransientError } = require('./dbRetry');

test('isTransientError: detecta códigos Prisma transitorios', () => {
  assert.equal(isTransientError({ code: 'P1001' }), true);
  assert.equal(isTransientError({ code: '57P01' }), true);
  assert.equal(isTransientError({ code: '53300' }), true);
});

test('isTransientError: detecta mensajes de error de red/DNS', () => {
  assert.equal(isTransientError({ code: 'P2002', message: 'Unique constraint failed' }), false);
  assert.equal(isTransientError({ code: 'P2025', message: 'Record not found' }), false);
  assert.equal(isTransientError({ message: 'getaddrinfo EAI_AGAIN postgres' }), true);
  assert.equal(isTransientError({ message: 'getaddrinfo EAI_NONAME postgres' }), true);
  assert.equal(isTransientError({ message: 'ECONNREFUSED 127.0.0.1:5432' }), true);
  assert.equal(isTransientError({ message: 'Can\'t reach database server at postgres' }), true);
  assert.equal(isTransientError({ message: 'Something else entirely' }), false);
});

test('isTransientError: error nulo o indefinido no es transitorio', () => {
  assert.equal(isTransientError(null), false);
  assert.equal(isTransientError(undefined), false);
});

test('withRetry: tiene éxito en el primer intento', async () => {
  let calls = 0;
  const result = await withRetry(() => {
    calls += 1;
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('withRetry: reintenta tras error transitorio y tiene éxito', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls < 3) {
      const err = new Error('getaddrinfo EAI_AGAIN postgres');
      err.code = 'EAI_AGAIN';
      throw err;
    }
    return 'recuperado';
  }, { maxAttempts: 5, baseDelayMs: 10 });
  assert.equal(result, 'recuperado');
  assert.equal(calls, 3);
});

test('withRetry: no reintenta errores no transitorios', async () => {
  let calls = 0;
  let threw = null;
  try {
    await withRetry(async () => {
      calls += 1;
      const err = new Error('Unique constraint failed');
      err.code = 'P2002';
      throw err;
    }, { maxAttempts: 5, baseDelayMs: 10 });
  } catch (e) {
    threw = e;
  }
  assert.equal(calls, 1, 'no debe reintentar error no transitorio');
  assert.equal(threw.code, 'P2002');
});

test('withRetry: lanza el último error tras agotar intentos', async () => {
  let calls = 0;
  let threw = null;
  try {
    await withRetry(async () => {
      calls += 1;
      const err = new Error('getaddrinfo EAI_AGAIN postgres');
      err.code = 'EAI_AGAIN';
      throw err;
    }, { maxAttempts: 3, baseDelayMs: 10 });
  } catch (e) {
    threw = e;
  }
  assert.equal(calls, 3, 'debe haber agotado todos los intentos');
  assert.equal(threw.code, 'EAI_AGAIN');
});

test('withRetry: respeta maxAttempts y baseDelayMs', async () => {
  const delays = [];
  const originalSetTimeout = setTimeout;
  // No podemos mockear setTimeout fácilmente, así que usamos baseDelayMs muy pequeño
  // y verificamos el número de intentos.
  let calls = 0;
  let threw = null;
  try {
    await withRetry(async () => {
      calls += 1;
      const err = new Error('Can\'t reach database server at postgres');
      err.code = 'P1001';
      throw err;
    }, { maxAttempts: 4, baseDelayMs: 5 });
  } catch (e) {
    threw = e;
  }
  assert.equal(calls, 4, 'debe intentar exactamente maxAttempts veces');
  assert.equal(threw.code, 'P1001');
});
