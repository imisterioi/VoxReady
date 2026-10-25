// Validación de `interviewConfig` en las rutas de guardado de escenarios.
//
//   - POST/PUT /api/library/themes   (routes/library.js)
//   - POST     /api/themes           (index.js)
//
// Sin base de datos y sin red: Prisma, express (solo para index.js) y la autenticación están
// sustituidos por dobles. Lo que se comprueba es la REGLA (422 + INTERVIEW_CONFIG_INVALID antes
// de normalizar/guardar) y que las solicitudes válidas conservan su comportamiento.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const authPath = require.resolve('../auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { requireAuth: () => (req, res, next) => { req.user = { id: 'admin1', role: 'system', tenantId: 't1' }; next(); } },
};

const { invalidInterviewConfigPayload, normalizeInterviewConfig, resolveInterviewConfig } = require('../ai/interviewConfig');
const registerLibraryRoutes = require('../routes/library');

// 12 principales x (1 + 3 habituales + 2 extraordinarias + 1 contingencia) = 84 turnos > 30.
const INVALID = { questionCount: 12, followUps: 3, aggressiveness: 'EXTREMA', estimatedMinutes: 5 };
const VALID = { questionCount: 3, followUps: 1, aggressiveness: 'MEDIA', estimatedMinutes: 5 };
const body = (interview) => ({
  title: 'Escenario',
  context: 'Contexto de crisis',
  keyMessages: ['mensaje clave'],
  ...(interview ? { interview } : {}),
});

function libraryHarness() {
  const calls = { create: [], update: [] };
  const theme = { id: 'th1', isGlobal: true, deletedAt: null, title: 'Escenario' };
  const prisma = {
    theme: {
      findFirst: async () => null,
      findUnique: async () => theme,
      create: async ({ data }) => { calls.create.push(data); return { ...theme, ...data }; },
      update: async ({ data }) => { calls.update.push(data); return { ...theme, ...data }; },
    },
  };
  const app = express();
  app.use(express.json());
  registerLibraryRoutes(app, prisma);
  return { app, calls };
}

async function call(app, method, path, payload) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

test('la validación autoritativa devuelve null cuando la configuración es válida', () => {
  assert.equal(invalidInterviewConfigPayload(undefined), null, 'sin configuración se usan los valores por defecto');
  assert.equal(invalidInterviewConfigPayload({}), null);
  assert.equal(invalidInterviewConfigPayload(VALID), null);
  assert.equal(invalidInterviewConfigPayload({ questionCount: 10, followUps: 0, aggressiveness: 'BAJA' }), null, 'justo en el límite (30)');

  const payload = invalidInterviewConfigPayload(INVALID);
  assert.equal(payload.status, 'error');
  assert.equal(payload.code, 'INTERVIEW_CONFIG_INVALID');
  assert.equal(payload.limit, 30);
  assert.equal(payload.potential, 84);
  assert.ok(payload.errors.some((issue) => issue.code === 'TURN_LIMIT'), 'el detalle identifica el límite de turnos');
  assert.match(payload.mensaje, /30 turnos potenciales/);

  // Valores fuera del rango declarado: el detalle indica el campo y su máximo.
  const outOfRange = invalidInterviewConfigPayload({ questionCount: 20, followUps: 5, aggressiveness: 'MEDIA' });
  assert.ok(outOfRange.errors.some((issue) => issue.field === 'questionCount' && issue.code === 'ABOVE_MAX' && issue.max === 12));
  assert.ok(outOfRange.errors.some((issue) => issue.field === 'followUps' && issue.code === 'ABOVE_MAX' && issue.max === 3));
  assert.ok(outOfRange.errors.some((issue) => issue.code === 'TURN_LIMIT'), 'también avisa del límite de turnos');
});

// ------------------------------------------------------- Duración máxima OBLIGATORIA (5 min)

