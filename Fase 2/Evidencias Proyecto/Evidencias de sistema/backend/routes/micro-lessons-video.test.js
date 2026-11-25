// Microlecciones (ampliación): enlace de video externo (YouTube) y área GENERAL.
// Prisma y autenticación simulados, igual que `micro-lessons.test.js`. NO altera las pruebas
// existentes: comprueba la compatibilidad hacia atrás y las nuevas capacidades.
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

// Almacén en memoria. `sessions` decide el área más débil del vocero (recomendación).
function createStore({ sessions = [] } = {}) {
  const state = {
    lessons: [
      // Lección HISTÓRICA (como las existentes): solo archivo subido, sin enlace externo.
      { id: 'legacy-upload', title: 'Histórica', description: 'x', language: 'es', areas: ['empathy'], active: true, videoFile: 'legacy-upload.webm', videoMime: 'video/webm', videoBytes: 1234, videoUrl: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') },
    ],
    sessions,
  };

  const prisma = {
    microLesson: {
      findMany: async ({ where = {}, orderBy } = {}) => {
        const rows = state.lessons.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
        if (orderBy?.createdAt === 'desc') rows.sort((a, b) => b.createdAt - a.createdAt);
        return rows.map((row) => ({ ...row }));
      },
      findUnique: async ({ where }) => {
        const row = state.lessons.find((item) => item.id === where.id);
        return row ? { ...row } : null;
      },
      create: async ({ data }) => {
        const row = { id: `new-${state.lessons.length + 1}`, createdAt: new Date(), updatedAt: new Date(), videoFile: null, videoUrl: null, ...data };
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
      findFirst: async () => state.sessions[0] || null,
    },
  };

  return { state, prisma };
}

async function withServer(options, run) {
  const { state, prisma } = createStore(options);
  const app = express();
  app.use(express.json());
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

const VALID_BASE = { title: 'T', description: 'D', language: 'es', areas: ['coherence'] };

test('un enlace de YouTube válido se guarda como URL canónica y como fuente externa', async () => {
  await withServer({}, async ({ call }) => {
    const watch = await call('/api/micro-lessons', {
      method: 'POST', user: 'sys',
      body: { ...VALID_BASE, videoUrl: 'https://www.youtube.com/watch?v=1vbWtbuC5TY' },
    });
    assert.equal(watch.status, 201);
    assert.equal(watch.data.lesson.hasVideo, true);
    assert.equal(watch.data.lesson.videoSource, 'external');
    assert.equal(watch.data.lesson.videoUrl, 'https://www.youtube.com/watch?v=1vbWtbuC5TY');

    const short = await call('/api/micro-lessons', {
      method: 'POST', user: 'sys',
      body: { ...VALID_BASE, videoUrl: 'https://youtu.be/m8jyYIZwc28?t=10' },
    });
    assert.equal(short.status, 201, 'youtu.be también es válido');
    assert.equal(short.data.lesson.videoUrl, 'https://www.youtube.com/watch?v=m8jyYIZwc28', 'se normaliza a la URL canónica');

    const shorts = await call('/api/micro-lessons', {
      method: 'POST', user: 'sys',
      body: { ...VALID_BASE, videoUrl: 'https://www.youtube.com/shorts/TJAbOeb7NEA' },
    });
    assert.equal(shorts.status, 201, 'los enlaces /shorts también valen');
    assert.equal(shorts.data.lesson.videoUrl, 'https://www.youtube.com/watch?v=TJAbOeb7NEA');
  });
});

test('se rechazan enlaces inválidos o inseguros (HTTP, otros dominios, javascript:, sin id)', async () => {
  await withServer({}, async ({ call }) => {
    const bad = [
      'http://www.youtube.com/watch?v=1vbWtbuC5TY',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://youtube.com/watch?v=1vbWtbuC5TY',
      'https://evil.example/watch?v=1vbWtbuC5TY',
      'https://www.youtube.com/watch?v=abc',
      'https://www.youtube.com/watch',
      'no-es-una-url',
    ];
    for (const videoUrl of bad) {
      const response = await call('/api/micro-lessons', { method: 'POST', user: 'sys', body: { ...VALID_BASE, videoUrl } });
      assert.equal(response.status, 422, `debe rechazar: ${videoUrl}`);
    }
  });
});

test('GENERAL es un área admitida y se recomienda SIEMPRE (transversal, sin área débil)', async () => {
  await withServer({ sessions: [] }, async ({ call }) => {
    const created = await call('/api/micro-lessons', {
      method: 'POST', user: 'sys',
      body: { title: 'Base transversal', description: 'D', language: 'es', areas: ['GENERAL'], active: true },
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.data.lesson.areas, ['GENERAL']);

    const catalog = await call('/api/micro-lessons', { user: 'voceroEs' });
    assert.equal(catalog.data.weakestArea, null, 'el vocero no tiene prácticas');
    const byId = Object.fromEntries(catalog.data.lessons.map((l) => [l.id, l]));
    assert.equal(byId['new-2'].recommended, true, 'GENERAL se recomienda aunque no haya área débil');
    assert.equal(byId['legacy-upload'].recommended, false, 'sin datos, una lección de rúbrica NO se recomienda');
  });
});

test('las cuatro áreas originales conservan su criterio de recomendación', async () => {
  const sessions = [{ report: { areas: [{ key: 'coherence', score: 40 }, { key: 'empathy', score: 90 }] } }];
  await withServer({ sessions }, async ({ call }) => {
    await call('/api/micro-lessons', { method: 'POST', user: 'sys', body: { title: 'C', description: 'D', language: 'es', areas: ['coherence'], active: true } });
    await call('/api/micro-lessons', { method: 'POST', user: 'sys', body: { title: 'E', description: 'D', language: 'es', areas: ['empathy'], active: true } });
    await call('/api/micro-lessons', { method: 'POST', user: 'sys', body: { title: 'G', description: 'D', language: 'es', areas: ['GENERAL'], active: true } });
    const catalog = await call('/api/micro-lessons', { user: 'voceroEs' });
    assert.equal(catalog.data.weakestArea, 'coherence');
    const byId = Object.fromEntries(catalog.data.lessons.map((l) => [l.id, l]));
    assert.equal(byId['new-2'].recommended, true, 'coherencia es el área más débil');
    assert.equal(byId['new-3'].recommended, false, 'empatía no es el área más débil');
    assert.equal(byId['new-4'].recommended, true, 'GENERAL siempre recomendada');
  });
});

test('compatibilidad: una microlección con video subido sigue igual y se puede sustituir por un enlace', async () => {
  fs.mkdirSync(LESSONS_DIR, { recursive: true });
  const file = path.join(LESSONS_DIR, 'legacy-upload.webm');
  fs.writeFileSync(file, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]));
  try {
    await withServer({}, async ({ call }) => {
      const legacy = await call('/api/micro-lessons?all=1', { user: 'sys' });
      const row = legacy.data.lessons.find((l) => l.id === 'legacy-upload');
      assert.equal(row.hasVideo, true);
      assert.equal(row.videoSource, 'upload', 'una lección histórica sigue sirviéndose como archivo');
      assert.equal(row.videoUrl, null);

      // No se puede añadir el enlace mientras exista el archivo (exclusividad de fuentes).
      const blocked = await call('/api/micro-lessons/legacy-upload', {
        method: 'PUT', user: 'sys', body: { videoUrl: 'https://youtu.be/1vbWtbuC5TY' },
      });
      assert.equal(blocked.status, 409, 'se rechaza tener archivo y enlace a la vez');
      assert.equal(fs.existsSync(file), true, 'el rechazo no toca el archivo guardado');

      // Se quita el archivo y entonces sí puede usarse el enlace.
      const removed = await call('/api/micro-lessons/legacy-upload/video', { method: 'DELETE', user: 'sys' });
      assert.equal(removed.status, 200);
      assert.equal(removed.data.lesson.videoSource, null);
      assert.equal(removed.data.lesson.videoUrl, null);
      assert.equal(fs.existsSync(file), false, 'quitar el video borra el archivo del disco');

      const withLink = await call('/api/micro-lessons/legacy-upload', {
        method: 'PUT', user: 'sys', body: { videoUrl: 'https://youtu.be/1vbWtbuC5TY' },
      });
      assert.equal(withLink.status, 200);
      assert.equal(withLink.data.lesson.videoSource, 'external');
      assert.equal(withLink.data.lesson.videoUrl, 'https://www.youtube.com/watch?v=1vbWtbuC5TY');
    });
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('subir un archivo se rechaza si la microlección ya tiene un enlace (petición manipulada)', async () => {
  fs.mkdirSync(LESSONS_DIR, { recursive: true });
  try {
    await withServer({}, async ({ call, base }) => {
      // Lección SIN archivo pero CON enlace (como la crearía la interfaz).
      const created = await call('/api/micro-lessons', {
        method: 'POST', user: 'sys',
        body: { title: 'Con enlace', description: 'D', language: 'es', areas: ['coherence'], active: true, videoUrl: 'https://youtu.be/1vbWtbuC5TY' },
      });
      const id = created.data.lesson.id;
      const target = path.join(LESSONS_DIR, `${id}.webm`);

      const blocked = await fetch(`${base}/api/micro-lessons/${id}/video`, {
        method: 'POST',
        headers: { 'x-test-user': 'sys', 'Content-Type': 'video/webm' },
        body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03]),
      });
      assert.equal(blocked.status, 409, 'no se puede subir un archivo si ya hay un enlace');
      assert.equal(fs.existsSync(target), false, 'el rechazo no deja ningún archivo huérfano');

      // El enlace sigue siendo la única fuente.
      const after = await call('/api/micro-lessons?all=1', { user: 'sys' });
      const row = after.data.lessons.find((l) => l.id === id);
      assert.equal(row.videoSource, 'external');
      assert.equal(row.hasVideo, true);

      // Al quitar el enlace, la subida vuelve a funcionar.
      await call(`/api/micro-lessons/${id}`, { method: 'PUT', user: 'sys', body: { videoUrl: '' } });
      const ok = await fetch(`${base}/api/micro-lessons/${id}/video`, {
        method: 'POST',
        headers: { 'x-test-user': 'sys', 'Content-Type': 'video/webm' },
        body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x04, 0x05]),
      });
      assert.equal(ok.status, 200);
      const payload = await ok.json();
      assert.equal(payload.lesson.videoSource, 'upload');
      assert.equal(payload.lesson.videoUrl, null);
      fs.rmSync(target, { force: true });
    });
  } finally {
    fs.rmSync(path.join(LESSONS_DIR, 'legacy-upload.webm'), { force: true });
  }
});

test('quitar el video de una lección sin archivo no rompe (idempotente)', async () => {
  await withServer({}, async ({ call }) => {
    const removed = await call('/api/micro-lessons/legacy-upload/video', { method: 'DELETE', user: 'sys' });
    assert.equal(removed.status, 200);
    assert.equal(removed.data.lesson.hasVideo, false);
    assert.equal((await call('/api/micro-lessons/legacy-upload/video', { method: 'DELETE', user: 'voceroEs' })).status, 403, 'solo el sistema administra');
  });
});

test('editar puede cambiar el enlace y quitarlo (vuelve al video subido)', async () => {
  await withServer({}, async ({ call }) => {
    const created = await call('/api/micro-lessons', { method: 'POST', user: 'sys', body: { ...VALID_BASE, videoUrl: 'https://youtu.be/1vbWtbuC5TY' } });
    const id = created.data.lesson.id;

    const changed = await call(`/api/micro-lessons/${id}`, { method: 'PUT', user: 'sys', body: { videoUrl: 'https://www.youtube.com/watch?v=FbJ4_bS98Ls' } });
    assert.equal(changed.data.lesson.videoUrl, 'https://www.youtube.com/watch?v=FbJ4_bS98Ls');

    const cleared = await call(`/api/micro-lessons/${id}`, { method: 'PUT', user: 'sys', body: { videoUrl: '' } });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.lesson.videoUrl, null);
    assert.equal(cleared.data.lesson.videoSource, null, 'sin archivo ni enlace no hay fuente');
    assert.equal(cleared.data.lesson.hasVideo, false);
  });
});

test('el idioma sigue separando los catálogos con GENERAL y enlaces externos', async () => {
  await withServer({}, async ({ call }) => {
    await call('/api/micro-lessons', { method: 'POST', user: 'sys', body: { title: 'ES', description: 'D', language: 'es', areas: ['GENERAL'], active: true } });
    await call('/api/micro-lessons', { method: 'POST', user: 'sys', body: { title: 'EN', description: 'D', language: 'en', areas: ['GENERAL'], active: true, videoUrl: 'https://youtu.be/1vbWtbuC5TY' } });

    const es = await call('/api/micro-lessons', { user: 'voceroEs' });
    assert.deepEqual(es.data.lessons.map((l) => l.title).sort(), ['ES', 'Histórica']);
    const en = await call('/api/micro-lessons', { user: 'voceroEn' });
    assert.deepEqual(en.data.lessons.map((l) => l.title), ['EN']);
    assert.equal(en.data.lessons[0].videoSource, 'external');
  });
});
