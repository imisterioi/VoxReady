// Servidor simulado del modo demostración.
// Intercepta las llamadas fetch a /api/* y responde igual que el backend real
// (mismas rutas, permisos y formato de respuesta), usando la base de datos del
// navegador (./db.js). Así la aplicación se puede recorrer completa sin backend,
// por ejemplo publicada en Vercel.
import { DEMO_PASSWORD, getDb, patternFor, saveDb, uid } from './db';
import { DEFAULT_CONFIG, deepMerge, parseList, resolveConfig } from './patternConfig';
import { evaluateSession } from './evaluator';
import { nextQuestion } from './interviewer';
import { normalizeInterviewConfig, resolveInterviewConfig, turnPlan } from './interviewConfig';

const ROLE_TO_API = { VOCERO: 'user', ADMIN: 'admin', MASTER: 'master', SYSTEM: 'system' };
const ROLE_FROM_API = { user: 'VOCERO', admin: 'ADMIN', master: 'MASTER', system: 'SYSTEM' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Grabaciones de la sesión actual del navegador (no se guardan en localStorage)
const videos = new Map();
export const demoVideoUrl = (sessionId) => videos.get(sessionId) || null;

// ---------------------------------------------------------------- Utilidades

class HttpError extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}
const fail = (status, mensaje) => {
  throw new HttpError(status, mensaje);
};
const now = () => new Date().toISOString();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

const initialsOf = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

function toApiUser(db, u) {
  const tenant = db.tenants.find((t) => t.id === u.tenantId);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    initials: initialsOf(u.name),
    role: ROLE_TO_API[u.role] || 'user',
    status: u.status,
    area: u.area,
    tenantId: u.tenantId,
    tenantName: tenant?.name || null,
    // Colores de la organización (configuración "Estilo"); null = colores de VoxReady
    palette: tenant?.brandColor && tenant?.accentColor ? { brand: tenant.brandColor, accent: tenant.accentColor } : null,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

const userById = (db, id) => db.users.find((u) => u.id === id);
const themeById = (db, id) => db.themes.find((t) => t.id === id);

function summary(db, s) {
  const theme = themeById(db, s.themeId);
  const user = userById(db, s.userId);
  return {
    id: s.id,
    status: s.status,
    createdAt: s.createdAt,
    completedAt: s.completedAt,
    score: s.score,
    theme: theme ? { id: theme.id, title: theme.title, category: theme.category } : null,
    user: user ? { id: user.id, name: user.name } : null,
    areas: s.report?.areas?.map(({ key, label, score }) => ({ key, label, score })) || [],
  };
}

const fullSession = (db, s) => ({ ...summary(db, s), report: s.report, transcript: s.transcript, review: s.review });

// El modo "solo métricas" de la organización no conserva las grabaciones
function hasVideo(db, s) {
  const tenant = db.tenants.find((t) => t.id === s.tenantId);
  if (tenant?.retentionMode === 'METRICS') return false;
  return Boolean(s.hasVideo);
}

function toApiTheme(db, t) {
  return {
    id: t.id,
    title: t.title,
    context: t.context,
    category: t.category,
    optic: t.optic,
    keyMessages: parseList(t.keyMessages),
    redLines: parseList(t.redLines),
    publics: parseList(t.publics),
    availableToAllVoceros: t.availableToAllVoceros,
    interview: resolveInterviewConfig(t),
    voceroIds: db.assignments.filter((a) => a.themeId === t.id).map((a) => a.userId),
    sessions: db.sessions.filter((s) => s.themeId === t.id).length,
  };
}

function toApiPattern(db, p) {
  const createdBy = userById(db, p.createdById);
  return {
    id: p.id,
    version: p.version,
    name: p.name || 'Patrón base',
    status: p.status,
    createdAt: p.createdAt,
    createdBy: createdBy ? { id: createdBy.id, name: createdBy.name } : null,
    config: resolveConfig(p),
    overrides: db.patternOverrides
      .filter((o) => o.patternId === p.id)
      .map((o) => {
        const theme = themeById(db, o.themeId);
        const tenant = db.tenants.find((t) => t.id === theme?.tenantId);
        return { themeId: o.themeId, theme: theme ? { id: theme.id, title: theme.title } : null, tenant: tenant ? { id: tenant.id, name: tenant.name } : null };
      }),
    voceroOverrides: db.voceroOverrides
      .filter((o) => o.patternId === p.id)
      .map((o) => {
        const user = userById(db, o.userId);
        const tenant = db.tenants.find((t) => t.id === user?.tenantId);
        return { userId: o.userId, user: user ? { id: user.id, name: user.name } : null, tenant: tenant ? { id: tenant.id, name: tenant.name } : null };
      }),
  };
}

function syncAssignments(db, theme, voceroIds = []) {
  const wanted = new Set(
    db.users.filter((u) => voceroIds.includes(u.id) && u.tenantId === theme.tenantId && u.role === 'VOCERO').map((u) => u.id),
  );
  db.assignments = db.assignments.filter((a) => a.themeId !== theme.id || wanted.has(a.userId));
  for (const userId of wanted) {
    if (!db.assignments.some((a) => a.themeId === theme.id && a.userId === userId)) {
      db.assignments.push({ id: uid(), userId, themeId: theme.id, status: 'PENDING', assignedAt: now() });
    }
  }
}

function validateNewUser(db, { name, email, password }) {
  if (!name?.trim()) return 'Ingresa el nombre completo.';
  if (!EMAIL_RE.test(email?.trim() || '')) return 'Ingresa un correo válido.';
  if (!password || password.length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
  if (db.users.some((u) => u.email === email.trim().toLowerCase())) return 'Ya existe un usuario con ese correo.';
  return null;
}

function reviewReason(s) {
  const areas = s.report?.areas || [];
  if ((s.report?.lineasRojas || []).some((l) => l.cruzada)) return { label: 'Línea roja cruzada', tone: 'danger', priority: 0 };
  if (s.score >= 45 && s.score <= 65) return { label: 'Puntaje límite', tone: 'warning', priority: 1 };
  if (areas.some((a) => a.score == null)) return { label: 'Área sin medir', tone: 'warning', priority: 2 };
  return { label: 'Muestreo aleatorio', tone: 'neutral', priority: 3 };
}

// ------------------------------------------------------------------- Rutas

const routes = [];
const route = (method, pattern, roles, handler) => {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ method, regex, keys, roles, handler });
};

// roles: null = público · [] = cualquier sesión · ['admin', …] = esos roles

// ------------------------------------------------------- Pruebas técnicas
route('GET', '/api/health', null, () => ({ status: 'ok', service: 'VoxReady API (demo)', mensaje: '¡El backend de demostración está funcionando!' }));
route('GET', '/api/db-test', null, () => ({ status: 'ok', database: 'Navegador (demo)', prisma: 'simulado', fecha: now() }));

