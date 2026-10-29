// Vencimientos reales y plan de retención vigente (funciones puras).
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DAY_MS,
  sessionExpiresAt,
  isExpired,
  effectivePlan,
  planState,
  planChangeEffectiveAt,
  pendingDaysAfterExtension,
} = require('./retentionPlan');

const at = (iso) => new Date(iso);
const iso = (date) => new Date(date).toISOString();

test('sin pausas, la sesión vence al cumplirse el plazo', () => {
  const createdAt = at('2026-01-01T00:00:00Z');
  const expires = sessionExpiresAt({ createdAt, days: 30, intervals: [] });
  assert.equal(iso(expires), iso(new Date(createdAt.getTime() + 30 * DAY_MS)));
});

test('una pausa dentro del plazo corre el vencimiento lo que duró la pausa', () => {
  const createdAt = at('2026-01-01T00:00:00Z');
  // Suspensión del 10 al 15 de enero (5 días): el vencimiento se mueve 5 días.
  const intervals = [{ startedAt: at('2026-01-10T00:00:00Z'), endedAt: at('2026-01-15T00:00:00Z') }];
  const expires = sessionExpiresAt({ createdAt, days: 30, intervals });
  assert.equal(iso(expires), iso(new Date(createdAt.getTime() + 35 * DAY_MS)));
});

test('una pausa abierta detiene el reloj: la sesión no vence mientras esté suspendido', () => {
  const createdAt = at('2026-01-01T00:00:00Z');
  const intervals = [{ startedAt: at('2026-01-10T00:00:00Z'), endedAt: null }];
  const now = at('2026-06-01T00:00:00Z').getTime();
  assert.equal(isExpired({ createdAt, days: 30, intervals, now }), false);
});

test('isExpired usa la misma comparación que el proceso automático (tiempo efectivo > plazo)', () => {
  const createdAt = at('2026-01-01T00:00:00Z');
  const justBefore = createdAt.getTime() + 30 * DAY_MS;
  assert.equal(isExpired({ createdAt, days: 30, intervals: [], now: justBefore }), false);
  assert.equal(isExpired({ createdAt, days: 30, intervals: [], now: justBefore + 1 }), true);
});

test('sin cambio programado el plan efectivo es el vigente', () => {
  const plan = effectivePlan({ retentionMode: 'FULL', retentionDays: 90 }, Date.now());
  assert.deepEqual(plan, { mode: 'FULL', days: 90, due: false, pending: null });
});

test('un cambio programado para el futuro NO se aplica todavía', () => {
  const now = at('2026-03-01T00:00:00Z').getTime();
  const plan = effectivePlan(
    {
      retentionMode: 'FULL',
      retentionDays: 90,
      retentionModePending: 'METRICS',
      retentionDaysPending: 30,
      retentionEffectiveAt: at('2026-03-10T00:00:00Z'),
    },
    now,
  );
  assert.equal(plan.mode, 'FULL');
  assert.equal(plan.days, 90);
  assert.equal(plan.due, false);
  assert.equal(plan.pending.mode, 'METRICS');
  assert.equal(plan.pending.days, 30);
});

test('al llegar la fecha, el cambio programado pasa a ser el vigente (y se marca para persistir)', () => {
  const now = at('2026-03-10T00:00:00Z').getTime();
  const plan = effectivePlan(
    {
      retentionMode: 'FULL',
      retentionDays: 90,
      retentionModePending: 'METRICS',
      retentionDaysPending: 30,
      retentionEffectiveAt: at('2026-03-10T00:00:00Z'),
    },
    now,
  );
  assert.equal(plan.mode, 'METRICS');
  assert.equal(plan.days, 30);
  assert.equal(plan.due, true);
  assert.equal(plan.pending, null);
});


test('el fin del periodo es el vencimiento de la sesión más reciente', () => {
  const now = at('2026-01-15T00:00:00Z').getTime();
  const sessions = [
    { id: 's1', userId: 'u1', createdAt: at('2026-01-01T00:00:00Z') },
    { id: 's2', userId: 'u1', createdAt: at('2026-01-20T00:00:00Z') },
  ];
  const state = planState({ tenant: { retentionDays: 30 }, sessions, now });
  assert.equal(iso(state.periodEndsAt), iso(new Date(sessions[1].createdAt.getTime() + 30 * DAY_MS)));
  // La próxima eliminación es el vencimiento de la más antigua que aún no vence.
  assert.equal(iso(state.nextPurgeAt), iso(new Date(sessions[0].createdAt.getTime() + 30 * DAY_MS)));
  assert.equal(state.expiredSessions, 0);
  assert.equal(state.sessions, 2);
});

test('las sesiones ya vencidas no cuentan como próxima eliminación', () => {
  const now = at('2026-03-01T00:00:00Z').getTime();
  const sessions = [
    { id: 'vieja', userId: 'u1', createdAt: at('2026-01-01T00:00:00Z') }, // vencida
    { id: 'nueva', userId: 'u1', createdAt: at('2026-02-25T00:00:00Z') }, // vigente
  ];
  const state = planState({ tenant: { retentionDays: 30 }, sessions, now });
  assert.equal(state.expiredSessions, 1);
  assert.equal(iso(state.nextPurgeAt), iso(new Date(sessions[1].createdAt.getTime() + 30 * DAY_MS)));
});

test('sin sesiones no hay periodo: el cambio se puede aplicar de inmediato', () => {
  const now = at('2026-03-01T00:00:00Z').getTime();
  const state = planState({ tenant: { retentionDays: 90 }, sessions: [], now });
  assert.equal(state.periodEndsAt, null);
  assert.equal(state.nextPurgeAt, null);
  assert.equal(iso(planChangeEffectiveAt({ tenant: { retentionDays: 90 }, sessions: [], now })), iso(new Date(now)));
});

test('la fecha efectiva es el fin del periodo y nunca queda en el pasado', () => {
  const now = at('2026-03-01T00:00:00Z').getTime();
  const sessions = [{ id: 's1', userId: 'u1', createdAt: at('2026-02-25T00:00:00Z') }];
  const effective = planChangeEffectiveAt({ tenant: { retentionDays: 30 }, sessions, now });
  assert.equal(iso(effective), iso(new Date(sessions[0].createdAt.getTime() + 30 * DAY_MS)));

  // Periodo ya terminado (todas las sesiones vencidas): se aplica ahora.
  const vencidas = [{ id: 's1', userId: 'u1', createdAt: at('2025-01-01T00:00:00Z') }];
  assert.equal(iso(planChangeEffectiveAt({ tenant: { retentionDays: 30 }, sessions: vencidas, now })), iso(new Date(now)));
});

test('una extensión nunca deja un cambio programado por debajo del plazo extendido', () => {
  assert.equal(pendingDaysAfterExtension({ pendingDays: 30, requestedDays: 180 }), 180);
  assert.equal(pendingDaysAfterExtension({ pendingDays: 365, requestedDays: 180 }), 365);
  assert.equal(pendingDaysAfterExtension({ pendingDays: null, requestedDays: 180 }), null);
});
