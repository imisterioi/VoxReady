// Pruebas del motor de modelos del entrevistador (sin red, sin claves, sin inferencias).
const test = require('node:test');
const assert = require('node:assert/strict');

const { askModel, askModelFromContext, generateQuestion } = require('./interviewer');
const { createInterviewSession } = require('../lib/interviewSession');

const ok = (content) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
const httpError = (status) => async () => ({ ok: false, status, text: async () => 'boom' });
const tick = () => new Promise((r) => setImmediate(r));

test('devuelve la pregunta validada, el modelo y el tiempo', async () => {
  const result = await askModel('m1', [], { fetchImpl: ok('Pregunta: **Â¿QuÃ© medidas tomaron?**') });
  assert.equal(result.question, 'Â¿QuÃ© medidas tomaron?'); // cleanQuestion quita el prefijo y el markdown
  assert.equal(result.model, 'm1');
  assert.ok(Number.isFinite(result.ms));
});

test('un error HTTP se propaga con su cÃ³digo', async () => {
  await assert.rejects(() => askModel('m1', [], { fetchImpl: httpError(500) }), /HTTP 500/);
});

test('una respuesta que no es pregunta en espaÃ±ol se descarta', async () => {
  await assert.rejects(() => askModel('m1', [], { fetchImpl: ok('Claro, aquÃ­ tienes la informaciÃ³n.') }), /respuesta descartada/);
});

test('un modelo que no responde agota su propio tiempo', async () => {
  const never = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  await assert.rejects(() => askModel('m1', [], { fetchImpl: never, timeoutMs: 20 }), (error) => error.name === 'AbortError');
});

test('la respuesta tardÃ­a de otro modelo no deja promesas sin gestionar', async () => {
  const rejections = [];
  const onRejection = (error) => rejections.push(error);
  process.on('unhandledRejection', onRejection);
  try {
    let resolveSlow;
    const slow = () => new Promise((resolve) => { resolveSlow = resolve; });
    const fast = askModel('rapido', [], { fetchImpl: ok('Â¿Primera pregunta?') });
    const late = askModel('lento', [], { fetchImpl: slow });
    late.catch(() => {}); // el llamador gestiona la perdedora

    const winner = await fast;
    assert.equal(winner.question, 'Â¿Primera pregunta?');

    // El modelo lento termina DESPUÃ‰S y con error: no debe producir unhandledRejection.
    resolveSlow({ ok: false, status: 503, text: async () => 'caÃ­do' });
    await tick();
    await tick();
    assert.deepEqual(rejections, []);
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});

test('es compatible con interviewSession.js (misma interfaz askModel(model, context))', async () => {
  const session = createInterviewSession({
    sessionId: 's1',
    models: ['m1', 'm2'],
    askModel: (model, context) => askModel(model, context.messages, { fetchImpl: ok(`Â¿Pregunta de ${model}?`) }),
    now: () => Date.now(),
    sleep: async () => {},
  });

  const started = await session.start({ context: { messages: [{ role: 'user', content: 'contexto' }] } });
  assert.equal(started.ok, true);
  assert.match(started.question, /^Â¿Pregunta de m\d\?$/);
  assert.equal(session.snapshot().asked.length, 1);

  const next = await session.next({ context: { messages: [{ role: 'user', content: 'mÃ¡s contexto' }] }, timeoutMs: 200 });
  assert.equal(next.ok, true);
  assert.notEqual(next.question, started.question);
});

test('askModelFromContext construye los mensajes con buildMessages', async () => {
  const captured = [];
  const context = {
    theme: { title: 'Corte de suministro', context: 'falla elÃ©ctrica', keyMessages: 'a|b', redLines: 'c' },
    history: [],
    cfg: { aggressiveness: 'MEDIA' },
    plan: { kind: 'main', number: 1, total: 3 },
  };
  const result = await askModelFromContext('m1', context, {
    fetchImpl: async (url, init) => {
      captured.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Â¿QuÃ© ocurriÃ³?' } }] }) };
    },
  });
  assert.equal(result.question, 'Â¿QuÃ© ocurriÃ³?');
  assert.ok(captured[0].messages.length >= 2, 'debe enviar system + user');
  assert.match(JSON.stringify(captured[0].messages), /Corte de suministro/);
});

test('generateQuestion no cancela a los perdedores ni deja rechazos sueltos', async () => {
  const rejections = [];
  const onRejection = (error) => rejections.push(error);
  process.on('unhandledRejection', onRejection);

  const previous = { ...process.env };
  const previousFetch = globalThis.fetch;
  process.env.NVIDIA_API_KEY = 'clave-de-prueba'; // ficticia: el fetch estÃ¡ simulado
  process.env.AI_MODEL = 'lento';
  process.env.AI_FALLBACK_MODEL = 'rapido';
  process.env.AI_EXTRA_MODELS = '';
  process.env.AI_TIMEOUT_MS = '300';

  globalThis.fetch = async (url, init) => {
    const { model } = JSON.parse(init.body);
    if (model === 'rapido') return { ok: true, json: async () => ({ choices: [{ message: { content: 'Â¿QuÃ© pasÃ³?' } }] }) };
    await new Promise((r) => setTimeout(r, 50)); // el perdedor falla DESPUÃ‰S del ganador
    return { ok: false, status: 500, text: async () => 'fallo tardÃ­o' };
  };

  try {
    const winner = await generateQuestion({ theme: null, history: [] });
    assert.equal(winner.question, 'Â¿QuÃ© pasÃ³?');
    assert.equal(winner.model, 'rapido');
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(rejections, [], 'la promesa perdedora debe quedar gestionada');
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    process.off('unhandledRejection', onRejection);
  }
});

test('contexto sin cfg ni plan: se derivan del tema (no se atribuye a los modelos)', async () => {
  const seen = [];
  const result = await askModelFromContext('m1', { theme: null, history: [] }, { fetchImpl: async (url, init) => {
    seen.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '¿Pregunta?' } }] }) };
  } });
  assert.equal(result.question, '¿Pregunta?');
  assert.ok(seen[0].messages[0].content.includes('Eres'), 'el prompt del sistema se construye sin cfg');
});

