// Camino VERIFICADO: el audio (Whisper simulado) sostiene el WPM y el criterio puntúa.
// Sin base de datos, sin red externa y sin servicio de Whisper real.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.EVAL_WHISPER_ENABLED = 'true';
process.env.NVIDIA_API_KEY = 'test-key';
process.env.AI_EVAL_MODEL = 'test/modelo-a';
process.env.AI_EVAL_FALLBACK_MODEL = 'test/modelo-b';

// IMPORTANTE: se parchea el cliente ANTES de cargar las rutas (que lo desestructuran).
const whisperClient = require('../lib/whisperClient');

function wordsFor(text, startSec, step = 0.5) {
  return text.split(' ').map((word, i) => ({
    start: Number((startSec + i * step).toFixed(2)),
    end: Number((startSec + i * step + 0.25).toFixed(2)),
    word,
  }));
}
function segment(startSec, text) {
  const words = wordsFor(text, startSec);
  return { start: startSec, end: words[words.length - 1].end, text, words };
}

const ANSWER_1 = 'Quiero lamentar profundamente lo ocurrido y expresar nuestra solidaridad con la familia.';
const ANSWER_2 = 'Estamos colaborando con la autoridad desde el primer minuto.';

// Lo que devolvería el servicio: pregunta del entrevistador + dos respuestas.
const SEGMENTS = [
  segment(1, 'Cuénteme qué ocurrió exactamente'),
  segment(4, ANSWER_1),
  segment(20, 'Y qué están haciendo ahora'),
  segment(23, ANSWER_2),
];

whisperClient.transcribeFile = async () => ({
  ok: true,
  segments: SEGMENTS,
  durationSeconds: 32,
  modelKey: 'small',
  modelName: 'small',
  processingMs: 1200,
});

const express = require('express');
const { createToken } = require('../auth');
const registerSessionRoutes = require('../routes/sessions');
const { DEFAULT_CONFIG } = require('../ai/patternConfig');

const realFetch = global.fetch;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(25);
  }
  return false;
}

const verdict = () => ({
  coherencia: Object.fromEntries(Object.keys(DEFAULT_CONFIG.coherence.criteria).map((key) => [key, 80])),
  empatia: Object.fromEntries(Object.keys(DEFAULT_CONFIG.empathy.criteria).map((key) => [key, 70])),
  resumen: 'Buen desempeño.',
  cita: 'Cita.',
  fortalezas: ['Claridad'],
  mejoras: ['Sintetizar'],
  mensajesClave: [],
  lineasRojas: [],
  porPregunta: [],
});

function stubAI() {
  global.fetch = async (url, options) => {
    if (!String(url).includes('integrate.api.nvidia.com')) return realFetch(url, options);
    return new Response(
      JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(verdict()) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
}

const theme = () => ({
  id: 't1',
  title: 'Accidente',
  context: 'Accidente.',
  optic: 'Institucional',
  keyMessages: JSON.stringify([]),
  redLines: null,
  interviewConfig: { aggressiveness: 'MEDIA', questionCount: 2, followUps: 0 },
});

function createStore(row) {
  const rows = new Map([[row.id, row]]);
  const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
  return {
    rows,
    user: {
      async findUnique({ where }) {
        return where.id === 'u1'
          ? { id: 'u1', name: 'Vocero', role: 'VOCERO', status: 'ACTIVE', tenant: { status: 'ACTIVE' } }
          : null;
      },
      async findMany() { return []; },
    },
    session: {
      async findUnique({ where }) { return clone(rows.get(where.id) || null); },
      async findMany() { return []; },
      async update({ where, data }) { const r = rows.get(where.id); Object.assign(r, data); return clone(r); },
      async updateMany({ where, data }) {
        const r = rows.get(where.id);
        if (!r || ('status' in where && r.status !== where.status)) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
    },
    tenant: { async findMany() { return []; } },
    voceroPatternOverride: { async findUnique() { return null; } },
    patternOverride: { async findUnique() { return null; } },
    masterPattern: { async findFirst() { return null; } },
  };
}

const BODY = {
  transcript: [
    { question: '¿Qué ocurrió?', answer: ANSWER_1, metrics: { speakingMs: 6000, latencyMs: 900, longPauses: 0, volumeVariation: 0.3 } },
    { question: '¿Qué hacen ahora?', answer: ANSWER_2, metrics: { speakingMs: 4000, latencyMs: 1200, longPauses: 0, volumeVariation: 0.3 } },
  ],
  metrics: {
    voice: { available: true, longPauses: 0, volumeVariation: 0.3, avgLatencyMs: 1000, transcription: 'voz' },
    body: { available: true, presence: 0.95, facingCamera: 0.8, analyzedSeconds: 20, facingSeconds: 16, awaySeconds: 4 },
    lighting: { average: 120 },
    durationSeconds: 32,
  },
};

test('con audio que sostiene el texto, el WPM se verifica y puntúa', async () => {
  const store = createStore({
    id: 's1',
    userId: 'u1',
    status: 'CREATED',
    createdAt: new Date(),
    completedAt: null,
    tenantId: 't1',
    themeId: 't1',
    transcript: null,
    metrics: null,
    report: null,
    score: null,
    review: null,
    theme: theme(),
    user: { id: 'u1', name: 'Vocero' },
    tenant: { status: 'ACTIVE' },
  });

  const app = express();
  app.use(express.json());
  registerSessionRoutes(app, store);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const call = (path, { method = 'GET', body } = {}) =>
    realFetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${createToken({ id: 'u1', role: 'VOCERO' })}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  stubAI();
  try {
    const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
    assert.equal(started.status, 202);
    assert.ok(await waitFor(() => store.rows.get('s1').status === 'COMPLETED'));

    const row = store.rows.get('s1');
    const voice = row.report.areas.find((area) => area.key === 'voice');
    const wpm = voice.details.find((detail) => detail.key === 'wpm');

    assert.equal(wpm.verified, true);
    assert.equal(wpm.score, 100); // 150 pal/min está en el rango ideal (120-165)
    assert.ok(wpm.value > 120 && wpm.value < 180, `wpm inesperado: ${wpm.value}`);
    assert.equal(voice.coverage, 1);
    assert.equal(row.report.coverage.wpmVerified, true);
    assert.equal(row.report.audit.metricSources.wpm, 'server-audio');
    assert.equal(row.report.audit.speech.status, 'verified');
    assert.equal(row.report.audit.speech.model, 'small');
    assert.ok(row.report.audit.speech.speechMs > 0);
    // El texto transcrito NO se guarda en la auditoría
    assert.equal('text' in row.report.audit.speech, false);
    // Los turnos llevan el WPM verificado y su origen
    assert.equal(row.transcript[0].metrics.speechSource, 'audio');
    assert.ok(row.transcript[0].metrics.wpm > 0);
  } finally {
    global.fetch = realFetch;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