// ----------------------------------------------------------------- Cuentas
route('POST', '/api/auth/login', null, ({ db, body }) => {
  const email = (body?.email || '').trim().toLowerCase();
  const user = db.users.find((u) => u.email === email);
  if (!user || (body?.password || '') !== (user.password || DEMO_PASSWORD)) fail(401, 'Correo o contraseña incorrectos.');
  const tenant = db.tenants.find((t) => t.id === user.tenantId);
  if (user.status === 'SUSPENDED') fail(403, 'Esta cuenta está suspendida. Contacta a tu administrador.');
  if (tenant?.status === 'SUSPENDED') fail(403, `La organización ${tenant.name} está suspendida.`);
  user.lastLoginAt = now();
  saveDb();
  return { status: 'ok', token: `demo.${user.id}`, user: toApiUser(db, user) };
});

route('GET', '/api/auth/me', [], ({ db, user }) => ({ status: 'ok', user: toApiUser(db, user) }));

// Usuarios conectados: quien hizo una petición en los últimos minutos (lo registra el despachador)
const PRESENCE_WINDOW_MS = 5 * 60 * 1000;
const lastSeen = new Map(); // userId → momento de la última petición
function connectedUsers(db, tenantId = null) {
  const byRole = { VOCERO: 0, ADMIN: 0, MASTER: 0, SYSTEM: 0 };
  let total = 0;
  for (const [userId, at] of lastSeen) {
    const u = userById(db, userId);
    if (!u || Date.now() - at > PRESENCE_WINDOW_MS || (tenantId && u.tenantId !== tenantId)) continue;
    total += 1;
    byRole[u.role] += 1;
  }
  return { total, byRole, windowMinutes: PRESENCE_WINDOW_MS / 60000 };
}

route('POST', '/api/auth/heartbeat', [], () => ({ status: 'ok' }));
route('POST', '/api/auth/logout', [], ({ user }) => {
  lastSeen.delete(user.id);
  return { status: 'ok' };
});

route('GET', '/api/tenants', ['system'], ({ db }) => {
  const month = startOfMonth();
  return {
    status: 'ok',
    tenants: [...db.tenants]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((t) => {
        const members = db.users.filter((u) => u.tenantId === t.id);
        return {
          id: t.id,
          name: t.name,
          sector: t.sector,
          status: t.status,
          createdAt: t.createdAt,
          sessionsMonth: db.sessions.filter((s) => s.tenantId === t.id && new Date(s.createdAt).getTime() >= month).length,
          admins: members.filter((u) => u.role === 'ADMIN').map(({ id, name, email }) => ({ id, name, email })),
          voceros: members.filter((u) => u.role === 'VOCERO').length,
        };
      }),
  };
});

route('POST', '/api/tenants', ['system'], ({ db, body }) => {
  const { name, sector, adminName, adminEmail, adminPassword } = body || {};
  if (!name?.trim()) fail(400, 'Ingresa el nombre de la organización.');
  if (db.tenants.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) fail(409, 'Ya existe una organización con ese nombre.');
  const invalid = validateNewUser(db, { name: adminName, email: adminEmail, password: adminPassword });
  if (invalid) fail(400, invalid);
  const tenant = { id: uid(), name: name.trim(), sector: sector || null, status: 'ACTIVE', createdAt: now(), retentionMode: 'FULL', retentionDays: 90 };
  const admin = { id: uid(), name: adminName.trim(), email: adminEmail.trim().toLowerCase(), role: 'ADMIN', password: adminPassword, tenantId: tenant.id, area: null, status: 'ACTIVE', createdAt: now(), lastLoginAt: null };
  db.tenants.push(tenant);
  db.users.push(admin);
  saveDb();
  return { status: 'ok', tenant, admin: toApiUser(db, admin) };
});

route('PATCH', '/api/tenants/:id', ['system'], ({ db, params, body }) => {
  if (!['ACTIVE', 'SUSPENDED'].includes(body?.status)) fail(400, 'Estado no válido.');
  const tenant = db.tenants.find((t) => t.id === params.id);
  if (!tenant) fail(404, 'Organización no encontrada.');
  // Historial para las métricas de clientes (solo si el estado realmente cambió)
  if (tenant.status !== body.status) {
    (db.tenantEvents ||= []).push({ tenantId: tenant.id, type: body.status === 'SUSPENDED' ? 'SUSPENDED' : 'REACTIVATED', at: now() });
  }
  tenant.status = body.status;
  saveDb();
  return { status: 'ok', tenant };
});

route('GET', '/api/users', ['system', 'admin'], ({ db, user, apiRole }) => {
  const list = apiRole === 'admin' ? db.users.filter((u) => u.tenantId === user.tenantId && u.role === 'VOCERO') : db.users;
  return {
    status: 'ok',
    users: [...list]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((u) => ({ ...toApiUser(db, u), sessions: db.sessions.filter((s) => s.userId === u.id && s.status === 'COMPLETED').length })),
  };
});

route('POST', '/api/users', ['system', 'admin'], ({ db, user, apiRole, body }) => {
  const { name, email, password, role, tenantId, area } = body || {};
  const allowed = apiRole === 'system' ? ['admin', 'master', 'system'] : ['user'];
  if (!allowed.includes(role)) fail(403, 'No puedes crear usuarios con ese rol.');
  const invalid = validateNewUser(db, { name, email, password });
  if (invalid) fail(400, invalid);
  let finalTenantId = null;
  if (apiRole === 'admin') finalTenantId = user.tenantId;
  else if (role === 'admin') {
    if (!db.tenants.some((t) => t.id === tenantId)) fail(400, 'Selecciona una organización.');
    finalTenantId = tenantId;
  }
  const created = {
    id: uid(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    role: ROLE_FROM_API[role],
    password,
    tenantId: finalTenantId,
    area: role === 'user' ? area || null : null,
    status: 'ACTIVE',
    createdAt: now(),
    lastLoginAt: null,
  };
  db.users.push(created);
  // Los temas "disponibles para todos" quedan asignados al nuevo vocero
  if (created.role === 'VOCERO') {
    db.themes
      .filter((t) => t.tenantId === finalTenantId && t.availableToAllVoceros)
      .forEach((t) => db.assignments.push({ id: uid(), userId: created.id, themeId: t.id, status: 'PENDING', assignedAt: now() }));
  }
  saveDb();
  return { status: 'ok', user: toApiUser(db, created) };
});

route('PATCH', '/api/users/:id', ['system', 'admin'], ({ db, user, apiRole, params, body }) => {
  if (!['ACTIVE', 'SUSPENDED'].includes(body?.status)) fail(400, 'Estado no válido.');
  if (params.id === user.id) fail(400, 'No puedes suspender tu propia cuenta.');
  const target = userById(db, params.id);
  if (!target) fail(404, 'Usuario no encontrado.');
  if (apiRole === 'admin' && (target.tenantId !== user.tenantId || target.role !== 'VOCERO')) fail(403, 'Solo puedes gestionar voceros de tu organización.');
  target.status = body.status;
  saveDb();
  return { status: 'ok', user: toApiUser(db, target) };
});

route('GET', '/api/system/overview', ['system'], ({ db }) => {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - 13);
  const daily = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(since);
    day.setDate(since.getDate() + i);
    return { date: day.toISOString().slice(0, 10), count: 0 };
  });
  for (const s of db.sessions) {
    const slot = daily.find((d) => d.date === new Date(s.createdAt).toISOString().slice(0, 10));
    if (slot) slot.count += 1;
  }
  const byRole = { user: 0, admin: 0, master: 0, system: 0 };
  for (const u of db.users) byRole[ROLE_TO_API[u.role] || 'user'] += 1;

  const activity = [
    ...[...db.users]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5)
      .map((u) => {
        const tenant = db.tenants.find((t) => t.id === u.tenantId);
        return { id: `u-${u.id}`, icon: 'users', text: `Se creó la cuenta de ${u.name}${tenant ? ` en ${tenant.name}` : ''}`, at: u.createdAt };
      }),
    ...db.sessions
      .filter((s) => s.status === 'COMPLETED')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5)
      .map((s) => ({
        id: `s-${s.id}`,
        icon: 'mic',
        text: `${userById(db, s.userId)?.name} completó "${themeById(db, s.themeId)?.title}"${s.score != null ? ` (${s.score}/100)` : ''}`,
        at: s.completedAt || s.createdAt,
      })),
    ...[...db.patterns]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 3)
      .map((p) => ({ id: `p-${p.id}`, icon: 'sliders', text: `${userById(db, p.createdById)?.name} publicó el patrón maestro v${p.version}`, at: p.createdAt })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 8);

  return {
    status: 'ok',
    tenants: { total: db.tenants.length, active: db.tenants.filter((t) => t.status === 'ACTIVE').length },
    users: { total: db.users.length, active: db.users.filter((u) => u.status === 'ACTIVE').length, byRole },
    sessions: { daily, month: db.sessions.filter((s) => new Date(s.createdAt).getTime() >= startOfMonth()).length },
    activity,
  };
});

