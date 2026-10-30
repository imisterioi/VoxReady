// Catálogos de escenarios generales separados por idioma (no se traducen entre sí).
// Prisma y autenticación simulados (sin base de datos).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const realAuth = require('../auth');
const authPath = require.resolve('../auth');

const USERS = {
  sys: { id: 's-1', role: 'SYSTEM', status: 'ACTIVE', tenantId: null },
  adminA: { id: 'a-a', role: 'ADMIN', status: 'ACTIVE', tenantId: 'T1' },
};
const ROLE_TO_API = { VOCERO: 'user', ADMIN: 'admin', MASTER: 'master', SYSTEM: 'system' };

require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    ...realAuth,
    requireAuth: (_prisma, roles = []) => async (req, res, next) => {
      const user = USERS[req.headers['x-test-user']];
      if (!user) return res.status(401).json({ status: 'error', mensaje: 'sin usuario de prueba' });
      const apiRole = ROLE_TO_API[user.role];
      if (roles.length && !roles.includes(apiRole)) {
        return res.status(403).json({ status: 'error', mensaje: 'No tienes permiso para esta acción.' });
      }
      req.user = user;
      req.apiRole = apiRole;
      next();
    },
  },
};

const registerLibraryRoutes = require('./library');

function createStore() {
  const state = {
    themes: [
      { id: 'g-es', title: 'Corte prolongado', language: 'es', isGlobal: true, tenantId: null, deletedAt: null, category: 'CRISIS', context: 'x', keyMessages: '["a"]', redLines: '[]', publics: '[]', optic: null, interviewConfig: null, createdAt: new Date() },
      { id: 'g-en', title: 'Prolonged outage', language: 'en', isGlobal: true, tenantId: null, deletedAt: null, category: 'CRISIS', context: 'y', keyMessages: '["a"]', redLines: '[]', publics: '[]', optic: null, interviewConfig: null, createdAt: new Date() },
      { id: 'org-1', title: 'Propio', language: 'es', isGlobal: false, tenantId: 'T1', deletedAt: null, category: 'GENERAL', context: 'z', keyMessages: '["a"]', redLines: '[]', publics: '[]', optic: null, interviewConfig: null, createdAt: new Date() },
    ],
    creates: [],
    updates: [],
  };
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'NOT') return row.id !== value.id;
      if (value === null) return row[key] === null || row[key] === undefined;
      return row[key] === value;
    });
  const prisma = {
    theme: {
      findMany: async ({ where = {} } = {}) => state.themes.filter((row) => matches(row, where)),
      findFirst: async ({ where = {} } = {}) => state.themes.find((row) => matches(row, where)) || null,
      findUnique: async ({ where = {} } = {}) => state.themes.find((row) => row.id === where.id) || null,
      create: async ({ data } = {}) => {
        const row = { id: `new-${state.creates.length + 1}`, createdAt: new Date(), deletedAt: null, ...data };
        state.themes.push(row);
        state.creates.push(data);
        return row;
      },
      update: async ({ where, data } = {}) => {
        const row = state.themes.find((t) => t.id === where.id);
        Object.assign(row, data);
        state.updates.push({ id: row.id, data });
        return row;
      },
    },
  };
  return { state, prisma };
}

function buildApp() {
  const { state, prisma } = createStore();
  const app = express();
  app.use(express.json());
  registerLibraryRoutes(app, prisma);
  return { app, state };
}

async function call(app, { method = 'GET', path, user, body }) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'x-test-user': user, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

test('la biblioteca se puede filtrar por catálogo de idioma', async () => {
  const { app } = buildApp();
  const all = await call(app, { path: '/api/library/themes', user: 'sys' });
  assert.equal(all.body.themes.length, 2, 'sin filtro se devuelven los dos catálogos');

  const onlyEn = await call(app, { path: '/api/library/themes?language=en', user: 'sys' });
  assert.deepEqual(onlyEn.body.themes.map((t) => t.title), ['Prolonged outage']);
  assert.equal(onlyEn.body.themes[0].language, 'en');

  const onlyEs = await call(app, { path: '/api/library/themes?language=es', user: 'sys' });
  assert.deepEqual(onlyEs.body.themes.map((t) => t.title), ['Corte prolongado']);
});

test('un escenario general nuevo se registra en el catálogo indicado', async () => {
  const { app, state } = buildApp();
  const res = await call(app, {
    method: 'POST',
    path: '/api/library/themes',
    user: 'sys',
    body: { title: 'Media briefing', context: 'ctx', keyMessages: ['a'], language: 'en' },
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.theme.language, 'en');
  assert.equal(state.creates[0].language, 'en');
  assert.equal(state.creates[0].isGlobal, true);
  assert.equal(state.creates[0].tenantId, null);
});

test('sin idioma explícito el escenario general entra al catálogo español', async () => {
  const { app, state } = buildApp();
  const res = await call(app, {
    method: 'POST',
    path: '/api/library/themes',
    user: 'sys',
    body: { title: 'Sin idioma', context: 'ctx', keyMessages: ['a'] },
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.theme.language, 'es');
  assert.equal(state.creates[0].language, 'es');
});

test('el mismo título puede existir en los dos catálogos', async () => {
  const { app, state } = buildApp();
  const res = await call(app, {
    method: 'POST',
    path: '/api/library/themes',
    user: 'sys',
    body: { title: 'Corte prolongado', context: 'ctx', keyMessages: ['a'], language: 'en' },
  });

  assert.equal(res.status, 201, 'no choca con el título homónimo del catálogo español');
  assert.equal(state.creates[0].language, 'en');
});

test('el título repetido dentro del mismo catálogo se rechaza', async () => {
  const { app, state } = buildApp();
  const res = await call(app, {
    method: 'POST',
    path: '/api/library/themes',
    user: 'sys',
    body: { title: 'Corte prolongado', context: 'ctx', keyMessages: ['a'], language: 'es' },
  });

  assert.equal(res.status, 409);
  assert.equal(state.creates.length, 0);
});

test('el administrador del cliente solo puede listar la biblioteca, no modificarla', async () => {
  const { app } = buildApp();
  assert.equal((await call(app, { path: '/api/library/themes', user: 'adminA' })).status, 200);
  const created = await call(app, {
    method: 'POST',
    path: '/api/library/themes',
    user: 'adminA',
    body: { title: 'No permitido', context: 'ctx', keyMessages: ['a'], language: 'en' },
  });
  assert.equal(created.status, 403);
});

test('copiar un escenario general conserva el idioma del original (no se traduce)', async () => {
  const { app, state } = buildApp();
  const res = await call(app, { method: 'POST', path: '/api/library/themes/g-en/copy', user: 'adminA' });

  assert.equal(res.status, 201);
  assert.equal(state.creates.length, 1);
  assert.equal(state.creates[0].language, 'en', 'la copia del catálogo inglés sigue siendo inglesa');
  assert.equal(state.creates[0].tenantId, 'T1', 'la copia pertenece a la organización del administrador');
  assert.equal(state.creates[0].isGlobal, false);
});
