// Pruebas del cálculo de evidencia de habla (puras: sin red, sin disco, sin base de datos).
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_SEGMENTS_PER_TURN,
  MIN_TOTAL_SPEECH_MS,
  PAUSE_GAP_MS,
  computeSpeechEvidence,
  mergeIntervals,
  normalizeTokens,
  sanitizeSegments,
  speechIntervals,
  totalMs,
} = require('../lib/speechEvidence');

// ------------------------------------------------------------- utilidades

// Palabras separadas `step` segundos (por defecto 0,4 s ≈ 150 pal/min) y 0,25 s de duración.
function wordsFor(text, startSec, step = 0.4, dur = 0.25) {
  return text.split(' ').map((word, i) => ({
    start: Number((startSec + i * step).toFixed(2)),
    end: Number((startSec + i * step + dur).toFixed(2)),
    word,
  }));
}

function segment(startSec, text, { step = 0.4, dur = 0.25 } = {}) {
  const words = wordsFor(text, startSec, step, dur);
  return { start: startSec, end: words[words.length - 1].end, text, words };
}

const LONG_ANSWER =
  'buenos dias quiero lamentar profundamente lo ocurrido y expresar nuestra solidaridad con la familia afectada';
const LONG_ANSWER_2 =
  'estamos colaborando con la autoridad desde el primer minuto y hemos abierto una investigacion interna';

// ------------------------------------------------------------- texto

test('normalizeTokens quita tildes, mayúsculas y puntuación', () => {
  assert.deepEqual(normalizeTokens('Buenos días, ¿cómo está?'), ['buenos', 'dias', 'como', 'esta']);
  assert.deepEqual(normalizeTokens(''), []);
  assert.deepEqual(normalizeTokens(null), []);
});

// ------------------------------------------------------------- segmentos

test('sanitizeSegments descarta tiempos inválidos sin lanzar', () => {
  const { segments, dropped } = sanitizeSegments([
    null,
    { start: NaN, end: 1, text: 'x' },
    { start: 2, end: 1, text: 'invertido' },
    { start: 0, end: 1, text: '' },
    segment(1, 'hola que tal'),
  ]);
  assert.equal(dropped, 4);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].tokens.join(' '), 'hola que tal');
});

test('sanitizeSegments ordena por tiempo y descarta palabras inválidas', () => {
  const later = segment(10, 'segunda parte');
  const earlier = segment(1, 'primera parte');
  earlier.words.push({ start: 'x', end: 'y', word: 'rota' }, { start: 5, end: 4, word: 'invertida' });
  const { segments } = sanitizeSegments([later, earlier]);
  assert.equal(segments[0].tokens[0], 'primera');
  assert.equal(segments[0].words.length, 2);
});

// ------------------------------------------------------------- intervalos

test('speechIntervals descuenta pausas internas mayores que PAUSE_GAP_MS', () => {
  // 3 palabras: 0–0,25 · 0,4–0,65 · 2,0–2,25 (hueco de 1,35 s → pausa)
  const seg = {
    words: [
      { start: 0, end: 250 },
      { start: 400, end: 650 },
      { start: 2000, end: 2250 },
    ],
  };
  const intervals = speechIntervals(seg);
  assert.equal(intervals.length, 2);
  assert.equal(totalMs(intervals), 900); // 0–650 y 2000–2250
});

test('speechIntervals mantiene los huecos cortos (respiración) como habla', () => {
  const gap = PAUSE_GAP_MS - 50;
  const seg = {
    words: [
      { start: 0, end: 250 },
      { start: 250 + gap, end: 250 + gap + 250 },
    ],
  };
  assert.equal(speechIntervals(seg).length, 1);
});

test('mergeIntervals fusiona solapamientos y recorta a la duración conocida', () => {
  const merged = mergeIntervals([[0, 1000], [800, 2000], [5000, 9000]], 6000);
  assert.deepEqual(merged, [[0, 2000], [5000, 6000]]);
});

