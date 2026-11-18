// Clasificador de respuestas: la seleccion debe ser "el PRIMER resultado VALIDO que llega",
// independientemente del orden en que esten declarados los modelos.
//
// Pruebas DETERMINISTAS con `askModel` simulado: cada modelo recibe una promesa que el propio test
// resuelve, asi el orden de llegada se controla sin temporizadores, sin red y sin proveedores.
const test = require('node:test');
const assert = require('node:assert/strict');

const { assessAnswer, STATUS } = require('./answerAssessment');

const ANSWER = 'Cerramos la planta a las 9 y avisamos a los vecinos en 20 minutos.';
const MAIN_QUESTION = 'Por que murio el trabajador?';
const CFG = { aggressiveness: 'MEDIA' };
const MODELS = ['m1', 'm2', 'm3', 'm4'];

// Respuestas ficticias: cumplen (o no) el contrato JSON del clasificador.
const json = (body) => JSON.stringify({ evidence: [], justify_extraordinary: false, ...body });
const validSufficient = () => json({ status: 'sufficient', focus: '', reason: 'contesta lo pedido' });
const validPartial = (focus = 'cuando se reviso la maquina') => json({ status: 'partial', focus, reason: 'falta un dato' });
const validEvasive = () => json({ status: 'evasive', focus: 'no respondio la causa', reason: 'generalidad' });
const invalidJson = () => 'esto no es json {';
const unknownStatus = () => json({ status: 'sorprendido', focus: 'x' });
const missingFocus = () => JSON.stringify({ status: 'partial' });

// Orden de llegada controlado: `askModel` devuelve una promesa que este test resuelve cuando quiere.
function controlledModel() {
  const gates = new Map();
  const calls = [];
  const askModel = (model) => {
    calls.push(model);
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    gates.set(model, { resolve, reject, promise });
    return promise;
  };
  return { askModel, gates, calls };
}

const flush = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

// Lanza la evaluacion y espera a que TODOS los modelos hayan arrancado, sin resolver ninguno.
async function startAssessment({ models = MODELS, extra = {} } = {}) {
  const { askModel, gates, calls } = controlledModel();
  const pending = assessAnswer({ mainQuestion: MAIN_QUESTION, answer: ANSWER, cfg: CFG, models, askModel, ...extra });
  await flush();
  assert.deepEqual(calls, models, 'todos los modelos configurados deben arrancar en paralelo');
  assert.equal(gates.size, models.length, 'cada modelo debe tener su solicitud pendiente');
  return { pending, gates, calls };
}

test('T1) gana el primer resultado VALIDO que llega, no el primero de la lista', async () => {
  const { pending, gates } = await startAssessment();
  gates.get('m2').resolve(validSufficient());
  // El resto sigue pendiente: la funcion ya debe devolver el ganador.
  const result = await pending;
  assert.equal(result.source, 'ai:m2');
  assert.equal(result.status, 'sufficient');
  // Resolver despues a los demas no altera la decision.
  gates.get('m1').resolve(validPartial());
  gates.get('m3').resolve(validEvasive());
  gates.get('m4').resolve(validSufficient());
  await flush();
  assert.equal(result.source, 'ai:m2', 'los resultados posteriores no cambian el ganador');
  assert.equal(result.status, 'sufficient');
});

test('T2) un JSON invalido no bloquea al modelo valido que llega despues', async () => {
  const { pending, gates } = await startAssessment();
  gates.get('m1').resolve(invalidJson());
  await flush();
  gates.get('m2').resolve(validSufficient());
  const result = await pending;
  assert.equal(result.source, 'ai:m2');
  assert.equal(result.status, 'sufficient');
});

test('T3) una categoria no permitida se descarta y gana el valido posterior', async () => {
  const { pending, gates } = await startAssessment();
  gates.get('m1').resolve(unknownStatus());
  await flush();
  gates.get('m2').resolve(validPartial());
  const result = await pending;
  assert.equal(result.source, 'ai:m2');
  assert.equal(result.status, 'partial');
  assert.ok(STATUS.includes(result.status));
});

