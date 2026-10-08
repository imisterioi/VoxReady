// Métricas administrativas de VoxReady (SOLO LECTURA).
//
// Calcula, reutilizando únicamente datos ya existentes (Session, User, Theme, Tenant):
//   - Ranking de VOCEROS vigentes por entrenamientos (más / menos).
//   - Preferencia de temas (más / menos usados).
//   - Clientes: actuales (ACTIVE) y creados en el período.
//
// Reglas fijas:
//   * VOCEROS vigentes = role VOCERO, status ACTIVE, anonymizedAt IS NULL.
//   * "Entrenamiento" = sesión con status COMPLETED dentro del período.
//   * Aislamiento multi-tenant: el tenantId SIEMPRE proviene del token (req.user),
//     nunca del frontend. Se aplica en scopeFromRequest(req).
//   * No modifica datos. No toca retención, suspensión, anonimización ni eliminación.

const presence = require('./presence');

// Presets de período (días). El frontend envía ?period=<clave>.
const PERIOD_PRESETS = { '7': 7, '30': 30, '90': 90, '365': 365 };
const DEFAULT_PERIOD_DAYS = 30;

// Resuelve el período seleccionado a un rango [from, to].
// from = null cuando el período es "todo el tiempo" (no acota por fecha).
function resolvePeriod(query = {}) {
  const raw = String(query.period ?? DEFAULT_PERIOD_DAYS).toLowerCase();
  const to = new Date();

  if (raw === 'all' || raw === 'todo') {
    return { from: null, to, key: 'all', label: 'Todo el tiempo' };
  }

  const parsed = PERIOD_PRESETS[raw] ?? Number.parseInt(raw, 10);
  const days = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PERIOD_DAYS;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to, key: String(days), label: `Últimos ${days} días` };
}

// Alcance por rol, tomado EXCLUSIVAMENTE del usuario autenticado (req.user).
//   ADMIN → solo su organización (tenantId).
//   Otros roles de sistema (SYSTEM) → alcance global (tenantId = null).
function scopeFromRequest(req) {
  const apiRole = req?.apiRole;
  const tenantId = apiRole === 'admin' ? req.user.tenantId : null;
  return { apiRole, tenantId };
}

// Filtro de sesiones "entrenamiento": COMPLETED dentro del período.
// tenantId (opcional) acota a una organización; userIdIn (opcional) a un conjunto de voceros.
function trainingSessionWhere({ tenantId = null, from = null, to = null, userIdIn = null } = {}) {
  const where = { status: 'COMPLETED' };
  if (tenantId) where.tenantId = tenantId;
  if (userIdIn) where.userId = { in: userIdIn };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }
  return where;
}

// Ranking de voceros vigentes: más y menos entrenamientos del período.
// Incluye TODOS los voceros vigentes del alcance (con 0 entrenamientos en `bottom`).
async function voceroRankings(prisma, { tenantId = null, from = null, to = null, limit = 5 } = {}) {
  const voceros = await prisma.user.findMany({
    where: {
      role: 'VOCERO',
      status: 'ACTIVE',
      anonymizedAt: null,
      ...(tenantId ? { tenantId } : {}),
    },
    select: { id: true, name: true },
  });

  if (voceros.length === 0) return { top: [], bottom: [], total: 0 };

  const ids = voceros.map((v) => v.id);
  const grouped = await prisma.session.groupBy({
    by: ['userId'],
    where: trainingSessionWhere({ tenantId, from, to, userIdIn: ids }),
    _count: { _all: true },
  });
  const counts = new Map(grouped.map((g) => [g.userId, g._count._all]));

  const rows = voceros.map((v) => ({ id: v.id, name: v.name, sessions: counts.get(v.id) || 0 }));
  const byName = (a, b) => a.name.localeCompare(b.name);

  const top = [...rows].sort((a, b) => b.sessions - a.sessions || byName(a, b)).slice(0, limit);
  const bottom = [...rows].sort((a, b) => a.sessions - b.sessions || byName(a, b)).slice(0, limit);
  return { top, bottom, total: rows.length };
}