test('mergeIntervals ignora intervalos vacíos, negativos o no finitos', () => {
  assert.deepEqual(mergeIntervals([[1, 1], [2, 1], [-5, -1], [NaN, 3], [0, 0]]), []);
});

// ------------------------------------------------------------- emparejamiento

test('una sesión con audio suficiente produce WPM verificado', () => {
  const turns = [
    { question: 'P1', answer: LONG_ANSWER },
    { question: 'P2', answer: LONG_ANSWER_2 },
  ];
  const segments = [
    segment(1, 'cuenteme que paso'), // pregunta del entrevistador
    segment(3, LONG_ANSWER),
    segment(20, 'y que mas'), // pregunta del entrevistador
    segment(22, LONG_ANSWER_2),
  ];
  const evidence = computeSpeechEvidence({ turns, segments, durationSeconds: 40, model: 'small' });

  assert.equal(evidence.status, 'verified');
  assert.equal(evidence.reason, null);
  assert.equal(evidence.model, 'small');
  assert.equal(evidence.coverage.answeredTurns, 2);
  assert.equal(evidence.coverage.verifiedTurns, 2);
  assert.equal(evidence.coverage.fraction, 1);
  assert.ok(evidence.speechMs >= MIN_TOTAL_SPEECH_MS);
  // 26 palabras en ~10,1 s de habla → entre 120 y 180 pal/min
  assert.ok(evidence.wpm > 120 && evidence.wpm < 180, `wpm inesperado: ${evidence.wpm}`);
  assert.equal(evidence.turns.filter((turn) => turn.verified).length, 2);
});

test('los segmentos del entrevistador no cuentan como habla del vocero', () => {
  const turns = [{ question: 'P1', answer: LONG_ANSWER }, { question: 'P2', answer: LONG_ANSWER_2 }];
  const withInterviewer = [
    segment(1, 'cuenteme que paso con la crisis'),
    segment(3, LONG_ANSWER),
    segment(20, 'y que mas'),
    segment(22, LONG_ANSWER_2),
  ];
  const without = [segment(3, LONG_ANSWER), segment(22, LONG_ANSWER_2)];

  const a = computeSpeechEvidence({ turns, segments: withInterviewer, durationSeconds: 40 });
  const b = computeSpeechEvidence({ turns, segments: without, durationSeconds: 40 });
  assert.equal(a.status, 'verified');
  assert.equal(a.speechMs, b.speechMs);
  assert.equal(a.wpm, b.wpm);
});

test('un segmento no se reutiliza para dos respuestas', () => {
  const frase = 'quiero lamentar lo ocurrido y expresar solidaridad con la familia';
  const turns = [
    { question: 'P1', answer: frase },
    { question: 'P2', answer: frase },
  ];
  // Solo hay audio de UNA de las dos respuestas
  const segments = [segment(1, frase, { step: 0.6 })];
  const evidence = computeSpeechEvidence({ turns, segments, durationSeconds: 20 });
  assert.equal(evidence.status, 'unverified');
  assert.equal(evidence.coverage.verifiedTurns, 1);
  assert.equal(evidence.coverage.answeredTurns, 2);
});

test('sin respuestas no hay evidencia', () => {
  const evidence = computeSpeechEvidence({ turns: [{ question: 'P1', answer: '   ' }], segments: [] });
  assert.equal(evidence.status, 'unverified');
  assert.equal(evidence.reason, 'NO_ANSWERS');
  assert.equal(evidence.wpm, null);
});

test('una transcripción sin segmentos queda no verificada, no lanza', () => {
  const evidence = computeSpeechEvidence({ turns: [{ question: 'P1', answer: LONG_ANSWER }], segments: [] });
  assert.equal(evidence.status, 'unverified');
  assert.equal(evidence.reason, 'NO_SEGMENTS');
});

