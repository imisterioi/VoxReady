// Prompt del entrevistador (Etapa 1): estructura, comportamiento por nivel de agresividad,
// contexto de escenario y organización, memoria estructurada, prohibiciones y límites reales de
// formato. Pruebas OFFLINE: no llaman a ningún modelo ni a la base de datos.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMessages,
  buildMemory,
  detectTopics,
  detectTension,
  isReservedQuestionStale,
  cleanQuestion,
  QUESTION_TARGET_WORDS,
  MAX_QUESTION_WORDS,
  TOPIC_LADDER,
} = require('./interviewer');
const { AGGRESSIVENESS, normalizeInterviewConfig, turnPlan } = require('./interviewConfig');
const { createInterviewSession } = require('../lib/interviewSession');

const THEME = {
  title: 'Prueba integral: corte masivo de suministro',
  context: 'Un corte eléctrico no programado dejó sin suministro a 80.000 hogares durante 14 horas.',
  optic: 'Empática',
  publics: JSON.stringify(['Clientes', 'Vecinos']),
  keyMessages: JSON.stringify(['El 100% del suministro ya fue restablecido.', 'Compensaremos a los afectados.']),
  redLines: JSON.stringify(['Culpar a terceros sin evidencia.']),
  tenant: { name: 'Energía Andes', sector: 'Energía' },
  interviewConfig: { aggressiveness: 'MEDIA', questionCount: 5, followUps: 0, estimatedMinutes: 5 },
};

const HISTORY = [
  { role: 'interviewer', text: '¿Qué ocurrió exactamente en el suministro?' },
  { role: 'vocero', text: 'Tuvimos un corte masivo que afectó a 4.200 clientes; el 100 % ya está restablecido.' },
  { role: 'interviewer', text: '¿Por qué no informaron antes a los vecinos?' },
  { role: 'vocero', text: 'El gerente de operaciones lo revisará el viernes y compensaremos en la próxima boleta.' },
];

const cfgFor = (level = 'MEDIA', extra = {}) =>
  normalizeInterviewConfig({ aggressiveness: level, questionCount: 5, followUps: 0, estimatedMinutes: 5, ...extra });

const promptFor = ({ level = 'MEDIA', lang = 'es', theme = THEME, history = HISTORY, turn = { kind: 'main' }, extra = {}, extras = {} } = {}) => {
  const cfg = cfgFor(level, extra);
  const plan = turnPlan(cfg, history.filter((item) => item.role === 'interviewer').length);
  return buildMessages(theme, history, cfg, plan, turn, lang, extras)[0].content;
};

test('1) el prompt declara objetivo, método, comportamiento del nivel y prohibiciones', () => {
  const prompt = promptFor();
  assert.match(prompt, /Objetivo de la entrevista:/);
  assert.match(prompt, /Método:/);
  assert.match(prompt, /Comportamiento de tu nivel:/);
  assert.match(prompt, /Prohibido en todos los niveles:/);
  for (const fragment of [
    'No inventes hechos, cifras, declaraciones, acusaciones ni antecedentes',
    'No insultes ni uses hostilidad gratuita',
    'No induzcas al vocero a revelar información confidencial',
    'No busques que cruce sus líneas rojas',
    'No repitas una pregunta solo para aumentar la presión',
    'No presentes suposiciones como hechos comprobados',
  ]) {
    assert.ok(prompt.includes(fragment), `falta la prohibición: ${fragment}`);
  }
});

test('2) el prompt ya no pide tentar al vocero a cruzar las líneas rojas (regresión)', () => {
  for (const level of ['BAJA', 'MEDIA', 'ALTA', 'EXTREMA']) {
    for (const lang of ['es', 'en']) {
      const prompt = promptFor({ level, lang });
      assert.ok(!/tienten|tempt/i.test(prompt), `no debe pedir tentar al vocero a cruzar líneas rojas (${level}/${lang})`);
      assert.ok(!/peor interpretación|worst possible reading/i.test(prompt), `no debe pedir la peor interpretación (${level}/${lang})`);
    }
  }
  const prompt = promptFor();
  assert.ok(prompt.includes('Culpar a terceros sin evidencia'), 'las líneas rojas siguen presentes como contexto');
});