// Preferencia de temas = uso real en entrenamientos (no la asignación).
async function themePreference(prisma, { tenantId = null, from = null, to = null, limit = 5 } = {}) {
  // Temas vigentes del alcance: globales + del tenant (ADMIN) o todos (SYSTEM).
  const themeWhere = { deletedAt: null };
  if (tenantId) themeWhere.OR = [{ tenantId }, { isGlobal: true }];

  const themes = await prisma.theme.findMany({ where: themeWhere, select: { id: true, title: true } });
  if (themes.length === 0) return { preferred: [], least: [], total: 0 };

  const ids = themes.map((t) => t.id);
  const grouped = await prisma.session.groupBy({
    by: ['themeId'],
    where: { ...trainingSessionWhere({ tenantId, from, to }), themeId: { in: ids } },
    _count: { _all: true },
  });
  const counts = new Map(grouped.map((g) => [g.themeId, g._count._all]));

  const rows = themes.map((t) => ({ id: t.id, title: t.title, sessions: counts.get(t.id) || 0 }));
  const byTitle = (a, b) => a.title.localeCompare(b.title);

  const preferred = [...rows].sort((a, b) => b.sessions - a.sessions || byTitle(a, b)).slice(0, limit);
  const least = [...rows].sort((a, b) => a.sessions - b.sessions || byTitle(a, b)).slice(0, limit);
  return { preferred, least, total: rows.length };
}

// Clientes: actuales (status ACTIVE) y creados en el período (por Tenant.createdAt).
// NOTA: "clientes creados en el período" NO es un historial comercial WON/LOST.
async function tenantMetrics(prisma, { from = null, to = null } = {}) {
  const createdWhere = from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};

  const [current, created] = await Promise.all([
    prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, sector: true, createdAt: true },
    }),
    prisma.tenant.findMany({
      where: createdWhere,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, sector: true, status: true, createdAt: true },
    }),
  ]);

  return { current, currentCount: current.length, created, createdCount: created.length };
}

// ---------------------------------------------------------------------------
// Alcance efectivo de los endpoints. Parte SIEMPRE del token y, solo para el
// Administrador del Sistema (SYSTEM), admite un ?tenantId= que se valida contra la BD.
//   ADMIN  → su propio tenant (cualquier ?tenantId= se IGNORA).
//   SYSTEM → global; si envían ?tenantId= válido, se acota a ese tenant.
//   (VOCERO y MASTER no llegan aquí: los endpoints no los autorizan.)
// Devuelve { apiRole, mode: 'global'|'tenant', tenantId, tenantName, invalidTenant }.
async function resolveScope(prisma, req) {
  const apiRole = req.apiRole;

  if (apiRole === 'admin') {
    return { apiRole, mode: 'tenant', tenantId: req.user.tenantId, tenantName: req.user.tenant?.name || null, invalidTenant: false };
  }

  const requested = req.query?.tenantId;
  if (requested) {
    const tenant = await prisma.tenant.findUnique({ where: { id: requested }, select: { id: true, name: true } });
    if (!tenant) return { apiRole, mode: 'global', tenantId: null, tenantName: null, invalidTenant: true };
    return { apiRole, mode: 'tenant', tenantId: tenant.id, tenantName: tenant.name, invalidTenant: false };
  }

  return { apiRole, mode: 'global', tenantId: null, tenantName: null, invalidTenant: false };
}

// Voceros vigentes (ACTIVE, no anonimizados) del alcance.
function activeVoceroWhere(tenantId = null) {
  return { role: 'VOCERO', status: 'ACTIVE', anonymizedAt: null, ...(tenantId ? { tenantId } : {}) };
}

async function activeVoceroCount(prisma, { tenantId = null } = {}) {
  return prisma.user.count({ where: activeVoceroWhere(tenantId) });
}

// Frecuencia de entrenamiento del período: total, voceros vigentes, promedio por
// vocero y ritmo semanal.
async function trainingFrequency(prisma, { tenantId = null, from = null, to = null } = {}) {
  const [sessions, voceros] = await Promise.all([
    prisma.session.count({ where: trainingSessionWhere({ tenantId, from, to }) }),
    activeVoceroCount(prisma, { tenantId }),
  ]);
  const avgPerVocero = voceros ? Math.round((sessions / voceros) * 10) / 10 : 0;
  const end = to || new Date();
  const days = from ? Math.max(1, Math.round((end - from) / (24 * 60 * 60 * 1000))) : null;
  const perWeek = days ? Math.round((sessions / days) * 7 * 10) / 10 : null;
  const avgDaysBetween = await averageDaysBetweenTrainings(prisma, { tenantId, from, to });
  return { sessions, voceros, avgPerVocero, perWeek, avgDaysBetween };
}

