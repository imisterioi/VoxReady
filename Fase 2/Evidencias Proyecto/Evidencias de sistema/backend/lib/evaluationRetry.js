// Política de reintentos automáticos de evaluación: persistente y segura entre instancias.
//
// SEMÁNTICA DE "INTENTO"
// Un intento = UNA ejecución de evaluación de la sesión (una carrera `judgeContent` con todos sus
// modelos). Los modelos perdedores NO son intentos ni fallos de sesión: si otro modelo produce un
// resultado válido, la ejecución termina bien y no se programa ningún reintento.
//
// INTERVALOS (siempre desde que TERMINA el intento fallido)
//  - espera normal: 3 minutos;
//  - cada 5 intentos fallidos (5, 10, 15, …): pausa de 15 minutos que SUSTITUYE a los 3 minutos;
//  - 50 intentos: se detiene y la sesión queda marcada como agotada (intervención técnica).
//
// EXCLUSIÓN: el reclamo de un intento es un `updateMany` atómico (CAS) que exige `report = null`,
// `evalExhausted = false`, `evalAttempts < 50` y un lease vencido. Eso evita dos trabajos
// simultáneos incluso con varias instancias del backend o solicitudes repetidas.
//
// Este módulo no imprime contenido del vocero: solo ids y códigos internos.
const { Prisma } = require('@prisma/client');

// `Session.report` es una columna JSON: un `null` literal NO es válido en un `where` de Prisma.
// Además hay DOS formas de "sin informe": NULL de SQL (cuando el campo nunca se escribió) y JSON
// null (cuando alguien escribió `report: null`). `Prisma.AnyNull` cubre las dos; `Prisma.DbNull`
// solo la primera (comprobado contra la base real: DbNull devolvía 0 filas para una fila JSON null).
const NO_REPORT = { equals: Prisma.AnyNull };