test('3) el escenario y el contexto disponible llegan al prompt (y solo si existen)', () => {
  const prompt = promptFor();
  assert.ok(prompt.includes('Prueba integral: corte masivo de suministro'));
  assert.ok(prompt.includes('80.000 hogares'));
  assert.ok(prompt.includes('Organización: Energía Andes (sector: Energía)'));
  assert.ok(prompt.includes('Óptica institucional esperada: Empática'));
  assert.ok(prompt.includes('Clientes | Vecinos'));
  assert.ok(prompt.includes('El 100% del suministro ya fue restablecido.'));
  assert.ok(prompt.includes('Culpar a terceros sin evidencia.'));

  // Sin datos de organización, óptica ni público, el prompt NO los inventa.
  const bare = { title: 'Escenario mínimo', context: 'Contexto mínimo' };
  const promptBare = promptFor({ theme: bare, history: [] });
  assert.ok(!promptBare.includes('Organización:'));
  assert.ok(!promptBare.includes('Óptica institucional'));
  assert.ok(!promptBare.includes('Público al que se dirige'));
});

test('4) los cuatro niveles producen prompts distintos con su comportamiento completo', () => {
  const prompts = {};
  for (const level of ['BAJA', 'MEDIA', 'ALTA', 'EXTREMA']) {
    prompts[level] = promptFor({ level });
    const behavior = AGGRESSIVENESS[level];
    for (const field of ['approach', 'formulate', 'press', 'evasion', 'contradiction', 'advance']) {
      assert.ok(prompts[level].includes(behavior[field]), `el nivel ${level} debe incluir su comportamiento «${field}»`);
    }
  }
  const levels = Object.keys(prompts);
  for (let i = 0; i < levels.length; i += 1) {
    for (let j = i + 1; j < levels.length; j += 1) {
      assert.notEqual(prompts[levels[i]], prompts[levels[j]], `${levels[i]} y ${levels[j]} no pueden ser iguales`);
    }
  }
  assert.match(prompts.BAJA, /No exiges cifras, plazos ni responsables/);
  assert.match(prompts.EXTREMA, /Insistes sobre los puntos críticos/);
  assert.match(prompts.ALTA, /Abordas la inconsistencia de frente/);
  assert.match(prompts.MEDIA, /Pides precisión cuando falta un dato relevante/);
});

test('5) la memoria resume principales, temas preguntados, pendientes y datos ya dichos', () => {
  const memory = buildMemory({ history: HISTORY, cfg: cfgFor('MEDIA'), plan: turnPlan(cfgFor('MEDIA'), 2), lang: 'es' });
  assert.equal(memory.mains.length, 2);
  assert.ok(memory.asked.includes('qué ocurrió'));
  assert.ok(memory.notAsked.length > 0);
  assert.deepEqual(memory.answered, [], 'sin resoluciones no hay ningún tema respondido');
  assert.ok(memory.figures.some((item) => item.includes('4.200')));
  assert.ok(memory.commitments.some((item) => /Compensaremos/i.test(item)));
  assert.ok(memory.actors.some((item) => /gerente de operaciones/i.test(item)));

  const prompt = promptFor();
  assert.ok(prompt.includes('Memoria de la entrevista:'));
  assert.ok(prompt.includes('Temas preguntados (una pregunta NO implica que esté respondido):'));
  assert.ok(prompt.includes('Temas aún no preguntados'));
  assert.ok(!prompt.includes('Temas ya tratados'));
  assert.ok(prompt.includes('4.200 clientes'));
  assert.ok(prompt.includes('gerente de operaciones'));
  assert.ok(prompt.includes('no des por hecho nada que el vocero no haya dicho'));
});

