// Estado en memoria de los procesos críticos del backend (se reinicia con el servidor):
//  - jobs automáticos (retención, eliminación de organizaciones): última ejecución y resultado,
//  - IA (entrevistador y evaluador): última respuesta correcta y último fallo.
// Lo consulta GET /api/system/status para el panel del administrador del sistema.

const startedAt = new Date();
const jobs = new Map();
const ai = new Map();

// Declara un job para que aparezca en el panel aunque todavía no haya corrido
function registerJob(name, { label, everyMs = null } = {}) {
  if (!jobs.has(name)) {
    jobs.set(name, { name, label: label || name, everyMs, runs: 0, running: false, lastRunAt: null, lastOkAt: null, lastMs: null, lastResult: null, lastError: null });
  }
  return jobs.get(name);
}

// Ejecuta un job dejando registro de cuándo corrió, cuánto tardó y si falló.
// Propaga el error para que quien lo llama decida qué hacer.
async function runJob(name, fn) {
  const job = registerJob(name);
  const start = Date.now();
  job.running = true;
  try {
    const result = await fn();
    job.lastOkAt = new Date();
    job.lastResult = result ?? null;
    job.lastError = null;
    return result;
  } catch (error) {
    job.lastError = { message: error.message, at: new Date() };
    throw error;
  } finally {
    job.running = false;
    job.runs += 1;
    job.lastRunAt = new Date();
    job.lastMs = Date.now() - start;
  }
}

// Un job está "abajo" si su última ejecución falló o si lleva más de dos ciclos sin correr
function jobState(job, now = Date.now()) {
  if (job.lastError) return 'error';
  if (!job.lastRunAt) return 'pending';
  if (job.everyMs && now - job.lastRunAt.getTime() > job.everyMs * 2 + 60000) return 'error';
  return 'ok';
}

function recordAi(kind, ok, info = {}) {
  const entry = ai.get(kind) || { kind, calls: 0, failures: 0, lastOkAt: null, lastErrorAt: null, lastError: null, lastModel: null, lastMs: null };
  entry.calls += 1;
  if (ok) {
    entry.lastOkAt = new Date();
    entry.lastModel = info.model || null;
    entry.lastMs = info.ms ?? null;
  } else {
    entry.failures += 1;
    entry.lastErrorAt = new Date();
    entry.lastError = info.error || 'sin respuesta';
  }
  ai.set(kind, entry);
}

// "ok" si lo último que pasó fue una respuesta correcta; "error" si fue un fallo
function aiState(entry) {
  if (!entry || (!entry.lastOkAt && !entry.lastErrorAt)) return 'pending';
  if (!entry.lastErrorAt) return 'ok';
  if (!entry.lastOkAt) return 'error';
  return entry.lastOkAt >= entry.lastErrorAt ? 'ok' : 'error';
}

function snapshot() {
  const now = Date.now();
  return {
    startedAt,
    uptimeSeconds: Math.round((now - startedAt.getTime()) / 1000),
    jobs: [...jobs.values()].map((job) => ({ ...job, state: jobState(job, now) })),
    ai: Object.fromEntries(['interviewer', 'evaluator'].map((kind) => [kind, { ...(ai.get(kind) || { kind, calls: 0, failures: 0 }), state: aiState(ai.get(kind)) }])),
  };
}

module.exports = { registerJob, runJob, recordAi, snapshot, jobState, aiState };