test('duración máxima: sin valor guardado se aplica el predeterminado de 5 minutos', () => {
  // Caso 1: escenario antiguo (interviewConfig = null).
  const legacy = resolveInterviewConfig({ interviewConfig: null });
  assert.equal(legacy.estimatedMinutes, 5, 'escenario sin configuración → 5 minutos');
  assert.equal(legacy.maxDurationMs, 300000, 'el límite efectivo existe (300000 ms)');
  assert.equal(legacy.estimatedMinutesAuto, true, 'se marca como predeterminado, no elegido');
  assert.equal(legacy.estimatedMinutesReference, 6, 'la referencia orientativa sigue siendo informativa');

  // Caso 2: objeto de configuración vacío.
  const empty = resolveInterviewConfig({ interviewConfig: {} });
  assert.equal(empty.estimatedMinutes, 5);
  assert.equal(empty.maxDurationMs, 300000);
});

test('duración máxima: un valor válido elegido por el usuario se conserva (caso 4)', () => {
  const custom = resolveInterviewConfig({ interviewConfig: { estimatedMinutes: 20 } });
  assert.equal(custom.estimatedMinutes, 20);
  assert.equal(custom.maxDurationMs, 1200000);
  assert.equal(custom.estimatedMinutesAuto, false, 'no es el predeterminado');
  assert.equal(custom.estimatedMinutesStored, 20);
});

test('duración máxima: vacío, nulo o inválido no puede desactivar el límite (caso 3)', () => {
  for (const value of ['', null, undefined, 'abc', '  ']) {
    const cfg = normalizeInterviewConfig({ estimatedMinutes: value });
    assert.equal(cfg.estimatedMinutes, 5, `"${String(value)}" debe caer al predeterminado`);
    assert.equal(resolveInterviewConfig({ interviewConfig: { estimatedMinutes: value } }).maxDurationMs, 300000);
  }
  // Fuera de rango: se acota dentro de [1, 120] (normalización documentada); nunca queda sin límite.
  assert.equal(normalizeInterviewConfig({ estimatedMinutes: 0 }).estimatedMinutes, 1);
  assert.equal(normalizeInterviewConfig({ estimatedMinutes: 500 }).estimatedMinutes, 120);
});

test('duración máxima: al GUARDAR es obligatoria y debe estar en rango', () => {
  // Sin la opción (configuración ya guardada, al iniciar la entrevista) una duración ausente NO es error.
  assert.equal(invalidInterviewConfigPayload({ questionCount: 3 }), null);

  const missing = invalidInterviewConfigPayload({ questionCount: 3, estimatedMinutes: '' }, { requireDuration: true });
  assert.equal(missing.code, 'INTERVIEW_CONFIG_INVALID');
  assert.ok(missing.errors.some((issue) => issue.field === 'estimatedMinutes' && issue.code === 'REQUIRED'));
  assert.match(missing.mensaje, /duracion maxima/i);

  const nullValue = invalidInterviewConfigPayload({ estimatedMinutes: null }, { requireDuration: true });
  assert.ok(nullValue.errors.some((issue) => issue.code === 'REQUIRED'));

  const below = invalidInterviewConfigPayload({ estimatedMinutes: 0 }, { requireDuration: true });
  assert.ok(below.errors.some((issue) => issue.code === 'BELOW_MIN'));

  const above = invalidInterviewConfigPayload({ estimatedMinutes: 121 }, { requireDuration: true });
  assert.ok(above.errors.some((issue) => issue.code === 'ABOVE_MAX'));

  const garbage = invalidInterviewConfigPayload({ estimatedMinutes: 'mucho' }, { requireDuration: true });
  assert.ok(garbage.errors.some((issue) => issue.code === 'INVALID'));

  assert.equal(invalidInterviewConfigPayload({ estimatedMinutes: 5 }, { requireDuration: true }), null);
});

test('POST /api/library/themes rechaza con 422 una configuración inválida y no guarda nada', async () => {
  const { app, calls } = libraryHarness();
  const res = await call(app, 'POST', '/api/library/themes', body(INVALID));
  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'INTERVIEW_CONFIG_INVALID');
  assert.equal(res.body.limit, 30);
  assert.ok(Array.isArray(res.body.errors) && res.body.errors.length > 0, 'incluye el detalle del error');
  assert.equal(calls.create.length, 0, 'no se crea el escenario');
});

