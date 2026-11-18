// A4: el prompt del clasificador explica el campo `focus` y el campo `justify_extraordinary`, y
// nada del contrato previo (estados, evidencias, contradicciones) cambio.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMessages, parseAssessment } = require('../ai/answerAssessment');

const systemOf = (lang = 'es') =>
  buildMessages({
    mainQuestion: '¿Qué ocurrió?',
    answer: 'una respuesta cualquiera',
    history: [],
    cfg: { aggressiveness: 'ALTA' },
    followUpsUsed: 0,
    extraordinaryUsed: 0,
    budget: { extraordinary: 1 },
    lang,
  })[0].content;

test('el prompt (es) explica que debe contener el campo focus', () => {
  const system = systemOf('es');
  assert.match(system, /El campo "focus" describe la INFORMACION CONCRETA/);
  assert.match(system, /No describas en "focus" la conducta del vocero/);
  assert.match(system, /Si el estado es "sufficient", "focus" queda vacio/);
});

test('el prompt (es) explica cuando poner justify_extraordinary en true y cuando no', () => {
  const system = systemOf('es');
  assert.match(system, /El campo "justify_extraordinary" se pone en true SOLO si/);
  assert.match(system, /Se deja en false por defecto/);
  assert.match(system, /no lo uses como sustituto del estado "contradiction"/);
});

test('las mismas instrucciones existen en ingles', () => {
  const system = systemOf('en');
  assert.match(system, /The "focus" field describes the CONCRETE information/);
  assert.match(system, /Set "justify_extraordinary" to true ONLY if/);
  assert.doesNotMatch(system, /El campo "focus"/, 'los textos no se mezclan entre idiomas');
});

test('no se altero lo previo: rol, contrato JSON y reglas siguen presentes y en su orden', () => {
  const system = systemOf('es');
  const at = (needle) => system.indexOf(needle);
  assert.ok(at('analista de entrevistas') >= 0, 'el rol del clasificador sigue igual');
  assert.match(system, /"status":"sufficient\|partial\|evasive\|contradiction"/);
  assert.match(system, /"focus":"informacion pendiente \(vacio si sufficient\)"/);
  assert.match(system, /"evidence":\["fragmento literal del vocero"\]/);
  assert.ok(at('Usa "contradiction"') > at('analista de entrevistas'));
  assert.ok(at('Usa "sufficient"') > at('Usa "contradiction"'));
  assert.ok(at('El campo "focus"') > at('Usa "sufficient"'), 'las reglas nuevas se anaden al final');
});

test('el comportamiento de validacion no cambio', () => {
  // partial sin focus sigue siendo invalido
  assert.equal(parseAssessment('{"status":"partial"}', { answer: 'algo' }), null);
  // estado fuera del conjunto sigue siendo invalido
  assert.equal(parseAssessment('{"status":"sorprendido","focus":"x"}', { answer: 'algo' }), null);
  // sufficient sin focus sigue siendo valido
  assert.equal(parseAssessment('{"status":"sufficient","focus":""}', { answer: 'algo' }).status, 'sufficient');
  // contradiccion con menos de 2 citas literales sigue degradandose a partial
  const weak = parseAssessment(JSON.stringify({ status: 'contradiction', focus: 'aclarar', evidence: ['no aparece en la respuesta'] }), { answer: 'texto distinto' });
  assert.equal(weak.status, 'partial');
  // con 2 citas literales sigue siendo contradiction
  const strong = parseAssessment(
    JSON.stringify({ status: 'contradiction', focus: 'aclarar', evidence: ['dije que si', 'luego dije que no'] }),
    { answer: 'primero dije que si y luego dije que no' },
  );
  assert.equal(strong.status, 'contradiction');
  // justify_extraordinary se sigue leyendo igual
  const justified = parseAssessment(JSON.stringify({ status: 'partial', focus: 'un dato', justify_extraordinary: true }), { answer: 'x' });
  assert.equal(justified.justifyExtraordinary, true);
});