test('T4) campos incompletos (partial sin focus) se descartan', async () => {
  const { pending, gates } = await startAssessment();
  gates.get('m1').resolve(missingFocus());
  await flush();
  gates.get('m2').resolve(validEvasive());
  const result = await pending;
  assert.equal(result.source, 'ai:m2');
  assert.equal(result.status, 'evasive');
});

test('T5) contradiccion sin dos evidencias verificables: se degrada a partial (sin debilitar nada)', async () => {
  // Una sola cita verificable: la contradiccion NO se acepta como hecho.
  const one = await startAssessment({ models: ['m1'] });
  one.gates.get('m1').resolve(
    json({ status: 'contradiction', focus: 'cual de las dos versiones es correcta', evidence: ['avisamos a los vecinos'], reason: 'dos versiones' }),
  );
  const degraded = await one.pending;
  assert.equal(degraded.status, 'partial', 'sin dos citas verificables no es contradiccion');
  assert.equal(degraded.reason, 'dos versiones');
  assert.deepEqual(degraded.evidence, ['avisamos a los vecinos'], 'la cita si era verificable');

  // Sin ninguna cita: se conserva el motivo de degradacion por defecto.
  const none = await startAssessment({ models: ['m1'] });
  none.gates.get('m1').resolve(json({ status: 'contradiction', focus: 'aclarar versiones', evidence: [] }));
  const degradedNoEvidence = await none.pending;
  assert.equal(degradedNoEvidence.status, 'partial');
  assert.equal(degradedNoEvidence.reason, 'contradiccion_sin_evidencia_verificable');

  // El resultado degradado sigue siendo VALIDO y compite: gana si llega primero.
  const first = await startAssessment();
  first.gates.get('m2').resolve(json({ status: 'contradiction', focus: 'aclarar versiones', evidence: [] }));
  await flush();
  first.gates.get('m1').resolve(validSufficient());
  const winner = await first.pending;
  assert.equal(winner.source, 'ai:m2', 'gana el primero en llegar aunque quede degradado a partial');
  assert.equal(winner.status, 'partial');
});

test('T6) ningun modelo valido: se conserva el resultado de contingencia', async () => {
  const { pending, gates } = await startAssessment();
  gates.get('m1').resolve(invalidJson());
  gates.get('m2').resolve(unknownStatus());
  gates.get('m3').resolve(missingFocus());
  gates.get('m4').resolve('{}');
  const result = await pending;
  assert.equal(result.status, 'unevaluable');
  assert.equal(result.source, 'ai-failed');
  assert.equal(result.reason, 'formato_invalido');
  assert.deepEqual(result.evidence, []);
  assert.equal(result.focus, '');
});

test('T7) fallos y timeouts: contingencia con motivo representativo, independiente del orden', async () => {
  const timeout = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
  const providerError = () => new Error('HTTP 500');

  // (a) Todos agotan el tiempo de espera.
  const allTimeout = await startAssessment();
  for (const model of MODELS) allTimeout.gates.get(model).reject(timeout());
  const a = await allTimeout.pending;
  assert.equal(a.status, 'unevaluable');
  assert.equal(a.source, 'ai-failed');
  assert.equal(a.reason, 'timeout');

  // (b) Todos fallan por error del proveedor.
  const allError = await startAssessment();
  for (const model of MODELS) allError.gates.get(model).reject(providerError());
  const b = await allError.pending;
  assert.equal(b.status, 'unevaluable');
  assert.equal(b.reason, 'error_proveedor');

  // (c) Mezcla 2 timeouts + 2 formatos invalidados, en DOS ordenes distintos de llegada:
  //     el motivo no puede depender de la carrera (empate 2-2 -> prioridad fija: timeout).
  const orderOne = await startAssessment();
  orderOne.gates.get('m1').reject(timeout());
  orderOne.gates.get('m2').reject(timeout());
  orderOne.gates.get('m3').resolve(invalidJson());
  orderOne.gates.get('m4').resolve(unknownStatus());
  const c = await orderOne.pending;

  const orderTwo = await startAssessment();
  orderTwo.gates.get('m4').resolve(unknownStatus());
  orderTwo.gates.get('m3').resolve(invalidJson());
  orderTwo.gates.get('m2').reject(timeout());
  orderTwo.gates.get('m1').reject(timeout());
  const d = await orderTwo.pending;

  assert.equal(c.reason, 'timeout');
  assert.equal(d.reason, 'timeout');
  assert.equal(c.reason, d.reason, 'el motivo no depende del orden de llegada');

  // (d) Mayoria de formato invalido frente a un error del proveedor.
  const majority = await startAssessment();
  majority.gates.get('m4').reject(providerError());
  majority.gates.get('m1').resolve(invalidJson());
  majority.gates.get('m2').resolve(invalidJson());
  majority.gates.get('m3').resolve(invalidJson());
  const e = await majority.pending;
  assert.equal(e.reason, 'formato_invalido');
});

