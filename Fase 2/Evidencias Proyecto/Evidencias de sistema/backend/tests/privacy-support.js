// Pruebas de privacidad: (A) eliminación de organizaciones borrando video Y audio, y
// (B) anonimización de las transcripciones de auditoría.
//
// - Datos 100% sintéticos; NO se toca ninguna base de datos real.
// - Los archivos se crean en una carpeta temporal: nunca en uploads/sessions.
// - El doble de Prisma implementa las operaciones que usan los módulos bajo prueba
//   (findMany con select, updateMany con `in`, $transaction interactiva, deleteMany y count),
//   resolviendo las relaciones que las dos correcciones necesitan (sesión→auditoría,
//   usuario→sesiones, solicitud→usuario).
const fs = require('fs');
const os = require('os');
const path = require('path');

// ------------------------------------------------------------------ doble de Prisma

const matches = (row, where) => {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return cond.some((c) => matches(row, c));
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (typeof cond === 'object' && cond !== null) {
      if ('in' in cond) return cond.in.includes(value);
      if ('not' in cond) {
        if (cond.not === null) return value !== null && value !== undefined;
        return value !== cond.not;
      }
      return true;
    }
    return value === cond;
  });
};

// Proyección fiel: `select` recorta; `include` conserva los campos y añade relaciones.
const project = (db, row, cfg, mode) => {
  if (!row) return null;
  const out = mode === 'include' ? { ...row } : {};
  for (const [key, value] of Object.entries(cfg || {})) {
    if (value === false) continue;
    if (value === true) {
      out[key] = row[key];
      continue;
    }
    if (Array.isArray(db[key])) {
      const related = db[key].find((r) => r.id === row[`${key}Id`]);
      out[key] = related ? project(db, related, value.select || value.include || {}, value.select ? 'select' : 'include') : null;
      continue;
    }
    out[key] = row[key];
  }
  return out;
};

