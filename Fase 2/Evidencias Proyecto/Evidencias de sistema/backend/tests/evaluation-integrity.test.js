// Pruebas de integridad de la evaluación (Etapa 1).
//
//   cd backend && node --test tests/evaluation-integrity.test.js
//
// No usan red, ni base de datos, ni el proveedor de IA: validan la normalización de la
// entrada, la validación de la respuesta del modelo, el registro del modelo ganador y la
// compatibilidad del informe con la interfaz actual.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { EvaluationInputError, normalizeEvaluateInput } = require('../lib/evaluationInput');
const { FILLER_PATTERN } = require('../lib/textMetrics');
const { DEFAULT_CONFIG } = require('../ai/patternConfig');
const {
  EVALUATOR_VERSION,
  PROMPT_VERSION,
  EvaluationResponseError,
  evaluateSession,
  judgeContent,
  scoreBody,
  scoreVoice,
  validateJudgement,
} = require('../ai/evaluator');

// ---------------------------------------------------------------- utilidades

const turn = (question, answer, metrics) => ({ question, answer, metrics });

// Turnos con SOLO las señales que el navegador sí puede aportar (palabras y muletillas se
// recalculan en el servidor, así que no se declaran).
const validTranscript = () => [
  turn('¿Qué ocurrió?', 'Quiero lamentar profundamente lo ocurrido y expresar nuestra solidaridad con la familia afectada.', {
    speakingMs: 6000,
    latencyMs: 900,
    longPauses: 0,
    volumeVariation: 0.3,
  }),
  turn('¿Están colaborando?', 'Estamos colaborando con la autoridad desde el primer minuto.', {
    speakingMs: 4000,
    latencyMs: 1200,
    longPauses: 1,
    volumeVariation: 0.25,
  }),
];

const validMetrics = () => ({
  voice: { available: true, longPauses: 1, volumeVariation: 0.3, avgLatencyMs: 1000, transcription: 'voz' },
  body: {
    available: true,
    presence: 0.95,
    facingCamera: 0.8,
    shoulderTilt: 2,
    headMovement: 0.004,
    handActivity: 0.008,
    analyzedSeconds: 20,
    facingSeconds: 16,
    awaySeconds: 4,
    smileSeconds: 0,
    faceAvailable: true,
  },
  lighting: { average: 120 },
  durationSeconds: 25,
});

// Respuesta del modelo con TODOS los criterios por defecto (0-100).
function judgementFixture(overrides = {}) {
  const coherencia = Object.fromEntries(Object.keys(DEFAULT_CONFIG.coherence.criteria).map((key) => [key, 80]));
  const empatia = Object.fromEntries(Object.keys(DEFAULT_CONFIG.empathy.criteria).map((key) => [key, 70]));
  return {
    coherencia,
    empatia,
    resumen: 'Buen desempeño.',
    cita: 'Cita de coach.',
    fortalezas: ['Claridad'],
    mejoras: ['Sintetizar'],
    mensajesClave: [{ mensaje: 'Colaboramos con la autoridad', cubierto: true }],
    lineasRojas: [{ linea: 'No especular', cruzada: false, evidencia: '' }],
    porPregunta: [{ pregunta: 1, puntaje: 85, comentario: 'Correcta' }],
    ...overrides,
  };
}

const themeFixture = () => ({
  id: 't1',
  title: 'Accidente',
  context: 'Accidente en una planta.',
  optic: 'Institucional',
  keyMessages: JSON.stringify(['Colaboramos con la autoridad']),
  redLines: JSON.stringify(['No especular']),
  interviewConfig: { aggressiveness: 'MEDIA', questionCount: 2, followUps: 0 },
});

// ---------------------------------------------------------------- 1. métricas válidas

test('métricas válidas: se conservan y se marca la procedencia de cada una', () => {
  const input = normalizeEvaluateInput({ transcript: validTranscript(), metrics: validMetrics() });

  assert.equal(input.transcript.length, 2);
  assert.equal(input.metrics.voice.available, true);
  assert.equal(input.metrics.body.available, true);
  assert.equal(input.metrics.lighting.average, 120);
  // Palabras/muletillas: servidor. Cuerpo/MediaPipe: cliente.
  // WPM: NO se calcula con la duración del navegador; queda sin verificar (excluido).
  assert.equal(input.sources.words, 'server');
  assert.equal(input.sources.body, 'client');
  assert.equal(input.sources.wpm, 'unverified');
  assert.equal(input.metrics.voice.wpm, null);
  assert.equal(input.metrics.voice.wpmSource, 'unverified');
  assert.equal(input.metrics.voice.wpmReason, 'NO_AUDIO');
  assert.deepEqual(input.warnings, []);
  assert.equal(input.coverage.voice, true);
  assert.equal(input.coverage.turns, 2);
});