test('6) la memoria señala una posible inconsistencia de cifras sin acusar (mismo referente)', () => {
  const history = [
    { role: 'interviewer', text: '¿Cuántos clientes afectados hay?' },
    { role: 'vocero', text: 'Hay 4.200 clientes afectados.' },
    { role: 'interviewer', text: '¿Y ahora?' },
    { role: 'vocero', text: 'Ahora son 80.000 clientes afectados.' },
  ];
  const memory = buildMemory({ history, cfg: cfgFor('MEDIA'), plan: turnPlan(cfgFor('MEDIA'), 2), lang: 'es' });
  assert.match(memory.tension, /dos cifras distintas sobre «clientes afectados»/);
  assert.match(memory.tension, /4\.200 y 80\.000/);
  assert.match(promptFor({ history }), /Posible inconsistencia:/);
});

test('7) el progreso y el estado del análisis viajan al prompt', () => {
  const prompt = promptFor({
    turn: {
      kind: 'followup',
      mainQuestion: '¿Qué ocurrió?',
      focus: 'cuántos clientes siguen sin suministro',
      hasTranscript: true,
      assessmentStatus: 'evasive',
    },
  });
  assert.match(prompt, /Vas por el turno 3 de 5 \(pregunta principal 3 de 5\)/);
  assert.match(prompt, /Este turno es una REPREGUNTA/);
  assert.match(prompt, /Aspecto pendiente que debe aclarar: cuántos clientes siguen sin suministro/);
  assert.match(prompt, /clasificó como "evasive"/);
  assert.ok(!/clasificó como/.test(promptFor()), 'sin estado no debe aparecer la línea del análisis');
});

test('8) el silencio real se instruye sin interpretar motivos', () => {
  const history = [...HISTORY, { role: 'vocero', text: '', spoke: false }];
  const prompt = promptFor({ history, turn: { kind: 'main' } });
  assert.match(prompt, /se quedó en SILENCIO/);
  assert.ok(!/oculta algo/.test(prompt), 'no debe afirmar motivos del silencio');
  assert.ok(!/clasificó como/.test(prompt), 'sin respuesta no hay estado del análisis que mostrar');
});

test('9) el idioma sigue siendo obligatorio y el prompt inglés no filtra instrucciones en español', () => {
  const spanish = promptFor({ lang: 'es' });
  assert.match(spanish, /Idioma de la entrevista \(obligatorio, no negociable\)/);
  assert.match(spanish, /Formula TODAS tus preguntas y repreguntas en español/);

  const english = promptFor({ lang: 'en' });
  assert.match(english, /Interview language \(mandatory, non-negotiable\)/);
  assert.match(english, /Ask ALL your questions and follow-ups in English/);
  assert.match(english, /Interview objective:/);
  assert.match(english, /Forbidden at every level:/);
  assert.match(english, /Interview memory:/);
  for (const leak of [
    'Idioma de la entrevista',
    'Formula TODAS',
    'Reglas:',
    'Escenario:',
    'Pregunta principal',
    'Objetivo de la entrevista',
    'Método:',
    'Comportamiento de tu nivel',
    'Prohibido en todos los niveles',
    'Memoria de la entrevista',
    'Organización:',
    'Óptica institucional',
    'Público al que se dirige',
  ]) {
    assert.ok(!english.includes(leak), `el prompt en inglés no debe contener «${leak}»`);
  }
});

test('10) las instrucciones de formato coinciden con la validación real de cleanQuestion', () => {
  const prompt = promptFor();
  assert.ok(prompt.includes(`de máximo ${QUESTION_TARGET_WORDS} palabras`));
  assert.ok(prompt.includes(`si supera ${MAX_QUESTION_WORDS}, se descarta`));

  const words = (count) => `¿${Array.from({ length: count }, (_, i) => `palabra${i}`).join(' ')}?`;
  assert.equal(cleanQuestion(words(QUESTION_TARGET_WORDS)), words(QUESTION_TARGET_WORDS));
  assert.equal(cleanQuestion(words(MAX_QUESTION_WORDS)), words(MAX_QUESTION_WORDS));
  assert.equal(cleanQuestion(words(MAX_QUESTION_WORDS + 1)), null);
});

