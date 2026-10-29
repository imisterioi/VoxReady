// La evaluación final aprovecha la comprobación anticipada de disponibilidad: orden, timeouts por
// modelo, reintento de un modelo caído, respaldo cuando el disponible falla y mensaje genérico
// cuando fallan todos. Sin red: `call` está inyectado y la sonda usa un fetch falso.
const test = require('node:test');
const assert = require('node:assert/strict');

const { judgeContent } = require('../ai/evaluator');
const { resolveConfig } = require('../ai/patternConfig');
const health = require('../lib/evaluatorHealth');

const ENV = { NVIDIA_API_KEY: 'clave-de-prueba' };
const VALID = { choices: [{ finish_reason: 'stop', message: { content: '{"coherencia":{"a":50},"empatia":{"b":50}}' } }] };
const jsonOk = (body = VALID, status = 200) => ({ ok: status < 300, status, json: async () => body });

const INPUT = {
  theme: { title: 'Crisis', context: 'planta', keyMessages: '', redLines: '', interviewConfig: { questionCount: 3, followUps: 1, estimatedMinutes: 5 } },
  transcript: [{ question: '¿Qué ocurrió?', answer: 'Hubo un incidente y activamos el protocolo.', metrics: { wpm: 130, fillers: 0, latencyMs: 900 } }],
  voice: { available: false },
  body: { available: false },
  lighting: null,
  cfg: resolveConfig(null),
};
// Juicio COMPLETO según el patrón activo (`DEFAULT_CONFIG`): coherencia (keyMessages, directness,
// redLines, clarity) y empatía (impact, warmth, responsibility). Un juicio incompleto ya NO gana la
// carrera: la validación completa ocurre antes de publicar.
const JUDGEMENT = {
  coherencia: { keyMessages: 80, directness: 70, redLines: 90, clarity: 75 },
  empatia: { impact: 70, warmth: 65, responsibility: 80 },
};

// Cambia una variable de entorno y devuelve la función que la restaura.
function setEnv(name, value) {
  const previous = process.env[name];
  if (value == null) delete process.env[name];
  else process.env[name] = value;
  return () => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  };
}

// Fija los modelos efectivos durante la prueba (la lista se lee del entorno en cada evaluación).
async function withModels(models, run) {
  const saved = { model: process.env.AI_EVAL_MODEL, fallback: process.env.AI_EVAL_FALLBACK_MODEL };
  process.env.AI_EVAL_MODEL = models[0];
  process.env.AI_EVAL_FALLBACK_MODEL = models[1] || '';
  try {
    return await run();
  } finally {
    if (saved.model === undefined) delete process.env.AI_EVAL_MODEL;
    else process.env.AI_EVAL_MODEL = saved.model;
    if (saved.fallback === undefined) delete process.env.AI_EVAL_FALLBACK_MODEL;
    else process.env.AI_EVAL_FALLBACK_MODEL = saved.fallback;
  }
}

// Sonda previa: 'caido' responde 404, 'ok' responde correctamente.
async function seedHealth() {
  health.reset();
  await health.preflight({
    reason: 'test',
    models: ['caido', 'ok'],
    env: ENV,
    force: true,
    deps: { fetchImpl: async (_url, init) => (JSON.parse(init.body).model === 'ok' ? jsonOk() : jsonOk({}, 404)) },
  });
}

async function silent(run) {
  const original = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return await run();
  } finally {
    console.log = original;
    console.warn = originalWarn;
  }
}

