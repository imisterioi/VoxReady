// Pruebas de privacidad en el endpoint de auditoría de transcripción y en el flujo de
// solicitudes de borrado. Servidor HTTP local con base simulada y autenticación sustituida:
// no se toca ninguna base real ni ninguna grabación.
const test = require('node:test');
const assert = require('node:assert/strict');

const { createPrismaStub, TEXTO, anonymizationSeed } = require('./privacy-support');

// La autenticación real se sustituye por un doble ANTES de cargar las rutas (igual que en el
// resto de la suite). El rol y el usuario se fijan desde la propia prueba con una cabecera.
const authPath = require.resolve('../auth');
const SESSION = { user: null, role: 'user' };
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireAuth: (prisma, roles = []) => (req, res, next) => {
      req.user = SESSION.user;
      req.apiRole = SESSION.role;
      if (roles.length && !roles.includes(SESSION.role)) {
        return res.status(403).json({ status: 'error', mensaje: 'No tienes permiso para esta acción.' });
      }
      next();
    },
  },
};

const USERS = {
  vocero1: { id: 'u1', name: 'Ana Torres', tenantId: 't1' },
  vocero2: { id: 'u2', name: 'Diego Paredes', tenantId: 't1' },
  vocero3: { id: 'u3', name: 'Lucía Soto', tenantId: 't1' },
  admin1: { id: 'ad1', name: 'Admin Uno', tenantId: 't1' },
  admin2: { id: 'ad2', name: 'Admin Dos', tenantId: 't2' },
  maestro: { id: 'ma1', name: 'Configurador', tenantId: null },
  sistema: { id: 'sy1', name: 'Admin Sistema', tenantId: null },
};

async function withServer(prisma, run) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = req.headers['x-user'];
    if (who) {
      SESSION.user = USERS[who];
      SESSION.role = who.startsWith('admin') ? 'admin' : who === 'maestro' ? 'master' : who === 'sistema' ? 'system' : 'user';
    }
    next();
  });
  require('../routes/sessions')(app, prisma, { evaluationQueue: { enabled: false } });
  require('../routes/deletionRequests')(app, prisma);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

const call = async (base, path, { user, method = 'GET', body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'x-user': user, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('endpoint de auditoría: devuelve el texto antes de anonimizar y null después', async () => {
  const prisma = createPrismaStub(anonymizationSeed());

  await withServer(prisma, async (base) => {
    // Control: sin anonimizar, el dueño ve el texto transcrito.
    const antes = await call(base, '/api/sessions/anon-s3/transcription-audit', { user: 'vocero2' });
    assert.equal(antes.status, 200);
    assert.equal(antes.body.audits.length, 1);
    assert.equal(antes.body.audits[0].transcript, TEXTO, 'el endpoint sí devuelve texto cuando existe');

    // Se anonimiza a u3 completando su solicitud de borrado y se revisa su auditoría.
    const cierre = await call(base, '/api/deletion-requests/req-1', { user: 'sistema', method: 'PATCH', body: { status: 'COMPLETED' } });
    assert.equal(cierre.status, 200);

    const propio = await call(base, '/api/sessions/anon-s4/transcription-audit', { user: 'vocero3' });
    assert.equal(propio.status, 200);
    assert.ok(propio.body.audits.every((a) => a.transcript === null), 'ya no hay texto tras la anonimización');
  });
});

test('endpoint de auditoría: la anonimización no deja texto accesible a ningún rol', async () => {
  const prisma = createPrismaStub(anonymizationSeed());
  const { anonymizeUser } = require('../lib/anonymize');
  await anonymizeUser(prisma, 'u1');

  await withServer(prisma, async (base) => {
    for (const who of ['vocero1', 'admin1', 'maestro', 'sistema']) {
      const res = await call(base, '/api/sessions/anon-s1/transcription-audit', { user: who });
      assert.equal(res.status, 200, `${who} puede consultar la auditoría de una sesión de su alcance`);
      assert.ok(res.body.audits.length > 0, `${who} sigue viendo los registros operativos`);
      assert.ok(
        res.body.audits.every((a) => a.transcript === null),
        `${who} no debe recibir texto transcrito tras la anonimización`,
      );
      assert.equal(res.body.audits[0].turnIndex, 0, 'los datos operativos siguen disponibles');
    }
  });
});

test('endpoint de auditoría: se mantienen los permisos por usuario, rol y organización', async () => {
  const prisma = createPrismaStub(anonymizationSeed());

  await withServer(prisma, async (base) => {
    const otroVocero = await call(base, '/api/sessions/anon-s1/transcription-audit', { user: 'vocero2' });
    assert.equal(otroVocero.status, 403, 'un vocero no ve la sesión de otro vocero');

    const adminOtraOrganizacion = await call(base, '/api/sessions/anon-s1/transcription-audit', { user: 'admin2' });
    assert.equal(adminOtraOrganizacion.status, 403, 'un admin de otra organización no ve la sesión');

    const adminMismaOrganizacion = await call(base, '/api/sessions/anon-s1/transcription-audit', { user: 'admin1' });
    assert.equal(adminMismaOrganizacion.status, 200, 'un admin de la misma organización sí la ve');

    const inexistente = await call(base, '/api/sessions/no-existe/transcription-audit', { user: 'sistema' });
    assert.equal(inexistente.status, 404);
  });
});

test('flujo de solicitud de borrado: completar una solicitud ANONYMIZE limpia la auditoría', async () => {
  const prisma = createPrismaStub(anonymizationSeed());

  await withServer(prisma, async (base) => {
    assert.equal(prisma.db.transcriptionAudit.find((a) => a.sessionId === 'anon-s4').transcript, TEXTO);

    const res = await call(base, '/api/deletion-requests/req-1', { user: 'sistema', method: 'PATCH', body: { status: 'COMPLETED' } });

    assert.equal(res.status, 200);
    assert.equal(res.body.request.status, 'COMPLETED');
    assert.equal(res.body.effect.found, true, 'la anonimización se ejecutó');
    assert.equal(prisma.db.transcriptionAudit.find((a) => a.sessionId === 'anon-s4').transcript, null, 'la auditoría del vocero queda sin texto');
    assert.equal(prisma.db.user.find((u) => u.id === 'u3').name, 'Usuario anonimizado');
    assert.equal(prisma.db.session.find((s) => s.id === 'anon-s4').score, 55, 'la puntuación se conserva');
    assert.equal(prisma.db.transcriptionAudit.find((a) => a.sessionId === 'anon-s1').transcript, TEXTO, 'otro vocero no se ve afectado');
  });
});
