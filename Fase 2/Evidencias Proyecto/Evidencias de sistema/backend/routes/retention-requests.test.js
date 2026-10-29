// Solicitudes de extensión del plazo de retención: permisos y aplicación.
// Prisma y autenticación simulados (sin base de datos). El doble de `requireAuth` SÍ aplica la
// lista de roles, como el middleware real: así se comprueba que un ADMIN no puede resolver.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const USERS = {
  adminA: { id: 'a-a', role: 'ADMIN', status: 'ACTIVE', tenantId: 'T1', name: 'Admin A' },
  adminB: { id: 'a-b', role: 'ADMIN', status: 'ACTIVE', tenantId: 'T2', name: 'Admin B' },
  staff: { id: 's-1', role: 'SYSTEM', status: 'ACTIVE', tenantId: null, name: 'Staff' },
  vocero: { id: 'u-a', role: 'VOCERO', status: 'ACTIVE', tenantId: 'T1', name: 'Vocero A' },
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

const registerRetentionRequestRoutes = require('./retentionRequests');

// Estado inicial de la "base": una organización con 90 días y una solicitud pendiente.
function createStore({ requestStatus = 'PENDING', tenantDays = 90, initialRequest = true } = {}) {
  const state = {
    tenants: { T1: { id: 'T1', name: 'Organización A', retentionMode: 'FULL', retentionDays: tenantDays } },
    requests: initialRequest ? [
      {
        id: 'r1',
        status: requestStatus,
        reason: 'Auditoría interna',
        currentDays: 90,
        requestedDays: 180,
        appliedDays: null,
        createdAt: new Date('2026-03-01T10:00:00Z'),
        resolvedAt: null,
        resolutionNote: null,
        tenantId: 'T1',
        requestedById: 'a-a',
        resolvedById: null,
      },
    ] : [],
    tenantUpdates: [],
    requestCreates: [],
    requestUpdates: [],
  };

  const withRelations = (r) => ({
    ...r,
    tenant: { id: r.tenantId, name: state.tenants[r.tenantId]?.name || null },
    requestedBy: { id: r.requestedById, name: 'Admin A' },
    resolvedBy: r.resolvedById ? { id: r.resolvedById, name: 'Staff' } : null,
  });

  const prisma = {
    tenant: {
      findUnique: async ({ where }) => state.tenants[where.id] || null,
      update: async ({ where, data }) => {
        state.tenantUpdates.push({ id: where.id, data });
        state.tenants[where.id] = { ...state.tenants[where.id], ...data };
        return state.tenants[where.id];
      },
    },
    retentionExtensionRequest: {
      findMany: async ({ where }) => state.requests.filter((r) => (where.tenantId ? r.tenantId === where.tenantId : true)).map(withRelations),
      findFirst: async ({ where }) => {
        const found = state.requests.find(
          (r) => (!where.tenantId || r.tenantId === where.tenantId) && (!where.status || r.status === where.status),
        );
        return found || null;
      },
      findUnique: async ({ where }) => state.requests.find((r) => r.id === where.id) || null,
      create: async ({ data }) => {
        const created = { id: `new-${state.requestCreates.length + 1}`, ...data };
        state.requestCreates.push(created);
        state.requests.push(created);
        return withRelations(created);
      },
      updateMany: async ({ where, data }) => {
        const target = state.requests.find((r) => r.id === where.id && (!where.status || r.status === where.status));
        if (!target) return { count: 0 };
        Object.assign(target, data);
        state.requestUpdates.push({ id: target.id, data });
        return { count: 1 };
      },
      update: async ({ where, data }) => {
        const target = state.requests.find((r) => r.id === where.id);
        Object.assign(target, data);
        state.requestUpdates.push({ id: target.id, data });
        return withRelations(target);
      },
    },
  };
  return { state, prisma };
}