// ------------------------------------- Procesos críticos y jobs (simulados)
const startedAt = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const aiStats = { interviewer: { calls: 0, lastOkAt: null, lastMs: null }, evaluator: { calls: 0, lastOkAt: null, lastMs: null } };
const recordAi = (kind, ms) => Object.assign(aiStats[kind], { calls: aiStats[kind].calls + 1, lastOkAt: now(), lastMs: ms });
const jobs = {
  retention: { name: 'retention', label: 'Retención de datos (borrado por vencimiento)', everyMinutes: 360, runs: 0, lastRunAt: null, lastMs: null, lastResult: null },
  'tenant-deletion': { name: 'tenant-deletion', label: 'Eliminación de organizaciones', everyMinutes: 5, runs: 0, lastRunAt: null, lastMs: null, lastResult: null },
};
const publicJob = (job) => ({ ...job, state: job.lastRunAt ? 'ok' : 'pending', lastOkAt: job.lastRunAt, lastError: null });

const isExpired = (db, s) => {
  const tenant = db.tenants.find((t) => t.id === s.tenantId);
  return Date.now() - new Date(s.createdAt).getTime() > (tenant?.retentionDays ?? 90) * DAY_MS;
};

// Retención: en las prácticas fuera de plazo se eliminan la grabación y la transcripción
function applyRetention(db, tenantId = null) {
  const result = { videosRemoved: 0, transcriptsCleared: 0, reportsCleaned: 0 };
  for (const s of db.sessions) {
    if ((tenantId && s.tenantId !== tenantId) || !isExpired(db, s)) continue;
    if (s.hasVideo) {
      s.hasVideo = false;
      videos.delete(s.id);
      result.videosRemoved += 1;
    }
    if (s.transcript) {
      s.transcript = null;
      result.transcriptsCleared += 1;
    }
    if (s.report && ('resumen' in s.report || 'cita' in s.report)) {
      s.report = { ...s.report };
      for (const key of ['resumen', 'cita', 'fortalezas', 'mejoras']) delete s.report[key];
      result.reportsCleaned += 1;
    }
  }
  saveDb();
  return result;
}

function runJob(name, fn) {
  const start = performance.now();
  const result = fn();
  Object.assign(jobs[name], { runs: jobs[name].runs + 1, lastRunAt: now(), lastMs: Math.round(performance.now() - start), lastResult: result });
  return result;
}

route('GET', '/api/system/status', ['system'], ({ db }) => {
  // En la demo los jobs corren al consultar el estado (no hay un proceso en segundo plano)
  if (!jobs.retention.lastRunAt) runJob('retention', () => applyRetention(db));
  if (!jobs['tenant-deletion'].lastRunAt) runJob('tenant-deletion', () => ({ total: 0, done: 0, pending: 0 }));
  const ai = (kind) => ({
    state: aiStats[kind].calls ? 'ok' : 'pending',
    lastOkAt: aiStats[kind].lastOkAt,
    lastModel: aiStats[kind].calls ? `${kind === 'interviewer' ? 'Entrevistador' : 'Evaluador'} de demostración` : null,
    lastMs: aiStats[kind].lastMs,
    calls: aiStats[kind].calls,
    failures: 0,
  });
  const uptimeSeconds = Math.round((Date.now() - startedAt) / 1000);
  return {
    status: 'ok',
    startedAt: new Date(startedAt).toISOString(),
    uptimeSeconds,
    down: 0,
    processes: [
      { key: 'api', name: 'API VoxReady', state: 'ok', uptimeSeconds },
      { key: 'database', name: 'Base de datos', state: 'ok', ms: 1 },
      { key: 'storage', name: 'Almacenamiento de grabaciones', state: 'ok', recordings: videos.size, megabytes: 0 },
      { key: 'interviewer', name: 'IA entrevistadora', ...ai('interviewer') },
      { key: 'evaluator', name: 'IA evaluadora', ...ai('evaluator') },
      ...Object.values(jobs).map((job) => ({ ...publicJob(job), key: `job-${job.name}`, name: job.label })),
    ],
    connected: connectedUsers(db),
  };
});

route('GET', '/api/system/jobs', ['system'], ({ db }) => ({
  status: 'ok',
  jobs: Object.values(jobs).map(publicJob),
  tenants: [...db.tenants]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => {
      const sessions = db.sessions.filter((s) => s.tenantId === t.id);
      return {
        id: t.id,
        name: t.name,
        status: t.status,
        retentionMode: t.retentionMode,
        retentionDays: t.retentionDays,
        deletionRequestedAt: null,
        sessions: sessions.length,
        expiredSessions: sessions.filter((s) => isExpired(db, s)).length,
        recordings: sessions.filter((s) => hasVideo(db, s)).length,
        anonymizedUsers: db.users.filter((u) => u.tenantId === t.id && u.anonymizedAt).length,
        openDeletionRequests: 0,
      };
    }),
}));

route('POST', '/api/system/jobs/retention/run', ['system'], ({ db, body }) => {
  const tenantId = body?.tenantId || null;
  if (tenantId && !db.tenants.some((t) => t.id === tenantId)) fail(404, 'Organización no encontrada.');
  const result = tenantId ? applyRetention(db, tenantId) : runJob('retention', () => applyRetention(db));
  return { status: 'ok', tenantId, result };
});