test('POST /api/library/themes guarda la configuración válida tal como se normaliza', async () => {
  const { app, calls } = libraryHarness();
  const res = await call(app, 'POST', '/api/library/themes', body(VALID));
  assert.equal(res.status, 201);
  assert.equal(calls.create.length, 1);
  assert.deepEqual(calls.create[0].interviewConfig, {
    aggressiveness: 'MEDIA',
    questionCount: 3,
    followUps: 1,
    estimatedMinutes: 5,
    interviewerRole: '',
    maxAnswerSeconds: null,
  });
  assert.equal(res.body.theme.interview.questionCount, 3);
  assert.equal(res.body.theme.interview.estimatedMinutes, 5, 'la duración llega a la respuesta de la API');
  assert.equal(res.body.theme.interview.maxDurationMs, 300000, 'y con su límite efectivo');
});

test('POST /api/library/themes rechaza una duración vacía o inválida (no puede desactivar el límite)', async () => {
  const { app, calls } = libraryHarness();
  for (const minutes of ['', null, 0, 121, 'mucho']) {
    const res = await call(app, 'POST', '/api/library/themes', body({ ...VALID, estimatedMinutes: minutes }));
    assert.equal(res.status, 422, `duración "${String(minutes)}" debe rechazarse`);
    assert.equal(res.body.code, 'INTERVIEW_CONFIG_INVALID');
    assert.ok(res.body.errors.some((issue) => issue.field === 'estimatedMinutes'), 'el detalle indica el campo');
  }
  assert.equal(calls.create.length, 0, 'no se guarda ningún escenario inválido');
});

test('POST /api/library/themes sin configuración sigue usando los valores por defecto', async () => {
  const { app, calls } = libraryHarness();
  const res = await call(app, 'POST', '/api/library/themes', body(undefined));
  assert.equal(res.status, 201);
  assert.equal(calls.create[0].interviewConfig.questionCount, 5);
  assert.equal(calls.create[0].interviewConfig.followUps, 0);
  assert.equal(calls.create[0].interviewConfig.estimatedMinutes, 5, 'y la duración predeterminada de 5 minutos');
  assert.equal(res.body.theme.interview.maxDurationMs, 300000);
});

test('POST /api/library/themes conserva el 400 cuando faltan datos obligatorios', async () => {
  const { app, calls } = libraryHarness();
  const res = await call(app, 'POST', '/api/library/themes', { context: 'Contexto', keyMessages: ['m'], interview: INVALID });
  assert.equal(res.status, 400, 'la falta de nombre se informa antes que la configuración');
  assert.equal(calls.create.length, 0);
});

test('PUT /api/library/themes rechaza con 422 y conserva el escenario', async () => {
  const { app, calls } = libraryHarness();
  const invalid = await call(app, 'PUT', '/api/library/themes/th1', body(INVALID));
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.code, 'INTERVIEW_CONFIG_INVALID');
  assert.equal(calls.update.length, 0, 'no se actualiza el escenario');

  const valid = await call(app, 'PUT', '/api/library/themes/th1', body(VALID));
  assert.equal(valid.status, 200);
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].interviewConfig.questionCount, 3);
});

// ------------------------------------------------------------------ POST /api/themes (index.js)

