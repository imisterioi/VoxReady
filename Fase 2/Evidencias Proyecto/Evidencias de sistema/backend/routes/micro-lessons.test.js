// Microlecciones: catálogo por idioma, recomendación por área más débil, administración (SYSTEM),
// subida/protección del video y limpieza del archivo. Prisma y autenticación simulados.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

const realAuth = require('../auth');
const authPath = require.resolve('../auth');

const USERS = {
  voceroEs: { id: 'u-es', role: 'VOCERO', status: 'ACTIVE', tenantId: 'T1', language: 'es' },
  voceroEn: { id: 'u-en', role: 'VOCERO', status: 'ACTIVE', tenantId: 'T1', language: 'en' },
  adminA: { id: 'a-1', role: 'ADMIN', status: 'ACTIVE', tenantId: 'T1' },
  sys: { id: 's-1', role: 'SYSTEM', status: 'ACTIVE', tenantId: null, language: 'es' },
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

const registerMicroLessonRoutes = require('./microLessons');

const LESSONS_DIR = path.join(__dirname, '..', 'uploads', 'lessons');

function createStore() {
  const state = {
    lessons: [
      { id: 'es-active', title: 'Empatía en crisis', description: 'x', language: 'es', areas: ['empathy'], active: true, videoFile: null, videoMime: null, videoBytes: null, createdAt: new Date('2026-01-02'), updatedAt: new Date('2026-01-02') },
      { id: 'es-expression', title: 'Expresión clara', description: 'y', language: 'es', areas: ['expression', 'coherence'], active: true, videoFile: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') },
      { id: 'es-inactive', title: 'Retirada', description: 'z', language: 'es', areas: ['empathy'], active: false, videoFile: null, createdAt: new Date('2026-01-03'), updatedAt: new Date('2026-01-03') },
      { id: 'en-active', title: 'Empathy under fire', description: 'w', language: 'en', areas: ['empathy'], active: true, videoFile: null, createdAt: new Date('2026-01-04'), updatedAt: new Date('2026-01-04') },
    ],
    sessions: [
      // Última práctica del vocero ES: empatía es el área más débil.
      { id: 'sess-1', userId: 'u-es', score: 72, completedAt: new Date('2026-01-10'), report: { areas: [{ key: 'expression', score: 82 }, { key: 'voice', score: 75 }, { key: 'coherence', score: 78 }, { key: 'empathy', score: 45 }] } },
    ],
  };

  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value) && 'not' in value) return row[key] !== null && row[key] !== value.not;
      return row[key] === value;
    });

  const prisma = {
    microLesson: {
      findMany: async ({ where = {}, orderBy } = {}) => {
        const rows = state.lessons.filter((row) => matches(row, where));
        if (orderBy?.createdAt === 'desc') rows.sort((a, b) => b.createdAt - a.createdAt);
        return rows.map((row) => ({ ...row }));
      },
      findUnique: async ({ where }) => {
        const row = state.lessons.find((item) => item.id === where.id);
        return row ? { ...row } : null;
      },
      create: async ({ data }) => {
        const row = { id: `new-${state.lessons.length + 1}`, createdAt: new Date(), updatedAt: new Date(), videoFile: null, ...data };
        state.lessons.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = state.lessons.find((item) => item.id === where.id);
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
      delete: async ({ where }) => {
        const index = state.lessons.findIndex((item) => item.id === where.id);
        const [row] = state.lessons.splice(index, 1);
        return row;
      },
    },
    session: {
      findFirst: async ({ where }) => state.sessions.find((row) => matches(row, where)) || null,
    },
  };

  return { state, prisma };
}