// ------------------------------------------------- Métricas administrativas
// Mismo formato que GET /api/metrics/overview del backend (lib/metrics.js)
const PERIOD_DAYS = { 7: 7, 30: 30, 90: 90, 365: 365 };

route('GET', '/api/metrics/overview', ['admin', 'system'], ({ db, user, apiRole, query }) => {
  const raw = String(query.get('period') || '30').toLowerCase();
  const all = raw === 'all' || raw === 'todo';
  const days = PERIOD_DAYS[raw] || 30;
  const from = all ? null : Date.now() - days * DAY_MS;
  const inPeriod = (iso) => from == null || new Date(iso).getTime() >= from;

  // ADMIN: solo su organización. SYSTEM: global, o la organización que elija
  let tenant = null;
  if (apiRole === 'admin') tenant = db.tenants.find((t) => t.id === user.tenantId);
  else if (query.get('tenantId')) {
    tenant = db.tenants.find((t) => t.id === query.get('tenantId'));
    if (!tenant) fail(400, 'La organización indicada no existe.');
  }
  const inScope = (row) => !tenant || row.tenantId === tenant.id;

  const trainings = db.sessions.filter((s) => s.status === 'COMPLETED' && inScope(s) && inPeriod(s.createdAt));
  const countBy = (key) => trainings.reduce((map, s) => map.set(s[key], (map.get(s[key]) || 0) + 1), new Map());
  const byUser = countBy('userId');
  const byTheme = countBy('themeId');

  const voceros = db.users
    .filter((u) => u.role === 'VOCERO' && u.status === 'ACTIVE' && !u.anonymizedAt && inScope(u))
    .map((u) => ({ id: u.id, name: u.name, sessions: byUser.get(u.id) || 0 }));
  const themes = db.themes
    .filter((t) => !t.deletedAt && (!tenant || t.tenantId === tenant.id || t.isGlobal))
    .map((t) => ({ id: t.id, title: t.title, sessions: byTheme.get(t.id) || 0 }));
  const ranked = (rows, label, direction) => [...rows].sort((a, b) => direction * (a.sessions - b.sessions) || a[label].localeCompare(b[label])).slice(0, 5);

  // Cada cuánto entrenan: días entre dos entrenamientos consecutivos del mismo vocero
  const last = new Map();
  let gapsMs = 0;
  let gaps = 0;
  for (const s of [...trainings].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    const at = new Date(s.createdAt).getTime();
    if (last.has(s.userId)) {
      gapsMs += at - last.get(s.userId);
      gaps += 1;
    }
    last.set(s.userId, at);
  }

  const global = !tenant;
  const events = (db.tenantEvents || []).filter((e) => inPeriod(e.at));
  const created = db.tenants.filter((t) => inPeriod(t.createdAt)).length;
  return {
    status: 'ok',
    period: { key: all ? 'all' : String(days), label: all ? 'Todo el tiempo' : `Últimos ${days} días` },
    scope: global ? 'global' : 'tenant',
    tenant: tenant ? { id: tenant.id, name: tenant.name } : null,
    summary: {
      vocerosActive: voceros.length,
      sessions: trainings.length,
      avgPerVocero: voceros.length ? Math.round((trainings.length / voceros.length) * 10) / 10 : 0,
      perWeek: all ? null : Math.round((trainings.length / days) * 7 * 10) / 10,
      avgDaysBetween: gaps ? Math.round((gapsMs / gaps / DAY_MS) * 10) / 10 : null,
      connected: connectedUsers(db, tenant?.id),
      organizations: global ? db.tenants.filter((t) => t.status === 'ACTIVE').length : null,
      organizationsCreated: global ? created : null,
      organizationsWon: global ? created : null,
      organizationsLost: global ? events.filter((e) => e.type === 'DELETED').length : null,
      organizationsSuspended: global ? events.filter((e) => e.type === 'SUSPENDED').length : null,
    },
    voceros: { top: ranked(voceros, 'name', -1), bottom: ranked(voceros, 'name', 1), total: voceros.length },
    themes: { preferred: ranked(themes, 'title', -1), least: ranked(themes, 'title', 1), total: themes.length },
    organizations: apiRole === 'system' ? [...db.tenants].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ id: t.id, name: t.name, status: t.status })) : null,
  };
});

// ------------------------------------------------------ Escenarios y temas
route('GET', '/api/scenarios/my', null, ({ db, query }) => {
  const email = query.get('email');
  if (!email) fail(400, 'Debes indicar el correo del usuario');
  const user = db.users.find((u) => u.email === email.toLowerCase());
  if (!user) fail(404, 'Usuario no encontrado');
  // Los temas "disponibles para todos los voceros" se asignan automáticamente
  for (const t of db.themes.filter((x) => x.tenantId === user.tenantId && x.availableToAllVoceros && !x.deletedAt)) {
    if (!db.assignments.some((a) => a.userId === user.id && a.themeId === t.id)) {
      db.assignments.push({ id: uid(), userId: user.id, themeId: t.id, status: 'PENDING', assignedAt: now() });
    }
  }
  saveDb();
  const scenarios = db.assignments
    .filter((a) => a.userId === user.id && a.status === 'PENDING')
    .sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt))
    .map((a) => {
      const t = themeById(db, a.themeId);
      return t && !t.deletedAt && !t.isGlobal && {
        scope: 'org',
        assignmentId: a.id,
        id: t.id,
        title: t.title,
        context: t.context,
        keyMessages: t.keyMessages,
        redLines: t.redLines,
        optic: t.optic,
        publics: t.publics,
        category: t.category,
        interview: resolveInterviewConfig(t),
        status: a.status,
        assignedAt: a.assignedAt,
      };
    })
    .filter(Boolean);
  // Escenarios generales de la biblioteca de VoxReady: todos los voceros los ven
  const generales = db.themes
    .filter((t) => t.isGlobal && !t.deletedAt)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((t) => ({
      scope: 'general',
      assignmentId: null,
      id: t.id,
      title: t.title,
      context: t.context,
      keyMessages: t.keyMessages,
      redLines: t.redLines,
      optic: t.optic,
      publics: t.publics,
      category: t.category,
      interview: resolveInterviewConfig(t),
      status: 'PENDING',
      assignedAt: t.createdAt,
    }));
  return { status: 'ok', scenarios: [...scenarios, ...generales] };
});

route('GET', '/api/themes', ['admin'], ({ db, user }) => ({
  status: 'ok',
  themes: db.themes
    .filter((t) => t.tenantId === user.tenantId && !t.deletedAt)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((t) => toApiTheme(db, t)),
}));

