// Rutas del resultado de las prácticas: evaluación con IA, informe e historial.
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../auth');
const { EvaluationResponseError, evaluateSession } = require('../ai/evaluator');
const { EvaluationInputError, applySpeechEvidence, normalizeEvaluateInput } = require('../lib/evaluationInput');
const { computeSpeechEvidence } = require('../lib/speechEvidence');
const { transcribeFile } = require('../lib/whisperClient');
const { transcribeAnswers } = require('../lib/nvidiaTranscribe');
const { enginesForEnv } = require('../lib/asrChain');
const { auditRowsFor, persistAudit, reusableTranscripts } = require('../lib/transcriptionAudit');
const { retryState, claimAttempt, markAttemptFailed, clearRetryState } = require('../lib/evaluationRetry');
const { classifyEvaluationError } = require('../lib/evaluationErrors');
const { createEvaluationQueue } = require('../lib/evaluationQueue');
const { saveStreamToFile } = require('../lib/uploadGuard');
const { MEDIA_TYPES, UPLOAD_ERRORS } = require('../lib/mediaUpload');
const { removeVideoFiles } = require('../lib/anonymize');
const { effectiveElapsedMs, reconcilePauses } = require('../lib/retentionPause');
const { effectivePlan } = require('../lib/retentionPlan');
const { syncDuePlans } = require('../lib/retentionSchedule');
const { registerJob, runJob } = require('../lib/runtimeStatus');
const { resolveSessionOwner, resolvePaging } = require('../lib/sessionScope');
const { resolveLanguage, normalizeLanguage, asrLanguage, sessionLanguage } = require('../lib/language');

const RETENTION_JOB = 'retention';
const RETENTION_EVERY_MS = 6 * 60 * 60 * 1000;

// Mismo directorio donde se guardan las grabaciones: video (<id>.webm) y audio (<id>.audio.webm)
const SESSIONS_DIR = path.join(__dirname, '..', 'uploads', 'sessions');
const videoPath = (id) => path.join(SESSIONS_DIR, `${id}.webm`);
const audioPath = (id) => path.join(SESSIONS_DIR, `${id}.audio.webm`);

// Transcripción por respuesta (entrevistador): tope de audio y presupuesto de espera.
// El tope de bytes es el mismo que aplica la subida de audio de index.js (misma variable de entorno).
const MAX_LIVE_AUDIO_BYTES = (Number(process.env.EVAL_MAX_AUDIO_MB) || 10) * 1024 * 1024;
const LIVE_TRANSCRIBE_BUDGET_MS = (() => {
  const value = Number(process.env.INTERVIEW_ASR_BUDGET_MS);
  return Number.isFinite(value) && value > 0 ? value : 12000;
})();
const LIVE_WINDOW_MAX_MS = 15 * 60 * 1000; // una respuesta no puede durar más que esto
const MAX_TURN_INDEX = 200;

// Limpieza del reporte para retención (independiente de la anonimización):
// elimina el texto derivado de la respuesta del vocero y conserva la parte numérica/técnica.
// NO se anonimiza (no se sustituye por texto): los campos sensibles se borran.
// Se conserva todo lo demás: global, areas, weights, pattern, patternVersion, strictness,
// mensajesClave, lineasRojas (línea/cruzada), porPregunta (pregunta/puntaje), measured numérico, ai, generatedAt.
function cleanReportForRetention(report) {
  if (!report || typeof report !== 'object') return { report, changed: false };
  let changed = false;
  const out = { ...report };

  // Texto derivado de la intervención del vocero
  for (const key of ['resumen', 'cita', 'fortalezas', 'mejoras']) {
    if (key in out) {
      delete out[key];
      changed = true;
    }
  }

  if (Array.isArray(out.porPregunta)) {
    out.porPregunta = out.porPregunta.map((p) => {
      if (!p || typeof p !== 'object' || !('comentario' in p)) return p;
      const { comentario, ...rest } = p; // conserva pregunta (nº) y puntaje
      changed = true;
      return rest;
    });
  }

  if (Array.isArray(out.lineasRojas)) {
    out.lineasRojas = out.lineasRojas.map((l) => {
      if (!l || typeof l !== 'object' || !('evidencia' in l)) return l;
      const { evidencia, ...rest } = l; // conserva linea (del escenario) y cruzada
      changed = true;
      return rest;
    });
  }

  if (out.measured && typeof out.measured === 'object' && out.measured.voice && typeof out.measured.voice === 'object' && 'fillerWords' in out.measured.voice) {
    const { fillerWords, ...voiceRest } = out.measured.voice; // conserva el resto de métricas numéricas
    out.measured = { ...out.measured, voice: voiceRest };
    changed = true;
  }

  // Análisis de sensibilidad: se conservan los tiempos; el comentario sobre la risa es texto derivado del vocero
  if (out.sensibilidad?.risa && typeof out.sensibilidad.risa === 'object' && 'comentario' in out.sensibilidad.risa) {
    const { comentario, ...risaRest } = out.sensibilidad.risa;
    out.sensibilidad = { ...out.sensibilidad, risa: risaRest };
    changed = true;
  }

  return { report: changed ? out : report, changed };
}