test('11) el prompt no crece sin control con una entrevista larga', () => {
  const long = [];
  for (let i = 0; i < 5; i += 1) {
    long.push({ role: 'interviewer', text: `¿Pregunta principal número ${i + 1} sobre lo ocurrido y sus responsables?` });
    long.push({
      role: 'vocero',
      text: `Respuesta ${i + 1}: 4.20${i} clientes afectados, el gerente de operaciones informará el viernes y compensaremos.`,
    });
  }
  const prompt = promptFor({ history: long });
  const budget = 7000;
  assert.ok(prompt.length <= budget, `el prompt (${prompt.length} caracteres) supera el presupuesto de ${budget}`);
});

test('12) la detección de temas cubre la escalera de progresión sin inventar', () => {
  const topics = detectTopics(['¿Qué ocurrió?', '¿Cuántos clientes se vieron afectados?', '¿Qué medidas adoptaron?']);
  assert.deepEqual(topics, ['hecho', 'afectados', 'medidas']);
  assert.equal(TOPIC_LADDER.length, 7);
  assert.equal(detectTension(['un cliente']), null, 'una sola respuesta no puede contradecirse');
  // Dos menciones idénticas (aunque sean genéricas) sí se comparan: mismo referente, dos valores.
  assert.deepEqual(detectTension(['4.200 clientes', '80.000 clientes']).values, ['4.200', '80.000']);
  assert.equal(detectTension(['4.200 clientes afectados', '80.000 clientes afectados']).referent, 'clientes afectados');
  assert.deepEqual(detectTension(['4.200 clientes afectados', '80.000 clientes afectados']).values, ['4.200', '80.000']);
  // Unidades iguales con referentes distintos: no se compara (evita el falso positivo).
  assert.equal(detectTension(['80.000 clientes afectados', '4.200 clientes sin suministro']), null);
  // Dos cifras dentro de la MISMA respuesta tampoco se comparan.
  assert.equal(detectTension(['4.200 clientes afectados y 80.000 clientes afectados']), null);
});

// ---------------------------------------------------------------- Etapa 2: memoria por estados
// T1-T4 (R1): un tema preguntado NO es un tema respondido. El estado sale del clasificador ya
// existente (`resolutions` por turno) y solo `sufficient` marca un tema como respondido.
const ONE_TOPIC_HISTORY = [
  { role: 'interviewer', text: '¿Cuántos clientes fueron afectados?' },
  { role: 'vocero', text: 'Estamos trabajando intensamente para resolver el problema.' },
];

test('13) T1: un tema preguntado sin respuesta no aparece como respondido', () => {
  const memory = buildMemory({ history: ONE_TOPIC_HISTORY, cfg: cfgFor('MEDIA'), plan: turnPlan(cfgFor('MEDIA'), 1) });
  assert.deepEqual(memory.asked, ['a quiénes afectó y con qué alcance']);
  assert.deepEqual(memory.answered, [], 'preguntar no es responder');
  assert.deepEqual(memory.needsClarification, [], 'sin estado del clasificador no se inventa nada');

  const prompt = promptFor({ history: ONE_TOPIC_HISTORY });
  assert.match(prompt, /Temas preguntados \(una pregunta NO implica que esté respondido\)/);
  assert.match(prompt, /Un tema preguntado NO está respondido/);
  assert.ok(!prompt.includes('Temas ya tratados'), 'la etiqueta ambigua se eliminó');
  assert.ok(!/Temas respondidos según el análisis/.test(prompt), 'sin resolución no hay respondidos');
});