// Creación de temas: el frontend envía el correo del administrador (igual que el backend actual)
route('POST', '/api/themes', null, ({ db, body }) => {
  const { email, title, context, keyMessages, category, optic, publics, redLines, availableToAllVoceros, voceroIds } = body || {};
  if (!email || !title || !context || !keyMessages) fail(400, 'Faltan datos obligatorios.');
  const user = db.users.find((u) => u.email === email);
  if (!user) fail(404, 'Usuario no encontrado.');
  if (user.role !== 'ADMIN') fail(403, 'Solo un administrador puede crear escenarios.');
  if (db.themes.some((t) => t.tenantId === user.tenantId && t.title === title.trim())) fail(409, 'Ya existe un tema con ese nombre.');
  const theme = {
    id: uid(),
    tenantId: user.tenantId,
    title: title.trim(),
    context: context.trim(),
    keyMessages: JSON.stringify(keyMessages),
    category: category || 'GENERAL',
    optic: optic || null,
    publics: publics ? JSON.stringify(publics) : null,
    redLines: redLines ? JSON.stringify(redLines) : null,
    availableToAllVoceros: Boolean(availableToAllVoceros),
    interviewConfig: normalizeInterviewConfig(body.interview),
    createdAt: now(),
  };
  db.themes.push(theme);
  syncAssignments(db, theme, Array.isArray(voceroIds) ? voceroIds : []);
  saveDb();
  return { message: 'Escenario creado correctamente.', theme };
});

route('GET', '/api/themes/:id', ['admin'], ({ db, user, params }) => {
  const theme = themeById(db, params.id);
  if (!theme || theme.tenantId !== user.tenantId || theme.deletedAt) fail(404, 'Tema no encontrado.');
  return { status: 'ok', theme: toApiTheme(db, theme) };
});

// Voceros con acceso a un tema
route('PUT', '/api/themes/:id/assignments', ['admin'], ({ db, user, params, body }) => {
  const theme = themeById(db, params.id);
  if (!theme || theme.tenantId !== user.tenantId || theme.deletedAt) fail(404, 'Tema no encontrado.');
  const { voceroIds = [], availableToAllVoceros } = body || {};
  if (!Array.isArray(voceroIds)) fail(400, 'Lista de voceros no válida.');
  if (typeof availableToAllVoceros === 'boolean') theme.availableToAllVoceros = availableToAllVoceros;
  syncAssignments(db, theme, theme.availableToAllVoceros ? [] : voceroIds);
  saveDb();
  return { status: 'ok', theme: toApiTheme(db, theme) };
});

// Borrado lógico: deja de estar disponible pero conserva el historial
route('DELETE', '/api/themes/:id', ['admin'], ({ db, user, params }) => {
  const theme = themeById(db, params.id);
  if (!theme || theme.tenantId !== user.tenantId || theme.deletedAt) fail(404, 'Tema no encontrado.');
  theme.deletedAt = now();
  saveDb();
  return { status: 'ok' };
});

route('PUT', '/api/themes/:id', ['admin'], ({ db, user, params, body }) => {
  const theme = themeById(db, params.id);
  if (!theme || theme.tenantId !== user.tenantId || theme.deletedAt) fail(404, 'Tema no encontrado.');
  const { title, context, keyMessages = [], redLines = [], publics = [], optic, category, availableToAllVoceros, voceroIds = [] } = body || {};
  if (!title?.trim() || !context?.trim()) fail(400, 'El nombre y el contexto son obligatorios.');
  if (!keyMessages.length) fail(400, 'Agrega al menos un mensaje clave.');
  if (db.themes.some((t) => t.tenantId === theme.tenantId && t.title === title.trim() && t.id !== theme.id)) fail(409, 'Ya existe otro tema con ese nombre.');
  Object.assign(theme, {
    title: title.trim(),
    context: context.trim(),
    keyMessages: JSON.stringify(keyMessages),
    redLines: JSON.stringify(redLines),
    publics: JSON.stringify(publics),
    optic: optic || null,
    category: category || theme.category,
    availableToAllVoceros: Boolean(availableToAllVoceros),
    ...(body.interview !== undefined ? { interviewConfig: normalizeInterviewConfig(body.interview) } : {}),
  });
  syncAssignments(db, theme, voceroIds);
  saveDb();
  return { status: 'ok', theme: toApiTheme(db, theme) };
});

// ------------------------------------------- Biblioteca de escenarios generales
const LIBRARY_CATEGORIES = ['CRISIS', 'MEDIOS', 'INSTITUCIONAL', 'GENERAL'];
const toApiLibraryTheme = (db, t) => ({
  id: t.id,
  title: t.title,
  context: t.context,
  category: t.category,
  optic: t.optic,
  keyMessages: parseList(t.keyMessages),
  redLines: parseList(t.redLines),
  publics: parseList(t.publics),
  interview: resolveInterviewConfig(t),
  sessions: db.sessions.filter((s) => s.themeId === t.id).length,
  createdAt: t.createdAt,
});

function readLibraryTheme(body = {}) {
  const { title, context, category, optic, keyMessages = [], redLines = [] } = body;
  const clean = (list) => (Array.isArray(list) ? list.map((x) => String(x).trim()).filter(Boolean) : []);
  if (!title?.trim() || !context?.trim()) fail(400, 'El nombre y el contexto son obligatorios.');
  if (!clean(keyMessages).length) fail(400, 'Agrega al menos un mensaje clave.');
  return {
    title: title.trim(),
    context: context.trim(),
    category: LIBRARY_CATEGORIES.includes(category) ? category : 'GENERAL',
    optic: optic || null,
    keyMessages: JSON.stringify(clean(keyMessages)),
    redLines: JSON.stringify(clean(redLines)),
    interviewConfig: normalizeInterviewConfig(body.interview),
  };
}
const libraryTheme = (db, id) => {
  const theme = themeById(db, id);
  if (!theme?.isGlobal || theme.deletedAt) fail(404, 'Escenario general no encontrado.');
  return theme;
};
const libraryTitleTaken = (db, title, exceptId) => db.themes.some((t) => t.isGlobal && !t.deletedAt && t.title === title && t.id !== exceptId);

route('GET', '/api/library/themes', ['system', 'master', 'admin'], ({ db }) => ({
  status: 'ok',
  themes: db.themes
    .filter((t) => t.isGlobal && !t.deletedAt)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((t) => toApiLibraryTheme(db, t)),
}));

route('POST', '/api/library/themes', ['system'], ({ db, body }) => {
  const data = readLibraryTheme(body);
  if (libraryTitleTaken(db, data.title)) fail(409, 'Ya existe un escenario general con ese nombre.');
  const theme = { id: uid(), ...data, publics: '[]', isGlobal: true, tenantId: null, availableToAllVoceros: false, createdAt: now(), deletedAt: null };
  db.themes.push(theme);
  saveDb();
  return { status: 'ok', theme: toApiLibraryTheme(db, theme) };
});

route('PUT', '/api/library/themes/:id', ['system'], ({ db, params, body }) => {
  const theme = libraryTheme(db, params.id);
  const data = readLibraryTheme(body);
  if (libraryTitleTaken(db, data.title, theme.id)) fail(409, 'Ya existe un escenario general con ese nombre.');
  Object.assign(theme, data);
  saveDb();
  return { status: 'ok', theme: toApiLibraryTheme(db, theme) };
});

route('DELETE', '/api/library/themes/:id', ['system'], ({ db, params }) => {
  libraryTheme(db, params.id).deletedAt = now();
  saveDb();
  return { status: 'ok' };
});

