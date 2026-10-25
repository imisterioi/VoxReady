// Runner de recuperación de evaluaciones: reanuda trabajos interrumpidos y ejecuta los reintentos
// programados. Se apoya en el lease persistente (`evaluationRetry.claimAttempt`) para que dos
// procesos o instancias NUNCA ejecuten la misma sesión a la vez.
//
// Límites explícitos:
//  - Solo toca sesiones que YA llegaron a la generación del informe (tienen reintento programado o
//    quedaron en EVALUATING con el lease vencido). No recupera entrevistas ni al entrevistador.
//  - No publica nada: solo reclama y delega el intento en `runAttempt` (que respeta la validación).
//  - No imprime contenido del vocero: ids y códigos internos únicamente.
const { claimAttempt, dueSessions, interruptedSessions } = require('./evaluationRetry');

const DEFAULT_INTERVAL_MS = 30 * 1000;
const DEFAULT_BATCH_LIMIT = 5;

function createEvaluationQueue({
  prisma,
  runAttempt,
  env = process.env,
  now = () => Date.now(),
  intervalMs = Number(env.EVAL_QUEUE_INTERVAL_MS) || DEFAULT_INTERVAL_MS,
  batchLimit = Number(env.EVAL_QUEUE_BATCH_LIMIT) || DEFAULT_BATCH_LIMIT,
  timers = { setInterval, clearInterval },
  logger = console,
} = {}) {
  if (!prisma) throw new Error('prisma requerido');
  if (typeof runAttempt !== 'function') throw new Error('runAttempt requerido');

  let timer = null;
  const inFlight = new Set();
  const stats = { ticks: 0, claimed: 0, resumed: 0, retried: 0, skipped: 0, lastError: null, lastRunAt: null };

  // Ejecuta un intento ya reclamado. Nunca propaga el error al bucle (el fallo se persiste).
  async function runClaimed(sessionId, meta) {
    try {
      return await runAttempt(sessionId, meta);
    } catch (error) {
      logger.error('[Evaluación] intento falló:', sessionId.slice(0, 8), error?.code || error?.name || 'ERROR');
      return { ok: false, code: error?.code || 'ERROR' };
    }
  }

  async function runOne(sessionId, { reason = 'retry', requireDue = true } = {}) {
    if (inFlight.has(sessionId)) return { skipped: 'inflight' };
    inFlight.add(sessionId);
    try {
      const claimed = await claimAttempt(prisma, sessionId, { now, env, requireDue });
      if (!claimed) {
        stats.skipped += 1;
        return { skipped: 'not-claimed' };
      }
      stats.claimed += 1;
      // El lease reclamado se propaga al intento: permite publicar de forma condicional y evita
      // que un intento que perdió el lease sobrescriba el resultado de otro.
      return await runClaimed(sessionId, { reason, leaseUntil: claimed.leaseUntil });
    } finally {
      inFlight.delete(sessionId);
    }
  }

  // Trabajos interrumpidos por un reinicio: se reanudan de inmediato (el intento ya se contó).
  async function resumeInterrupted() {
    const rows = await interruptedSessions(prisma, { now, limit: batchLimit });
    let started = 0;
    for (const row of rows) {
      const result = await runOne(row.id, { reason: 'interrupted', requireDue: false });
      if (!result?.skipped) started += 1;
    }
    stats.resumed += started;
    return started;
  }

  // Reintentos cuyo momento programado ya llegó.
  async function runDueRetries() {
    const rows = await dueSessions(prisma, { now, limit: batchLimit });
    let started = 0;
    for (const row of rows) {
      const result = await runOne(row.id, { reason: 'retry', requireDue: true });
      if (!result?.skipped) started += 1;
    }
    stats.retried += started;
    return started;
  }

  async function tick() {
    stats.ticks += 1;
    stats.lastRunAt = now();
    try {
      await resumeInterrupted();
      await runDueRetries();
      stats.lastError = null;
    } catch (error) {
      stats.lastError = error?.code || error?.name || 'ERROR';
      // Detalle técnico SOLO en la consola del backend (nunca al vocero ni con contenido suyo).
      // El mensaje de Prisma empieza con salto de línea: se usa la primera línea CON texto.
      const detail = String(error?.message || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)[0] || '(sin detalle)';
      logger.error('[Evaluación] recuperación falló:', stats.lastError, detail.slice(0, 300));
    }
    return stats;
  }

  function start() {
    if (timer) return false;
    // Primera pasada inmediata: recupera lo que quedó pendiente antes del reinicio.
    tick();
    timer = timers.setInterval(tick, intervalMs);
    // No mantiene vivo el proceso (ni las pruebas) solo por el temporizador.
    if (timer && typeof timer.unref === 'function') timer.unref();
    return true;
  }

  function stop() {
    if (!timer) return false;
    timers.clearInterval(timer);
    timer = null;
    return true;
  }

  return { start, stop, tick, runOne, resumeInterrupted, runDueRetries, inFlight, stats, isRunning: () => Boolean(timer) };
}

module.exports = { createEvaluationQueue, DEFAULT_INTERVAL_MS, DEFAULT_BATCH_LIMIT };
