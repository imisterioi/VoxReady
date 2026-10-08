// Pruebas de la configuración de entrevista, el análisis de sensibilidad y las
// métricas nuevas (clientes ganados/perdidos, frecuencia, usuarios conectados,
// estado de procesos).
//
// La parte de métricas crea fixtures aislados en la base de datos y los limpia
// en `finally` (no toca datos reales).
//
// Uso:  node tests/interview.test.js
require('dotenv').config();
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { normalizeInterviewConfig, resolveInterviewConfig, turnPlan } = require('../ai/interviewConfig');
const { buildSystemPrompt } = require('../ai/interviewer');
const { buildSensitivity } = require('../ai/evaluator');
const presence = require('../lib/presence');
const { registerJob, runJob, recordAi, snapshot } = require('../lib/runtimeStatus');
const { clientFlow, averageDaysBetweenTrainings } = require('../lib/metrics');
const { deleteTenantRecords } = require('../lib/tenantDeletion');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass += 1; console.log('  ✓', msg); }
  else { fail += 1; console.log('  ✗', msg); }
};

function configTests() {
  console.log('\nConfiguración de la entrevista');
  const def = resolveInterviewConfig({ interviewConfig: null });
  ok(def.aggressiveness === 'MEDIA' && def.questionCount === 5 && def.followUps === 0 && def.totalTurns === 5, '1. Un escenario sin configuración usa los valores por defecto (5 preguntas, presión media)');

  const dirty = normalizeInterviewConfig({ aggressiveness: 'x', questionCount: 99, followUps: 9, maxAnswerSeconds: 5, interviewerRole: 'a'.repeat(500) });
  ok(dirty.aggressiveness === 'MEDIA' && dirty.followUps === 3 && dirty.maxAnswerSeconds === 15 && dirty.interviewerRole.length === 120, '2. Los valores fuera de rango se acotan');
  ok(dirty.questionCount * (1 + dirty.followUps) <= 30, '3. Preguntas y repreguntas nunca superan los 30 turnos');

  const cfg = normalizeInterviewConfig({ questionCount: 3, followUps: 2 });
  const kinds = [0, 1, 2, 3, 4, 5].map((asked) => turnPlan(cfg, asked).kind).join(',');
  ok(kinds === 'main,followup,followup,main,followup,followup', '4. Cada pregunta principal va seguida de sus repreguntas');
  ok(turnPlan(cfg, 8).done === false && turnPlan(cfg, 9).done === true && turnPlan(cfg, 0).total === 9, '5. La entrevista termina al completar todas las preguntas y repreguntas');

  const custom = resolveInterviewConfig({ interviewConfig: { questionCount: 4, followUps: 1, estimatedMinutes: 20 } });
  const auto = resolveInterviewConfig({ interviewConfig: { questionCount: 4, followUps: 1 } });
  ok(custom.estimatedMinutes === 20 && !custom.estimatedMinutesAuto && auto.estimatedMinutesAuto && auto.estimatedMinutes === 10, '6. El tiempo estimado se respeta si se define y se calcula si no');

  console.log('\nEntrevistador (instrucciones según la agresividad)');
  const theme = { title: 'Accidente', context: 'Murió un trabajador', keyMessages: '["Lamentamos"]', redLines: '["Culpar al trabajador"]' };
  const prompt = (overrides, asked) => {
    const c = normalizeInterviewConfig(overrides);
    return buildSystemPrompt(theme, c, turnPlan(c, asked));
  };
  const low = prompt({ aggressiveness: 'BAJA', followUps: 1 }, 0);
  const extreme = prompt({ aggressiveness: 'EXTREMA', followUps: 1 }, 1);
  ok(low.includes('cordial') && !low.includes('líneas rojas con preguntas') && low.includes('pregunta NUEVA'), '7. Presión baja: tono cordial, no tienta a cruzar líneas rojas');
  ok(extreme.includes('hostil') && extreme.includes('REPREGUNTA') && extreme.includes('peor interpretación'), '8. Presión extrema: la repregunta devuelve la respuesta en su peor interpretación');
  ok(prompt({ interviewerRole: 'un dirigente sindical' }, 0).startsWith('Eres un dirigente sindical'), '9. Se puede definir quién entrevista');

  console.log('\nAnálisis de sensibilidad del video');
  const body = { available: true, faceAvailable: true, analyzedSeconds: 100, facingSeconds: 70, awaySeconds: 30, smileSeconds: 8 };
  const transcript = [{ metrics: { video: { facingSeconds: 40, awaySeconds: 10, smileSeconds: 6 } } }, { metrics: {} }];
  const sens = buildSensitivity(body, transcript, { consistencia: 20, comentario: 'Reíste al hablar del accidente.' });
  ok(sens.facingSeconds === 70 && sens.awaySeconds === 30 && sens.smileSeconds === 8, '10. Informa cuánto miró a la cámara, cuánto a otro lado y cuánto se rió');
  ok(sens.facingPct === 70 && sens.awayPct === 30 && sens.smilePct === 8, '11. Informa los porcentajes sobre el tiempo analizado');
  ok(sens.risa.detectada && sens.risa.consistencia === 20 && sens.porPregunta.length === 1 && sens.porPregunta[0].smileSeconds === 6, '12. Incluye la coherencia de la risa y el detalle por pregunta');
  ok(buildSensitivity({ ...body, smileSeconds: 0.2 }, [], { consistencia: 5 }).risa.detectada === false, '13. Sin risas no se juzga la coherencia');
  ok(buildSensitivity({ ...body, faceAvailable: false }, [], null).risa === null, '14. Sin detección de rostro la risa queda como no medida');
  ok(buildSensitivity({ available: false }, [], null) === null && buildSensitivity({ available: true }, [], null) === null, '15. Sin cámara (o prácticas antiguas) no hay análisis');
}

