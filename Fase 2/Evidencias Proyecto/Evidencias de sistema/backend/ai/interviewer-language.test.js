// Idioma del entrevistador: el prompt debe declarar el idioma de la SESIÓN en cada solicitud.
// Estas pruebas comprueban la CONSTRUCCIÓN del prompt (no llaman a ningún modelo real).
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSystemPrompt, buildMessages } = require('./interviewer');
const { normalizeInterviewConfig, turnPlan } = require('./interviewConfig');

const theme = {
  title: 'Customer data breach',
  context: 'A company has suffered a data breach affecting 40,000 customers.',
  keyMessages: JSON.stringify(['No customer is at risk', 'We already contacted everyone']),
  redLines: JSON.stringify(['Do not confirm the number of affected customers']),
  interviewConfig: { questionCount: 5, followUps: 1, aggressiveness: 'MEDIA' },
};

const cfg = normalizeInterviewConfig(theme.interviewConfig);
const plan = turnPlan(cfg, 0);
const systemFor = (lang) => buildSystemPrompt(theme, cfg, plan, {}, false, lang);

test('una sesión en inglés recibe instrucciones en inglés', () => {
  const prompt = systemFor('en');
  assert.match(prompt, /Interview language \(mandatory, non-negotiable\)/);
  assert.match(prompt, /Ask ALL your questions and follow-ups in English/);
  assert.match(prompt, /Scenario: Customer data breach/);
  assert.match(prompt, /Rules:/);
  assert.match(prompt, /Ask ONE single question, in English/);
});

test('una sesión en español mantiene las instrucciones en español', () => {
  const prompt = systemFor('es');
  assert.match(prompt, /Idioma de la entrevista \(obligatorio, no negociable\)/);
  assert.match(prompt, /Formula TODAS tus preguntas y repreguntas en español/);
  assert.match(prompt, /Escenario: Customer data breach/);
  assert.match(prompt, /Reglas:/);
  assert.match(prompt, /Haz UNA sola pregunta, en español/);
});

test('el prompt de inglés no filtra instrucciones en español', () => {
  const prompt = systemFor('en');
  for (const leak of ['Idioma de la entrevista', 'Formula TODAS', 'Reglas:', 'Escenario:', 'Pregunta principal']) {
    assert.ok(!prompt.includes(leak), `el prompt en inglés no debe contener «${leak}»`);
  }
  // El contenido del escenario (datos) sí se inserta tal cual, en su idioma original.
  assert.match(prompt, /Customer data breach/);
});

test('el bloque de idioma cubre los casos pedidos (otro idioma, nombres propios, traducciones)', () => {
  const en = systemFor('en');
  assert.match(en, /Even if the spokesperson answers in another language, keep asking in English/);
  assert.match(en, /Even if the scenario includes words or expressions in another language, do not switch language/);
  assert.match(en, /Do not translate proper nouns, brands, job titles or institution names/);
  assert.match(en, /Do not invent translations of institutional names and do not alter the key messages/);

  const es = systemFor('es');
  assert.match(es, /Aunque el vocero responda en otro idioma, sigue preguntando en español/);
  assert.match(es, /Aunque el escenario incluya palabras o expresiones en otro idioma, no cambies de idioma/);
  assert.match(es, /No traduzcas nombres propios, marcas, cargos ni nombres de instituciones/);
  assert.match(es, /No inventes traducciones de nombres institucionales ni alteres los mensajes clave/);
});

test('los mensajes de la conversación también usan el idioma de la sesión', () => {
  const english = buildMessages(theme, [], cfg, plan, {}, 'en');
  assert.equal(english[0].role, 'system');
  assert.match(english[0].content, /Interview language/);
  assert.equal(english[english.length - 1].content, 'Start the interview with your first question.');

  const spanish = buildMessages(theme, [], cfg, plan, {}, 'es');
  assert.equal(spanish[spanish.length - 1].content, 'Comienza la entrevista con tu primera pregunta.');

  const history = [
    { role: 'interviewer', text: 'What happened?' },
    { role: 'vocero', text: 'We detected an incident yesterday.' },
  ];
  const withHistoryEn = buildMessages(theme, history, cfg, plan, {}, 'en');
  assert.equal(withHistoryEn[1].content, 'What happened?');
  assert.equal(withHistoryEn[2].content, 'Spokesperson answer: We detected an incident yesterday.');

  const withHistoryEs = buildMessages(theme, history, cfg, plan, {}, 'es');
  assert.equal(withHistoryEs[2].content, 'Respuesta del vocero: We detected an incident yesterday.');
});

test('sin idioma explícito se usa español (comportamiento histórico)', () => {
  const prompt = buildSystemPrompt(theme, cfg, plan, {}, false);
  assert.match(prompt, /Idioma de la entrevista/);
});
