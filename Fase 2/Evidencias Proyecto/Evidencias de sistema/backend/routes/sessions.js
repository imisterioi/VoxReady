// Rutas del resultado de las prácticas: evaluación con IA, informe e historial.
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../auth');
const { evaluateSession } = require('../ai/evaluator');

// Mismo directorio donde el endpoint de tu compañero guarda las grabaciones
const SESSIONS_DIR = path.join(__dirname, '..', 'uploads', 'sessions');
const videoPath = (id) => path.join(SESSIONS_DIR, `${id}.webm`);

// Política de retención: borra videos vencidos o de organizaciones que solo guardan métricas
async function purgeVideos(prisma) {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.webm'));
  if (!files.length) return;
  const sessions = await prisma.session.findMany({
    where: { id: { in: files.map((f) => f.replace('.webm', '')) } },
    include: { tenant: true },
  });
  let removed = 0;
  for (const s of sessions) {
    const days = s.tenant?.retentionDays ?? 90;
    const expired = Date.now() - new Date(s.createdAt).getTime() > days * 24 * 60 * 60 * 1000;
    const metricsOnly = s.tenant?.retentionMode === 'METRICS' && s.score != null;
    if (expired || metricsOnly) {
      fs.rmSync(videoPath(s.id), { force: true });
      removed += 1;
    }
  }
  if (removed) console.log(`[Retención] ${removed} grabación(es) eliminada(s) según la política de retención`);
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

  // Retención: al iniciar y cada 6 horas
  const runPurge = () => purgeVideos(prisma).catch((e) => console.warn('[Retención] error:', e.message));
  setTimeout(runPurge, 5000);
  setInterval(runPurge, 6 * 60 * 60 * 1000).unref();

  // Evaluaciones en curso: si llegan dos solicitudes para la misma sesión,
  // la segunda espera el resultado de la primera (no se evalúa dos veces)
  const inProgress = new Map();

  // Patrón aplicable, por prioridad: el excepcional del vocero, el del escenario o el activo
  async function patternFor(themeId, userId) {
    const byVocero = await prisma.voceroPatternOverride.findUnique({ where: { userId }, include: { pattern: true } });
    if (byVocero) return { pattern: byVocero.pattern, source: 'vocero' };
    const override = await prisma.patternOverride.findUnique({ where: { themeId }, include: { pattern: true } });
    if (override) return { pattern: override.pattern, source: 'scenario' };
    const active = await prisma.masterPattern.findFirst({ where: { status: 'ACTIVE' }, orderBy: { version: 'desc' } });
    return { pattern: active, source: 'active' };
  }

  async function runEvaluation(session, transcript, metrics) {
    const { pattern, source } = await patternFor(session.themeId, session.userId);
    const report = await evaluateSession({ theme: session.theme, transcript, metrics, pattern, patternSource: source });
    return prisma.session.update({
      where: { id: session.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        transcript,
        metrics,
        report,
        score: report.global,
      },
      include: { theme: true, user: true },
    });
  }

  // Analiza la entrevista (transcripción + métricas) y guarda el informe
  app.post('/api/sessions/:id/evaluate', auth('user'), async (req, res) => {
    try {
      const session = await prisma.session.findUnique({ where: { id: req.params.id }, include: { theme: true, user: true } });
      if (!session) return fail(res, 404, 'Sesión no encontrada.');
      if (session.userId !== req.user.id) return fail(res, 403, 'Esta sesión no te pertenece.');

      // Ya evaluada: se devuelve el informe guardado
      if (session.report) {
        return res.json({ status: 'ok', session: { ...summary(session), report: session.report, transcript: session.transcript } });
      }

      const { transcript = [], metrics = {} } = req.body || {};
      if (!Array.isArray(transcript) || transcript.length === 0) {
        return fail(res, 400, 'La entrevista no tiene preguntas registradas.');
      }

      if (!inProgress.has(session.id)) {
        inProgress.set(
          session.id,
          runEvaluation(session, transcript, metrics).finally(() => inProgress.delete(session.id)),
        );
      }
      const updated = await inProgress.get(session.id);
      runPurge();

      res.json({ status: 'ok', session: { ...summary(updated), report: updated.report, transcript: updated.transcript } });
    } catch (error) {
      console.error('Error evaluando sesión:', error.message);
      fail(res, error.code === 'NO_API_KEY' ? 503 : 502, error.message || 'No se pudo evaluar la sesión.');
    }
  });

  // Informe de una sesión
  app.get('/api/sessions/:id', auth(), async (req, res) => {
    try {
      const session = await prisma.session.findUnique({ where: { id: req.params.id }, include: { theme: true, user: true } });
      if (!session) return fail(res, 404, 'Sesión no encontrada.');
      if (!canView(req.user, req.apiRole, session)) return fail(res, 403, 'No puedes ver esta sesión.');

      res.json({ status: 'ok', session: { ...summary(session), report: session.report, transcript: session.transcript } });
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