// ---------------------------------------------------------------- 3. rangos

test('valores negativos o fuera de rango se descartan y quedan marcados', () => {
  const input = normalizeEvaluateInput({
    transcript: [turn('P1', 'Hola.', { speakingMs: 5000, latencyMs: -1, longPauses: -2, volumeVariation: 99 })],
    metrics: { voice: { available: true, wpm: 99999, longPauses: 9999 }, body: { available: true, presence: 1.5, facingCamera: -0.2 } },
  });

  assert.equal(input.transcript[0].metrics.latencyMs, null);
  assert.equal(input.transcript[0].metrics.longPauses, null);
  assert.equal(input.transcript[0].metrics.volumeVariation, null);
  assert.equal(input.metrics.voice.wpm, null); // nunca desde speakingMs (aunque sea válido)
  assert.equal(input.metrics.body.available, false); // sin presencia/mirada válidas
  const codes = input.warnings.map((warning) => warning.code);
  assert.ok(codes.includes('OUT_OF_RANGE'));
  assert.ok(codes.includes('BODY_INCOMPLETE'));
});

// ---------------------------------------------------------------- 4. no numéricos

test('NaN, Infinity y valores no numéricos no puntúan ni llegan al JSON', () => {
  const input = normalizeEvaluateInput({
    transcript: [turn('P1', 'Texto válido.', { speakingMs: Infinity, latencyMs: NaN, longPauses: '3', volumeVariation: '0.3' })],
    metrics: { voice: { available: true }, body: { available: true, presence: NaN, facingCamera: 0.8 }, lighting: { average: Infinity } },
  });

  assert.equal(input.transcript[0].metrics.speakingMs, null);
  assert.equal(input.transcript[0].metrics.latencyMs, null);
  assert.equal(input.transcript[0].metrics.longPauses, null);
  assert.equal(input.metrics.voice.available, false); // sin duración válida no hay voz
  assert.equal(input.metrics.body.available, false);
  assert.equal(input.metrics.lighting, null);
  assert.equal(/NaN|Infinity/.test(JSON.stringify(input.metrics)), false);
  assert.ok(input.warnings.some((warning) => warning.code === 'INVALID_NUMBER'));

  const voice = scoreVoice(
    { available: true, wpm: NaN, fillersPerMin: Infinity, longPauses: null, volumeVariation: null, avgLatencyMs: null },
    DEFAULT_CONFIG,
  );
  assert.equal(voice.score, null);
});

// ---------------------------------------------------------------- 5. manipulación

test('manipular palabras, muletillas y WPM no cambia lo que puntúa el servidor', () => {
  const input = normalizeEvaluateInput({
    transcript: [turn('P1', 'Este... bueno, el vocero habla claro.', { words: 500, fillers: 0, wpm: 400, speakingMs: 4000 })],
    metrics: { voice: { available: true, wpm: 400 } },
  });

  const metrics = input.transcript[0].metrics;
  assert.equal(metrics.words, 6); // recalculado del texto
  assert.equal(metrics.fillers, 2); // "Este" y "bueno"
  // El WPM declarado (por turno o agregado) no se usa ni se convierte en puntaje.
  assert.equal(metrics.wpm, null);
  assert.equal(input.metrics.voice.wpm, null);
  assert.equal(input.metrics.voice.declaredWpm, 400); // solo se conserva para auditar
  const codes = input.warnings.map((warning) => warning.code);
  assert.ok(codes.includes('WORDS_MISMATCH'));
  assert.ok(codes.includes('FILLERS_MISMATCH'));
});

test('el cliente no puede activar el área de voz sin una duración de habla válida', () => {
  const input = normalizeEvaluateInput({
    transcript: [turn('P1', 'Texto.', {})],
    metrics: { voice: { available: true, wpm: 150 } },
  });
  assert.equal(input.metrics.voice.available, false); // lo decide el servidor
  assert.equal(input.metrics.voice.wpm, null);
});

// ---------------------------------------------------------------- entrada no evaluable

test('una entrevista vacía o sin texto no es evaluable', () => {
  assert.throws(() => normalizeEvaluateInput({ transcript: [] }), EvaluationInputError);
  assert.throws(() => normalizeEvaluateInput({}), EvaluationInputError);
  assert.throws(() => normalizeEvaluateInput({ transcript: [{ question: 'P1', answer: '   ' }] }), /Ninguna respuesta/);
});