test('timestamps inválidos no producen error 500: quedan como unverified', () => {
  const evidence = computeSpeechEvidence({
    turns: [{ question: 'P1', answer: LONG_ANSWER }],
    segments: [{ start: 'a', end: null, text: 'basura' }, { start: Infinity, end: -1, words: 'no' }],
  });
  assert.equal(evidence.status, 'unverified');
  assert.equal(evidence.reason, 'INVALID_TIMESTAMPS');
  assert.equal(evidence.droppedSegments, 2);
});

test('segmentos sin marcas por palabra no aportan tiempo', () => {
  const evidence = computeSpeechEvidence({
    turns: [{ question: 'P1', answer: LONG_ANSWER }],
    segments: [{ start: 1, end: 9, text: LONG_ANSWER }],
  });
  assert.equal(evidence.status, 'unverified');
  assert.equal(evidence.reason, 'NO_VERIFIED_TURNS');
  assert.equal(evidence.turns[0].reason, 'NO_WORD_TIMESTAMPS');
});

test('si el texto del cliente no aparece en el audio, no se verifica', () => {
  const evidence = computeSpeechEvidence({
    turns: [{ question: 'P1', answer: 'texto inventado que nadie dijo' }],
    segments: [segment(1, 'una respuesta completamente distinta')],
  });
  assert.equal(evidence.status, 'unverified');
  assert.equal(evidence.turns[0].reason, 'LOW_COVERAGE');
});

test('cobertura de sesión insuficiente (menos de la mitad de respuestas) no verifica', () => {
  const turns = [
    { question: 'P1', answer: LONG_ANSWER },
    { question: 'P2', answer: 'otra respuesta que no aparece en la grabacion de la sesion' },
    { question: 'P3', answer: 'tercera respuesta que tampoco aparece en la grabacion' },
  ];
  const segments = [segment(1, LONG_ANSWER, { step: 0.5 })];
  const evidence = computeSpeechEvidence({ turns, segments, durationSeconds: 60 });
  assert.equal(evidence.status, 'unverified');
  assert.equal(evidence.reason, 'LOW_SESSION_COVERAGE');
  assert.equal(evidence.coverage.verifiedTurns, 1);
  assert.equal(evidence.coverage.fraction, 0.333); // 1 de 3: por debajo del 50 %
});

test('una respuesta demasiado corta no se verifica', () => {
  const turns = [{ question: 'P1', answer: 'hola que tal' }];
  const segments = [segment(1, 'hola que tal')]; // 0,95 s de habla
  const evidence = computeSpeechEvidence({ turns, segments, durationSeconds: 10 });
  assert.equal(evidence.status, 'unverified');
  assert.equal(evidence.turns[0].reason, 'SHORT_SPEECH');
});

test('respeta el tope de segmentos por respuesta', () => {
  const turns = [{ question: 'P1', answer: 'palabra uno dos tres cuatro cinco seis' }];
  const segments = Array.from({ length: MAX_SEGMENTS_PER_TURN + 5 }, (_, i) => segment(i * 2, 'ruido'));
  segments.push(segment(100, 'palabra uno dos tres cuatro cinco seis'));
  const evidence = computeSpeechEvidence({ turns, segments, durationSeconds: 200 });
  // El audio de la respuesta está más allá del tope: no se verifica (y no se cuelga)
  assert.equal(evidence.status, 'unverified');
});

test('la duración total no se confunde con el tiempo de habla', () => {
  // 60 s de grabación con solo ~12 s de voz: el WPM debe usar los 12 s, no los 60
  const turns = [
    { question: 'P1', answer: LONG_ANSWER },
    { question: 'P2', answer: LONG_ANSWER_2 },
  ];
  const segments = [segment(30, LONG_ANSWER), segment(45, LONG_ANSWER_2)];
  const evidence = computeSpeechEvidence({ turns, segments, durationSeconds: 60 });
  assert.equal(evidence.status, 'verified');
  assert.equal(evidence.coverage.audioDurationSeconds, 60);
  assert.ok(evidence.speechMs < 20000);
  assert.ok(evidence.wpm > 100, `wpm inesperado: ${evidence.wpm}`);
});

