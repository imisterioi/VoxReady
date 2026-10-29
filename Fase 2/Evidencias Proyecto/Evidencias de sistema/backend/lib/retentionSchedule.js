// Persistencia del plan de retención: cambio programado y solicitudes de extensión.
//
// El cálculo vive en `lib/retentionPlan.js` (puro). Aquí solo se lee/escribe en PostgreSQL:
//  - `syncDuePlans`: materializa los cambios de plan cuya fecha efectiva ya llegó (idempotente).
//  - `buildPlanState`: estado del plan con fechas reales (próximo borrado y fin de periodo).
//  - `schedulePlanChange`: deja un cambio PENDIENTE con su fecha efectiva.
//  - `applyExtension`: aplica de inmediato el plazo extendido y deja coherente el pendiente.
const { effectivePlan, planState, planChangeEffectiveAt, pendingDaysAfterExtension } = require('./retentionPlan');

const TENANT_PLAN_FIELDS = {
  id: true,
  name: true,
  retentionMode: true,
  retentionDays: true,
  retentionModePending: true,
  retentionDaysPending: true,
  retentionEffectiveAt: true,
};

// Contexto que usa el cálculo: sesiones (creación y dueño) y pausas por usuario.
// Es la MISMA información que revisa el proceso automático, así que las fechas que se muestran
// coinciden con las que aplica la retención.
async function loadPlanContext(prisma, tenantId) {
  const [sessions, pauses] = await Promise.all([
    prisma.session.findMany({ where: { tenantId }, select: { id: true, userId: true, createdAt: true } }),
    prisma.retentionPause.findMany({
      where: { user: { tenantId } },
      select: { userId: true, startedAt: true, endedAt: true },
    }),
  ]);
  const pausesByUser = new Map();
  for (const p of pauses) {
    if (!pausesByUser.has(p.userId)) pausesByUser.set(p.userId, []);
    pausesByUser.get(p.userId).push(p);
  }
  return { sessions, pausesByUser };
}

// Estado del plan vigente + fechas reales del tenant.
async function buildPlanState(prisma, tenant, { now = Date.now() } = {}) {
  const { sessions, pausesByUser } = await loadPlanContext(prisma, tenant.id);
  const state = planState({ tenant, sessions, pausesByUser, now });
  return { ...state, tenantId: tenant.id, tenantName: tenant.name };
}

// Aplica los cambios de plan cuya fecha efectiva ya se cumplió y limpia el pendiente.
// Idempotente: si no hay nada vencido no toca la base.
async function syncDuePlans(prisma, { now = Date.now() } = {}) {
  const tenants = await prisma.tenant.findMany({
    where: { retentionEffectiveAt: { not: null, lte: new Date(now) } },
    select: TENANT_PLAN_FIELDS,
  });
  let applied = 0;
  for (const tenant of tenants) {
    const plan = effectivePlan(tenant, now);
    if (!plan.due) continue;
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        retentionMode: plan.mode,
        retentionDays: plan.days,
        retentionModePending: null,
        retentionDaysPending: null,
        retentionEffectiveAt: null,
      },
    });
    applied += 1;
    console.log(`[Retención] plan de ${tenant.name}: aplicado el cambio programado (${plan.mode} · ${plan.days} días)`);
  }
  return { applied };
}

// Programa un cambio de plan (o lo aplica ya, si no hay datos bajo el plan vigente).
// No altera retroactivamente ninguna sesión: hasta la fecha efectiva se sigue aplicando el plan
// actual (ver `effectivePlan`).
async function schedulePlanChange(prisma, tenant, { mode, days }, { now = Date.now() } = {}) {
  const { sessions, pausesByUser } = await loadPlanContext(prisma, tenant.id);
  const effectiveAt = planChangeEffectiveAt({ tenant, sessions, pausesByUser, now });
  const applyNow = effectiveAt.getTime() <= now;

  const updated = await prisma.tenant.update({
    where: { id: tenant.id },
    data: applyNow
      ? {
        retentionMode: mode,
        retentionDays: days,
        retentionModePending: null,
        retentionDaysPending: null,
        retentionEffectiveAt: null,
      }
      : {
        retentionModePending: mode,
        retentionDaysPending: days,
        retentionEffectiveAt: effectiveAt,
      },
    select: TENANT_PLAN_FIELDS,
  });

  return { tenant: updated, effectiveAt, applied: applyNow ? 'now' : 'scheduled' };
}

// Aprueba una extensión: el plazo solicitado pasa a ser el vigente de inmediato (los datos
// existentes quedan protegidos en la siguiente pasada de la retención) y, si había un cambio de
// plan programado con un plazo menor, se eleva para que la extensión no quede sin efecto.
async function applyExtension(prisma, { tenantId, requestedDays }, { now = Date.now() } = {}) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: TENANT_PLAN_FIELDS });
  if (!tenant) return { found: false };
  const pendingDays = pendingDaysAfterExtension({
    pendingDays: tenant.retentionDaysPending,
    requestedDays,
  });
  const updated = await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      retentionDays: requestedDays,
      ...(pendingDays != null ? { retentionDaysPending: pendingDays } : {}),
    },
    select: TENANT_PLAN_FIELDS,
  });
  return { found: true, tenant: updated, now };
}

module.exports = {
  TENANT_PLAN_FIELDS,
  loadPlanContext,
  buildPlanState,
  syncDuePlans,
  schedulePlanChange,
  applyExtension,
};
