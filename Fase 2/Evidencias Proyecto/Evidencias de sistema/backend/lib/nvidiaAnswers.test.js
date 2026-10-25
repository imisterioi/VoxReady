// Pruebas del reparto de segmentos por ventanas de respuesta.
//   cd backend && node --test lib/nvidiaAnswers.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const { answersFromSegments } = require('./nvidiaAnswers');

const turns = [
  { question: 'q1', startMs: 0, endMs: 5000 },
  { question: 'q2', startMs: 5000, endMs: 9000 },
];

test('asigna cada segmento a la ventana donde cae', () => {
  const result = answersFromSegments({
    turns,
    segments: [
      { text: 'primera respuesta', start: 1, end: 4 },
      { text: 'segunda respuesta', start: 6, end: 8 },
    ],
  });
  assert.deepEqual(result.answers, ['primera respuesta', 'segunda respuesta']);
  assert.deepEqual(result.orphans, []);
  assert.deepEqual(result.emptyTurns, []);
});

test('une varios segmentos del mismo turno en orden', () => {
  const result = answersFromSegments({
    turns: [{ startMs: 0, endMs: 10000 }],
    segments: [
      { text: 'hola', start: 1, end: 2 },
      { text: 'mundo', start: 3, end: 4 },
    ],
  });
  assert.equal(result.answers[0], 'hola mundo');
});

test('gana la ventana con más solapamiento, no la primera', () => {
  const result = answersFromSegments({
    turns: [{ startMs: 0, endMs: 3000 }, { startMs: 3000, endMs: 8000 }],
    segments: [{ text: 'casi todo en la segunda', start: 2.8, end: 6 }],
  });
  assert.equal(result.answers[1], 'casi todo en la segunda');
  assert.equal(result.answers[0], '');
  assert.deepEqual(result.emptyTurns, [0]);
});

test('un segmento fuera de toda ventana queda huérfano y no se atribuye', () => {
  const result = answersFromSegments({
    turns,
    segments: [{ text: 'silencio del entrevistador', start: 20, end: 22 }],
  });
  assert.deepEqual(result.answers, ['', '']);
  assert.deepEqual(result.orphans, ['silencio del entrevistador']);
});

test('sin marcas de tiempo válidas no se inventa asignación', () => {
  const result = answersFromSegments({
    turns: [{ question: 'sin tiempos' }],
    segments: [{ text: 'texto', start: 1, end: 2 }],
  });
  assert.deepEqual(result.answers, ['']);
  assert.deepEqual(result.orphans, ['texto']);
});

test('un segmento sin tiempos o vacío se descarta sin romper', () => {
  const result = answersFromSegments({
    turns,
    segments: [{ text: 'sin tiempos' }, { text: '', start: 1, end: 2 }, null],
  });
  assert.deepEqual(result.answers, ['', '']);
  assert.deepEqual(result.orphans, ['sin tiempos']);
});

test('tolera entradas vacías', () => {
  assert.deepEqual(answersFromSegments({}), { answers: [], orphans: [], emptyTurns: [] });
  assert.deepEqual(answersFromSegments().answers, []);
});