test('la evaluación usa el orden de la comprobación anticipada, sin límites distintos por modelo', async () => {
  await seedHealth();
  const restore = setEnv('AI_EVAL_TIMEOUT_MS', null); // sin límite artificial en esta prueba
  try {
    const calls = [];
    const winner = await silent(() =>
      judgeContent(INPUT, {
        models: ['caido', 'ok', 'z-ai/glm-5.3'],
        call: async (model, _messages, options) => {
          calls.push({ model, timeoutMs: options.timeoutMs });
          return JUDGEMENT;
        },
      }),
    );

    // El disponible va primero, el desconocido en medio y el caído al final (el caído NO se excluye),
    // pero NINGUNO recibe un recorte de tiempo.
    assert.deepEqual(calls.map((item) => item.model), ['ok', 'z-ai/glm-5.3', 'caido']);
    assert.deepEqual(calls.map((item) => item.timeoutMs), [0, 0, 0], 'ningún modelo se corta por tiempo');
    assert.equal(winner.model, 'ok');
    assert.equal(winner.validated, true, 'el ganador sale ya validado de la carrera');
    assert.ok(Array.isArray(winner.failed));
  } finally {
    restore();
  }
});

test('un modelo que falló en la comprobación NO se excluye: se reintenta y puede ganar', async () => {
  await seedHealth();
  await withModels(['caido', 'ok'], async () => {
    const attempted = [];
    const winner = await silent(() =>
      judgeContent(INPUT, {
        call: async (model) => {
          attempted.push(model);
          if (model === 'caido') return JUDGEMENT; // se recuperó durante la evaluación real
          throw new Error('HTTP 500');
        },
      }),
    );
    assert.ok(attempted.includes('caido'), 'el modelo caído se reintenta');
    assert.equal(winner.model, 'caido', 'el modelo recuperado responde y gana');
    const failed = winner.failed.find((item) => item.model === 'ok');
    assert.equal(failed.reason, 'HTTP 500');
    assert.ok(Number.isFinite(failed.ms), 'se registra la duración del intento fallido');
  });
});

test('si todos fallan: error AI_UNAVAILABLE con mensaje genérico y detalle solo interno', async () => {
  health.reset();
  await withModels(['z-ai/glm-5.3'], async () => {
    const error = await silent(() =>
      judgeContent(INPUT, {
        call: async () => {
          throw new Error('HTTP 410 del proveedor nvidia (modelo retirado)');
        },
      }).catch((thrown) => thrown),
    );
    assert.equal(error.code, 'AI_UNAVAILABLE');
    assert.equal(error.message, 'La IA evaluadora no respondió. Intenta nuevamente.');
    for (const token of ['HTTP', 'nvidia', '410', 'glm', 'kimi', 'nemotron', 'modelo']) {
      assert.ok(!error.message.includes(token), `el mensaje al vocero no debe contener "${token}"`);
    }
    assert.ok(Array.isArray(error.failed) && error.failed.length >= 1, 'el detalle técnico queda en el objeto interno');
  });
});

test('sin comprobación previa la evaluación funciona igual (orden configurado) y sin límite artificial', async () => {
  health.reset();
  const calls = [];
  const winner = await silent(() =>
    judgeContent(INPUT, {
      models: ['z-ai/glm-5.3'],
      call: async (model, _messages, options) => {
        calls.push({ model, timeoutMs: options.timeoutMs });
        return JUDGEMENT;
      },
    }),
  );
  assert.deepEqual(
    calls,
    [{ model: 'z-ai/glm-5.3', timeoutMs: 0 }],
    'sin AI_EVAL_TIMEOUT_MS no se impone ningún límite de tiempo',
  );
  assert.equal(winner.model, 'z-ai/glm-5.3');
});

test('un límite configurado EXPLÍCITAMENTE sí se aplica (y nunca es un presupuesto de 60 s)', async () => {
  health.reset();
  const restore = setEnv('AI_EVAL_TIMEOUT_MS', '240000');
  try {
    const calls = [];
    await silent(() =>
      judgeContent(INPUT, {
        models: ['z-ai/glm-5.3'],
        call: async (model, _messages, options) => {
          calls.push({ model, timeoutMs: options.timeoutMs });
          return JUDGEMENT;
        },
      }),
    );
    assert.deepEqual(calls, [{ model: 'z-ai/glm-5.3', timeoutMs: 240000 }]);
  } finally {
    restore();
  }
});