async function runtimeTests() {
  console.log('\nUsuarios conectados');
  const now = Date.now();
  presence.touch({ id: 'test-u1', role: 'VOCERO', tenantId: 'test-tA' }, now);
  presence.touch({ id: 'test-u2', role: 'ADMIN', tenantId: 'test-tB' }, now);
  presence.touch({ id: 'test-u3', role: 'VOCERO', tenantId: 'test-tA' }, now - 10 * 60 * 1000);
  ok(presence.connected({ tenantId: 'test-tA', now }).total === 1, '16. Solo cuenta a quien tuvo actividad en los últimos minutos, por organización');
  ok(presence.connected({ now }).byRole.ADMIN >= 1, '17. Vista global con desglose por rol');
  presence.forget('test-u1');
  presence.forget('test-u2');
  ok(presence.connected({ tenantId: 'test-tA', now }).total === 0, '18. Al cerrar sesión deja de contarse');

  console.log('\nEstado de procesos críticos');
  registerJob('test-job', { label: 'Job de prueba', everyMs: 60000 });
  const jobOf = () => snapshot().jobs.find((j) => j.name === 'test-job');
  ok(jobOf().state === 'pending', '19. Un job que aún no corre figura como pendiente');
  await runJob('test-job', async () => ({ done: 1 }));
  ok(jobOf().state === 'ok' && jobOf().lastResult.done === 1, '20. Tras ejecutarse bien figura arriba, con su resultado');
  await runJob('test-job', async () => { throw new Error('falló'); }).catch(() => {});
  ok(jobOf().state === 'error' && jobOf().lastError.message === 'falló', '21. Si falla figura abajo, con el motivo');
  recordAi('evaluator', false, { error: 'sin respuesta' });
  ok(snapshot().ai.evaluator.state === 'error', '22. La IA figura abajo si lo último fue un fallo');
  recordAi('evaluator', true, { model: 'm', ms: 10 });
  ok(snapshot().ai.evaluator.state === 'ok', '23. La IA vuelve a figurar arriba al responder');
}

async function metricsTests() {
  console.log('\nClientes ganados y perdidos');
  const s = Date.now().toString(36);
  const created = { tenants: [], users: [], themes: [], sessions: [] };
  const from = daysAgo(30);
  const to = new Date();

  try {
    const before = await clientFlow(prisma, { from, to });

    const mkTenant = async (name, ago) => {
      const t = await prisma.tenant.create({ data: { name: `[test-${s}] ${name}`, createdAt: daysAgo(ago) } });
      created.tenants.push(t.id);
      return t;
    };
    const tNew = await mkTenant('Nuevo', 2); // ganado en el período
    const tGone = await mkTenant('Ganado y perdido', 5); // ganado y perdido en el período
    const tOldGone = await mkTenant('Antiguo perdido', 200); // perdido en el período, ganado antes

    await deleteTenantRecords(prisma, tGone.id);
    await deleteTenantRecords(prisma, tOldGone.id);
    const after = await clientFlow(prisma, { from, to: new Date() }); // las eliminaciones ocurrieron después de `to`

    ok(after.won - before.won === 2, '24. Ganados: creados en el período, incluido el que después se eliminó');
    ok(after.lost - before.lost === 2, '25. Perdidos: organizaciones eliminadas en el período');
    const events = await prisma.tenantEvent.findMany({ where: { tenantId: { in: [tGone.id, tOldGone.id] } } });
    ok(events.length === 2 && events.every((e) => e.type === 'DELETED' && !('name' in e)), '26. El historial conserva solo el hecho, sin datos de la organización');

    console.log('\nCada cuánto se entrenan');
    const user = await prisma.user.create({ data: { name: 'Vocero', email: `freq-${s}@t.test`, role: 'VOCERO', tenantId: tNew.id } });
    created.users.push(user.id);
    const theme = await prisma.theme.create({ data: { title: `[test-${s}] Tema`, context: 'c', keyMessages: 'k', tenantId: tNew.id } });
    created.themes.push(theme.id);
    for (const ago of [9, 5, 1]) {
      const d = daysAgo(ago);
      const se = await prisma.session.create({ data: { status: 'COMPLETED', createdAt: d, completedAt: d, userId: user.id, themeId: theme.id, tenantId: tNew.id } });
      created.sessions.push(se.id);
    }
    ok((await averageDaysBetweenTrainings(prisma, { tenantId: tNew.id, from, to })) === 4, '27. Promedio de días entre entrenamientos del mismo vocero (9, 5 y 1 días atrás → 4)');
    ok((await averageDaysBetweenTrainings(prisma, { tenantId: tNew.id, from: daysAgo(2), to })) === null, '28. Sin dos entrenamientos en el período no hay frecuencia');
  } finally {
    await prisma.session.deleteMany({ where: { id: { in: created.sessions } } });
    await prisma.theme.deleteMany({ where: { id: { in: created.themes } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await prisma.tenantEvent.deleteMany({ where: { tenantId: { in: created.tenants } } });
    await prisma.tenant.deleteMany({ where: { id: { in: created.tenants } } });
  }
}

async function main() {
  configTests();
  await runtimeTests();
  await metricsTests();
}

main()
  .catch((error) => {
    console.error('\nError ejecutando las pruebas:', error);
    fail += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\nResultado: ${pass} aprobadas, ${fail} fallidas.`);
    process.exitCode = fail === 0 ? 0 : 1;
  });
