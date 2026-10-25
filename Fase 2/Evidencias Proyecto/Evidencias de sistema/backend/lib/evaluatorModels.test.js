// Modelos evaluadores: resolución efectiva, prioridad del entorno y ausencia de identificadores
// obsoletos. El incidente real los tenía en `backend/.env.local` y en un respaldo del código, y
// como `.env.local` tiene prioridad, cambiar solo los defaults no habría servido.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluatorModels,
  evaluatorModelsSource,
  cleanList,
  VALIDATED_DEFAULTS,
  CANDIDATE_DEFAULTS,
  DEFAULT_MODELS,
  MAX_MODELS,
} = require('./evaluatorModels');

const OBSOLETOS = ['moonshotai/kimi-k3', 'nvidia/nemotron-3-super-120b-a12b', 'google/gemma-4-31b-it'];

test('las variables de entorno tienen prioridad sobre los valores por defecto', () => {
  const models = evaluatorModels({ env: { AI_EVAL_MODEL: 'modelo/a', AI_EVAL_FALLBACK_MODEL: 'modelo/b' } });
  // Los modelos configurados van primero y los defaults validados quedan como red de seguridad.
  assert.deepEqual(models.slice(0, 2), ['modelo/a', 'modelo/b']);
  assert.ok(models.includes('z-ai/glm-5.3'));
  assert.equal(evaluatorModelsSource({ env: { AI_EVAL_MODEL: 'modelo/a' } }).envOverrides, true);
});

test('sin variables de entorno se usan el modelo validado y los candidatos verificados', () => {
  assert.deepEqual(evaluatorModels({ env: {} }), DEFAULT_MODELS);
  assert.deepEqual(VALIDATED_DEFAULTS, ['z-ai/glm-5.3'], 'único modelo validado a tamaño real de informe');
  assert.ok(CANDIDATE_DEFAULTS.length > 0, 'hay candidatos verificados que se consultan en paralelo');
  assert.deepEqual(evaluatorModels({ env: {} }).slice(0, 1), ['z-ai/glm-5.3']);
});

test('los identificadores obsoletos del incidente no reaparecen por ningún camino', () => {
  const lists = [
    evaluatorModels({ env: {} }),
    evaluatorModels({ env: { AI_EVAL_MODEL: '', AI_EVAL_FALLBACK_MODEL: '   ' } }),
    evaluatorModelsSource({ env: {} }).defaults,
    evaluatorModelsSource({ env: {} }).fromEnv,
  ];
  for (const list of lists) {
    for (const obsolete of OBSOLETOS) {
      assert.ok(!list.includes(obsolete), `${obsolete} no debe reaparecer`);
    }
  }
});

test('la lista se sanea: espacios, vacíos, duplicados y tope', () => {
  assert.deepEqual(cleanList([' a ', '', '   ', 'a', 'b,c']), ['a', 'b', 'c']);
  assert.equal(cleanList(['1', '2', '3', '4', '5', '6', '7']).length, MAX_MODELS, 'tope defensivo de modelos');
  // Un respaldo vacío no reintroduce nada y el duplicado se colapsa.
  assert.deepEqual(evaluatorModels({ env: { AI_EVAL_MODEL: 'z-ai/glm-5.3', AI_EVAL_FALLBACK_MODEL: '' } }), [
    'z-ai/glm-5.3',
    ...CANDIDATE_DEFAULTS.slice(0, MAX_MODELS - 1),
  ]);
  assert.deepEqual(evaluatorModels({ env: { AI_EVAL_MODEL: 'x', AI_EVAL_FALLBACK_MODEL: 'x' } }).slice(0, 2), [
    'x',
    'z-ai/glm-5.3',
  ]);
});

test('AI_EVAL_MODELS habilita varios modelos en paralelo (lista separada por comas)', () => {
  const models = evaluatorModels({ env: { AI_EVAL_MODELS: 'modelo/a, modelo/b ,modelo/c' } });
  assert.deepEqual(models.slice(0, 3), ['modelo/a', 'modelo/b', 'modelo/c'], 'se consultan TODOS los habilitados');
  assert.ok(models.includes('z-ai/glm-5.3'), 'el validado sigue como red de seguridad');
  assert.ok(models.length <= MAX_MODELS);
  // La lista del entorno manda y se combina con las otras dos variables (sin duplicados).
  assert.deepEqual(evaluatorModels({ env: { AI_EVAL_MODELS: 'a,b', AI_EVAL_MODEL: 'c' } }).slice(0, 3), ['a', 'b', 'c']);
  const source = evaluatorModelsSource({ env: { AI_EVAL_MODELS: 'a,b' } });
  assert.equal(source.envOverrides, true);
  assert.deepEqual(source.validated, VALIDATED_DEFAULTS);
  assert.ok(source.candidates.length > 0, 'los candidatos verificados quedan registrados');
});

test('los modelos en paralelo NO cambian el número de intentos (un intento = una carrera)', () => {
  // Propiedad del contrato: `evaluatorModels` solo devuelve la lista; el contador de intentos vive en
  // el reclamo de la sesión (`claimAttempt`), que ocurre UNA vez por carrera, no por modelo.
  const models = evaluatorModels({ env: { AI_EVAL_MODELS: 'a,b,c,d,e,f,g' } });
  assert.equal(models.length, MAX_MODELS);
  assert.equal(new Set(models).size, models.length, 'sin duplicados');
});
