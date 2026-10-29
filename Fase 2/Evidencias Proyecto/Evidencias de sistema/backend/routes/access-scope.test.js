// Alcance de las consultas administrativas (Prisma y autenticación simulados, sin base de datos).
//
// Cubre lo que protege el aislamiento entre organizaciones:
//   GET /api/sessions?userId=            → solo el vocero indicado, si el rol lo permite
//   GET /api/users?tenantId=             → filtro por organización (solo SYSTEM)
//   GET /api/deletion-requests?tenantId= → filtro por organización (solo SYSTEM)
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Usuarios de prueba: el encabezado `x-test-user` elige quién hace la petición.
const USERS = {
  voceroA: { id: 'u-a', role: 'VOCERO', status: 'ACTIVE', tenantId: 'T1', name: 'Vocero A' },
  voceroB: { id: 'u-b', role: 'VOCERO', status: 'ACTIVE', tenantId: 'T2', name: 'Vocero B' },
  adminA: { id: 'a-a', role: 'ADMIN', status: 'ACTIVE', tenantId: 'T1', name: 'Admin A' },
  adminB: { id: 'a-b', role: 'ADMIN', status: 'ACTIVE', tenantId: 'T2', name: 'Admin B' },
  staff: { id: 's-1', role: 'SYSTEM', status: 'ACTIVE', tenantId: null, name: 'Staff' },
};
const BY_ID = Object.fromEntries(Object.values(USERS).map((u) => [u.id, u]));
const ROLE_TO_API = { VOCERO: 'user', ADMIN: 'admin', MASTER: 'master', SYSTEM: 'system' };

// `requireAuth` simulado: no hay tokens ni base de datos, solo el rol de la petición.
const authPath = require.resolve('../auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    ROLE_TO_API,
    ROLE_FROM_API: { user: 'VOCERO', admin: 'ADMIN', master: 'MASTER', system: 'SYSTEM' },
    hashPassword: () => 'x',
    verifyPassword: () => true,
    createToken: () => 'token',
    toApiUser: (u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: ROLE_TO_API[u.role] || 'user',
      status: u.status,
      area: u.area || null,
      tenantId: u.tenantId,
      tenantName: u.tenant?.name || null,
      lastLoginAt: u.lastLoginAt || null,
    }),
    requireAuth: () => async (req, res, next) => {
      const user = USERS[req.headers['x-test-user']];
      if (!user) return res.status(401).json({ status: 'error', mensaje: 'Usuario de prueba no indicado.' });
      req.user = user;
      req.apiRole = ROLE_TO_API[user.role];
      next();
    },
  },
};

const registerAccountRoutes = require('./accounts');
const registerDeletionRoutes = require('./deletionRequests');
const registerSessionRoutes = require('./sessions');

const SESSION_ROW = {
  id: 's1',
  status: 'COMPLETED',
  createdAt: new Date('2026-01-02T10:00:00Z'),
  completedAt: new Date('2026-01-02T10:30:00Z'),
  score: 80,
  metrics: null,
  theme: { id: 't1', title: 'Corte de suministro', category: 'Energía' },
  report: { areas: [{ key: 'expression', label: 'Expresión', score: 80 }] },
};

function buildApp() {
  const calls = { session: [], sessionCount: [], user: [], deletionRequest: [] };
  // Las consultas de retención (que no son objeto de esta prueba) se distinguen por usar
  // `select`: se responden vacías para que el job de retención no ensucie la salida.
  const prisma = {
    session: {
      findMany: async (args) => {
        if (args.select) return [];
        calls.session.push(args);
        return [SESSION_ROW];
      },
      // Total simulado del historial (para comprobar la paginación del servidor).
      count: async (args) => {
        calls.sessionCount.push(args);
        return 25;
      },
    },
    user: {
      findUnique: async ({ where }) => BY_ID[where.id] || null,
      findMany: async (args) => {
        if (args.select) return [];
        calls.user.push(args);
        return [
          {
            id: 'u-a',
            email: 'vocero.a@empresa.com',
            name: 'Vocero A',
            role: 'VOCERO',
            status: 'ACTIVE',
            area: 'Planta',
            tenantId: 'T1',
            tenant: { name: 'Organización A' },
            _count: { sessions: 3 },
          },
        ];
      },
    },
    deletionRequest: {
      findMany: async (args) => {
        calls.deletionRequest.push(args);
        return [
          {
            id: 'r1',
            scope: 'ANONYMIZE',
            reason: 'Solicitud del vocero',
            status: 'PENDING',
            createdAt: new Date('2026-01-05T09:00:00Z'),
            resolvedAt: null,
            resolutionNote: null,
            targetUser: { id: 'u-a', name: 'Vocero A', email: 'vocero.a@empresa.com' },
            requestedBy: { id: 'a-a', name: 'Admin A' },
            resolvedBy: null,
          },
        ];
      },
    },
  };

  const app = express();
  app.use(express.json());
  registerAccountRoutes(app, prisma);
  registerDeletionRoutes(app, prisma);
  registerSessionRoutes(app, prisma);
  return { app, calls };
}

async function call(app, path, user) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: { 'x-test-user': user },
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