// "Cada cuánto se entrenan": promedio de días entre dos entrenamientos consecutivos
// del mismo vocero dentro del período. null si nadie entrenó al menos dos veces.
async function averageDaysBetweenTrainings(prisma, { tenantId = null, from = null, to = null } = {}) {
  const rows = await prisma.session.findMany({
    where: trainingSessionWhere({ tenantId, from, to }),
    select: { userId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const last = new Map();
  let gapsMs = 0;
  let gaps = 0;
  for (const row of rows) {
    const previous = last.get(row.userId);
    if (previous) {
      gapsMs += row.createdAt - previous;
      gaps += 1;
    }
    last.set(row.userId, row.createdAt);
  }
  return gaps ? Math.round((gapsMs / gaps / (24 * 60 * 60 * 1000)) * 10) / 10 : null;
}

// Clientes ganados y perdidos en el período.
//   Ganados  = organizaciones creadas en el período (incluye las que después se eliminaron).
//   Perdidos = organizaciones eliminadas en el período (historial TenantEvent).
//   Suspendidas = suspensiones registradas en el período (clientes en riesgo, no perdidos).
// El historial empieza cuando se agregó TenantEvent: eliminaciones anteriores no se cuentan.
async function clientFlow(prisma, { from = null, to = null } = {}) {
  const range = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : null;
  const [createdAlive, createdThenDeleted, lost, suspended] = await Promise.all([
    prisma.tenant.count({ where: range ? { createdAt: range } : {} }),
    prisma.tenantEvent.count({ where: { type: 'DELETED', ...(range ? { tenantCreatedAt: range } : {}) } }),
    prisma.tenantEvent.count({ where: { type: 'DELETED', ...(range ? { at: range } : {}) } }),
    prisma.tenantEvent.count({ where: { type: 'SUSPENDED', ...(range ? { at: range } : {}) } }),
  ]);
  const won = createdAlive + createdThenDeleted;
  return { won, lost, suspended, net: won - lost };
}

// Resumen de clientes/tenants (solo alcance global): actuales, creados en el período
// y la lista de organizaciones para el selector.
async function tenantSummary(prisma, { from = null, to = null } = {}) {
  const createdWhere = from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};
  const [currentCount, createdCount, organizations] = await Promise.all([
    prisma.tenant.count({ where: { status: 'ACTIVE' } }),
    prisma.tenant.count({ where: createdWhere }),
    prisma.tenant.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, status: true } }),
  ]);
  return { currentCount, createdCount, organizations };
}

// Overview combinado del dashboard para el alcance resuelto.
async function metricsOverview(prisma, { scope, from = null, to = null } = {}) {
  const tenantId = scope.tenantId || null;
  const [voceros, themes, frequency] = await Promise.all([
    voceroRankings(prisma, { tenantId, from, to }),
    themePreference(prisma, { tenantId, from, to }),
    trainingFrequency(prisma, { tenantId, from, to }),
  ]);

  const result = {
    scope: scope.mode,
    tenant: scope.tenantId ? { id: scope.tenantId, name: scope.tenantName } : null,
    summary: {
      vocerosActive: frequency.voceros,
      sessions: frequency.sessions,
      avgPerVocero: frequency.avgPerVocero,
      perWeek: frequency.perWeek,
      avgDaysBetween: frequency.avgDaysBetween,
      // Usuarios con actividad en los últimos minutos (del alcance: organización o todas)
      connected: presence.connected({ tenantId }),
      organizations: null,
      organizationsCreated: null,
      organizationsWon: null,
      organizationsLost: null,
      organizationsSuspended: null,
    },
    voceros,
    themes,
    organizations: null,
  };

  if (scope.mode === 'global') {
    const [ts, flow] = await Promise.all([tenantSummary(prisma, { from, to }), clientFlow(prisma, { from, to })]);
    result.summary.organizations = ts.currentCount;
    result.summary.organizationsCreated = ts.createdCount;
    result.summary.organizationsWon = flow.won;
    result.summary.organizationsLost = flow.lost;
    result.summary.organizationsSuspended = flow.suspended;
  }

  // Solo el Administrador del Sistema (SYSTEM) recibe la lista de organizaciones
  // para el selector, tanto en vista global como al tener una organización seleccionada.
  if (scope.apiRole === 'system') {
    result.organizations = await prisma.tenant.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, status: true },
    });
  }
  return result;
}

module.exports = {
  PERIOD_PRESETS,
  resolvePeriod,
  scopeFromRequest,
  resolveScope,
  trainingSessionWhere,
  activeVoceroWhere,
  activeVoceroCount,
  trainingFrequency,
  averageDaysBetweenTrainings,
  clientFlow,
  tenantSummary,
  voceroRankings,
  themePreference,
  tenantMetrics,
  metricsOverview,
};
