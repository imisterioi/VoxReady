// Rutas del resultado de las prácticas: evaluación con IA, informe e historial.
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../auth');
const { EvaluationResponseError, evaluateSession } = require('../ai/evaluator');
const { EvaluationInputError, applySpeechEvidence, normalizeEvaluateInput } = require('../lib/evaluationInput');
const { computeSpeechEvidence } = require('../lib/speechEvidence');
const { transcribeFile } = require('../lib/whisperClient');
const { removeVideoFiles } = require('../lib/anonymize');
const { effectiveElapsedMs, reconcilePauses } = require('../lib/retentionPause');
const { registerJob, runJob } = require('../lib/runtimeStatus');

const RETENTION_JOB = 'retention';
const RETENTION_EVERY_MS = 6 * 60 * 60 * 1000;

// Mismo directorio donde se guardan las grabaciones: video (<id>.webm) y audio (<id>.audio.webm)
const SESSIONS_DIR = path.join(__dirname, '..', 'uploads', 'sessions');
const videoPath = (id) => path.join(SESSIONS_DIR, `${id}.webm`);
const audioPath = (id) => path.join(SESSIONS_DIR, `${id}.audio.webm`);

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
  const [sessions, users] = await Promise.all([
    prisma.session.findMany({
      where: tenantId ? { tenantId } : {},
      select: { id: true, createdAt: true, userId: true, tenantId: true, tenant: { select: { retentionDays: true, status: true } } },
    }),
    prisma.user.findMany({
      where: tenantId ? { tenantId } : {},
      select: { id: true, retentionPauses: { select: { startedAt: true, endedAt: true } } },
    }),
  ]);
  const byTenant = {};
  const tally = (id) => (byTenant[id] ||= { sessions: 0, expired: 0, videos: 0, videosRemoved: 0, audios: 0, audiosRemoved: 0 });
  const pausesByUser = new Map(users.map((u) => [u.id, u.retentionPauses]));

  const now = Date.now();
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

    const days = s.tenant?.retentionDays ?? 90;
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
});

