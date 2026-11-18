// A1: la lista de modelos del entrevistador tiene UNA sola definicion y todos los componentes de
// la entrevista la usan (generacion de preguntas, clasificacion y warm-up).
// Todo se comprueba sin red: `fetch` se sustituye por un doble.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INTERVIEWER_SRC = path.join(__dirname, '..', 'ai', 'interviewer.js');
const ROUTES_SRC = path.join(__dirname, '..', 'routes', 'interviewer.js');

const countOccurrences = (text, needle) => text.split(needle).length - 1;

function withEnv(values, fn) {
  const previous = { ...process.env };
  Object.assign(process.env, values);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    });
}

test('la formula de la lista aparece una sola vez (sin copias)', () => {
  const source = fs.readFileSync(INTERVIEWER_SRC, 'utf8');
  assert.equal(countOccurrences(source, 'AI_EXTRA_MODELS ?? DEFAULT_EXTRA'), 1, 'los extras se leen en un solo lugar');
  assert.equal(countOccurrences(source, 'AI_FALLBACK_MODEL || DEFAULT_FALLBACK'), 1, 'la lista no puede estar duplicada');
  assert.equal(countOccurrences(source, 'function interviewModels()'), 1, 'debe existir una unica definicion');
});

test('generateQuestion usa la fuente unica', () => {
  const source = fs.readFileSync(INTERVIEWER_SRC, 'utf8');
  assert.match(source, /const models = interviewModels\(\);/, 'la generacion debe tomar la lista centralizada');
});

test('la ruta del entrevistador (generacion y clasificacion) usa la misma fuente', () => {
  const source = fs.readFileSync(ROUTES_SRC, 'utf8');
  assert.match(source, /models = interviewModels/, 'la dependencia por defecto es la fuente unica');
  assert.match(source, /models: models\(\),/, 'el clasificador recibe esa misma lista');
});

test('interviewModels conserva identificadores, orden y deduplicacion', async () => {
  const { interviewModels } = require('../ai/interviewer');
  await withEnv({ AI_MODEL: 'uno', AI_FALLBACK_MODEL: 'dos', AI_EXTRA_MODELS: 'tres, cuatro ,uno' }, () => {
    assert.deepEqual(interviewModels(), ['uno', 'dos', 'tres', 'cuatro']);
  });
});

test('generateQuestion despacha exactamente la lista centralizada y gana el primer resultado valido', async () => {
  const { generateQuestion, interviewModels } = require('../ai/interviewer');
  const previousFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url, init) => {
    const { model } = JSON.parse(init.body);
    requested.push(model);
    if (model === 'dos') {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '¿Qué pasó?' } }] }) };
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { ok: false, status: 500, text: async () => 'fallo' };
  };
  try {
    await withEnv(
      { NVIDIA_API_KEY: 'clave-de-prueba', AI_MODEL: 'uno', AI_FALLBACK_MODEL: 'dos', AI_EXTRA_MODELS: 'tres', AI_TIMEOUT_MS: '200' },
      async () => {
        const expected = interviewModels();
        const winner = await generateQuestion({ theme: null, history: [] });
        assert.equal(winner.model, 'dos', 'gana el primer resultado valido');
        assert.deepEqual([...requested].sort(), [...expected].sort(), 'se consulta exactamente la lista centralizada');
        await new Promise((resolve) => setTimeout(resolve, 80)); // deja terminar a los perdedores
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
