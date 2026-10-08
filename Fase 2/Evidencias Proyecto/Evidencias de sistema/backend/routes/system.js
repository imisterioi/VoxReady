// Estado de los procesos críticos y jobs de borrado/anonimización (administrador del sistema).
//
//   GET  /api/system/status              → procesos críticos: arriba o abajo               [system]
//   GET  /api/system/jobs                → jobs automáticos y su estado por organización    [system]
//   POST /api/system/jobs/retention/run  → ejecuta la retención ahora ({ tenantId? })       [system]
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../auth');
const { snapshot, runJob } = require('../lib/runtimeStatus');
const presence = require('../lib/presence');
const { applyRetention, RETENTION_JOB } = require('./sessions');

const SESSIONS_DIR = path.join(__dirname, '..', 'uploads', 'sessions');

// Comprueba la base de datos con una consulta real y mide cuánto tarda
async function checkDatabase(prisma) {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { state: 'ok', ms: Date.now() - start };
  } catch (error) {
    return { state: 'error', ms: Date.now() - start, detail: 'No responde' };
  }
}

// Comprueba que la carpeta de grabaciones exista y se pueda escribir en ella
function checkStorage() {
  try {
    fs.accessSync(SESSIONS_DIR, fs.constants.R_OK | fs.constants.W_OK);
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.webm'));
    const bytes = files.reduce((total, f) => total + fs.statSync(path.join(SESSIONS_DIR, f)).size, 0);
    return { state: 'ok', recordings: files.length, megabytes: Math.round((bytes / 1024 / 1024) * 10) / 10 };
  } catch (error) {
    return { state: 'error', detail: 'No se puede leer o escribir en la carpeta de grabaciones' };
  }
}

// La IA está "abajo" si falta la clave o si lo último que ocurrió fue un fallo
function checkAi(entry) {
  if (!process.env.NVIDIA_API_KEY) return { state: 'error', detail: 'Falta NVIDIA_API_KEY' };
  return {
    state: entry.state === 'pending' ? 'pending' : entry.state,
    lastOkAt: entry.lastOkAt || null,
    lastErrorAt: entry.lastErrorAt || null,
    lastModel: entry.lastModel || null,
    lastMs: entry.lastMs ?? null,
    calls: entry.calls || 0,
    failures: entry.failures || 0,
    detail: entry.state === 'error' ? entry.lastError : null,
  };
}

const publicJob = (job) => ({
  name: job.name,
  label: job.label,
  state: job.running ? 'running' : job.state,
  everyMinutes: job.everyMs ? Math.round(job.everyMs / 60000) : null,
  runs: job.runs,
  lastRunAt: job.lastRunAt,
  lastOkAt: job.lastOkAt,
  lastMs: job.lastMs,
  lastError: job.lastError,
  // Del resultado solo se exponen los totales (el detalle por organización va en /api/system/jobs)
  lastResult: job.lastResult && typeof job.lastResult === 'object' ? Object.fromEntries(Object.entries(job.lastResult).filter(([, v]) => typeof v === 'number')) : null,
});

module.exports = function registerSystemRoutes(app, prisma) {
  const auth = (...roles) => requireAuth(prisma, roles);
  const fail = (res, code, mensaje) => res.status(code).json({ status: 'error', mensaje });

  app.get('/api/system/status', auth('system'), async (req, res) => {
    try {
      const runtime = snapshot();
      const database = await checkDatabase(prisma);
      const processes = [
        { key: 'api', name: 'API VoxReady', state: 'ok', uptimeSeconds: runtime.uptimeSeconds },
        { key: 'database', name: 'Base de datos', ...database },
        { key: 'storage', name: 'Almacenamiento de grabaciones', ...checkStorage() },
        { key: 'interviewer', name: 'IA entrevistadora', ...checkAi(runtime.ai.interviewer) },
        { key: 'evaluator', name: 'IA evaluadora', ...checkAi(runtime.ai.evaluator) },
        ...runtime.jobs.map((job) => ({ ...publicJob(job), key: `job-${job.name}`, name: job.label })),
      ];
      res.json({
        status: 'ok',
        startedAt: runtime.startedAt,
        uptimeSeconds: runtime.uptimeSeconds,
        // "pending" (aún sin uso) y "running" no cuentan como caídos
        down: processes.filter((p) => p.state === 'error').length,
        processes,
        connected: presence.connected(),
      });
    } catch (error) {
      console.error('Error obteniendo el estado del sistema:', error);
      fail(res, 500, 'No se pudo obtener el estado del sistema.');
    }
  });

  app.get('/api/system/jobs', auth('system'), async (req, res) => {
    try {
      const [tenants, anonymized, requests, dry] = await Promise.all([
        prisma.tenant.findMany({
          orderBy: { name: 'asc' },
          select: { id: true, name: true, status: true, retentionMode: true, retentionDays: true, deletionRequestedAt: true },
        }),
        prisma.user.groupBy({ by: ['tenantId'], where: { anonymizedAt: { not: null } }, _count: { _all: true } }),
        prisma.deletionRequest.groupBy({ by: ['tenantId'], where: { status: { in: ['PENDING', 'APPROVED'] } }, _count: { _all: true } }),
        applyRetention(prisma, { dryRun: true }),
      ]);
      const count = (rows) => new Map(rows.map((r) => [r.tenantId, r._count._all]));
      const anonymizedBy = count(anonymized);
      const requestsBy = count(requests);

      res.json({
        status: 'ok',
        jobs: snapshot().jobs.map(publicJob),
        tenants: tenants.map((t) => {
          const stats = dry.byTenant[t.id] || { sessions: 0, expired: 0, videos: 0 };
          return {
            id: t.id,
            name: t.name,
            status: t.status,
            retentionMode: t.retentionMode,
            retentionDays: t.retentionDays,
            deletionRequestedAt: t.deletionRequestedAt,
            sessions: stats.sessions,
            expiredSessions: stats.expired, // ya fuera de plazo: la retención las limpia (o ya las limpió)
            recordings: stats.videos,
            anonymizedUsers: anonymizedBy.get(t.id) || 0,
            openDeletionRequests: requestsBy.get(t.id) || 0,
          };
        }),
      });
    } catch (error) {
      console.error('Error obteniendo los jobs:', error);
      fail(res, 500, 'No se pudo obtener el estado de los jobs.');
    }
  });

  // Ejecuta la retención ahora, para todas las organizaciones o solo para una
  app.post('/api/system/jobs/retention/run', auth('system'), async (req, res) => {
    try {
      const tenantId = req.body?.tenantId || null;
      if (tenantId) {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
        if (!tenant) return fail(res, 404, 'Organización no encontrada.');
      }
      // La ejecución de una sola organización no reemplaza el registro del job global
      const result = tenantId ? await applyRetention(prisma, { tenantId }) : await runJob(RETENTION_JOB, () => applyRetention(prisma));
      const { byTenant, ...totals } = result;
      res.json({ status: 'ok', tenantId, result: totals });
    } catch (error) {
      console.error('Error ejecutando la retención:', error);
      fail(res, 500, 'No se pudo ejecutar la retención.');
    }
  });
};