// El handler de index.js vive dentro del archivo que arranca el servidor: para probarlo sin
// PostgreSQL ni puertos se sustituyen `express`, `@prisma/client` y `@prisma/adapter-pg` en
// require.cache y se invoca el handler registrado en POST /api/themes con req/res propios.
function indexHarness() {
  const calls = { create: [] };
  const routes = [];
  const app = {
    use: () => app,
    get: (path, ...handlers) => { routes.push({ method: 'get', path, handlers }); return app; },
    post: (path, ...handlers) => { routes.push({ method: 'post', path, handlers }); return app; },
    put: (path, ...handlers) => { routes.push({ method: 'put', path, handlers }); return app; },
    patch: (path, ...handlers) => { routes.push({ method: 'patch', path, handlers }); return app; },
    delete: (path, ...handlers) => { routes.push({ method: 'delete', path, handlers }); return app; },
    all: (path, ...handlers) => { routes.push({ method: 'all', path, handlers }); return app; },
    // No se ejecuta el callback de arranque: así no se programan trabajos ni se consulta la IA.
    listen: () => ({ close() {} }),
  };
  const expressStub = () => app;
  expressStub.json = () => (req, res, next) => next();

  class PrismaClientStub {
    constructor() {
      this.theme = { create: async ({ data }) => { calls.create.push(data); return { id: 'th1', ...data }; } };
      this.user = { findMany: async () => [] };
      this.scenarioAssignment = { create: async () => ({}) };
    }
  }

  const expressPath = require.resolve('express');
  const prismaPath = require.resolve('@prisma/client');
  const adapterPath = require.resolve('@prisma/adapter-pg');
  // routes/sessions.js programa la retención automática al cargarse: aquí no aporta nada a
  // POST /api/themes y solo añadiría trabajo de fondo y ruido en la salida de las pruebas.
  const sessionsPath = require.resolve('../routes/sessions');
  const saved = {
    [expressPath]: require.cache[expressPath],
    [prismaPath]: require.cache[prismaPath],
    [adapterPath]: require.cache[adapterPath],
    [sessionsPath]: require.cache[sessionsPath],
  };
  const stub = (id, exports) => { require.cache[id] = { id, filename: id, loaded: true, exports }; };
  stub(expressPath, expressStub);
  stub(prismaPath, { PrismaClient: PrismaClientStub });
  stub(adapterPath, { PrismaPg: class {} });
  stub(sessionsPath, () => {});

  try {
    require('../index.js');
  } finally {
    for (const [id, cached] of Object.entries(saved)) {
      if (cached) require.cache[id] = cached;
      else delete require.cache[id];
    }
  }

  const route = routes.filter((item) => item.method === 'post' && item.path === '/api/themes').pop();
  assert.ok(route, 'POST /api/themes debe estar registrado');
  const handler = route.handlers[route.handlers.length - 1];

  const run = async (payload) => {
    const res = {
      statusCode: null,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.payload = value; return this; },
    };
    await handler({ body: payload, user: { id: 'admin1', tenantId: 't1' } }, res);
    return res;
  };
  return { run, calls };
}

// index.js se carga UNA sola vez por proceso (registra sus rutas al importarse): el handler y el
// doble de Prisma se comparten entre pruebas.
let indexApp = null;
const index = () => {
  if (!indexApp) indexApp = indexHarness();
  return indexApp;
};

test('POST /api/themes (index.js) rechaza con 422 una configuración inválida y no guarda nada', async () => {
  const { run, calls } = index();
  const res = await run(body(INVALID));
  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.code, 'INTERVIEW_CONFIG_INVALID');
  assert.equal(res.payload.limit, 30);
  assert.equal(res.payload.potential, 84);
  assert.ok(res.payload.errors.length > 0, 'incluye el detalle del error');
  assert.equal(calls.create.length, 0, 'no se crea el escenario');
});

test('POST /api/themes (index.js) guarda la configuración válida y los valores por defecto', async () => {
  const { run, calls } = index();
  const before = calls.create.length;

  const valid = await run(body(VALID));
  assert.equal(valid.statusCode, 201);
  assert.equal(calls.create.length, before + 1);
  assert.deepEqual(calls.create[before].interviewConfig, {
    aggressiveness: 'MEDIA',
    questionCount: 3,
    followUps: 1,
    estimatedMinutes: 5,
    interviewerRole: '',
    maxAnswerSeconds: null,
  });

  const withoutConfig = await run(body(undefined));
  assert.equal(withoutConfig.statusCode, 201);
  assert.equal(calls.create[before + 1].interviewConfig.questionCount, 5);
  assert.equal(calls.create[before + 1].interviewConfig.followUps, 0);
  assert.equal(calls.create[before + 1].interviewConfig.estimatedMinutes, 5, 'duración predeterminada');
});

test('POST /api/themes (index.js) conserva el 400 cuando faltan datos obligatorios', async () => {
  const { run, calls } = index();
  const before = calls.create.length;
  const res = await run({ context: 'Contexto', keyMessages: ['m'], interview: INVALID });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.create.length, before, 'no se crea el escenario');
});