test('un payload antiguo (solo pregunta y respuesta) sigue siendo evaluable', () => {
  const input = normalizeEvaluateInput({ transcript: [{ question: 'P1', answer: 'Respuesta antigua.' }] });
  assert.equal(input.transcript.length, 1);
  assert.equal(input.metrics.voice.available, false);
  assert.equal(input.metrics.body.available, false);
  assert.equal(input.metrics.voice.wpm, null);
});

// ---------------------------------------------------------------- 2. ausentes

test('métricas ausentes o incompletas: el área queda sin medir, no se inventa un puntaje', () => {
  const input = normalizeEvaluateInput({ transcript: [turn('P1', 'Una respuesta breve.')] });

  assert.equal(input.metrics.voice.available, false);
  assert.equal(input.metrics.voice.wpm, null);
  assert.deepEqual(input.metrics.body, { available: false });
  assert.equal(input.metrics.lighting, null);
  assert.equal(input.coverage.voice, false);
  assert.deepEqual(input.warnings, []);

  assert.equal(scoreVoice(input.metrics.voice, DEFAULT_CONFIG).score, null);
  assert.equal(scoreBody(input.metrics.body, DEFAULT_CONFIG).score, null);
});

// ---------------------------------------------------------------- 6-7. respuesta de la IA

test('la IA con puntajes fuera de rango se rechaza (no se recorta a 100)', () => {
  const high = judgementFixture();
  high.coherencia.keyMessages = 150;
  assert.throws(
    () => validateJudgement(high, DEFAULT_CONFIG),
    (error) => {
      assert.equal(error.code, 'INVALID_AI_RESPONSE');
      assert.ok(error.issues.some((issue) => issue.includes('keyMessages')));
      return true;
    },
  );

  const negative = judgementFixture();
  negative.empatia.impact = -5;
  assert.throws(() => validateJudgement(negative, DEFAULT_CONFIG), EvaluationResponseError);

  const infinite = judgementFixture();
  infinite.empatia.warmth = Infinity;
  assert.throws(() => validateJudgement(infinite, DEFAULT_CONFIG), EvaluationResponseError);
});

test('la IA incompleta o con estructura incorrecta se rechaza', () => {
  const missing = judgementFixture();
  delete missing.empatia.responsibility;
  assert.throws(() => validateJudgement(missing, DEFAULT_CONFIG), /puntajes inválidos o incompletos/);
  assert.throws(() => validateJudgement({ coherencia: { keyMessages: 80 }, empatia: {} }, DEFAULT_CONFIG), EvaluationResponseError);
  assert.throws(() => validateJudgement(null, DEFAULT_CONFIG), /estructura inválida/);
  assert.throws(() => validateJudgement([], DEFAULT_CONFIG), /estructura inválida/);
  assert.throws(() => validateJudgement('texto', DEFAULT_CONFIG), /estructura inválida/);
});

// ---------------------------------------------------------------- 8. modelo ganador

const judgeInput = () => ({
  theme: themeFixture(),
  transcript: validTranscript(),
  voice: {},
  body: {},
  lighting: null,
  cfg: DEFAULT_CONFIG,
});

test('se registra el modelo que produjo la evaluación y no los errores de los demás', async () => {
  const previous = process.env.AI_EVAL_MODEL;
  process.env.AI_EVAL_MODEL = 'modelo-ganador';
  try {
    const judgement = judgementFixture();
    const result = await judgeContent(judgeInput(), {
      call: async (model) => {
        if (model === 'modelo-ganador') return judgement;
        throw new Error('HTTP 503');
      },
    });
    assert.equal(result.model, 'modelo-ganador');
    assert.equal(result.judgement, judgement);
    assert.equal(result.failed.length, 2);
    assert.ok(result.failed.every((item) => item.model !== 'modelo-ganador'));
    assert.ok(result.failed.every((item) => item.reason === 'HTTP 503'));
  } finally {
    if (previous === undefined) delete process.env.AI_EVAL_MODEL;
    else process.env.AI_EVAL_MODEL = previous;
  }
});

test('si todos los modelos fallan no hay resultado ni modelo ganador', async () => {
  await assert.rejects(
    () =>
      judgeContent(judgeInput(), {
        call: async () => {
          throw new Error('HTTP 500');
        },
      }),
    (error) => {
      assert.equal(error.code, 'AI_UNAVAILABLE');
      assert.equal(error.failed.length, 3);
      assert.equal(error.model, undefined);
      return true;
    },
  );
});