// Copia un escenario general a la organización del administrador para adaptarlo
route('POST', '/api/library/themes/:id/copy', ['admin'], ({ db, user, params }) => {
  const source = libraryTheme(db, params.id);
  const taken = new Set(db.themes.filter((t) => t.tenantId === user.tenantId).map((t) => t.title));
  let title = source.title;
  for (let n = 1; taken.has(title); n += 1) title = `${source.title} (copia${n > 1 ? ` ${n}` : ''})`;
  const theme = {
    id: uid(),
    tenantId: user.tenantId,
    title,
    context: source.context,
    category: source.category,
    optic: source.optic,
    keyMessages: source.keyMessages,
    redLines: source.redLines,
    publics: source.publics,
    interviewConfig: source.interviewConfig,
    availableToAllVoceros: false,
    isGlobal: false,
    createdAt: now(),
  };
  db.themes.push(theme);
  saveDb();
  return { status: 'ok', theme: { id: theme.id, title: theme.title } };
});

route('GET', '/api/tenant/settings', ['admin'], ({ db, user }) => {
  const tenant = db.tenants.find((t) => t.id === user.tenantId);
  return { status: 'ok', settings: { retentionMode: tenant.retentionMode, retentionDays: tenant.retentionDays, name: tenant.name } };
});

route('PUT', '/api/tenant/settings', ['admin'], ({ db, user, body }) => {
  const { retentionMode, retentionDays } = body || {};
  if (!['FULL', 'METRICS'].includes(retentionMode)) fail(400, 'Modo de retención no válido.');
  const days = Math.round(Number(retentionDays));
  if (!Number.isFinite(days) || days < 1 || days > 3650) fail(400, 'El plazo debe estar entre 1 y 3650 días.');
  const tenant = db.tenants.find((t) => t.id === user.tenantId);
  tenant.retentionMode = retentionMode;
  tenant.retentionDays = days;
  saveDb();
  return { status: 'ok', settings: { retentionMode, retentionDays: days } };
});

// Estilo de la organización: colores con los que sus voceros ven la plataforma
const HEX = /^#[0-9a-f]{6}$/i;
route('GET', '/api/tenant/branding', ['admin'], ({ db, user }) => {
  const tenant = db.tenants.find((t) => t.id === user.tenantId);
  return { status: 'ok', branding: { brandColor: tenant.brandColor || null, accentColor: tenant.accentColor || null, name: tenant.name } };
});

route('PUT', '/api/tenant/branding', ['admin'], ({ db, user, body }) => {
  const { brandColor = null, accentColor = null } = body || {};
  const reset = brandColor == null && accentColor == null;
  if (!reset && (!HEX.test(brandColor || '') || !HEX.test(accentColor || ''))) fail(400, 'Los colores deben tener el formato #RRGGBB.');
  const tenant = db.tenants.find((t) => t.id === user.tenantId);
  tenant.brandColor = reset ? null : brandColor.toUpperCase();
  tenant.accentColor = reset ? null : accentColor.toUpperCase();
  saveDb();
  return { status: 'ok', branding: { brandColor: tenant.brandColor, accentColor: tenant.accentColor, name: tenant.name } };
});

route('GET', '/api/admin/overview', ['admin'], ({ db, user }) => {
  const scored = db.sessions.filter((s) => s.tenantId === user.tenantId && s.score != null);
  return {
    status: 'ok',
    themes: db.themes.filter((t) => t.tenantId === user.tenantId && !t.deletedAt).length,
    voceros: db.users.filter((u) => u.tenantId === user.tenantId && u.role === 'VOCERO' && u.status === 'ACTIVE').length,
    sessionsMonth: db.sessions.filter((s) => s.tenantId === user.tenantId && new Date(s.createdAt).getTime() >= startOfMonth()).length,
    evaluated: scored.length,
    avgScore: scored.length ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length) : null,
  };
});

// ------------------------------------------------------------- Prácticas
route('POST', '/api/sessions', null, ({ db, body }) => {
  const { email, themeId } = body || {};
  if (!email || !themeId) fail(400, 'Faltan email o themeId');
  const user = db.users.find((u) => u.email === email);
  if (!user) fail(404, 'Usuario no encontrado');
  const theme = themeById(db, themeId);
  if (!theme) fail(404, 'Escenario no encontrado');
  // Los escenarios generales (biblioteca de VoxReady) están disponibles para todos los voceros
  const isGeneral = theme.isGlobal && !theme.deletedAt;
  if (!isGeneral && theme.tenantId !== user.tenantId) fail(403, 'El escenario no pertenece al tenant del usuario');
  if (!isGeneral && !db.assignments.some((a) => a.userId === user.id && a.themeId === theme.id)) fail(403, 'El escenario no está asignado al usuario');
  const session = { id: uid(), status: 'CREATED', createdAt: now(), userId: user.id, themeId: theme.id, tenantId: user.tenantId, completedAt: null, transcript: null, metrics: null, report: null, score: null, review: null, hasVideo: false };
  db.sessions.push(session);
  saveDb();
  return { status: 'ok', sessionId: session.id };
});

// La grabación queda disponible mientras la pestaña siga abierta
route('POST', '/api/sessions/:id/video', null, ({ db, params, rawBody }) => {
  const session = db.sessions.find((s) => s.id === params.id);
  if (!session) fail(404, 'Sesión no encontrada');
  if (rawBody instanceof Blob && rawBody.size) {
    videos.set(session.id, URL.createObjectURL(rawBody));
    session.hasVideo = true;
  }
  session.status = 'COMPLETED';
  saveDb();
  return { status: 'ok', mensaje: 'Video guardado correctamente', file: `${session.id}.webm` };
});

// Igual que el backend: exige sesión iniciada y toma el escenario de la práctica en curso
// (sin sessionId usa un escenario genérico, para el Laboratorio)
route('POST', '/api/interviewer/next-question', [], async ({ db, user, body }) => {
  const start = performance.now();
  const history = Array.isArray(body?.history) ? body.history : [];
  let theme = null;
  if (body?.sessionId) {
    const session = db.sessions.find((s) => s.id === body.sessionId);
    if (!session || session.userId !== user.id) fail(404, 'Sesión no encontrada.');
    if (session.score != null) fail(409, 'Esta entrevista ya fue evaluada.');
    theme = themeById(db, session.themeId);
  }
  const plan = turnPlan(normalizeInterviewConfig(theme?.interviewConfig), history.filter((h) => h.role === 'interviewer').length);
  if (theme && plan.done) fail(409, 'La entrevista ya completó todas sus preguntas.');
  await wait(700 + Math.random() * 700);
  const question = nextQuestion({ theme, history, plan });
  recordAi('interviewer', Math.round(performance.now() - start));
  return {
    status: 'ok',
    question,
    kind: plan.kind,
    number: plan.number,
    total: plan.total,
    interview: theme ? resolveInterviewConfig(theme) : null,
    model: 'Entrevistador de demostración',
    ms: Math.round(performance.now() - start),
  };
});