test('14) T2: solo «sufficient» marca un tema como respondido (y solo si la pregunta tenía un tema)', () => {
  const resolutions = [{ turn: 1, mainNumber: 1, status: 'sufficient', reason: 'ok' }];
  const memory = buildMemory({
    history: ONE_TOPIC_HISTORY,
    cfg: cfgFor('MEDIA'),
    plan: turnPlan(cfgFor('MEDIA'), 1),
    resolutions,
  });
  assert.deepEqual(memory.answered, ['a quiénes afectó y con qué alcance']);
  assert.deepEqual(memory.needsClarification, []);
  assert.match(
    promptFor({ history: ONE_TOPIC_HISTORY, extras: { resolutions } }),
    /Temas respondidos según el análisis: a quiénes afectó y con qué alcance/,
  );

  // Una pregunta que aborda DOS aspectos no se da por respondida aunque el análisis diga suficiente.
  const twoTopics = [
    { role: 'interviewer', text: '¿Cuántos clientes fueron afectados y qué medidas adoptaron?' },
    { role: 'vocero', text: 'Tomamos medidas para los 4.200 clientes afectados.' },
  ];
  const mixed = buildMemory({ history: twoTopics, cfg: cfgFor('MEDIA'), plan: turnPlan(cfgFor('MEDIA'), 1), resolutions });
  assert.ok(mixed.asked.includes('a quiénes afectó y con qué alcance'));
  assert.ok(mixed.asked.includes('qué medidas se tomaron'));
  assert.deepEqual(mixed.answered, [], 'no se marcan todos los aspectos como respondidos');
});

test('15) T3: parcial, evasiva y respuestas sin contenido piden aclaración (nunca «respondido»)', () => {
  for (const status of ['partial', 'evasive', 'contradiction', 'empty', 'unknown', 'refusal', 'repeat', 'no_transcript']) {
    const memory = buildMemory({
      history: ONE_TOPIC_HISTORY,
      cfg: cfgFor('MEDIA'),
      plan: turnPlan(cfgFor('MEDIA'), 1),
      resolutions: [{ turn: 1, status }],
    });
    assert.deepEqual(memory.answered, [], `«${status}» no puede marcar un tema como respondido`);
    assert.deepEqual(
      memory.needsClarification,
      ['a quiénes afectó y con qué alcance'],
      `«${status}» debe quedar pendiente de aclaración`,
    );
  }
});

test('16) T4: sin resoluciones (reinicio) o desalineadas, el tema queda solo como preguntado', () => {
  const plan = turnPlan(cfgFor('MEDIA'), 1);
  const without = buildMemory({ history: ONE_TOPIC_HISTORY, cfg: cfgFor('MEDIA'), plan });
  assert.deepEqual(without.answered, []);
  assert.ok(without.asked.includes('a quiénes afectó y con qué alcance'));

  // Más resoluciones que respuestas evaluadas y sin turno coincidente: no se atribuye nada.
  const foreign = buildMemory({
    history: ONE_TOPIC_HISTORY,
    cfg: cfgFor('MEDIA'),
    plan,
    resolutions: [
      { turn: 7, status: 'sufficient' },
      { turn: 8, status: 'sufficient' },
    ],
  });
  assert.deepEqual(foreign.answered, []);
  assert.deepEqual(foreign.needsClarification, []);
});

// ---------------------------------------------------------------- Etapa 2: cifras con referente
// T5-T8 (R2): solo se señala una posible inconsistencia cuando las cifras de respuestas distintas
// comparten referente. Nunca se afirma que el vocero mintió ni que la contradicción sea un hecho.

test('17) T5: cifras con unidades distintas no señalan inconsistencia (ejemplo del informe)', () => {
  const history = [
    { role: 'interviewer', text: '¿Cuántos hogares fueron afectados por el corte?' },
    { role: 'vocero', text: 'El corte afectó a 80.000 hogares y duró 14 horas.' },
    { role: 'interviewer', text: '¿Cuántos siguen sin suministro?' },
    { role: 'vocero', text: 'A 4.200 clientes todavía permanecen sin suministro.' },
  ];
  const memory = buildMemory({ history, cfg: cfgFor('MEDIA'), plan: turnPlan(cfgFor('MEDIA'), 2) });
  assert.equal(memory.tension, null);
  assert.ok(memory.figures.some((item) => item.includes('80.000 hogares')));
  assert.ok(!promptFor({ history }).includes('Posible inconsistencia'));
});