function makeClient(db) {
  const model = (name) => ({
    async findMany({ where, select, include, orderBy } = {}) {
      let rows = db[name].filter((r) => matches(r, where));
      if (orderBy) {
        const [[field, dir]] = Object.entries(orderBy);
        rows = [...rows].sort((a, b) => (dir === 'desc' ? -1 : 1) * (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0));
      }
      if (select) return rows.map((r) => project(db, r, select, 'select'));
      if (include) return rows.map((r) => project(db, r, include, 'include'));
      return rows.map((r) => ({ ...r }));
    },
    async findUnique({ where, select, include }) {
      const row = db[name].find((r) => matches(r, where));
      if (!row) return null;
      if (select) return project(db, row, select, 'select');
      if (include) return project(db, row, include, 'include');
      return { ...row };
    },
    async create({ data }) {
      const row = { id: `${name}-${db[name].length + 1}`, createdAt: new Date(), ...data };
      db[name].push(row);
      return { ...row };
    },
    async update({ where, data }) {
      const row = db[name].find((r) => matches(r, where));
      if (!row) throw new Error(`${name} no encontrado`);
      Object.assign(row, data);
      return { ...row };
    },
    async updateMany({ where, data }) {
      const rows = db[name].filter((r) => matches(r, where));
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
    async deleteMany({ where }) {
      const before = db[name].length;
      db[name] = db[name].filter((r) => !matches(r, where));
      return { count: before - db[name].length };
    },
    async count({ where } = {}) {
      return db[name].filter((r) => matches(r, where)).length;
    },
  });

  const client = { db, $queryRaw: async () => [{ 1: 1 }] };
  for (const name of MODELS) {
    db[name] = db[name] || [];
    client[name] = model(name);
  }
  return client;
}

const MODELS = ['tenant', 'user', 'theme', 'session', 'tenantEvent', 'deletionRequest', 'transcriptionAudit', 'scenarioAssignment', 'scenarioRubric', 'retentionPause', 'retentionExtensionRequest'];

function createPrismaStub(seed) {
  const db = seed;
  const prisma = makeClient(db);

  // Transacción: entrega un cliente DISTINTO (como hace Prisma) y REVIERTE si el callback falla.
  // Distinguir `tx` del cliente global es imprescindible: si se usara el mismo objeto, una
  // regresión que llamase al cliente global dentro de la transacción pasaría inadvertida.
  prisma.$transaction = async (fn) => {
    const snapshot = structuredClone(db);
    const tx = makeClient(db);
    try {
      return await fn(tx);
    } catch (error) {
      for (const key of Object.keys(db)) db[key] = snapshot[key];
      throw error;
    }
  };

  return prisma;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-privacy-'));
const file = (name, content = 'x') => fs.writeFileSync(path.join(TMP, name), content);

// ------------------------------------------------------------------ datos sintéticos
// Organización t1 con tres voceros: u1 (se anonimiza), u2 (no debe tocarse) y u3 (flujo de
// solicitud de borrado). Cada sesión tiene su fila de auditoría de transcripción con texto.
const TEXTO = 'Hola, soy Ana y trabajo en la planta';

function anonymizationSeed() {
  return {
    tenant: [{ id: 't1', name: 'Cliente Uno', status: 'ACTIVE' }],
    user: [
      { id: 'u1', name: 'Ana Torres', email: 'ana@demo.com', area: 'Dirección', role: 'VOCERO', status: 'ACTIVE', tenantId: 't1', passwordHash: 'hash', lastLoginAt: new Date(), anonymizedAt: null },
      { id: 'u2', name: 'Diego Paredes', email: 'diego@demo.com', area: 'Planta', role: 'VOCERO', status: 'ACTIVE', tenantId: 't1', passwordHash: 'hash', lastLoginAt: null, anonymizedAt: null },
      { id: 'u3', name: 'Lucía Soto', email: 'lucia@demo.com', area: 'Planta', role: 'VOCERO', status: 'ACTIVE', tenantId: 't1', passwordHash: 'hash', lastLoginAt: null, anonymizedAt: null },
    ],
    theme: [{ id: 'th1', title: 'Crisis', tenantId: 't1' }],
    session: [
      { id: 'anon-s1', userId: 'u1', tenantId: 't1', themeId: 'th1', score: 72, completedAt: new Date(), transcript: [{ question: 'P1', answer: TEXTO, metrics: { fillerWords: ['este'] } }], metrics: { voice: { fillerWords: ['este'], wpm: 130 } }, report: { global: 72, areas: [{ key: 'voice', score: 70 }], resumen: 'texto del vocero', porPregunta: [{ pregunta: 1, puntaje: 70, comentario: 'comentario' }] }, review: null },
      { id: 'anon-s2', userId: 'u1', tenantId: 't1', themeId: 'th1', score: 65, completedAt: new Date(), transcript: [{ question: 'P2', answer: TEXTO }], metrics: {}, report: { global: 65, areas: [] }, review: null },
      { id: 'anon-s3', userId: 'u2', tenantId: 't1', themeId: 'th1', score: 80, completedAt: new Date(), transcript: [{ question: 'P3', answer: TEXTO }], metrics: {}, report: { global: 80 }, review: null },
      { id: 'anon-s4', userId: 'u3', tenantId: 't1', themeId: 'th1', score: 55, completedAt: new Date(), transcript: [{ question: 'P4', answer: TEXTO }], metrics: {}, report: { global: 55 }, review: null },
    ],
    transcriptionAudit: [
      { id: 'aud-1', sessionId: 'anon-s1', turnIndex: 0, status: 'ok', engine: 'nvidia-whisper-large-v3', transcript: TEXTO, totalMs: 1200, reason: 'PRIORITY', attempts: [{ engine: 'nvidia-whisper-large-v3', status: 'ok', ms: 1200, chars: TEXTO.length }] },
      { id: 'aud-2', sessionId: 'anon-s1', turnIndex: 1, status: 'failed', engine: null, transcript: null, totalMs: null, reason: 'ALL_ENGINES_FAILED', attempts: [] },
      { id: 'aud-3', sessionId: 'anon-s2', turnIndex: 0, status: 'ok', engine: 'local-whisper-small', transcript: TEXTO, totalMs: 900, reason: 'PRIORITY', attempts: [] },
      { id: 'aud-4', sessionId: 'anon-s3', turnIndex: 0, status: 'ok', engine: 'nvidia-canary-1b', transcript: TEXTO, totalMs: 800, reason: 'PRIORITY', attempts: [] },
      { id: 'aud-5', sessionId: 'anon-s4', turnIndex: 0, status: 'ok', engine: 'nvidia-whisper-large-v3', transcript: TEXTO, totalMs: 700, reason: 'PRIORITY', attempts: [] },
    ],
    deletionRequest: [
      { id: 'req-1', tenantId: 't1', scope: 'ANONYMIZE', status: 'APPROVED', targetUserId: 'u3', requestedById: 'u2', resolvedById: null, reason: 'Solicitud de Lucía', resolutionNote: null, createdAt: new Date(), resolvedAt: null },
    ],
    tenantEvent: [],
    scenarioAssignment: [],
    scenarioRubric: [],
    retentionPause: [],
  };
}

module.exports = { createPrismaStub, matches, project, TMP, file, TEXTO, anonymizationSeed };