test('T8) resultados validos casi simultaneos: solo uno gana y no decide la lista', async () => {
  const first = await startAssessment();
  first.gates.get('m3').resolve(validSufficient());
  first.gates.get('m1').resolve(validPartial());
  const a = await first.pending;
  assert.equal(a.source, 'ai:m3');

  const second = await startAssessment();
  second.gates.get('m1').resolve(validPartial());
  second.gates.get('m3').resolve(validSufficient());
  const b = await second.pending;
  assert.equal(b.source, 'ai:m1');

  assert.notEqual(a.source, b.source, 'con la misma lista gana quien resuelve primero');
});

test('T9) los casos resueltos por reglas no consultan ningun modelo', async () => {
  const cases = [
    { label: 'respuesta vacia', input: { answer: '' }, status: 'empty' },
    { label: 'solo muletillas', input: { answer: 'eh, este, bueno' }, status: 'empty' },
    { label: 'desconocimiento declarado', input: { answer: 'no lo se' }, status: 'unknown' },
    { label: 'negativa explicita', input: { answer: 'sin comentarios' }, status: 'refusal' },
    { label: 'respuesta repetida', input: { answer: ANSWER, previousAnswers: [ANSWER] }, status: 'repeat' },
    { label: 'voz sin transcripcion', input: { answer: '', spoke: true, hasTranscript: false }, status: 'no_transcript' },
  ];

  for (const item of cases) {
    let calls = 0;
    const result = await assessAnswer({
      mainQuestion: MAIN_QUESTION,
      cfg: CFG,
      models: MODELS,
      askModel: async () => {
        calls += 1;
        return validSufficient();
      },
      ...item.input,
    });
    assert.equal(calls, 0, `no debe consultar modelos: ${item.label}`);
    assert.equal(result.status, item.status, item.label);
    assert.match(result.source, /^rule:/, item.label);
    assert.deepEqual(result.evidence, [], item.label);
    assert.equal(result.focus, '', item.label);
  }
});

test('T10) el contrato del resultado no cambia', async () => {
  const { pending, gates } = await startAssessment({ models: ['m1'] });
  gates.get('m1').resolve(validPartial());
  const winner = await pending;
  assert.deepEqual(Object.keys(winner).sort(), ['evidence', 'focus', 'justifyExtraordinary', 'ms', 'reason', 'source', 'status']);
  assert.equal(winner.status, 'partial');
  assert.equal(winner.focus, 'cuando se reviso la maquina');
  assert.equal(winner.justifyExtraordinary, false);
  assert.equal(typeof winner.ms, 'number');
  assert.equal(winner.source, 'ai:m1');

  // Sin modelos (o sin askModel) se conserva el comportamiento de `no-models`.
  let calls = 0;
  const noModels = await assessAnswer({
    mainQuestion: MAIN_QUESTION,
    answer: ANSWER,
    cfg: CFG,
    models: [],
    askModel: async () => {
      calls += 1;
      return validSufficient();
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(Object.keys(noModels).sort(), ['evidence', 'focus', 'ms', 'reason', 'source', 'status']);
  assert.equal(noModels.status, 'unevaluable');
  assert.equal(noModels.source, 'no-models');
  assert.equal(noModels.reason, 'sin_modelos_de_evaluacion');
});