test('18) T6: la misma palabra con referentes distintos no señala inconsistencia', () => {
  const history = [
    { role: 'interviewer', text: '¿A cuántos clientes afectó el corte?' },
    { role: 'vocero', text: 'Se vieron 80.000 clientes afectados por la interrupción.' },
    { role: 'interviewer', text: '¿Cuántos siguen sin servicio?' },
    { role: 'vocero', text: 'Quedan 4.200 clientes sin suministro.' },
  ];
  const memory = buildMemory({ history, cfg: cfgFor('MEDIA'), plan: turnPlan(cfgFor('MEDIA'), 2) });
  assert.equal(memory.tension, null, 'unidades iguales con referente distinto no son una inconsistencia');
  // La cifra sin calificador es ambigua: tampoco se compara.
  assert.equal(detectTension(['4.200 clientes', '80.000 clientes según el sistema']), null);
});

test('19) T7: el mismo referente con valores distintos sí produce una nota «posible»', () => {
  const history = [
    { role: 'interviewer', text: '¿Cuántos clientes afectados hay?' },
    { role: 'vocero', text: 'Hay 4.200 clientes afectados.' },
    { role: 'interviewer', text: '¿Y ahora?' },
    { role: 'vocero', text: 'Ahora son 80.000 clientes afectados.' },
  ];
  const memory = buildMemory({ history, cfg: cfgFor('MEDIA'), plan: turnPlan(cfgFor('MEDIA'), 2) });
  assert.match(memory.tension, /dos cifras distintas sobre «clientes afectados»/);
  assert.match(memory.tension, /4\.200 y 80\.000/);
  assert.match(memory.tension, /Pueden referirse a cosas diferentes/);
  assert.match(memory.tension, /momento concreto \("Ahora"\)/, 'el contexto temporal se informa');
  assert.match(promptFor({ history }), /Posible inconsistencia: dos cifras distintas sobre/);

  // Dos cifras de la MISMA respuesta no se comparan entre sí.
  assert.equal(detectTension(['4.200 clientes afectados y 80.000 clientes afectados en total']), null);
});