test('el vocero consulta sus propias prácticas y el backend usa su identificador', async () => {
  const { app, calls } = buildApp();
  const res = await call(app, '/api/sessions', 'voceroA');
  assert.equal(res.status, 200);
  assert.equal(res.body.user.id, 'u-a');
  assert.equal(res.body.sessions.length, 1);
  assert.equal(calls.session.at(-1).where.userId, 'u-a');
});

test('el vocero no puede pedir las prácticas de otro con ?userId=', async () => {
  const { app, calls } = buildApp();
  const res = await call(app, '/api/sessions?userId=u-b', 'voceroA');
  assert.equal(res.status, 403);
  assert.equal(calls.session.length, 0, 'no se consulta nada');
});

test('el administrador consulta a un vocero de su organización', async () => {
  const { app, calls } = buildApp();
  const res = await call(app, '/api/sessions?userId=u-a', 'adminA');
  assert.equal(res.status, 200);
  assert.equal(res.body.user.id, 'u-a');
  assert.equal(calls.session.at(-1).where.userId, 'u-a');
});

test('el administrador no puede consultar voceros de otra organización', async () => {
  const { app, calls } = buildApp();
  const res = await call(app, '/api/sessions?userId=u-b', 'adminA');
  assert.equal(res.status, 403);
  assert.equal(calls.session.length, 0);
});

test('el administrador debe indicar el vocero', async () => {
  const { app } = buildApp();
  const res = await call(app, '/api/sessions', 'adminA');
  assert.equal(res.status, 400);
});

test('el staff del sistema puede consultar cualquier vocero', async () => {
  const { app, calls } = buildApp();
  const res = await call(app, '/api/sessions?userId=u-b', 'staff');
  assert.equal(res.status, 200);
  assert.equal(calls.session.at(-1).where.userId, 'u-b');
});

test('el historial se pagina en el servidor (página, límite y total)', async () => {
  const { app, calls } = buildApp();
  const res = await call(app, '/api/sessions?page=3&limit=10', 'voceroA');
  assert.equal(res.status, 200);
  assert.equal(calls.session.at(-1).skip, 20, 'salta las dos páginas anteriores');
  assert.equal(calls.session.at(-1).take, 10);
  assert.equal(res.body.page, 3);
  assert.equal(res.body.limit, 10);
  assert.equal(res.body.total, 25);
  assert.equal(res.body.pages, 3, '25 sesiones en páginas de 10');
  assert.equal(calls.sessionCount.at(-1).where.userId, 'u-a', 'el total respeta el aislamiento');
});

test('el límite se acota al máximo del endpoint y la página inválida cae en la primera', async () => {
  const { app, calls } = buildApp();
  const huge = await call(app, '/api/sessions?limit=9999', 'voceroA');
  assert.equal(huge.body.limit, 50);
  const zero = await call(app, '/api/sessions?page=0&limit=-3', 'voceroA');
  assert.equal(zero.body.page, 1);
  assert.equal(zero.body.limit, 50, 'un límite inválido usa el valor por defecto');
  assert.equal(calls.session.at(-1).skip, 0);
});

test('la paginación del administrador sigue limitada a su organización', async () => {
  const { app, calls } = buildApp();
  const res = await call(app, '/api/sessions?userId=u-a&page=2&limit=20', 'adminA');
  assert.equal(res.status, 200);
  assert.equal(calls.session.at(-1).where.userId, 'u-a');
  assert.equal(calls.session.at(-1).skip, 20);
  assert.equal(res.body.pages, 2);
});

test('un vocero inexistente o que no es vocero no es consultable', async () => {
  const { app } = buildApp();
  assert.equal((await call(app, '/api/sessions?userId=no-existe', 'staff')).status, 404);
  assert.equal((await call(app, '/api/sessions?userId=a-a', 'staff')).status, 404);
});

test('SYSTEM filtra los usuarios por organización', async () => {
  const { app, calls } = buildApp();
  const res = await call(app, '/api/users?tenantId=T2', 'staff');
  assert.equal(res.status, 200);
  assert.equal(res.body.users[0].sessions, 3);
  assert.deepEqual(calls.user.at(-1).where, { tenantId: 'T2' });
});

test('un ADMIN ignora ?tenantId= y sigue viendo solo su organización', async () => {
  const { app, calls } = buildApp();
  const res = await call(app, '/api/users?tenantId=T2', 'adminA');
  assert.equal(res.status, 200);
  assert.deepEqual(calls.user.at(-1).where, { tenantId: 'T1', role: 'VOCERO' });
});

test('SYSTEM filtra las solicitudes de privacidad por organización', async () => {
  const { app, calls } = buildApp();
  const res = await call(app, '/api/deletion-requests?tenantId=T2', 'staff');
  assert.equal(res.status, 200);
  assert.equal(res.body.requests[0].scope, 'ANONYMIZE');
  assert.deepEqual(calls.deletionRequest.at(-1).where, { tenantId: 'T2' });
});

test('un ADMIN ignora ?tenantId= en las solicitudes de privacidad', async () => {
  const { app, calls } = buildApp();
  const res = await call(app, '/api/deletion-requests?tenantId=T2', 'adminA');
  assert.equal(res.status, 200);
  assert.deepEqual(calls.deletionRequest.at(-1).where, { tenantId: 'T1' });
});