async function withServer(run) {
  const { state, prisma } = createStore();
  const app = express();
  app.use(express.json()); // el cuerpo JSON de las peticiones de administración
  registerMicroLessonRoutes(app, prisma);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, { method = 'GET', user, body, headers = {} } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { ...(user ? { 'x-test-user': user } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  };
  try {
    await run({ call, state, base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('el vocero solo ve las microlecciones activas de SU idioma', async () => {
  await withServer(async ({ call }) => {
    const es = await call('/api/micro-lessons', { user: 'voceroEs' });
    assert.equal(es.status, 200);
    assert.deepEqual(
      es.data.lessons.map((l) => l.id).sort(),
      ['es-active', 'es-expression'],
      'no se mezclan catálogos ni se muestran inactivas',
    );
    assert.equal(es.data.language, 'es');

    const en = await call('/api/micro-lessons', { user: 'voceroEn' });
    assert.deepEqual(en.data.lessons.map((l) => l.id), ['en-active']);
    assert.equal(en.data.language, 'en');
  });
});

test('sin sesión iniciada no se puede consultar el catálogo', async () => {
  await withServer(async ({ call }) => {
    const response = await call('/api/micro-lessons');
    assert.equal(response.status, 401);
  });
});

test('la recomendación usa el área más débil de la última práctica evaluada', async () => {
  await withServer(async ({ call }) => {
    const es = await call('/api/micro-lessons', { user: 'voceroEs' });
    // Su última práctica: empatía 45 (la más baja) → se recomienda la lección de empatía.
    assert.equal(es.data.weakestArea, 'empathy');
    const byId = Object.fromEntries(es.data.lessons.map((l) => [l.id, l]));
    assert.equal(byId['es-active'].recommended, true);
    assert.equal(byId['es-expression'].recommended, false);

    // El vocero EN no tiene prácticas: no se recomienda nada.
    const en = await call('/api/micro-lessons', { user: 'voceroEn' });
    assert.equal(en.data.weakestArea, null);
    assert.equal(en.data.lessons.every((l) => l.recommended === false), true);
  });
});

test('una lección que refuerza varias áreas se recomienda si el vocero falla en cualquiera', async () => {
  const { prisma } = createStore();
  // Práctica con coherencia como área más débil: la lección de expresión + coherencia debe salir.
  prisma.session.findFirst = async () => ({
    report: { areas: [{ key: 'expression', score: 80 }, { key: 'coherence', score: 40 }, { key: 'empathy', score: 70 }] },
  });
  const app = express();
  registerMicroLessonRoutes(app, prisma);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/micro-lessons`, { headers: { 'x-test-user': 'voceroEs' } });
    const data = await response.json();
    assert.equal(data.weakestArea, 'coherence');
    const byId = Object.fromEntries(data.lessons.map((l) => [l.id, l]));
    assert.equal(byId['es-expression'].recommended, true);
    assert.equal(byId['es-active'].recommended, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('el video se entrega solo al idioma correcto, a lecciones activas y con sesión', async () => {
  fs.mkdirSync(LESSONS_DIR, { recursive: true });
  const esFile = path.join(LESSONS_DIR, 'es-active.webm');
  const enFile = path.join(LESSONS_DIR, 'en-active.webm');
  fs.writeFileSync(esFile, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x11, 0x22]));
  fs.writeFileSync(enFile, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x33, 0x44]));
  try {
    await withServer(async ({ state, base }) => {
      // La fila de cada lección apunta a su archivo en disco.
      state.lessons.find((l) => l.id === 'es-active').videoFile = 'es-active.webm';
      state.lessons.find((l) => l.id === 'en-active').videoFile = 'en-active.webm';
      state.lessons.find((l) => l.id === 'es-inactive').videoFile = 'es-active.webm';

      const as = (user) => (user ? { 'x-test-user': user } : {});
      assert.equal((await fetch(`${base}/api/micro-lessons/es-active/video`)).status, 401, 'sin sesión no se entrega');

      const sameLanguage = await fetch(`${base}/api/micro-lessons/es-active/video`, { headers: as('voceroEs') });
      assert.equal(sameLanguage.status, 200);
      assert.equal(Buffer.from(await sameLanguage.arrayBuffer()).length, 6, 'se entrega el archivo real');

      assert.equal(
        (await fetch(`${base}/api/micro-lessons/en-active/video`, { headers: as('voceroEs') })).status,
        403,
        'no se puede ver el video de otro idioma',
      );
      assert.equal(
        (await fetch(`${base}/api/micro-lessons/es-inactive/video`, { headers: as('voceroEs') })).status,
        403,
        'una lección inactiva no entrega su video',
      );
      assert.equal(
        (await fetch(`${base}/api/micro-lessons/en-active/video`, { headers: as('adminA') })).status,
        403,
        'el administrador del cliente tampoco ve otro idioma',
      );
      assert.equal(
        (await fetch(`${base}/api/micro-lessons/es-inactive/video`, { headers: as('sys') })).status,
        200,
        'el administrador del sistema sí puede revisar cualquier lección',
      );
    });
  } finally {
    fs.rmSync(esFile, { force: true });
    fs.rmSync(enFile, { force: true });
  }

test('solo el administrador del sistema administra las microlecciones', async () => {
  await withServer(async ({ call }) => {
    const payload = { title: 'Nueva', description: 'Descripción', language: 'es', areas: ['empathy'], active: true };
    assert.equal((await call('/api/micro-lessons', { method: 'POST', user: 'adminA', body: payload })).status, 403);
    assert.equal((await call('/api/micro-lessons/es-active', { method: 'PUT', user: 'adminA', body: payload })).status, 403);
    assert.equal((await call('/api/micro-lessons/es-active', { method: 'DELETE', user: 'adminA' })).status, 403);
    assert.equal((await call('/api/micro-lessons', { method: 'POST', user: 'sys', body: payload })).status, 201);
  });
});

test('las microlecciones se validan (título, descripción, idioma habilitado y áreas)', async () => {
  await withServer(async ({ call }) => {
    const base = { title: 'T', description: 'D', language: 'es', areas: ['empathy'] };
    const cases = [
      [{ ...base, title: '   ' }, 422, 'título vacío'],
      [{ ...base, description: '' }, 422, 'descripción vacía'],
      [{ ...base, language: 'pt' }, 422, 'idioma no habilitado'],
      [{ ...base, areas: [] }, 422, 'sin áreas'],
      [{ ...base, areas: ['invented'] }, 422, 'área que no es de la rúbrica'],
    ];
    for (const [body, status, label] of cases) {
      const response = await call('/api/micro-lessons', { method: 'POST', user: 'sys', body });
      assert.equal(response.status, status, label);
    }
    // Válido: se normalizan las áreas repetidas o ajenas y se guarda.
    const created = await call('/api/micro-lessons', {
      method: 'POST',
      user: 'sys',
      body: { ...base, areas: ['empathy', 'empathy', 'voice', 'nope'] },
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.data.lesson.areas, ['empathy', 'voice']);
    assert.equal(created.data.lesson.active, true);
  });
});

test('editar cambia el idioma y el estado sin perder el video', async () => {
  await withServer(async ({ call, state }) => {
    state.lessons.find((l) => l.id === 'es-active').videoFile = 'es-active.webm';
    const updated = await call('/api/micro-lessons/es-active', {
      method: 'PUT',
      user: 'sys',
      body: { language: 'en', active: false, title: 'Empatía (EN)' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.lesson.language, 'en');
    assert.equal(updated.data.lesson.active, false);
    assert.equal(updated.data.lesson.hasVideo, true, 'editar no borra el video');
  });
});

test('subir el video valida el formato, lo guarda y al eliminar se borra el archivo', async () => {
  fs.mkdirSync(LESSONS_DIR, { recursive: true });
  const file = path.join(LESSONS_DIR, 'es-active.webm');
  try {
    await withServer(async ({ call, state, base }) => {
      const wrongType = await fetch(`${base}/api/micro-lessons/es-active/video`, {
        method: 'POST',
        headers: { 'x-test-user': 'sys', 'Content-Type': 'application/pdf' },
        body: Buffer.from('no soy un video'),
      });
      assert.equal(wrongType.status, 415, 'un tipo no admitido se rechaza');

      const uploaded = await fetch(`${base}/api/micro-lessons/es-active/video`, {
        method: 'POST',
        headers: { 'x-test-user': 'sys', 'Content-Type': 'video/webm' },
        body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03]),
      });
      assert.equal(uploaded.status, 200);
      const payload = await uploaded.json();
      assert.equal(payload.lesson.hasVideo, true);
      assert.equal(payload.lesson.videoMime, 'video/webm');
      assert.equal(fs.existsSync(file), true, 'el archivo queda en disco');

      const removed = await call('/api/micro-lessons/es-active', { method: 'DELETE', user: 'sys' });
      assert.equal(removed.status, 200);
      assert.equal(fs.existsSync(file), false, 'al eliminar la lección no queda un video huérfano');
      assert.equal(state.lessons.some((l) => l.id === 'es-active'), false);
    });
  } finally {
    fs.rmSync(file, { force: true });
  }
});

});

// <!-- TERCERA PARTE -->

