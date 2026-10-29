// Solicitudes de PRIVACIDAD: solo el administrador del sistema resuelve.
// Prisma y autenticación simulados; el doble de `requireAuth` aplica la lista de roles.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const USERS = {
  adminA: { id: 'a-a', role: 'ADMIN', status: 'ACTIVE', tenantId: 'T1', name: 'Admin A' },
  adminB: { id: 'a-b', role: 'ADMIN', status: 'ACTIVE', tenantId: 'T2', name: 'Admin B' },
  staff: { id: 's-1', role: 'SYSTEM', status: 'ACTIVE', tenantId: null, name: 'Staff' },
  vocero: { id: 'u-a', role: 'VOCERO', status: 'ACTIVE', tenantId: 'T1', name: 'Vocero A' },
  voceroB: { id: 'u-b', role: 'VOCERO', status: 'ACTIVE', tenantId: 'T2', name: 'Vocero B' },
};
const ROLE_TO_API = { VOCERO: 'user', ADMIN: 'admin', MASTER: 'master', SYSTEM: 'system' };

const authPath = require.resolve('../auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
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

// Se sustituyen los efectos reales (borrado de archivos / anonimización) por contadores.
const anonymizePath = require.resolve('../lib/anonymize');
const effects = { anonymized: [], videos: [] };
require.cache[anonymizePath] = {
  id: anonymizePath,
  filename: anonymizePath,
  loaded: true,
  exports: {
    anonymizeUser: async (_prisma, userId) => {
      effects.anonymized.push(userId);
      return { found: true, userId, sessions: 1, videosRemoved: 1, auditsCleared: 0 };
    },
    deleteUserVideos: async (_prisma, tenantId, userIds) => {
      effects.videos.push({ tenantId, userIds });
      return userIds.length;
    },
  },
};

const registerDeletionRoutes = require('./deletionRequests');

function createStore({ status = 'PENDING', scope = 'ANONYMIZE', tenantId = 'T1' } = {}) {
  const state = {
    requests: [
      {
        id: 'r1',
        scope,
        reason: 'Derecho al olvido',
        status,
        createdAt: new Date('2026-03-01T10:00:00Z'),
        resolvedAt: null,
        resolutionNote: null,
        tenantId,
        requestedById: 'a-a',
        targetUserId: 'u-a',
        resolvedById: null,
      },
    ],
    updates: [],
    creates: [],
  };
  const byId = (id) => Object.values(USERS).find((u) => u.id === id) || null;
  // `include` del endpoint: se adjuntan las relaciones que usa `toApi`.
  const withRelations = (r) => ({
    ...r,
    targetUser: r.targetUserId ? byId(r.targetUserId) : null,
    requestedBy: byId(r.requestedById),
    resolvedBy: r.resolvedById ? byId(r.resolvedById) : null,
  });
  const prisma = {
    user: { findUnique: async ({ where }) => byId(where.id) },
    deletionRequest: {
      findMany: async ({ where }) => state.requests.filter((r) => (where.tenantId ? r.tenantId === where.tenantId : true)).map(withRelations),
      findUnique: async ({ where }) => {
        const found = state.requests.find((r) => r.id === where.id);
        return found ? withRelations(found) : null;
      },
      create: async ({ data }) => {
        const created = { id: `new-${state.creates.length + 1}`, ...data };
        state.creates.push(created);
        state.requests.push(created);
        return withRelations(created);
      },
      update: async ({ where, data }) => {
        const target = state.requests.find((r) => r.id === where.id);
        Object.assign(target, data);
        state.updates.push({ id: target.id, data });
        return withRelations(target);
      },
    },
  };
  return { state, prisma };
}

function buildApp(options) {
  const { state, prisma } = createStore(options);
  effects.anonymized.length = 0;
  effects.videos.length = 0;
  const app = express();
  app.use(express.json());
  registerDeletionRoutes(app, prisma);
  return { app, state };
}

async function call(app, { method = 'GET', path, user, body }) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
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

test('el administrador del cliente NO puede resolver solicitudes de privacidad', async () => {
  const { app, state } = buildApp();
  const own = await call(app, { method: 'PATCH', path: '/api/deletion-requests/r1', user: 'adminA', body: { status: 'APPROVED' } });
  assert.equal(own.status, 403, 'ni siquiera la de su propia organización');
  const other = await call(app, { method: 'PATCH', path: '/api/deletion-requests/r1', user: 'adminB', body: { status: 'APPROVED' } });
  assert.equal(other.status, 403);
  assert.equal(state.updates.length, 0);
});

test('el vocero NO puede resolver solicitudes de privacidad', async () => {
  const { app, state } = buildApp();
  const res = await call(app, { method: 'PATCH', path: '/api/deletion-requests/r1', user: 'vocero', body: { status: 'APPROVED' } });
  assert.equal(res.status, 403);
  assert.equal(state.updates.length, 0);
});

test('el administrador del sistema aprueba y registra la nota de resolución', async () => {
  const { app, state } = buildApp();
  const res = await call(app, { method: 'PATCH', path: '/api/deletion-requests/r1', user: 'staff', body: { status: 'APPROVED', resolutionNote: 'Revisada' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.request.status, 'APPROVED');
  assert.equal(res.body.request.resolutionNote, 'Revisada');
  assert.equal(state.updates[0].data.status, 'APPROVED');
});

test('al completar se registra quién y cuándo resolvió', async () => {
  const { app, state } = buildApp({ status: 'APPROVED' });
  const res = await call(app, { method: 'PATCH', path: '/api/deletion-requests/r1', user: 'staff', body: { status: 'COMPLETED' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.request.resolvedBy.id, 's-1');
  assert.ok(state.updates[0].data.resolvedAt, 'se registra la fecha de resolución');
});

test('al completar se ejecuta el efecto del alcance (anonimización)', async () => {
  const { app } = buildApp({ status: 'APPROVED', scope: 'ANONYMIZE' });
  const res = await call(app, { method: 'PATCH', path: '/api/deletion-requests/r1', user: 'staff', body: { status: 'COMPLETED' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.request.status, 'COMPLETED');
  assert.deepEqual(effects.anonymized, ['u-a']);
  assert.equal(res.body.request.resolutionNote, null, 'una anonimización no reintroduce texto libre');
});

test('al completar un borrado de grabaciones se borran los videos del vocero', async () => {
  const { app } = buildApp({ status: 'APPROVED', scope: 'RECORDINGS' });
  const res = await call(app, { method: 'PATCH', path: '/api/deletion-requests/r1', user: 'staff', body: { status: 'COMPLETED' } });
  assert.equal(res.status, 200);
  assert.deepEqual(effects.videos, [{ tenantId: 'T1', userIds: ['u-a'] }]);
});

test('se respeta la máquina de estados', async () => {
  const { app, state } = buildApp({ status: 'COMPLETED' });
  const res = await call(app, { method: 'PATCH', path: '/api/deletion-requests/r1', user: 'staff', body: { status: 'APPROVED' } });
  assert.equal(res.status, 400);
  assert.equal(state.updates.length, 0);
});

test('consultar una solicitud NO la marca como resuelta', async () => {
  const { app, state } = buildApp();
  const res = await call(app, { path: '/api/deletion-requests', user: 'staff' });
  assert.equal(res.status, 200);
  assert.equal(res.body.requests[0].status, 'PENDING');
  assert.equal(state.updates.length, 0);
});

test('el administrador solo ve las solicitudes de su organización', async () => {
  const { app } = buildApp({ tenantId: 'T1' });
  assert.equal((await call(app, { path: '/api/deletion-requests', user: 'adminA' })).body.requests.length, 1);
  assert.deepEqual((await call(app, { path: '/api/deletion-requests', user: 'adminB' })).body.requests, []);
});

test('el administrador crea solicitudes solo para voceros de su organización', async () => {
  const { app, state } = buildApp();
  const own = await call(app, { method: 'POST', path: '/api/deletion-requests', user: 'adminA', body: { targetUserId: 'u-a', scope: 'RECORDINGS', reason: 'Petición del titular' } });
  assert.equal(own.status, 201);
  assert.equal(state.creates[0].tenantId, 'T1');
  const foreign = await call(app, { method: 'POST', path: '/api/deletion-requests', user: 'adminA', body: { targetUserId: 'u-b', scope: 'RECORDINGS' } });
  assert.equal(foreign.status, 403, 'no puede pedir datos de otra organización');
  assert.equal(state.creates.length, 1);
});

test('el vocero no puede crear solicitudes de privacidad', async () => {
  const { app } = buildApp();
  const res = await call(app, { method: 'POST', path: '/api/deletion-requests', user: 'vocero', body: { targetUserId: 'u-a', scope: 'RECORDINGS' } });
  assert.equal(res.status, 403);
});