route('POST', '/api/sessions/:id/evaluate', ['user'], async ({ db, user, params, body }) => {
  const session = db.sessions.find((s) => s.id === params.id);
  if (!session) fail(404, 'Sesión no encontrada.');
  if (session.userId !== user.id) fail(403, 'Esta sesión no te pertenece.');
  if (session.report) return { status: 'ok', session: fullSession(db, session) };
  const { transcript = [], metrics = {} } = body || {};
  if (!Array.isArray(transcript) || transcript.length === 0) fail(400, 'La entrevista no tiene preguntas registradas.');
  await wait(4500);
  const { pattern, source } = patternFor(db, session.themeId, session.userId);
  const report = evaluateSession({ theme: themeById(db, session.themeId), transcript, metrics, pattern, patternSource: source });
  recordAi('evaluator', report.ai.ms);
  Object.assign(session, { status: 'COMPLETED', completedAt: now(), transcript, metrics, report, score: report.global });
  saveDb();
  return { status: 'ok', session: fullSession(db, session) };
});

const canView = (user, apiRole, s) =>
  s.userId === user.id || (apiRole === 'admin' ? s.tenantId === user.tenantId : apiRole === 'master' || apiRole === 'system');

route('GET', '/api/sessions/:id', [], ({ db, user, apiRole, params }) => {
  const session = db.sessions.find((s) => s.id === params.id);
  if (!session) fail(404, 'Sesión no encontrada.');
  if (!canView(user, apiRole, session)) fail(403, 'No puedes ver esta sesión.');
  return { status: 'ok', session: fullSession(db, session) };
});

route('DELETE', '/api/sessions/:id', ['user'], ({ db, user, params }) => {
  const session = db.sessions.find((s) => s.id === params.id);
  if (!session) fail(404, 'Sesión no encontrada.');
  if (session.userId !== user.id) fail(403, 'Esta sesión no te pertenece.');
  if (session.score != null) fail(400, 'No se puede descartar una sesión ya evaluada.');
  db.sessions = db.sessions.filter((s) => s.id !== session.id);
  videos.delete(session.id);
  saveDb();
  return { status: 'ok' };
});

route('GET', '/api/sessions', ['user'], ({ db, user }) => ({
  status: 'ok',
  sessions: db.sessions
    .filter((s) => s.userId === user.id && s.score != null)
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
    .slice(0, 20)
    .map((s) => summary(db, s)),
}));

route('GET', '/api/practices', ['admin', 'master', 'system'], ({ db, user, apiRole, query }) => ({
  status: 'ok',
  practices: db.sessions
    .filter(
      (s) =>
        s.score != null &&
        (apiRole !== 'admin' || s.tenantId === user.tenantId) &&
        (!query.get('userId') || s.userId === query.get('userId')) &&
        (!query.get('themeId') || s.themeId === query.get('themeId')),
    )
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
    .slice(0, 100)
    .map((s) => {
      const tenant = db.tenants.find((t) => t.id === s.tenantId);
      return {
        ...summary(db, s),
        tenant: tenant ? { id: tenant.id, name: tenant.name } : null,
        hasVideo: hasVideo(db, s),
        reviewed: Boolean(s.review),
        redLinesCrossed: (s.report?.lineasRojas || []).filter((l) => l.cruzada).length,
      };
    }),
}));

route('GET', '/api/review-queue', ['master', 'system'], ({ db }) => {
  const items = db.sessions
    .filter((s) => s.score != null)
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
    .slice(0, 100)
    .map((s) => {
      const tenant = db.tenants.find((t) => t.id === s.tenantId);
      return { ...summary(db, s), tenant: tenant ? { id: tenant.id, name: tenant.name } : null, reason: reviewReason(s), review: s.review, hasVideo: hasVideo(db, s) };
    })
    .sort((a, b) => Number(Boolean(a.review)) - Number(Boolean(b.review)) || a.reason.priority - b.reason.priority);
  return { status: 'ok', pending: items.filter((i) => !i.review).length, items };
});

route('POST', '/api/sessions/:id/review', ['master', 'system'], ({ db, user, params, body }) => {
  const session = db.sessions.find((s) => s.id === params.id);
  if (!session?.report) fail(404, 'Sesión evaluada no encontrada.');
  const { scores = {}, comment = '' } = body || {};
  const clean = {};
  for (const key of ['expression', 'voice', 'coherence', 'empathy']) {
    const v = scores[key];
    clean[key] = v === '' || v == null ? null : Math.max(0, Math.min(100, Math.round(Number(v))));
  }
  session.review = {
    scores: clean,
    comment: String(comment).trim(),
    reviewer: { id: user.id, name: user.name },
    at: now(),
    agreement: Object.fromEntries(session.report.areas.map((a) => [a.key, a.score != null && clean[a.key] != null ? Math.abs(a.score - clean[a.key]) : null])),
  };
  saveDb();
  return { status: 'ok', review: session.review };
});

// --------------------------------------------------------------- Patrones
function validateConfig(config) {
  if (!config?.areas) return 'Falta la configuración de las áreas.';
  const total = ['expression', 'voice', 'coherence', 'empathy'].reduce((s, k) => s + Number(config.areas[k] || 0), 0);
  if (total !== 100) return `Los pesos de las áreas deben sumar 100% (suman ${total}%).`;
  for (const area of ['voice', 'expression', 'coherence', 'empathy']) {
    const sum = Object.values(config[area]?.criteria || {}).reduce((s, c) => s + Number(c.weight || 0), 0);
    if (sum <= 0) return `El área "${area}" necesita al menos un criterio con peso mayor a 0.`;
  }
  return null;
}

route('GET', '/api/patterns', ['master', 'system'], ({ db }) => ({
  status: 'ok',
  defaults: DEFAULT_CONFIG,
  patterns: [...db.patterns].sort((a, b) => b.version - a.version).map((p) => toApiPattern(db, p)),
}));

route('POST', '/api/patterns', ['master'], ({ db, user, body }) => {
  const config = deepMerge(DEFAULT_CONFIG, body?.config || {});
  const invalid = validateConfig(config);
  if (invalid) fail(400, invalid);
  const activate = Boolean(body?.activate);
  if (activate) db.patterns.forEach((p) => p.status === 'ACTIVE' && (p.status = 'INACTIVE'));
  const pattern = {
    id: uid(),
    version: Math.max(0, ...db.patterns.map((p) => p.version)) + 1,
    status: activate ? 'ACTIVE' : 'DRAFT',
    name: body?.name?.trim() || null,
    config,
    createdAt: now(),
    createdById: user.id,
  };
  db.patterns.push(pattern);
  saveDb();
  return { status: 'ok', pattern: toApiPattern(db, pattern) };
});

route('POST', '/api/patterns/:id/activate', ['master'], ({ db, params }) => {
  const pattern = db.patterns.find((p) => p.id === params.id);
  if (!pattern) fail(404, 'Patrón no encontrado.');
  db.patterns.forEach((p) => {
    if (p.status === 'ACTIVE' && p.id !== pattern.id) p.status = 'INACTIVE';
  });
  pattern.status = 'ACTIVE';
  saveDb();
  return { status: 'ok' };
});