function buildApp(options) {
  const { state, prisma } = createStore(options);
  const app = express();
  app.use(express.json());
  registerRetentionRequestRoutes(app, prisma);
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

// --------------------------------------------------------------------- creación
test('el administrador del cliente crea una extensión con un plazo mayor', async () => {
  const { app, state } = buildApp({ initialRequest: false });
  const res = await call(app, { method: 'POST', path: '/api/retention-requests', user: 'adminA', body: { requestedDays: 180, reason: 'Auditoría' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.request.requestedDays, 180);
  assert.equal(res.body.request.currentDays, 90, 'guarda el plazo vigente al solicitarla');
  assert.equal(res.body.request.status, 'PENDING');
  assert.equal(state.requestCreates.length, 1);
  assert.equal(state.requestCreates[0].tenantId, 'T1', 'siempre en su propia organización');
});

test('una extensión no puede ser igual o menor que el plazo vigente', async () => {
  const { app, state } = buildApp();
  assert.equal((await call(app, { method: 'POST', path: '/api/retention-requests', user: 'adminA', body: { requestedDays: 90 } })).status, 400);
  assert.equal((await call(app, { method: 'POST', path: '/api/retention-requests', user: 'adminA', body: { requestedDays: 30 } })).status, 400);
  assert.equal(state.requestCreates.length, 0);
});

test('no se admiten dos extensiones pendientes a la vez', async () => {
  const { app, state } = buildApp({ requestStatus: 'PENDING' });
  const res = await call(app, { method: 'POST', path: '/api/retention-requests', user: 'adminA', body: { requestedDays: 365 } });
  assert.equal(res.status, 409);
  assert.equal(state.requestCreates.length, 0);
});

test('el vocero no puede crear ni ver solicitudes de extensión', async () => {
  const { app } = buildApp();
  assert.equal((await call(app, { method: 'POST', path: '/api/retention-requests', user: 'vocero', body: { requestedDays: 365 } })).status, 403);
  assert.equal((await call(app, { path: '/api/retention-requests', user: 'vocero' })).status, 403);
});

// --------------------------------------------------------------------- permisos
test('el administrador del cliente NO puede resolver (aprobar ni rechazar)', async () => {
  const { app, state } = buildApp();
  assert.equal((await call(app, { method: 'PATCH', path: '/api/retention-requests/r1', user: 'adminA', body: { status: 'APPROVED' } })).status, 403);
  assert.equal((await call(app, { method: 'PATCH', path: '/api/retention-requests/r1', user: 'adminB', body: { status: 'APPROVED' } })).status, 403);
  assert.equal(state.requestUpdates.length, 0, 'no se toca la solicitud');
  assert.equal(state.tenantUpdates.length, 0, 'no se toca el plan');
});

test('el vocero NO puede resolver solicitudes de extensión', async () => {
  const { app, state } = buildApp();
  assert.equal((await call(app, { method: 'PATCH', path: '/api/retention-requests/r1', user: 'vocero', body: { status: 'APPROVED' } })).status, 403);
  assert.equal(state.requestUpdates.length, 0);
});

// --------------------------------------------------------------------- resolución
test('solo el administrador del sistema aprueba: aplica el plazo de inmediato', async () => {
  const { app, state } = buildApp();
  const res = await call(app, { method: 'PATCH', path: '/api/retention-requests/r1', user: 'staff', body: { status: 'APPROVED', resolutionNote: 'Aprobada' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.request.status, 'APPROVED');
  assert.equal(res.body.request.appliedDays, 180);
  assert.equal(res.body.effect.retentionDays, 180);
  assert.equal(state.tenants.T1.retentionDays, 180, 'el plazo vigente pasa a ser el solicitado');
  assert.equal(state.tenants.T1.retentionMode, 'FULL', 'no se cambia el modo de conservación');
});

test('rechazar no modifica el plazo vigente', async () => {
  const { app, state } = buildApp();
  const res = await call(app, { method: 'PATCH', path: '/api/retention-requests/r1', user: 'staff', body: { status: 'REJECTED', resolutionNote: 'No procede' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.request.status, 'REJECTED');
  assert.equal(res.body.effect, null);
  assert.equal(state.tenants.T1.retentionDays, 90);
  assert.equal(state.tenantUpdates.length, 0);
});

test('una segunda aprobación no vuelve a aplicar la extensión', async () => {
  const { app, state } = buildApp({ requestStatus: 'APPROVED' });
  const res = await call(app, { method: 'PATCH', path: '/api/retention-requests/r1', user: 'staff', body: { status: 'APPROVED' } });
  assert.equal(res.status, 409);
  assert.equal(state.tenantUpdates.length, 0);
  assert.equal(state.requestUpdates.length, 0);
});

test('no se puede resolver con un estado que no corresponde', async () => {
  const { app } = buildApp();
  assert.equal((await call(app, { method: 'PATCH', path: '/api/retention-requests/r1', user: 'staff', body: { status: 'PENDING' } })).status, 400);
  assert.equal((await call(app, { method: 'PATCH', path: '/api/retention-requests/no-existe', user: 'staff', body: { status: 'APPROVED' } })).status, 404);
});

// --------------------------------------------------------------------- listado
test('el administrador solo ve las solicitudes de su organización', async () => {
  const { app, state } = buildApp();
  const res = await call(app, { path: '/api/retention-requests', user: 'adminB' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.requests, [], 'la solicitud de T1 no se muestra a T2');
  assert.equal(state.requests.length, 1, 'no se modifica nada al consultar');
});

test('el sistema ve todas y puede acotar por organización', async () => {
  const { app } = buildApp();
  const all = await call(app, { path: '/api/retention-requests', user: 'staff' });
  assert.equal(all.body.requests.length, 1);
  const scoped = await call(app, { path: '/api/retention-requests?tenantId=T2', user: 'staff' });
  assert.deepEqual(scoped.body.requests, []);
});