const DEFAULT_RETRY_MS = 3 * 60 * 1000;
const DEFAULT_BATCH_PAUSE_MS = 15 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_MAX_ATTEMPTS = 50;
// El lease debe cubrir un intento COMPLETO con los límites reales de cada etapa:
//   verificación de audio ≤120 s (ASR_CHAIN_BUDGET_MS del proyecto) + generación del informe
//   (lo que tarde el proveedor; si el operador fija `AI_EVAL_TIMEOUT_MS`, ese valor) + margen.
// Cuando NO hay límite local, la referencia es el techo del TRANSPORTE: el `fetch` interno de Node
// corta a los 300 s (headers/body timeout de undici) y el paquete `undici` no está instalado, así que
// no se puede reconfigurar. Se documenta en vez de fingir que no existe.
// Un lease más corto que el trabajo permitiría que otra instancia reclamara la misma sesión y
// publicara un resultado obsoleto; el más largo solo retrasa la recuperación tras un reinicio.
const DEFAULT_AUDIO_BUDGET_MS = 120000;
const DEFAULT_TRANSPORT_CEILING_MS = 300000;
const DEFAULT_LEASE_MARGIN_MS = 60000;
const DEFAULT_LEASE_MS = DEFAULT_AUDIO_BUDGET_MS + DEFAULT_TRANSPORT_CEILING_MS + DEFAULT_LEASE_MARGIN_MS;
// Objetivo de experiencia: el AVISO al vocero a los 60 s es solo de interfaz (frontend). El backend
// NO usa ese plazo para cortar nada: el único límite técnico es el timeout del proveedor
// (`AI_EVAL_TIMEOUT_MS`) y el de la verificación de audio.

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Techo efectivo de la generación del informe: lo que el operador fije EXPLÍCITAMENTE
// (`AI_EVAL_TIMEOUT_MS`) o, si no fija nada, el techo documentado del transporte. Sirve para
// dimensionar el lease: no se puede prometer «sin límites» si una capa técnica sigue cortando.
function evalCeilingMs(env = process.env) {
  const configured = Number(env.AI_EVAL_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TRANSPORT_CEILING_MS;
}

function limits(env = process.env) {
  // El lease se calcula con los límites reales, de modo que nunca vence mientras el intento sigue
  // trabajando (audio + generación + margen). `EVAL_RETRY_LEASE_MS` permite fijarlo a mano.
  const computedLease = DEFAULT_AUDIO_BUDGET_MS + evalCeilingMs(env) + DEFAULT_LEASE_MARGIN_MS;
  return {
    retryMs: num(env.EVAL_RETRY_MS, DEFAULT_RETRY_MS),
    batchPauseMs: num(env.EVAL_RETRY_BATCH_PAUSE_MS, DEFAULT_BATCH_PAUSE_MS),
    batchSize: num(env.EVAL_RETRY_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    maxAttempts: num(env.EVAL_RETRY_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
    leaseMs: num(env.EVAL_RETRY_LEASE_MS, Math.max(DEFAULT_LEASE_MS, computedLease)),
  };
}

// Retardo hasta el próximo intento, según los intentos YA consumidos.
// Devuelve `null` cuando la sesión está agotada (no se programa nada más).
function nextDelayFor(attempts, env = process.env) {
  const { retryMs, batchPauseMs, batchSize, maxAttempts } = limits(env);
  const used = Number(attempts) || 0;
  if (used >= maxAttempts) return null;
  return used % batchSize === 0 ? batchPauseMs : retryMs;
}

// Estado derivado de la sesión (lo consumen la API y el runner; sin detalles técnicos visibles).
function retryState(session, { now = () => Date.now(), env = process.env } = {}) {
  const { maxAttempts } = limits(env);
  const attempts = Number(session?.evalAttempts) || 0;
  const exhausted = Boolean(session?.evalExhausted) || attempts >= maxAttempts;
  const nextAt = session?.evalNextAt ? new Date(session.evalNextAt).getTime() : null;
  return {
    attempts,
    maxAttempts,
    exhausted,
    nextAt,
    due: Boolean(nextAt && nextAt <= now()),
    leaseUntil: session?.evalLeaseUntil ? new Date(session.evalLeaseUntil).getTime() : null,
    lastError: session?.evalLastError || null,
    finishedAt: session?.evalFinishedAt ? new Date(session.evalFinishedAt).getTime() : null,
    hasReport: Boolean(session?.report),
  };
}

// Reclamo atómico de un intento. Devuelve true solo si ESTA llamada ganó el derecho a ejecutarlo.
// `requireDue` lo usa el runner para respetar la programación; el POST /evaluate reclama sin él
// (primer intento, o reanudación inmediata de un trabajo interrumpido).
async function claimAttempt(prisma, sessionId, { now = () => Date.now(), env = process.env, requireDue = false } = {}) {
  const { maxAttempts, leaseMs } = limits(env);
  const at = now();
  const where = {
    id: sessionId,
    report: NO_REPORT,
    evalExhausted: false,
    evalAttempts: { lt: maxAttempts },
    OR: [{ evalLeaseUntil: null }, { evalLeaseUntil: { lt: new Date(at) } }],
  };
  if (requireDue) where.evalNextAt = { lte: new Date(at) };
  const leaseUntil = new Date(at + leaseMs);
  const claimed = await prisma.session.updateMany({
    where,
    data: {
      status: 'EVALUATING',
      evalAttempts: { increment: 1 },
      evalLeaseUntil: leaseUntil,
      evalNextAt: null,
      evalFinishedAt: null,
      evalLastError: null,
    },
  });
  // Devuelve el lease que escribió ESTE intento: con él se publica de forma condicional, de modo
  // que un intento que perdió el lease no puede publicar ni sobrescribir a otro más reciente.
  return claimed?.count === 1 ? { leaseUntil: leaseUntil.getTime() } : null;
}

// Marca el intento como fallido y PROGRAMA el siguiente (o agota la sesión).
// Nunca pisa un informe válido ni publica nada. `metrics` es opcional: si llega, se conserva el
// bloque `evaluation` con el mismo formato que consume la API.
async function markAttemptFailed(prisma, sessionId, {
  error = 'ERROR',
  kind = 'transient',
  now = () => Date.now(),
  env = process.env,
  metrics = null,
  leaseUntil = null,
} = {}) {
  const at = now();
  const current = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { report: true, evalAttempts: true, metrics: true },
  });
  if (!current || current.report) return { skipped: true };

  const attempts = Number(current.evalAttempts) || 0;
  const delay = nextDelayFor(attempts, env);
  // Un fallo PERMANENTE (credenciales, configuración, modelo inexistente/retirado, datos no
  // evaluables) no se reintenta solo: el mismo error se repetiría en cada intento. Se registra para
  // revisión técnica y se deja de programar. La sesión queda en FAILED (no 'EXHAUSTED', que en la
  // interfaz significa «puede llegar más adelante»): el vocero ve el mensaje de revisión y el
  // operador puede relanzarla a mano cuando corrija la causa.
  const permanent = kind === 'permanent';
  const exhausted = delay == null || permanent;
  const previous = current.metrics?.evaluation || {};
  const base = metrics || current.metrics || {};

  // Escritura CONDICIONAL: nunca pisa un informe válido ni el estado de un intento más reciente
  // (si el lease ya no es el de este intento, otro intento tomó el relevo y este se descarta).
  const updated = await prisma.session.updateMany({
    where: {
      id: sessionId,
      report: NO_REPORT,
      ...(leaseUntil != null ? { evalLeaseUntil: new Date(leaseUntil) } : {}),
    },
    data: {
      // 'EXHAUSTED' es distinguible de COMPLETED y de un informe disponible. Un fallo permanente se
      // queda en FAILED: no hay más intentos automáticos, pero tampoco es «puede llegar solo».
      status: exhausted && !permanent ? 'EXHAUSTED' : 'FAILED',
      evalExhausted: exhausted && !permanent,
      evalLastError: String(error || 'ERROR').slice(0, 60),
      evalFinishedAt: new Date(at),
      evalNextAt: exhausted ? null : new Date(at + delay),
      evalLeaseUntil: null,
      metrics: {
        ...base,
        evaluation: {
          ...previous,
          state: 'failed',
          stage: previous.stage || 'ai',
          error: String(error || 'ERROR').slice(0, 60),
          // Clasificación del fallo: 'transient' se reintenta; 'permanent' requiere revisión técnica.
          errorKind: kind === 'permanent' ? 'permanent' : 'transient',
          finishedAt: at,
          attempts,
          nextAttemptAt: exhausted ? null : at + delay,
          exhausted,
        },
      },
    },
  });
  if (updated?.count !== 1) return { skipped: true, superseded: true };
  return { attempts, exhausted, nextAt: exhausted ? null : at + delay, delay, kind };
}

// El intento terminó bien: se limpia cualquier reintento pendiente (no puede quedar programado
// nada que vuelva a evaluar una sesión ya publicada).
async function clearRetryState(prisma, sessionId, { now = () => Date.now() } = {}) {
  return prisma.session.updateMany({
    where: { id: sessionId },
    data: { evalNextAt: null, evalLeaseUntil: null, evalLastError: null, evalFinishedAt: new Date(now()), evalExhausted: false },
  });
}

// Sesiones cuyo reintento ya venció (el runner las reclama con `requireDue`).
async function dueSessions(prisma, { now = () => Date.now(), limit = 5 } = {}) {
  return prisma.session.findMany({
    where: { report: NO_REPORT, evalExhausted: false, evalNextAt: { lte: new Date(now()) } },
    orderBy: { evalNextAt: 'asc' },
    take: limit,
    select: { id: true, evalAttempts: true, evalNextAt: true, evalLastError: true },
  });
}

// Sesiones que quedaron en EVALUATING con el lease vencido: el proceso murió a mitad del intento.
// Se reanudan de inmediato (el intento ya se contó al reclamarlo).
async function interruptedSessions(prisma, { now = () => Date.now(), limit = 5 } = {}) {
  return prisma.session.findMany({
    where: {
      report: NO_REPORT,
      evalExhausted: false,
      status: 'EVALUATING',
      OR: [{ evalLeaseUntil: null }, { evalLeaseUntil: { lt: new Date(now()) } }],
    },
    orderBy: { evalFinishedAt: 'asc' },
    take: limit,
    select: { id: true, evalAttempts: true },
  });
}

module.exports = {
  limits,
  evalCeilingMs,
  nextDelayFor,
  retryState,
  claimAttempt,
  markAttemptFailed,
  clearRetryState,
  NO_REPORT,
  dueSessions,
  interruptedSessions,
  DEFAULT_RETRY_MS,
  DEFAULT_BATCH_PAUSE_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_LEASE_MS,
  DEFAULT_AUDIO_BUDGET_MS,
  DEFAULT_TRANSPORT_CEILING_MS,
  DEFAULT_LEASE_MARGIN_MS,
};