route('GET', '/api/patterns/themes', ['master', 'system'], ({ db }) => ({
  status: 'ok',
  themes: db.themes
    .filter((t) => !t.deletedAt)
    .map((t) => ({ t, tenant: db.tenants.find((x) => x.id === t.tenantId) || { id: 'general', name: 'Escenarios generales' } }))
    .sort((a, b) => a.tenant.name.localeCompare(b.tenant.name) || a.t.title.localeCompare(b.t.title))
    .map(({ t, tenant }) => {
      const o = db.patternOverrides.find((x) => x.themeId === t.id);
      const p = o && db.patterns.find((x) => x.id === o.patternId);
      return { id: t.id, title: t.title, tenant: { id: tenant.id, name: tenant.name }, override: p ? { patternId: p.id, name: p.name || 'Patrón base' } : null };
    }),
}));

route('GET', '/api/patterns/voceros', ['master', 'system'], ({ db, query }) => {
  const tenantId = query.get('tenantId');
  return {
    status: 'ok',
    voceros: db.users
      .filter((u) => u.role === 'VOCERO' && (!tenantId || u.tenantId === tenantId))
      .map((u) => ({ u, tenant: db.tenants.find((t) => t.id === u.tenantId) }))
      .sort((a, b) => (a.tenant?.name || '').localeCompare(b.tenant?.name || '') || a.u.name.localeCompare(b.u.name))
      .map(({ u, tenant }) => {
        const o = db.voceroOverrides.find((x) => x.userId === u.id);
        const p = o && db.patterns.find((x) => x.id === o.patternId);
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          area: u.area,
          tenant: tenant ? { id: tenant.id, name: tenant.name } : null,
          override: p ? { patternId: p.id, name: p.name || 'Patrón base' } : null,
        };
      }),
  };
});

route('PUT', '/api/pattern-overrides/vocero/:userId', ['master'], ({ db, params, body }) => {
  const user = userById(db, params.userId);
  if (!user || user.role !== 'VOCERO') fail(404, 'Vocero no encontrado.');
  if (!db.patterns.some((p) => p.id === body?.patternId)) fail(404, 'Patrón no encontrado.');
  db.voceroOverrides = db.voceroOverrides.filter((o) => o.userId !== user.id);
  db.voceroOverrides.push({ userId: user.id, patternId: body.patternId, createdAt: now() });
  saveDb();
  return { status: 'ok' };
});

route('DELETE', '/api/pattern-overrides/vocero/:userId', ['master'], ({ db, params }) => {
  db.voceroOverrides = db.voceroOverrides.filter((o) => o.userId !== params.userId);
  saveDb();
  return { status: 'ok' };
});

route('PUT', '/api/pattern-overrides/:themeId', ['master'], ({ db, params, body }) => {
  if (!themeById(db, params.themeId)) fail(404, 'Escenario no encontrado.');
  if (!db.patterns.some((p) => p.id === body?.patternId)) fail(404, 'Patrón no encontrado.');
  db.patternOverrides = db.patternOverrides.filter((o) => o.themeId !== params.themeId);
  db.patternOverrides.push({ themeId: params.themeId, patternId: body.patternId, createdAt: now() });
  saveDb();
  return { status: 'ok' };
});

route('DELETE', '/api/pattern-overrides/:themeId', ['master'], ({ db, params }) => {
  db.patternOverrides = db.patternOverrides.filter((o) => o.themeId !== params.themeId);
  saveDb();
  return { status: 'ok' };
});

route('GET', '/api/master/overview', ['master', 'system'], ({ db }) => {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const evaluated = db.sessions.filter((s) => s.score != null);
  const reviewed = db.sessions.filter((s) => s.review).length;
  const diffs = evaluated.flatMap((s) => Object.values(s.review?.agreement || {}).filter((d) => d != null));
  const agreement = diffs.length ? Math.round((diffs.filter((d) => d <= 10).length / diffs.length) * 100) : null;
  const buckets = [30, 40, 50, 60, 70, 80, 90].map((from) => ({
    range: String(from),
    count: evaluated.filter((s) => s.score >= from && (from === 90 ? s.score <= 100 : s.score < from + 10)).length,
  }));
  buckets[0].count += evaluated.filter((s) => s.score < 30).length;
  const active = [...db.patterns].filter((p) => p.status === 'ACTIVE').sort((a, b) => b.version - a.version)[0];
  return {
    status: 'ok',
    tenants: db.tenants.filter((t) => t.status === 'ACTIVE').length,
    sessionsWeek: db.sessions.filter((s) => new Date(s.createdAt).getTime() >= weekAgo).length,
    evaluated: evaluated.length,
    pendingReview: evaluated.length - reviewed,
    agreement,
    histogram: buckets,
    activePattern: active ? toApiPattern(db, active) : null,
  };
});

// ------------------------------------------------------------ Despachador

async function handle(method, url, headers, rawBody) {
  const db = getDb();
  const found = routes.find((r) => r.method === method && r.regex.test(url.pathname));
  if (!found) return { status: 404, body: { status: 'error', mensaje: `Ruta no disponible en la demo: ${method} ${url.pathname}` } };

  const params = Object.fromEntries(found.keys.map((k, i) => [k, decodeURIComponent(url.pathname.match(found.regex)[i + 1])]));
  let body = null;
  if (typeof rawBody === 'string') {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }
  }

  try {
    let user = null;
    let apiRole = null;
    if (found.roles) {
      const token = (headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
      user = token.startsWith('demo.') ? userById(db, token.slice(5)) : null;
      const tenant = user && db.tenants.find((t) => t.id === user.tenantId);
      if (!user) fail(401, 'Sesión no válida o expirada. Inicia sesión nuevamente.');
      if (user.status !== 'ACTIVE' || tenant?.status === 'SUSPENDED') fail(401, 'Tu cuenta no está activa.');
      apiRole = ROLE_TO_API[user.role];
      if (found.roles.length && !found.roles.includes(apiRole)) fail(403, 'No tienes permiso para esta acción.');
      lastSeen.set(user.id, Date.now());
    }
    await wait(120 + Math.random() * 180); // latencia de red simulada
    const result = await found.handler({ db, user, apiRole, params, query: url.searchParams, body, rawBody });
    return { status: method === 'POST' && /\/api\/(tenants|users|themes|patterns|library\/themes)$/.test(url.pathname) ? 201 : 200, body: result };
  } catch (error) {
    if (error instanceof HttpError) return { status: error.status, body: { status: 'error', mensaje: error.message } };
    console.error('[Demo] Error en', method, url.pathname, error);
    return { status: 500, body: { status: 'error', mensaje: 'Error interno de la demo.' } };
  }
}

// Reemplaza window.fetch: las rutas /api/* las responde la demo; el resto pasa al fetch real
export function installDemoServer() {
  if (window.__voxreadyDemo) return;
  window.__voxreadyDemo = true;
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);

    const method = (init.method || request?.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || request?.headers || {});
    const { status, body } = await handle(method, url, headers, init.body ?? null);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
}