// --- E4: el prompt describe el turno REAL y el contexto de la repregunta ---

const captureFetch = (captured) => async (url, init) => {
  captured.push(JSON.parse(init.body));
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '¿Qué medidas tomaron?' } }] }) };
};

const FOLLOW_CTX = {
  theme: { title: 'Accidente', context: 'planta', keyMessages: '', redLines: '' },
  cfg: { aggressiveness: 'MEDIA', followUps: 0 },
  plan: { kind: 'main', number: 2, total: 3 },
  history: [
    { role: 'interviewer', text: '¿Qué ocurrió?' },
    { role: 'vocero', text: 'Hubo una explosión en la planta y avisamos a la autoridad.' },
  ],
};

test('una repregunta real usa la instrucción de repregunta aunque el plan diga "main"', async () => {
  const captured = [];
  await askModelFromContext('m1', {
    ...FOLLOW_CTX,
    kind: 'followup',
    mainQuestion: '¿Qué ocurrió?',
    focus: 'cuándo avisaron a la autoridad',
    hasTranscript: true,
  }, { fetchImpl: captureFetch(captured) });
  const system = captured[0].messages[0].content;
  assert.match(system, /Este turno es una REPREGUNTA/);
  assert.doesNotMatch(system, /Este turno es una pregunta NUEVA/);
  assert.match(system, /Pregunta principal en curso: "¿Qué ocurrió\?"/);
  assert.match(system, /Aspecto pendiente que debe aclarar: cuándo avisaron a la autoridad/);
});

test('una pregunta principal real usa la instrucción de pregunta NUEVA', async () => {
  const captured = [];
  await askModelFromContext('m1', { ...FOLLOW_CTX, cfg: { aggressiveness: 'MEDIA', followUps: 2 }, kind: 'normal' }, { fetchImpl: captureFetch(captured) });
  const system = captured[0].messages[0].content;
  assert.match(system, /Este turno es una pregunta NUEVA/);
  assert.doesNotMatch(system, /Este turno es una REPREGUNTA/);
});

test('sin transcripción: el prompt no afirma lo dicho y el historial lo distingue del silencio', async () => {
  const captured = [];
  await askModelFromContext('m1', {
    ...FOLLOW_CTX,
    kind: 'followup',
    mainQuestion: '¿Qué ocurrió?',
    focus: null,
    hasTranscript: false,
    history: [
      { role: 'interviewer', text: '¿Qué ocurrió?' },
      { role: 'vocero', text: '', spoke: true, transcriptSource: 'unavailable' },
    ],
  }, { fetchImpl: captureFetch(captured) });
  const system = captured[0].messages[0].content;
  assert.match(system, /No hay transcripción utilizable de su última respuesta/);
  assert.match(system, /sin afirmar lo que dijo/);
  assert.doesNotMatch(system, /Si el vocero no dijo nada/, 'no se afirma que no respondió cuando sí habló');
  const ultimo = captured[0].messages[captured[0].messages.length - 1].content;
  assert.match(ultimo, /habló, pero no se pudo transcribir su respuesta/);
  assert.doesNotMatch(ultimo, /silencio/);
});

test('silencio real: el historial lo marca como silencio, no como fallo de transcripción', async () => {
  const captured = [];
  await askModelFromContext('m1', {
    ...FOLLOW_CTX,
    kind: 'followup',
    history: [
      { role: 'interviewer', text: '¿Qué ocurrió?' },
      { role: 'vocero', text: '' },
    ],
  }, { fetchImpl: captureFetch(captured) });
  const ultimo = captured[0].messages[captured[0].messages.length - 1].content;
  assert.match(ultimo, /silencio, no respondió/);
});