// ---------------------------------------------------------------- 9-10. informe compatible

async function withApiKey(run) {
  const previous = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'clave-de-prueba';
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previous;
  }
}

test('el informe conserva la estructura que consume la interfaz y añade la auditoría', async () => {
  const input = normalizeEvaluateInput({ transcript: validTranscript(), metrics: validMetrics() });
  const report = await withApiKey(() =>
    evaluateSession({
      theme: themeFixture(),
      transcript: input.transcript,
      metrics: input.metrics,
      pattern: null,
      inputAudit: { sources: input.sources, sourceNotes: input.sourceNotes, warnings: input.warnings, coverage: input.coverage },
      judge: async () => ({
        judgement: judgementFixture(),
        model: 'modelo-x',
        ms: 12,
        failed: [{ model: 'otro', reason: 'HTTP 500' }],
      }),
    }),
  );

  for (const key of [
    'global',
    'areas',
    'weights',
    'pattern',
    'resumen',
    'cita',
    'fortalezas',
    'mejoras',
    'mensajesClave',
    'lineasRojas',
    'porPregunta',
    'sensibilidad',
    'measured',
    'ai',
    'generatedAt',
    'audit',
  ]) {
    assert.ok(key in report, `falta el campo ${key}`);
  }
  assert.equal(report.areas.length, 4);
  assert.deepEqual(report.areas.map((area) => area.key), ['expression', 'voice', 'coherence', 'empathy']);

  // El global que se persiste es el promedio ponderado de las áreas medidas.
  const measuredAreas = report.areas.filter((area) => area.score != null);
  const totalWeight = measuredAreas.reduce((sum, area) => sum + area.weight, 0);
  const expected = Math.round(measuredAreas.reduce((sum, area) => sum + area.score * area.weight, 0) / totalWeight);
  assert.equal(report.global, expected);

  assert.equal(report.audit.evaluatorVersion, EVALUATOR_VERSION);
  assert.equal(report.audit.promptVersion, PROMPT_VERSION);
  assert.equal(report.audit.model, 'modelo-x');
  assert.equal(report.audit.failedModels.length, 1);
  assert.equal(report.audit.metricSources.words, 'server');
  assert.equal(report.audit.metricSources.body, 'client');
  assert.deepEqual(report.audit.inputWarnings, []);
  assert.equal(report.audit.inputCoverage.voice, true);
});

test('una respuesta inválida de la IA no produce informe', async () => {
  const input = normalizeEvaluateInput({ transcript: validTranscript(), metrics: validMetrics() });
  await withApiKey(async () => {
    await assert.rejects(
      () =>
        evaluateSession({
          theme: themeFixture(),
          transcript: input.transcript,
          metrics: input.metrics,
          pattern: null,
          judge: async () => ({
            judgement: { coherencia: { keyMessages: 200 }, empatia: {} },
            model: 'x',
            ms: 1,
            failed: [],
          }),
        }),
      (error) => {
        assert.equal(error.code, 'INVALID_AI_RESPONSE');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------- sin deriva con el frontend

test('la lista de muletillas del backend no diverge de la del frontend', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'practice', 'speech.js'),
    'utf8',
  );
  const match = source.match(/const FILLER_RE = \/(.+)\/([a-z]*);/);
  assert.ok(match, 'no se encontró FILLER_RE en speech.js');
  assert.equal(match[1], FILLER_PATTERN);
});

// ---------------------------------------------------------------- campos no críticos

test('los campos no críticos inválidos se descartan sin romper el informe', () => {
  const judgement = judgementFixture({
    mensajesClave: [{ mensaje: 'ok', cubierto: 'sí' }, { mensaje: 'válido', cubierto: true }],
    lineasRojas: [{ linea: '', cruzada: true }],
    porPregunta: [{ pregunta: 0, puntaje: 120 }],
  });
  const { judgement: clean, warnings } = validateJudgement(judgement, DEFAULT_CONFIG);
  assert.equal(clean.mensajesClave.length, 1);
  assert.deepEqual(clean.lineasRojas, []);
  assert.deepEqual(clean.porPregunta, []);
  assert.ok(warnings.some((warning) => warning.code === 'AI_MESSAGES_DROPPED'));
  assert.ok(warnings.some((warning) => warning.code === 'AI_REDLINES_DROPPED'));
  assert.ok(warnings.some((warning) => warning.code === 'AI_POR_PREGUNTA_DROPPED'));
});