test('20) T8: la nota no se presenta como engaño probado y mantiene la petición de aclaración', () => {
  const history = [
    { role: 'interviewer', text: '¿Cuántos clientes afectados hay?' },
    { role: 'vocero', text: 'Hay 4.200 clientes afectados.' },
    { role: 'interviewer', text: '¿Y ahora?' },
    { role: 'vocero', text: 'Ahora son 80.000 clientes afectados.' },
  ];
  for (const lang of ['es', 'en']) {
    const prompt = promptFor({ lang, history });
    assert.ok(!/\bmentir\w*|\bmentira\b|enga[ñn]|deceiv|trick|\blie\b|\blied\b|\blyin'/i.test(prompt), 'sin lenguaje acusatorio');
    assert.ok(!/contradicci[oó]n confirmada|confirmed contradiction/i.test(prompt));
    assert.match(prompt, lang === 'en' ? /Possible inconsistency/ : /Posible inconsistencia/);
    assert.match(prompt, lang === 'en' ? /ask them to clarify/i : /pide que lo aclare/);
    assert.match(prompt, lang === 'en' ? /they may refer to different things/i : /Pueden referirse a cosas diferentes/);
  }
});

// ---------------------------------------------------------------- Etapa 2: reservas y niveles
// T9 (R3): una reserva cuyo objetivo ya fue respondido de forma suficiente se descarta y se genera
// otra con la memoria actualizada; una profundización legítima se conserva.
const RESERVE_CTX = { theme: { title: 'Reserva' }, history: [], cfg: cfgFor('MEDIA') };

const reserveSession = ({ queue, withPredicate }) =>
  createInterviewSession({
    sessionId: 'reserva',
    models: ['modelo'],
    askModel: async () => ({ question: queue.shift() || '¿Pregunta de respaldo?' }),
    reserveTarget: 1,
    sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
    ...(withPredicate ? { isObsolete: (item, sessionState) => isReservedQuestionStale(item, sessionState) } : {}),
  });

// Deja la reserva cargada y el turno 1 ya respondido de forma suficiente.
async function withAnsweredTurn1(session) {
  await session.prewarm({ context: RESERVE_CTX, rounds: 1, waitPerRoundMs: 500 });
  assert.equal(session.snapshot().reserved.length, 1, 'la reserva previa queda cargada');
  session.seed({
    history: [
      { role: 'interviewer', text: '¿A cuántos clientes afectó el corte?' },
      { role: 'vocero', text: 'A 4.200 clientes.' },
    ],
    kindFor: () => 'main',
  });
  session.recordResolution({ status: 'sufficient' });
  return session;
}

test('21) T9: la reserva obsoleta por respuesta se descarta y la profundización legítima se conserva', async () => {
  // (a) La reserva pide lo que el vocero ya respondió: se descarta y se genera otra.
  const stale = await withAnsweredTurn1(
    reserveSession({ queue: ['¿Cuántos clientes fueron afectados por el corte?', '¿Qué medidas adoptaron?'], withPredicate: true }),
  );
  const nextQuestion = await stale.next({ context: RESERVE_CTX, timeoutMs: 500 });
  assert.equal(nextQuestion.question, '¿Qué medidas adoptaron?', 'se genera una pregunta nueva');

  // (b) La reserva aborda otro tema: se conserva tal cual (no se descarta por categoría).
  const kept = await withAnsweredTurn1(
    reserveSession({ queue: ['¿Qué medidas adoptaron para evitar otro corte?'], withPredicate: true }),
  );
  const keptQuestion = await kept.next({ context: RESERVE_CTX, timeoutMs: 500 });
  assert.equal(keptQuestion.question, '¿Qué medidas adoptaron para evitar otro corte?');

  // (c) Línea base: sin el predicado, la reserva obsoleta se entrega igual (demuestra el cambio).
  const baseline = await withAnsweredTurn1(
    reserveSession({ queue: ['¿Cuántos clientes fueron afectados por el corte?'], withPredicate: false }),
  );
  const baselineQuestion = await baseline.next({ context: RESERVE_CTX, timeoutMs: 500 });
  assert.equal(baselineQuestion.question, '¿Cuántos clientes fueron afectados por el corte?');

  // (d) Una reserva con el mismo tema pero enunciado distinto (profundización) se conserva.
  const depth = await withAnsweredTurn1(
    reserveSession({ queue: ['¿Cómo compensarán a esos clientes afectados?'], withPredicate: true }),
  );
  const depthQuestion = await depth.next({ context: RESERVE_CTX, timeoutMs: 500 });
  assert.equal(depthQuestion.question, '¿Cómo compensarán a esos clientes afectados?');
});

test('22) T10: ALTA y EXTREMA exigen sin suponer mala fe (español e inglés)', () => {
  const forbiddenEs = [
    /Eres hostil/i,
    /asumes lo peor/i,
    /peor interpretación/i,
    /desconfías de la versión oficial/i,
    /forma más dañina/i,
    /buscas el titular/i,
  ];
  const forbiddenEn = [
    /You are hostile/i,
    /assume the worst/i,
    /most damaging way/i,
    /distrust the official story/i,
    /worst possible reading/i,
    /after a headline/i,
  ];
  for (const level of ['ALTA', 'EXTREMA']) {
    const spanish = promptFor({ level });
    const english = promptFor({ level, lang: 'en' });
    for (const pattern of forbiddenEs) assert.ok(!pattern.test(spanish), `ES ${level}: ${pattern}`);
    for (const pattern of forbiddenEn) assert.ok(!pattern.test(english), `EN ${level}: ${pattern}`);
    assert.match(spanish, /sin hostilidad|sin acusaciones sin base/);
    assert.match(spanish, /no haya declarado|no haya dicho/);
    assert.match(english, /no hostility|no baseless accusations/);
    assert.match(english, /did not state/);
  }
  // Los textos de comportamiento (incluido `followUp`, hoy sin uso en el prompt) quedan coherentes.
  for (const level of ['ALTA', 'EXTREMA']) {
    const behavior = AGGRESSIVENESS[level];
    const texts = `${behavior.persona} ${behavior.followUp} ${behavior.approach} ${behavior.contradiction}`;
    assert.ok(!/hostil y|asumes lo peor|peor interpretación|forma más dañina|desconfías/i.test(texts), `${level} no supone mala fe`);
  }
});