module.exports = function registerSessionRoutes(app, prisma) {
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
    if (session?.report) {
      return { state: 'done', finishedAt: meta?.finishedAt ?? session.completedAt ?? null };
    }
    if (session?.status === 'EVALUATING') {
      const age = Number.isFinite(meta?.startedAt) ? Date.now() - meta.startedAt : null;
      // Si no hay trabajo vivo y el registro es viejo, quedó interrumpido (reinicio, caída).
      if (!jobs.has(session.id) && (age == null || age > STALE_MS)) {
        return { state: 'stalled', reason: 'INTERRUPTED', stage: meta?.stage ?? null, startedAt: meta?.startedAt ?? null };
      }
      return { state: 'processing', stage: meta?.stage ?? null, startedAt: meta?.startedAt ?? null };
    }
    if (session?.status === 'FAILED') {
      return { state: 'failed', reason: meta?.error || 'ERROR', stage: meta?.stage ?? null, finishedAt: meta?.finishedAt ?? null };
    }
    return { state: 'idle' };
  }

  // Transcripción del audio de la sesión + cálculo de la evidencia. NUNCA lanza: cualquier
  // problema se traduce en `unverified` con motivo, y la evaluación sigue sin el criterio.
  async function verifySpeech(sessionId, input) {
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

    const result = await transcribeFile(audioPath(sessionId));
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
  async function runEvaluation(session, input) {
    const { pattern, source } = await patternFor(session.themeId, session.userId);
    const report = await evaluateSession({
      theme: session.theme,
      transcript: input.transcript,
      metrics: input.metrics,
      pattern,
      patternSource: source,
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
    return prisma.session.update({
      where: { id: session.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        transcript: input.transcript, // normalizado: palabras/muletillas recalculadas
        metrics: { ...input.metrics, evaluation },
        report,
        score: report.global, // el global del informe ya validado
      },
      include: { theme: true, user: true },
    });
  }

  // Registra el fallo sin tocar un informe válido ni volver a evaluar nada.
  async function failEvaluation(sessionId, metrics, error) {
    try {
      const current = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { report: true, metrics: true },
      });
      if (!current || current.report) return; // jamás se pisa un informe válido
      const previous = current.metrics?.evaluation || {};
      await prisma.session.update({
        where: { id: sessionId },
        data: {
          status: 'FAILED',
          metrics: {
            ...metrics,
            evaluation: {
              ...previous,
              state: 'failed',
              stage: previous.stage || 'ai',
              error: error?.code || 'ERROR',
              finishedAt: Date.now(),
            },
          },
        },
      });
    } catch (failure) {
      console.error('Error registrando el fallo de la evaluación:', failure.message);
    }
  }

  // Lanza el trabajo en segundo plano. Devuelve enseguida: el cliente consulta el estado.
  function startJob(session, input) {
    const promise = (async () => {
      try {
        const evidence = await verifySpeech(session.id, input);
        applySpeechEvidence(input, evidence);

        // Se persiste la evidencia ANTES de llamar a la IA: si la IA falla y el usuario
        // reintenta, no se vuelve a transcribir (ni se gasta otra vez el servicio).
        input.metrics.evaluation = { ...(input.metrics.evaluation || {}), stage: 'ai' };
        await prisma.session.update({
          where: { id: session.id },
          data: { metrics: input.metrics, transcript: input.transcript },
        });

        await runEvaluation(session, input);
        try {
          runPurge();
        } catch {
          /* la retención no debe afectar al resultado */
        }
      } catch (error) {
        console.error('Error evaluando sesión:', error.message);
        await failEvaluation(session.id, input.metrics, error);
      }
    })();
    jobs.set(session.id, promise);
    promise.finally(() => jobs.delete(session.id));
    return promise;
  }

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

      // Validación + normalización: lanza INVALID_INPUT (400) si no hay nada evaluable.
      // Recalcula palabras y muletillas en el servidor y deja constancia de la procedencia.
      const input = normalizeEvaluateInput({ transcript: req.body?.transcript, metrics: req.body?.metrics });

      // Trabajo ya en curso: se responde 202 sin duplicar la evaluación.
      const state = evaluationState(session);
      if (state.state === 'processing') {
        return res.status(202).json({ status: 'processing', evaluation: state });
      }

      const claimable =
        ['CREATED', 'COMPLETED', 'FAILED'].includes(session.status) || state.state === 'stalled';
      if (!claimable) {
        return fail(res, 409, 'La sesión no se puede evaluar en su estado actual.');
      }

      // Reclamo con CAS sobre el estado leído: solo una petición pasa a EVALUATING.
      const startedAt = Date.now();
      const meta = {
        state: 'processing',
        stage: 'audio',
        startedAt,
        attempt: (session.metrics?.evaluation?.attempt || 0) + 1,
      };
      const claimed = await prisma.session.updateMany({
        where: { id: session.id, status: session.status },
        data: { status: 'EVALUATING', metrics: { ...input.metrics, evaluation: meta } },
      });
      if (claimed.count !== 1) {
        // Otra petición ganó la carrera: se informa, no se evalúa dos veces.
        return res.status(202).json({ status: 'processing', evaluation: { ...meta, startedAt } });
      }

      input.metrics.evaluation = meta;
      startJob(session, input);
      return res.status(202).json({ status: 'processing', evaluation: meta });
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

  // Historial de prácticas evaluadas del vocero conectado
  app.get('/api/sessions', auth('user'), async (req, res) => {
    try {
      const sessions = await prisma.session.findMany({
        where: { userId: req.user.id, score: { not: null } },
        orderBy: { completedAt: 'desc' },
        take: 20,
        include: { theme: true },
      });
      res.json({ status: 'ok', sessions: sessions.map(summary) });
    } catch (error) {
      console.error('Error listando sesiones:', error);
      fail(res, 500, 'No se pudieron obtener las sesiones.');
    }
  });
};

// Para el panel del sistema (estado y ejecución manual de la retención por organización)
module.exports.applyRetention = applyRetention;
module.exports.RETENTION_JOB = RETENTION_JOB;
