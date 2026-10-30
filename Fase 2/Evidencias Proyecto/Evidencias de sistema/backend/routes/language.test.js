// Idioma: preferencia individual del usuario y idioma por defecto de la organización.
// Prisma y autenticación simulados (sin base de datos). El doble de `requireAuth` aplica la lista
// de roles como el middleware real, así se comprueba que un VOCERO no puede cambiar el tenant.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const realAuth = require('../auth');
const authPath = require.resolve('../auth');

// Usuarios de prueba: 'voceroA' sin preferencia propia (hereda el inglés de su organización),
// 'adminA' administra T1 y 'adminB' administra T2 (ya eligió inglés).
const USERS = {
  voceroA: { id: 'u-a', role: 'VOCERO', status: 'ACTIVE', tenantId: 'T1' },
  adminA: { id: 'a-a', role: 'ADMIN', status: 'ACTIVE', tenantId: 'T1' },
  adminB: { id: 'a-b', role: 'ADMIN', status: 'ACTIVE', tenantId: 'T2' },
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

const registerAccountRoutes = require('./accounts');
const registerThemeRoutes = require('./themes');

function createStore() {
  const state = {
    tenants: {
      T1: { id: 'T1', name: 'Organización A', defaultLanguage: 'en' },
      T2: { id: 'T2', name: 'Organización B', defaultLanguage: 'es' },
    },
    users: {
      'u-a': { id: 'u-a', name: 'Vocero A', email: 'vocero@a.test', role: 'VOCERO', status: 'ACTIVE', tenantId: 'T1', language: null },
      'a-a': { id: 'a-a', name: 'Admin A', email: 'admin@a.test', role: 'ADMIN', status: 'ACTIVE', tenantId: 'T1', language: null },
      'a-b': { id: 'a-b', name: 'Admin B', email: 'admin@b.test', role: 'ADMIN', status: 'ACTIVE', tenantId: 'T2', language: 'en' },
    },
    userUpdates: [],
    tenantUpdates: [],
  };
  const withTenant = (user) => ({ ...user, tenant: { ...state.tenants[user.tenantId], status: 'ACTIVE' } });
  const prisma = {
    user: {
      findUnique: async ({ where, include }) => {
        const user = state.users[where.id];
        if (!user) return null;
        return include?.tenant ? withTenant(user) : { ...user };
      },
      update: async ({ where, data, include }) => {
        const user = state.users[where.id];
        Object.assign(user, data);
        state.userUpdates.push({ id: user.id, data });
        return include?.tenant ? withTenant(user) : { ...user };
      },
    },
    tenant: {
      findUnique: async ({ where, select }) => {
        const tenant = state.tenants[where.id];
        if (!tenant) return null;
        return select ? Object.fromEntries(Object.keys(select).map((key) => [key, tenant[key]])) : { ...tenant };
      },
      update: async ({ where, data }) => {
        const tenant = state.tenants[where.id];
        Object.assign(tenant, data);
        state.tenantUpdates.push({ id: tenant.id, data });
        return { ...tenant };
      },
    },
  };
  return { state, prisma };
}

function buildApp() {
  const { state, prisma } = createStore();
  const app = express();
  app.use(express.json());
  registerAccountRoutes(app, prisma);
  registerThemeRoutes(app, prisma);
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

// ------------------------------------------------- Preferencia individual (vocero)

test('el vocero cambia su propio idioma y la respuesta trae el idioma de su organización', async () => {
  const { app, state } = buildApp();
  const res = await call(app, { method: 'PATCH', path: '/api/auth/language', user: 'voceroA', body: { language: 'en' } });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.language, 'en');
  assert.equal(res.body.user.defaultLanguage, 'en', 'el idioma por defecto del tenant viaja en el usuario');
  assert.equal(state.users['u-a'].language, 'en');
  assert.equal(state.userUpdates.length, 1);
  assert.equal(state.userUpdates[0].id, 'u-a', 'solo cambia su propio registro');
});

test('un idioma no soportado se rechaza y no se guarda nada', async () => {
  const { app, state } = buildApp();
  const res = await call(app, { method: 'PATCH', path: '/api/auth/language', user: 'voceroA', body: { language: 'fr' } });

  assert.equal(res.status, 400);
  assert.equal(state.users['u-a'].language, null);
  assert.equal(state.userUpdates.length, 0);
});

test('borrar la preferencia (null) devuelve al usuario al idioma de su organización', async () => {
  const { app, state } = buildApp();
  state.users['u-a'].language = 'en';

  const res = await call(app, { method: 'PATCH', path: '/api/auth/language', user: 'voceroA', body: { language: null } });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.language, null);
  assert.equal(state.users['u-a'].language, null);
});

// --------------------------------------- Idioma por defecto de la organización (admin)

test('el administrador cambia el idioma por defecto de su organización', async () => {
  const { app, state } = buildApp();
  const res = await call(app, { method: 'PUT', path: '/api/tenant/language', user: 'adminA', body: { language: 'es' } });

  assert.equal(res.status, 200);
  assert.equal(res.body.language, 'es');
  assert.equal(state.tenants.T1.defaultLanguage, 'es');
  assert.deepEqual(state.tenantUpdates, [{ id: 'T1', data: { defaultLanguage: 'es' } }], 'solo toca su organización');
  assert.equal(state.tenants.T2.defaultLanguage, 'es', 'la otra organización no cambia');
});

test('cada administrador solo puede cambiar el idioma de su propia organización', async () => {
  const { app, state } = buildApp();
  const res = await call(app, { method: 'PUT', path: '/api/tenant/language', user: 'adminB', body: { language: 'en' } });

  assert.equal(res.status, 200);
  assert.equal(state.tenants.T2.defaultLanguage, 'en');
  assert.equal(state.tenants.T1.defaultLanguage, 'en', 'T1 conserva su valor original');
  assert.deepEqual(state.tenantUpdates.map((u) => u.id), ['T2']);
});

test('cambiar el idioma de la organización no altera a quien ya eligió el suyo', async () => {
  const { app, state } = buildApp();
  state.users['u-a'].language = 'en';

  await call(app, { method: 'PUT', path: '/api/tenant/language', user: 'adminA', body: { language: 'es' } });

  assert.equal(state.tenants.T1.defaultLanguage, 'es');
  assert.equal(state.users['u-a'].language, 'en', 'la preferencia individual se conserva');
  assert.equal(state.userUpdates.length, 0, 'no se toca ningún usuario');
});

test('el idioma de la organización solo lo cambia el administrador del cliente', async () => {
  const { app, state } = buildApp();
  const res = await call(app, { method: 'PUT', path: '/api/tenant/language', user: 'voceroA', body: { language: 'en' } });

  assert.equal(res.status, 403);
  assert.equal(state.tenantUpdates.length, 0);
});

test('el administrador lee el idioma vigente de su organización', async () => {
  const { app } = buildApp();
  const res = await call(app, { method: 'GET', path: '/api/tenant/language', user: 'adminA' });

  assert.equal(res.status, 200);
  assert.equal(res.body.language, 'en');
  assert.deepEqual(res.body.options, ['es', 'en']);
});