// Retención automática por tenant — SOLO por VENCIMIENTO de retentionDays.
// FULL y METRICS se comportan igual:
//  - vigente → se conserva TODO (video, transcripción, report, métricas, score, review).
//  - vencida → se elimina el .webm, la transcripción (null) y el texto sensible del report;
//              se conservan la sesión, el score, las métricas y la parte cuantitativa del report.
// El score, la revisión humana, el report o una evaluación manual NO adelantan la retención.
//
// Opciones:
//  - tenantId: aplica la retención solo a esa organización (ejecución manual por tenant).
//  - dryRun: no borra nada; solo cuenta qué sesiones están vencidas (para el panel del sistema).
// Devuelve además el detalle por organización en `byTenant`.
async function applyRetention(prisma, { tenantId = null, dryRun = false } = {}) {
  const now = Date.now();
  // Un cambio de plan PROGRAMADO se materializa antes de purgar (estado persistente, sobrevive
  // reinicios). En simulación no se escribe nada: el plan efectivo se calcula igualmente en memoria.
  if (!dryRun) await syncDuePlans(prisma, { now });

  const [sessions, users] = await Promise.all([
    prisma.session.findMany({
      where: tenantId ? { tenantId } : {},
      select: {
        id: true,
        createdAt: true,
        userId: true,
        tenantId: true,
        tenant: {
          select: {
            retentionDays: true,
            retentionMode: true,
            retentionModePending: true,
            retentionDaysPending: true,
            retentionEffectiveAt: true,
            status: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      where: tenantId ? { tenantId } : {},
      select: { id: true, retentionPauses: { select: { startedAt: true, endedAt: true } } },
    }),
  ]);
  const byTenant = {};
  const tally = (id) => (byTenant[id] ||= { sessions: 0, expired: 0, videos: 0, videosRemoved: 0, audios: 0, audiosRemoved: 0 });
  const pausesByUser = new Map(users.map((u) => [u.id, u.retentionPauses]));

  const isVideoFile = (f) => f.endsWith('.webm') && !f.endsWith('.audio.webm');
  const isAudioFile = (f) => f.endsWith('.audio.webm');
  const videoFiles = new Set(
    fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR).filter(isVideoFile) : [],
  );
  const audioFiles = new Set(
    fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR).filter(isAudioFile) : [],
  );

  let videosRemoved = 0;
  let audiosRemoved = 0;
  const eligibleIds = [];

  for (const s of sessions) {
    const stats = tally(s.tenantId);
    const fileName = `${s.id}.webm`;
    const audioName = `${s.id}.audio.webm`;
    stats.sessions += 1;
    if (videoFiles.has(fileName)) stats.videos += 1;
    if (audioFiles.has(audioName)) stats.audios += 1;
    if (s.tenant?.status === 'DELETING') continue; // el tenant se está eliminando: lo maneja el job de eliminación
    // Retención pausada (suspendido ahora): su reloj está detenido → NO se purga.
    const intervals = pausesByUser.get(s.userId) || [];
    if (intervals.some((iv) => !iv.endedAt)) continue;

    // Plan EFECTIVO del tenant: si un cambio programado ya cumplió su fecha, manda ese cambio
    // (y `syncDuePlans` lo habrá persistido al inicio de la pasada).
    const days = effectivePlan(s.tenant || {}, now).days;
    // Vencimiento por TIEMPO EFECTIVO: excluye los periodos con la retención pausada
    // (suspensiones del vocero y/o de su tenant).
    const elapsed = effectiveElapsedMs(s.createdAt, intervals, now);
    const expired = elapsed > days * 24 * 60 * 60 * 1000;
    if (!expired) continue; // Solo por vencimiento: ni score, ni review, ni report adelantan la retención.
    stats.expired += 1;
    if (dryRun) continue;

    // Video y audio: eliminación física solo si existen (puede no haber grabación)
    if (videoFiles.has(fileName)) {
      fs.rmSync(videoPath(s.id), { force: true });
      videoFiles.delete(fileName);
      videosRemoved += 1;
      stats.videos -= 1;
      stats.videosRemoved += 1;
    }
    // La pista de audio se borra con la misma política: no sobrevive a la grabación.
    if (audioFiles.has(audioName)) {
      fs.rmSync(audioPath(s.id), { force: true });
      audioFiles.delete(audioName);
      audiosRemoved += 1;
      stats.audios -= 1;
      stats.audiosRemoved += 1;
    }
    eligibleIds.push(s.id);
  }
  if (dryRun) return { dryRun: true, byTenant };

  // Transcripción: se pone a null con la misma política. Es seguro si ya es null y no toca otras columnas.
  let transcriptsCleared = 0;
  if (eligibleIds.length) {
    const result = await prisma.session.updateMany({
      where: { id: { in: eligibleIds }, transcript: { not: null } },
      data: { transcript: null },
    });
    transcriptsCleared = result.count;
    // La auditoría no conserva transcripciones más allá de la política existente.
    await prisma.transcriptionAudit.updateMany({
      where: { sessionId: { in: eligibleIds } },
      data: { transcript: null },
    });
  }

  // Reporte: se elimina el texto derivado del vocero y se conserva la parte numérica/técnica.
  // updateMany no sirve para JSON, así que se procesa cada reporte elegible y se guarda solo si cambió (idempotente).
  let reportsCleaned = 0;
  if (eligibleIds.length) {
    const rows = await prisma.session.findMany({ where: { id: { in: eligibleIds } }, select: { id: true, report: true } });
    for (const row of rows) {
      const { report, changed } = cleanReportForRetention(row.report);
      if (changed) {
        await prisma.session.update({ where: { id: row.id }, data: { report } });
        reportsCleaned += 1;
      }
    }
  }

  if (videosRemoved) console.log(`[Retención] ${videosRemoved} grabación(es) eliminada(s) según la política de retención`);
  if (audiosRemoved) console.log(`[Retención] ${audiosRemoved} pista(s) de audio eliminada(s) según la política de retención`);
  if (transcriptsCleared) console.log(`[Retención] ${transcriptsCleared} transcripción(es) eliminada(s) según la política de retención`);
  if (reportsCleaned) console.log(`[Retención] ${reportsCleaned} reporte(s) limpiado(s) según la política de retención`);
  return { videosRemoved, audiosRemoved, transcriptsCleared, reportsCleaned, byTenant };
}

const fail = (res, code, mensaje) => res.status(code).json({ status: 'error', mensaje });

// ¿Puede este usuario ver la sesión?
function canView(user, apiRole, session) {
  if (session.userId === user.id) return true;
  if (apiRole === 'admin') return session.tenantId === user.tenantId;
  return apiRole === 'master' || apiRole === 'system';
}

const summary = (s) => ({
  id: s.id,
  status: s.status,
  createdAt: s.createdAt,
  completedAt: s.completedAt,
  score: s.score,
  theme: s.theme ? { id: s.theme.id, title: s.theme.title, category: s.theme.category } : null,
  user: s.user ? { id: s.user.id, name: s.user.name } : null,
  areas: s.report?.areas?.map(({ key, label, score }) => ({ key, label, score })) || [],
  // Estado del informe, sin inferencias: el frontend no debe deducirlo de la ausencia de `score`.
  hasReport: Boolean(s.report),
});

module.exports = function registerSessionRoutes(app, prisma, deps = {}) {
  // Inyección para pruebas: la transcripción real es la cadena de respaldo oficial
  // (Whisper Large v3 → Canary 1B → Whisper Small local). En producción `deps` va vacío y el
  // comportamiento es idéntico al anterior.
  const transcribe = deps.transcribe || transcribeAnswers;
  // Ruta del audio de la sesión: inyectable para probar la transcripción por respuesta sin tocar
  // el directorio real de grabaciones.
  const audioPathFor = deps.audioPathFor || audioPath;
  const auth = (...roles) => requireAuth(prisma, roles);

  // Retención: al iniciar (reconciliando las pausas primero) y cada 6 horas
  registerJob(RETENTION_JOB, { label: 'Retención de datos (borrado por vencimiento)', everyMs: RETENTION_EVERY_MS });
  const runPurge = () => runJob(RETENTION_JOB, () => applyRetention(prisma)).catch((e) => console.warn('[Retención] error:', e.message));
  setTimeout(async () => {
    try { await reconcilePauses(prisma); } catch (e) { console.warn('[Retención] error al reconciliar pausas:', e.message); }
    runPurge();
  }, 5000);
  setInterval(runPurge, RETENTION_EVERY_MS).unref();

  // ------------------------------------------------ Evaluación en segundo plano
  //
  // Estados persistentes en `Session.status` (columna String, sin migración):
  //   CREATED    -> todavía no se evaluó (o se subió el video/audio)
  //   EVALUATING -> hay un trabajo en curso (el estado fino vive en metrics.evaluation)
  //   FAILED     -> el trabajo terminó mal; se puede reintentar
  //   COMPLETED  -> existe informe guardado (nunca se escribe antes de tenerlo)
  //
  // `jobs` evita lanzar dos trabajos en el MISMO proceso; el CAS sobre `status` evita que
  // dos peticiones simultáneas reclamen la sesión.
  const jobs = new Map();
  const STALE_MS = Number(process.env.EVAL_STALE_MS) || 15 * 60 * 1000;
  const WHISPER_ON = process.env.EVAL_WHISPER_ENABLED !== 'false';

  // Estado que se devuelve al cliente (GET /api/sessions/:id y POST /evaluate).
  function evaluationState(session) {
    const meta = session?.metrics?.evaluation || null;
    const retry = retryState(session);
    if (session?.report) {
      return { state: 'done', finishedAt: meta?.finishedAt ?? session.completedAt ?? null };
    }
    // Reintentos automáticos: se informa ANTES que `failed` para que el cliente siga esperando.
    // Nunca se exponen códigos técnicos al vocero: solo el estado y el momento del próximo intento.
    if (retry.exhausted) {
      return { state: 'exhausted', attempts: retry.attempts, maxAttempts: retry.maxAttempts, nextAttemptAt: null, finishedAt: retry.finishedAt };
    }
    if (session?.status === 'EVALUATING') {
      const age = Number.isFinite(meta?.startedAt) ? Date.now() - meta.startedAt : null;
      const leased = retry.leaseUntil != null && retry.leaseUntil > Date.now();
      // Hay trabajo vivo si este proceso lo tiene en marcha o si el lease sigue vigente (otra
      // instancia puede estar ejecutándolo). Si el registro es viejo y no hay lease, se reprograma.
      if (!jobs.has(session.id) && !leased && (age == null || age > STALE_MS)) {
        return { state: 'retrying', reason: 'INTERRUPTED', attempts: retry.attempts, maxAttempts: retry.maxAttempts, nextAttemptAt: retry.nextAt, stage: meta?.stage ?? null, startedAt: meta?.startedAt ?? null };
      }
      return { state: 'processing', stage: meta?.stage ?? null, startedAt: meta?.startedAt ?? null, attempts: retry.attempts, maxAttempts: retry.maxAttempts };
    }
    if (retry.nextAt) {
      return { state: 'retrying', attempts: retry.attempts, maxAttempts: retry.maxAttempts, nextAttemptAt: retry.nextAt, stage: meta?.stage ?? null, finishedAt: retry.finishedAt, errorKind: meta?.errorKind ?? null };
    }
    if (session?.status === 'FAILED') {
      return { state: 'failed', reason: meta?.error || 'ERROR', errorKind: meta?.errorKind ?? null, stage: meta?.stage ?? null, finishedAt: meta?.finishedAt ?? null };
    }
    return { state: 'idle' };
  }

  // Idioma efectivo del vocero dueño de la sesión (preferencia propia o el de su organización).
  // Se resuelve desde la base porque los reintentos en segundo plano no tienen al navegador.
  async function languageFor(session) {
    // El idioma con el que se inició la sesión manda (queda congelado). Solo en las sesiones
    // históricas (sin idioma guardado) se resuelve con el vocero y su organización, sin tocar el
    // registro. Así un informe antiguo conserva el idioma con el que se generó.
    const frozen = normalizeLanguage(session?.language);
    if (frozen) return frozen;
    const owner = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { language: true, tenant: { select: { defaultLanguage: true } } },
    });
    return resolveLanguage(owner, owner?.tenant);
  }

  // Transcripción del audio de la sesión + cálculo de la evidencia. NUNCA lanza: cualquier
  // problema se traduce en `unverified` con motivo, y la evaluación sigue sin el criterio.
  async function verifySpeech(sessionId, input, lang = 'es') {
    const disabled = {
      status: 'unverified',
      reason: 'DISABLED',
      wpm: null,
      speechMs: 0,
      words: 0,
      turns: [],
      coverage: { answeredTurns: 0, verifiedTurns: 0, fraction: 0, wordCoverage: 0, audioDurationSeconds: null },
      droppedSegments: 0,
      model: null,
    };
    if (!WHISPER_ON) return disabled;

    // El motor local solo se usa si ADMITE el idioma de la sesión: nunca se transcribe en otro
    // idioma. Si no lo admite, el criterio queda sin verificar (motivo explícito) y la evaluación
    // continúa sin él, en lugar de aportar una transcripción en un idioma equivocado.
    const asr = asrLanguage(lang, 'iso');
    if (!asr) return { ...disabled, reason: 'LANGUAGE_UNSUPPORTED' };

    const result = await transcribeFile(audioPath(sessionId), { language: asr });
    if (!result.ok) {
      return { ...disabled, reason: result.code, model: process.env.EVAL_WHISPER_MODEL || 'small' };
    }
    const evidence = computeSpeechEvidence({
      turns: input.transcript,
      segments: result.segments,
      durationSeconds: result.durationSeconds,
      model: result.modelKey,
    });
    // Solo números: el texto transcrito no se persiste ni se audita.
    return { ...evidence, processingMs: result.processingMs ?? null };
  }

  // Patrón aplicable, por prioridad: el excepcional del vocero, el del escenario o el activo
  async function patternFor(themeId, userId) {
    const byVocero = await prisma.voceroPatternOverride.findUnique({ where: { userId }, include: { pattern: true } });
    if (byVocero) return { pattern: byVocero.pattern, source: 'vocero' };
    const override = await prisma.patternOverride.findUnique({ where: { themeId }, include: { pattern: true } });
    if (override) return { pattern: override.pattern, source: 'scenario' };
    const active = await prisma.masterPattern.findFirst({ where: { status: 'ACTIVE' }, orderBy: { version: 'desc' } });
    return { pattern: active, source: 'active' };
  }

  // Evalúa y guarda. `input` viene YA normalizado y validado por normalizeEvaluateInput:
  // el cliente no puede definir los números que puntúan.
  async function runEvaluation(session, input, { leaseUntil = null, lang = 'es' } = {}) {
    const { pattern, source } = await patternFor(session.themeId, session.userId);
    const report = await evaluateSession({
      theme: session.theme,
      transcript: input.transcript,
      metrics: input.metrics,
      pattern,
      patternSource: source,
      // Idioma efectivo del vocero: el informe y su retroalimentación se generan en ese idioma.
      lang,
      // Procedencia, advertencias y evidencia del audio: quedan en report.audit.
      inputAudit: {
        sources: input.sources,
        sourceNotes: input.sourceNotes,
        warnings: input.warnings,
        coverage: input.coverage,
        speech: input.speech ?? null,
      },
    });
    // El estado de la evaluación se cierra AQUÍ, en la misma escritura que el informe:
    // nunca se marca COMPLETED sin report.
    const evaluation = {
      ...(input.metrics.evaluation || {}),
      state: 'done',
      stage: 'done',
      finishedAt: Date.now(),
    };
    // Publicación ATÓMICA y CONDICIONAL: informe, puntaje y estado se escriben en UNA sola
    // sentencia, y solo si este intento sigue siendo el dueño del lease. Así un intento antiguo
    // (o una ejecución duplicada) no puede publicar ni sobrescribir el informe de otro.
    const published = await prisma.session.updateMany({
      where: {
        id: session.id,
        ...(leaseUntil != null ? { evalLeaseUntil: new Date(leaseUntil) } : {}),
      },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        transcript: input.transcript, // normalizado: palabras/muletillas recalculadas
        metrics: { ...input.metrics, evaluation },
        report,
        score: report.global, // el global del informe ya validado
        // Un informe válido invalida cualquier reintento pendiente: la sesión ya está publicada.
        evalNextAt: null,
        evalLeaseUntil: null,
        evalLastError: null,
        evalExhausted: false,
        evalFinishedAt: new Date(),
      },
    });
    if (published?.count !== 1) {
      console.warn(
        '[Evaluación] intento descartado: el lease ya no pertenece a este intento',
        String(session.id).slice(0, 8),
      );
      return { ok: false, superseded: true };
    }
    return { ok: true };
  }

  // Registra el fallo del intento, PROGRAMA el siguiente (3 min, o 15 min cada 5 intentos) o marca
  // la sesión como agotada tras 50 intentos. Nunca pisa un informe válido y nunca publica nada.
  // `error.reasons` (motivos por modelo) permite clasificar el fallo como temporal o permanente.
  async function failEvaluation(sessionId, metrics, error, { leaseUntil = null } = {}) {
    try {
      const classification = classifyEvaluationError({ code: error?.code, reasons: error?.reasons });
      const result = await markAttemptFailed(prisma, sessionId, {
        error: error?.code || 'ERROR',
        kind: classification.kind,
        metrics,
        leaseUntil,
      });
      if (result?.skipped) return;
      // Registro técnico mínimo: id abreviado, número de intento y próximo momento. Sin contenido.
      console.log(
        '[Evaluación] intento fallido',
        String(sessionId).slice(0, 8),
        `intento ${result.attempts}`,
        classification.kind === 'permanent' ? 'ERROR PERMANENTE (requiere revisión técnica)' : 'fallo temporal',
        classification.kind === 'permanent'
          ? 'sin reintentos automáticos'
          : result.exhausted
            ? 'AGOTADA (intervención técnica)'
            : `próximo en ${Math.round(result.delay / 60000)} min`,
      );
    } catch (failure) {
      console.error('Error registrando el fallo de la evaluación:', failure.message);
    }
  }

  // Lanza el trabajo en segundo plano. Devuelve enseguida: el cliente consulta el estado.
  // `skipSpeech`: reutiliza la evidencia de audio ya persistida (reintentos tras reinicio).
  // `reason`: queda en `metrics.evaluation.reason` para saber si fue el primer intento o un reintento.
  // `leaseUntil`: lease que este intento escribió al reclamar la sesión. Se usa para publicar y para
  // registrar el fallo de forma CONDICIONAL: un intento que perdió el lease no puede sobrescribir
  // el informe ni el estado de otro intento más reciente.
  function startJob(session, input, { skipSpeech = false, reason = 'evaluate', leaseUntil = null } = {}) {
    const promise = (async () => {
      try {
        // Idioma efectivo del vocero: gobierna la transcripción y el informe.
        const lang = await languageFor(session);
        if (!skipSpeech) {
          const evidence = await verifySpeech(session.id, input, lang);
          applySpeechEvidence(input, evidence);
        }

        // El tiempo que tarde la verificación de audio NO recorta el tiempo de la evaluación: cada
        // etapa tiene su propio límite técnico (audio ≤120 s y, para el proveedor, solo el límite que
        // el operador fije en `AI_EVAL_TIMEOUT_MS`; por defecto NO hay ninguno).
        input.metrics.evaluation = { ...(input.metrics.evaluation || {}), stage: 'ai', reason };
        await prisma.session.update({
          where: { id: session.id },
          data: { metrics: input.metrics, transcript: input.transcript },
        });

        await runEvaluation(session, input, { leaseUntil, lang });
        try {
          runPurge();
        } catch {
          /* la retención no debe afectar al resultado */
        }
      } catch (error) {
        console.error('Error evaluando sesión:', error.message);
        await failEvaluation(session.id, input.metrics, error, { leaseUntil });
      }
    })();
    jobs.set(session.id, promise);
    promise.finally(() => jobs.delete(session.id));
    return promise;
  }

  // Ejecuta un intento reclamado usando SOLO lo persistido: sobrevive a reinicios y no necesita al
  // navegador. El intento ya quedó contado en `evalAttempts` al reclamarlo.
  async function runPersistedAttempt(sessionId, { reason = 'retry', leaseUntil = null } = {}) {
    const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { theme: true } });
    if (!session) return { ok: false, skipped: 'sin_sesion' };
    if (session.report) return { ok: false, skipped: 'con_informe' };
    let input;
    try {
      input = normalizeEvaluateInput({ transcript: session.transcript, metrics: session.metrics });
    } catch (error) {
      // Sin entrevista evaluable no se puede reintentar: se cuenta el intento y se reprograma.
      await failEvaluation(sessionId, session.metrics, { code: error?.code || 'INVALID_INPUT' }, { leaseUntil });
      return { ok: false, code: 'INVALID_INPUT' };
    }
    input.metrics.evaluation = {
      ...(input.metrics.evaluation || {}),
      state: 'processing',
      stage: 'audio',
      startedAt: Date.now(),
      attempt: session.evalAttempts,
      reason,
    };
    // La evidencia de audio ya verificada se reutiliza: no se repite Whisper sin necesidad.
    const skipSpeech = Boolean(session.metrics?.speech && session.metrics.speech.status === 'verified');
    await startJob(session, input, { skipSpeech, reason, leaseUntil });
    return { ok: true, started: true };
  }

  // Runner de recuperación: reanuda trabajos interrumpidos y ejecuta los reintentos programados.
  // Deshabilitado por defecto (las pruebas no dejan temporizadores); `index.js` lo activa.
  const queueOptions = deps.evaluationQueue || {};
  const queue = createEvaluationQueue({
    prisma,
    runAttempt: (sessionId, meta) => runPersistedAttempt(sessionId, meta),
    ...queueOptions,
  });
  app.locals.evaluationQueue = queue;
  if (queueOptions.enabled) queue.start();

  // Analiza la entrevista (transcripción + métricas) EN SEGUNDO PLANO y guarda el informe.
  // Responde 202 con el estado; el cliente consulta GET /api/sessions/:id hasta 'done'.
  app.post('/api/sessions/:id/evaluate', auth('user'), async (req, res) => {
    try {
      const session = await prisma.session.findUnique({
        where: { id: req.params.id },
        include: { theme: true, user: true, tenant: { select: { status: true } } },
      });
      if (!session) return fail(res, 404, 'Sesión no encontrada.');
      if (session.userId !== req.user.id) return fail(res, 403, 'Esta sesión no te pertenece.');

      // Ya evaluada: se devuelve el informe guardado (histórico intacto, sin re-evaluar).
      if (session.report) {
        return res.json({
          status: 'ok',
          evaluation: evaluationState(session),
          session: { ...summary(session), report: session.report, transcript: session.transcript },
        });
      }

      // No se evalúa una sesión de una organización que se está borrando.
      if (session.tenant?.status === 'DELETING') {
        return fail(res, 409, 'La organización de esta sesión está en proceso de eliminación.');
      }

      // Transcripción del vocero: NVIDIA Whisper Large v3 sobre el audio de la sesión.
      // Web Speech API no participa. Si el servicio falla o no se puede asignar texto a
      // una respuesta, se devuelve un error controlado y NO se evalúa con texto inventado.
      let rawTranscript = req.body?.transcript;
      let transcriptionDiagnostics = [];
      // Cadena oficial de transcripción: Whisper Large v3 → Canary 1B → Whisper Small local.
      // `enginesForEnv()` centraliza el interruptor operativo `EVAL_NVIDIA_ASR_ENABLED` (misma
      // definición que usa la transcripción por respuesta del entrevistador).
      const lang = sessionLanguage(session, req.user, req.user.tenant);
      const engines = enginesForEnv({ language: lang });
      {
        const turns = Array.isArray(rawTranscript) ? rawTranscript : [];
        // REUTILIZACIÓN: las respuestas que el entrevistador ya transcribió (auditoría `ok`) NO
        // vuelven a pasar por ASR; solo se transcriben las ventanas que falten. Así no se procesa
        // dos veces el mismo audio y la evaluación funciona igual cuando no hay nada reutilizable.
        const reused = await reusableTranscripts(prisma, session.id);
        const pending = [];
        const pendingIndexes = [];
        turns.forEach((turn, index) => {
          if (reused.has(index)) return;
          pending.push(turn);
          pendingIndexes.push(index);
        });
        // Una petición por respuesta pendiente, recortando el audio con los tiempos registrados.
        const transcribed = pending.length
          ? await transcribe({ filePath: audioPath(session.id), turns: pending, engines })
          : { ok: true, answers: [], diagnostics: [] };
        // El diagnóstico vuelve indexado por la posición en `pending`: se reindexa al turno REAL.
        transcriptionDiagnostics = (transcribed.diagnostics || []).map((item, position) => ({
          ...item,
          index: pendingIndexes[position] ?? item.index,
        }));
        // Auditoría persistente por respuesta: se guarda también cuando falla, para poder
        // investigar la causa. Idempotente por (sesión, turno): una fila ya `ok` no se sobrescribe.
        const answersByIndex = [];
        pendingIndexes.forEach((index, position) => {
          answersByIndex[index] = transcribed.answers?.[position] ?? '';
        });
        await persistAudit(
          prisma,
          auditRowsFor({
            sessionId: session.id,
            diagnostics: transcriptionDiagnostics,
            answers: answersByIndex,
          }),
        );
        // Registro técnico mínimo: motor y milisegundos por respuesta. Nunca el texto.
        if (transcriptionDiagnostics.length || reused.size) {
          console.log(
            '[ASR]',
            session.id,
            `reutilizadas:${reused.size}`,
            transcriptionDiagnostics.map((item) => `${item.index}:${item.engine || item.code}(${item.totalMs ?? '-'}ms)`).join(' '),
          );
        }
        if (!transcribed.ok) {
          const unsupported = transcribed.code === 'LANGUAGE_UNSUPPORTED';
          const configuration = transcribed.code === 'NO_WINDOWS' || unsupported;
          return res.status(configuration ? 422 : 502).json({
            status: 'error',
            code: `TRANSCRIPTION_${transcribed.code}`,
            mensaje: unsupported
              ? 'Ningún motor de transcripción configurado admite el idioma de esta sesión. Avisa al administrador.'
              : configuration
                ? 'La sesión no tiene tiempos de respuesta utilizables; no se puede evaluar.'
                : 'No se pudo transcribir alguna respuesta con NVIDIA. La grabación se conserva; puedes reintentar el análisis.',
            transcription: transcriptionDiagnostics,
          });
        }
        rawTranscript = turns.map((turn, index) => ({
          ...turn,
          answer: reused.get(index) ?? answersByIndex[index] ?? '',
        }));
      }

      // Validación + normalización: lanza INVALID_INPUT (400) si no hay nada evaluable.
      // Recalcula palabras y muletillas en el servidor y deja constancia de la procedencia.
      const input = normalizeEvaluateInput({ transcript: rawTranscript, metrics: req.body?.metrics });

      // Trabajo ya en curso: se responde 202 sin duplicar la evaluación.
      const state = evaluationState(session);
      if (state.state === 'processing') {
        return res.status(202).json({ status: 'processing', evaluation: state });
      }
      // Sesión agotada: respuesta idempotente. No se consume nada y no se crea ningún trabajo.
      if (state.state === 'exhausted') {
        return res.status(202).json({ status: 'processing', evaluation: state });
      }
      if (session.report) {
        return fail(res, 409, 'Esta entrevista ya fue evaluada.');
      }
      // Con un reintento programado, una petición explícita del vocero lo adelanta (reintento
      // manual). Las peticiones repetidas siguen siendo idempotentes: el lease impide que dos
      // se ejecuten a la vez y solo la que gana el reclamo consume un intento.

      // Reclamo ATÓMICO del intento: contador persistente (`evalAttempts`) + lease, de modo que
      // dos peticiones (o dos instancias del backend) nunca ejecutan la misma sesión a la vez.
      const startedAt = Date.now();
      const claimed = await claimAttempt(prisma, session.id);
      if (!claimed) {
        // Otra petición/instancia ganó el reclamo (o la sesión ya no es evaluable): se informa.
        const current = await prisma.session.findUnique({ where: { id: session.id } });
        return res.status(202).json({ status: 'processing', evaluation: evaluationState(current || session) });
      }
      const attempts = (Number(session.evalAttempts) || 0) + 1;
      const meta = { state: 'processing', stage: 'audio', startedAt, attempt: attempts, nextAttemptAt: null };
      input.metrics.evaluation = meta;
      startJob(session, input, { reason: 'evaluate', leaseUntil: claimed.leaseUntil });
      return res.status(202).json({ status: 'processing', evaluation: meta, transcription: transcriptionDiagnostics });
    } catch (error) {
      // Solo se registra el mensaje: nunca datos del vocero, transcripciones ni claves.
      console.error('Error iniciando la evaluación:', error.message);
      // 400 entrada no evaluable · 502 respuesta de IA inválida o fallo · 503 sin clave.
      // En los tres casos NO se guarda ningún informe.
      const isInputError = error instanceof EvaluationInputError || error.code === 'INVALID_INPUT';
      const isResponseError = error instanceof EvaluationResponseError || error.code === 'INVALID_AI_RESPONSE';
      const status = isInputError ? 400 : error.code === 'NO_API_KEY' ? 503 : isResponseError ? 502 : 502;
      fail(res, status, error.message || 'No se pudo evaluar la sesión.');
    }
  });

  // Transcripción de UNA respuesta para que el entrevistador conozca su contenido ANTES de decidir
  // la siguiente intervención (repregunta o pregunta principal). Reutiliza la MISMA cadena ASR que
  // la evaluación (mismos motores y prioridad) y deja la auditoría del turno.
  //
  //   POST /api/sessions/:id/answer-transcript?startMs=..&endMs=..&turnIndex=..
  //   Content-Type: audio/webm   (audio ACUMULADO de la sesión: se guarda en <id>.audio.webm)
  //   → 200 { status:'ok', text, engine, ms, code }   (`text:''` + `code` si no se pudo transcribir)
  //
  // No cambia el estado de la sesión: solo el archivo de audio y la auditoría del turno.
  app.post('/api/sessions/:id/answer-transcript', auth('user'), async (req, res) => {
    try {
      const session = await prisma.session.findUnique({
        where: { id: req.params.id },
        include: { tenant: { select: { status: true } } },
      });
      if (!session) return fail(res, 404, 'Sesión no encontrada.');
      if (session.userId !== req.user.id) return fail(res, 403, 'Esta sesión no te pertenece.');
      if (session.report) return fail(res, 409, 'La sesión ya tiene un informe: su grabación no se puede sustituir.');
      if (session.tenant?.status === 'DELETING') {
        return fail(res, 409, 'La organización de esta sesión está en proceso de eliminación.');
      }

      const startMs = Math.round(Number(req.query?.startMs));
      const endMs = Math.round(Number(req.query?.endMs));
      const turnIndex = Math.round(Number(req.query?.turnIndex));
      if (
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        startMs < 0 ||
        endMs <= startMs ||
        endMs - startMs > LIVE_WINDOW_MAX_MS
      ) {
        return fail(res, 400, 'La ventana de la respuesta no es válida.');
      }
      if (!Number.isFinite(turnIndex) || turnIndex < 0 || turnIndex > MAX_TURN_INDEX) {
        return fail(res, 400, 'El turno indicado no es válido.');
      }

      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!MEDIA_TYPES.has(type)) return fail(res, 415, 'Formato de archivo no admitido.');

      try {
        // Sobrescribe el audio acumulado de la sesión (escritura atómica en `.part` + validación EBML).
        await saveStreamToFile(req, audioPathFor(session.id), { maxBytes: MAX_LIVE_AUDIO_BYTES });
      } catch (error) {
        const [status, mensaje] = UPLOAD_ERRORS[error.code] || [500, 'No se pudo guardar el audio de la respuesta.'];
        if (status === 500) console.error('Error guardando el audio de una respuesta:', error.message);
        return fail(res, status, mensaje);
      }

      // Una sola ventana (la respuesta actual) con presupuesto acotado: nunca bloquea indefinidamente.
      const lang = sessionLanguage(session, req.user, req.user.tenant);
      const transcribed = await transcribe({
        filePath: audioPath(session.id),
        turns: [{ startMs, endMs }],
        language: lang,
        engines: enginesForEnv({ language: lang }),
        budgetMs: LIVE_TRANSCRIBE_BUDGET_MS,
      });

      const text = String(transcribed?.answers?.[0] ?? '').trim();
      // La auditoría reutiliza el mecanismo existente: se reindexa el diagnóstico al turno REAL.
      const diagnostics = (transcribed?.diagnostics?.length
        ? transcribed.diagnostics
        : [{ index: 0, status: 'failed', engine: null, code: transcribed?.code || 'NO_TRANSCRIPT', attempts: [], totalMs: null }]
      ).map((item) => ({ ...item, index: turnIndex }));
      const answers = [];
      answers[turnIndex] = text;
      await persistAudit(prisma, auditRowsFor({ sessionId: session.id, diagnostics, answers }));

      const diagnostic = diagnostics[0];
      return res.json({
        status: 'ok',
        text,
        engine: diagnostic?.engine || null,
        ms: Number.isFinite(diagnostic?.totalMs) ? diagnostic.totalMs : null,
        code: text ? null : diagnostic?.code || 'NO_TRANSCRIPT',
      });
    } catch (error) {
      console.error('Error transcribiendo una respuesta:', error.message);
      return fail(res, 502, 'No se pudo transcribir la respuesta.');
    }
  });

  // Auditoría técnica de transcripción (solo lectura, mismos permisos que la sesión).
  app.get('/api/sessions/:id/transcription-audit', auth(), async (req, res) => {
    try {
      const session = await prisma.session.findUnique({ where: { id: req.params.id } });
      if (!session) return fail(res, 404, 'Sesión no encontrada.');
      if (!canView(req.user, req.apiRole, session)) return fail(res, 403, 'No puedes ver esta sesión.');

      const audits = await prisma.transcriptionAudit.findMany({
        where: { sessionId: session.id },
        orderBy: { turnIndex: 'asc' },
        select: {
          turnIndex: true,
          status: true,
          engine: true,
          transcript: true,
          totalMs: true,
          reason: true,
          attempts: true,
          createdAt: true,
        },
      });
      return res.json({ status: 'ok', sessionId: session.id, audits });
    } catch (error) {
      console.error('Error obteniendo auditoría de transcripción:', error.message);
      return fail(res, 500, 'No se pudo obtener la auditoría.');
    }
  });

  // Informe de una sesión
  app.get('/api/sessions/:id', auth(), async (req, res) => {
    try {
      const session = await prisma.session.findUnique({ where: { id: req.params.id }, include: { theme: true, user: true } });
      if (!session) return fail(res, 404, 'Sesión no encontrada.');
      if (!canView(req.user, req.apiRole, session)) return fail(res, 403, 'No puedes ver esta sesión.');

      res.json({
        status: 'ok',
        evaluation: evaluationState(session),
        session: { ...summary(session), report: session.report, transcript: session.transcript },
      });
    } catch (error) {
      console.error('Error obteniendo sesión:', error);
      fail(res, 500, 'No se pudo obtener la sesión.');
    }
  });

  // ------------------------------------------------ Video de la sesión

  // <video src="...?token="> no puede enviar encabezados: el token va en la URL
  app.get('/api/sessions/:id/video', auth(), async (req, res) => {
    try {
      const session = await prisma.session.findUnique({ where: { id: req.params.id } });
      if (!session) return fail(res, 404, 'Sesión no encontrada.');
      if (!canView(req.user, req.apiRole, session)) return fail(res, 403, 'No puedes ver esta grabación.');
      const file = videoPath(session.id);
      if (!fs.existsSync(file)) return fail(res, 404, 'La grabación no está disponible (no se guardó o expiró su plazo de retención).');
      res.sendFile(file);
    } catch (error) {
      console.error('Error enviando video:', error);
      fail(res, 500, 'No se pudo obtener la grabación.');
    }
  });

  // ------------------------------------------ Prácticas (admin y staff)

  // ADMIN: prácticas de los voceros de su organización. MASTER/SYSTEM: todas.
  app.get('/api/practices', auth('admin', 'master', 'system'), async (req, res) => {
    try {
      const where = { score: { not: null } };
      if (req.apiRole === 'admin') where.tenantId = req.user.tenantId;
      if (req.query.userId) where.userId = req.query.userId;
      if (req.query.themeId) where.themeId = req.query.themeId;

      const sessions = await prisma.session.findMany({
        where,
        orderBy: { completedAt: 'desc' },
        take: 100,
        include: { theme: true, user: true, tenant: true },
      });
      res.json({
        status: 'ok',
        practices: sessions.map((s) => ({
          ...summary(s),
          tenant: s.tenant ? { id: s.tenant.id, name: s.tenant.name } : null,
          hasVideo: fs.existsSync(videoPath(s.id)),
          reviewed: Boolean(s.review),
          redLinesCrossed: (s.report?.lineasRojas || []).filter((l) => l.cruzada).length,
        })),
      });
    } catch (error) {
      console.error('Error listando prácticas:', error);
      fail(res, 500, 'No se pudieron obtener las prácticas.');
    }
  });

  // ------------------------------- Cola de etiquetado (segunda opinión)

  function reviewReason(s) {
    const areas = s.report?.areas || [];
    if ((s.report?.lineasRojas || []).some((l) => l.cruzada)) return { label: 'Línea roja cruzada', tone: 'danger', priority: 0 };
    if (s.score >= 45 && s.score <= 65) return { label: 'Puntaje límite', tone: 'warning', priority: 1 };
    if (areas.some((a) => a.score == null)) return { label: 'Área sin medir', tone: 'warning', priority: 2 };
    return { label: 'Muestreo aleatorio', tone: 'neutral', priority: 3 };
  }

  app.get('/api/review-queue', auth('master', 'system'), async (req, res) => {
    try {
      const sessions = await prisma.session.findMany({
        where: { score: { not: null } },
        orderBy: { completedAt: 'desc' },
        take: 100,
        include: { theme: true, user: true, tenant: true },
      });
      const items = sessions
        .map((s) => ({
          ...summary(s),
          tenant: s.tenant ? { id: s.tenant.id, name: s.tenant.name } : null,
          reason: reviewReason(s),
          review: s.review,
          hasVideo: fs.existsSync(videoPath(s.id)),
        }))
        .sort((a, b) => Number(Boolean(a.review)) - Number(Boolean(b.review)) || a.reason.priority - b.reason.priority);
      res.json({ status: 'ok', pending: items.filter((i) => !i.review).length, items });
    } catch (error) {
      console.error('Error en cola de etiquetado:', error);
      fail(res, 500, 'No se pudo obtener la cola de revisión.');
    }
  });

  // Guarda la corrección del experto (puntajes por área y comentario)
  app.post('/api/sessions/:id/review', auth('master', 'system'), async (req, res) => {
    try {
      const { scores = {}, comment = '' } = req.body || {};
      const session = await prisma.session.findUnique({ where: { id: req.params.id } });
      if (!session?.report) return fail(res, 404, 'Sesión evaluada no encontrada.');

      const clean = {};
      for (const key of ['expression', 'voice', 'coherence', 'empathy']) {
        const v = scores[key];
        clean[key] = v === '' || v == null ? null : Math.max(0, Math.min(100, Math.round(Number(v))));
      }
      const review = {
        scores: clean,
        comment: String(comment).trim(),
        reviewer: { id: req.user.id, name: req.user.name },
        at: new Date().toISOString(),
        // Diferencia entre la IA y el experto (sirve para medir el "acuerdo IA-humano")
        agreement: Object.fromEntries(
          session.report.areas.map((a) => [a.key, a.score != null && clean[a.key] != null ? Math.abs(a.score - clean[a.key]) : null]),
        ),
      };
      await prisma.session.update({ where: { id: session.id }, data: { review } });
      res.json({ status: 'ok', review });
    } catch (error) {
      console.error('Error guardando revisión:', error);
      fail(res, 500, 'No se pudo guardar la revisión.');
    }
  });

  // Descartar una sesión en curso (botón "Detener y descartar")
  app.delete('/api/sessions/:id', auth('user'), async (req, res) => {
    try {
      const session = await prisma.session.findUnique({ where: { id: req.params.id } });
      if (!session) return fail(res, 404, 'Sesión no encontrada.');
      if (session.userId !== req.user.id) return fail(res, 403, 'Esta sesión no te pertenece.');
      if (session.score != null) return fail(res, 400, 'No se puede descartar una sesión ya evaluada.');
      // Elimina primero la grabación para no dejar archivos huérfanos
      removeVideoFiles([session.id]);
      await prisma.session.delete({ where: { id: session.id } });
      res.json({ status: 'ok' });
    } catch (error) {
      console.error('Error descartando sesión:', error);
      fail(res, 500, 'No se pudo descartar la sesión.');
    }
  });

  // Historial de prácticas, PAGINADO EN EL SERVIDOR.
  // - VOCERO: solo las suyas (comportamiento original; un `userId` ajeno se rechaza).
  // - ADMIN del cliente: las de los voceros de SU organización, indicando `?userId=`; el
  //   servidor valida rol y pertenencia al tenant (el id del frontend no autoriza nada).
  // - MASTER/SYSTEM: las de cualquier vocero.
  // - `?page=` (desde 1) y `?limit=` (máx. 50; por defecto 50 = tope histórico del endpoint).
  //   Se devuelven `total` y `pages` para que el cliente pagine sin traer todo el historial.
  // - `orderBy createdAt`: `completedAt` es nulo en las sesiones sin informe, así que ordenar por
  //   esa columna las dejaría al final y las sacaría del historial.
  // - El aislamiento entre organizaciones lo resuelve `resolveSessionOwner` (lib/sessionScope).
  app.get('/api/sessions', auth('user', 'admin', 'master', 'system'), async (req, res) => {
    try {
      const owner = await resolveSessionOwner({
        apiRole: req.apiRole,
        requester: req.user,
        requestedUserId: req.query?.userId,
        findUser: (id) => prisma.user.findUnique({ where: { id } }),
      });
      if (owner.error) return fail(res, owner.status, owner.error);

      const { page, limit } = resolvePaging(req.query);
      const where = { userId: owner.id };
      // El total se consulta primero para no devolver nunca una página vacía: si se pide una
      // página fuera de rango se sirve la última existente.
      const total = await prisma.session.count({ where });
      const pages = Math.max(1, Math.ceil(total / limit));
      const current = Math.min(page, pages);
      const sessions = await prisma.session.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (current - 1) * limit,
        take: limit,
        include: { theme: true },
      });

      res.json({
        status: 'ok',
        // Vocero consultado (el propio o el indicado por el administrador): permite titular la
        // vista sin exponer nada más.
        user: { id: owner.id, name: owner.name || null },
        sessions: sessions.map((session) => ({ ...summary(session), evaluation: evaluationState(session) })),
        total,
        page: current,
        limit,
        pages,
      });
    } catch (error) {
      console.error('Error listando sesiones:', error);
      fail(res, 500, 'No se pudieron obtener las sesiones.');
    }
  });
};

// Para el panel del sistema (estado y ejecución manual de la retención por organización)
module.exports.applyRetention = applyRetention;
module.exports.RETENTION_JOB = RETENTION_JOB;
