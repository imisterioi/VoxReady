// Cálculo REAL de vencimientos de retención y del plan vigente (funciones puras, sin BD).
//
// Regla base: una sesión vence cuando el TIEMPO EFECTIVO transcurrido desde
// su creación supera el plazo del tenant, descontando las pausas por suspensión:
//     efectivo = ahora − createdAt − pausas dentro del rango
//     vencida  = efectivo > retentionDays * 24 h
// (ver lib/retentionPause.js y `applyRetention` en routes/sessions.js).
//
// De ahí se derivan, sin estimaciones:
//   · expiresAt de una sesión: instante en que el tiempo efectivo alcanza el plazo.
//   · próximo borrado (`nextPurgeAt`): el vencimiento futuro más cercano del tenant.
//   · fin del periodo actual (`periodEndsAt`): el vencimiento MÁS LEJANO (la sesión más
//     reciente). A partir de ese instante ninguna sesión sigue bajo el plan vigente, así que es
//     la fecha efectiva natural para aplicar un cambio de plan SIN alterar nada retroactivamente.
const { pauseOverlapMs, effectiveElapsedMs } = require('./retentionPause');

const DAY_MS = 24 * 60 * 60 * 1000;
const MODES = ['FULL', 'METRICS'];

// Instante en que una sesión alcanza el plazo (con las pausas descontadas).
// Se resuelve por iteración porque el propio vencimiento puede entrar en una pausa posterior.
function sessionExpiresAt({ createdAt, days, intervals = [] } = {}) {
  const start = new Date(createdAt).getTime();
  if (!Number.isFinite(start)) return null;
  const plazo = Math.max(0, Number(days) || 0) * DAY_MS;
  let candidate = start + plazo;
  for (let i = 0; i < 5; i += 1) {
    const next = start + plazo + pauseOverlapMs(intervals, start, candidate);
    if (next === candidate) break;
    candidate = next;
  }
  return new Date(candidate);
}

// ¿Está vencida AHORA? (misma comparación que usa el proceso automático: `> plazo`)
function isExpired({ createdAt, days, intervals = [], now = Date.now() } = {}) {
  const elapsed = effectiveElapsedMs(createdAt, intervals, now);
  return elapsed > Math.max(0, Number(days) || 0) * DAY_MS;
}

// Plan EFECTIVO del tenant: si hay un cambio programado cuya fecha ya llegó, manda el cambio.
// `due: true` indica que la capa que persiste debe materializarlo (aplicarlo y limpiar el pendiente).
function effectivePlan(tenant = {}, now = Date.now()) {
  const pendingDays = tenant.retentionDaysPending == null ? null : Number(tenant.retentionDaysPending);
  const pendingMode = tenant.retentionModePending || null;
  const effectiveAt = tenant.retentionEffectiveAt ? new Date(tenant.retentionEffectiveAt).getTime() : null;
  const hasPending = pendingDays != null || pendingMode != null;
  if (hasPending && effectiveAt != null && effectiveAt <= now) {
    return {
      mode: MODES.includes(pendingMode) ? pendingMode : tenant.retentionMode || 'FULL',
      days: Number.isFinite(pendingDays) && pendingDays > 0 ? pendingDays : tenant.retentionDays || 90,
      due: true,
      pending: null,
    };
  }
  return {
    mode: tenant.retentionMode || 'FULL',
    days: Number(tenant.retentionDays) || 90,
    due: false,
    pending: hasPending ? { mode: pendingMode, days: pendingDays, effectiveAt: tenant.retentionEffectiveAt || null } : null,
  };
}

// Estado completo del plan a partir de las sesiones del tenant (las mismas filas que usa el
// proceso automático: `createdAt` + `userId`), con las pausas de cada vocero.
function planState({ tenant = {}, sessions = [], pausesByUser = new Map(), now = Date.now() } = {}) {
  const plan = effectivePlan(tenant, now);
  const rows = (sessions || []).map((s) => {
    const intervals = pausesByUser.get(s.userId) || [];
    const expiresAt = sessionExpiresAt({ createdAt: s.createdAt, days: plan.days, intervals });
    return { id: s.id, userId: s.userId, expiresAt, expired: isExpired({ createdAt: s.createdAt, days: plan.days, intervals, now }) };
  });

  const upcoming = rows.filter((r) => r.expiresAt && r.expiresAt.getTime() > now).map((r) => r.expiresAt.getTime());
  const all = rows.filter((r) => r.expiresAt).map((r) => r.expiresAt.getTime());

  return {
    mode: plan.mode,
    days: plan.days,
    pending: plan.pending,
    due: plan.due,
    sessions: rows.length,
    expiredSessions: rows.filter((r) => r.expired).length,
    // Próxima fecha en que el sistema puede eliminar algo (la más cercana que aún no vence).
    nextPurgeAt: upcoming.length ? new Date(Math.min(...upcoming)) : null,
    // Fin del periodo actual: cuando la sesión más reciente alcanza el plazo. Es la fecha
    // efectiva de un cambio de plan (a partir de ahí no queda nada bajo el plan vigente).
    periodEndsAt: all.length ? new Date(Math.max(...all)) : null,
  };
}

// Fecha efectiva de un cambio de plan: fin del periodo actual (o ahora, si no hay datos bajo el
// plan vigente). Nunca se adelanta ni se altera el plazo de las sesiones existentes.
function planChangeEffectiveAt({ tenant = {}, sessions = [], pausesByUser = new Map(), now = Date.now() } = {}) {
  const state = planState({ tenant, sessions, pausesByUser, now });
  if (!state.periodEndsAt) return new Date(now);
  return state.periodEndsAt.getTime() > now ? state.periodEndsAt : new Date(now);
}

// Un cambio de plan pide conservar los datos existentes más tiempo: si además hay un cambio de
// plan programado con un plazo MENOR, se eleva para que la extensión aprobada no quede sin efecto
// cuando llegue su fecha. Devuelve el valor pendiente que corresponde guardar.
function pendingDaysAfterExtension({ pendingDays = null, requestedDays } = {}) {
  if (pendingDays == null) return null;
  const pendiente = Number(pendingDays);
  if (!Number.isFinite(pendiente)) return null;
  return pendiente < Number(requestedDays) ? Number(requestedDays) : pendiente;
}

module.exports = {
  DAY_MS,
  MODES,
  sessionExpiresAt,
  isExpired,
  effectivePlan,
  planState,
  planChangeEffectiveAt,
  pendingDaysAfterExtension,
};
