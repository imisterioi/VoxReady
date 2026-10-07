// Prueba de integración de las métricas administrativas (lib/metrics.js).
//
// Crea un conjunto aislado de fixtures (tenants, usuarios, temas y sesiones) con
// fechas controladas, ejecuta las funciones de métricas y verifica los 13 casos
// obligatorios. Limpia TODO lo creado en `finally` (no toca datos reales).
//
// Uso:  node tests/metrics.test.js
require('dotenv').config();
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const {
  resolvePeriod,
  scopeFromRequest,
  voceroRankings,
  themePreference,
  tenantMetrics,
} = require('../lib/metrics');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass += 1; console.log('  \u2713', msg); }
  else { fail += 1; console.log('  \u2717', msg); }
};

// --- Fixtures (se recrean por ejecución con un sufijo único) ---------------
async function createFixtures() {
  const s = Date.now().toString(36);
  const created = { tenants: [], users: [], themes: [], sessions: [] };

  const mkTenant = async (data) => {
    const t = await prisma.tenant.create({ data: { name: `[test-${s}] ${data.name}`, status: data.status, createdAt: data.createdAt } });
    created.tenants.push(t.id);
    return t;
  };
  const mkUser = async (data) => {
    const u = await prisma.user.create({ data: { email: `test-${s}-${data.tag}@voxready.test`, name: data.name, role: data.role, status: data.status || 'ACTIVE', tenantId: data.tenantId, anonymizedAt: data.anonymizedAt || null } });
    created.users.push(u.id);
    return u;
  };
  const mkTheme = async (data) => {
    const th = await prisma.theme.create({ data: { title: `[test-${s}] ${data.title}`, context: 'c', keyMessages: 'k', tenantId: data.tenantId ?? null, isGlobal: data.isGlobal || false } });
    created.themes.push(th.id);
    return th;
  };
  const mkSession = async (data) => {
    const se = await prisma.session.create({ data: { status: 'COMPLETED', score: 70, completedAt: data.createdAt, createdAt: data.createdAt, userId: data.userId, themeId: data.themeId, tenantId: data.tenantId } });
    created.sessions.push(se.id);
    return se;
  };

  const tenantA = await mkTenant({ name: 'Cliente A', status: 'ACTIVE', createdAt: daysAgo(200) });
  const tenantB = await mkTenant({ name: 'Cliente B', status: 'ACTIVE', createdAt: daysAgo(200) });
  const tenantSusp = await mkTenant({ name: 'Cliente Suspendido', status: 'SUSPENDED', createdAt: daysAgo(200) });
  const tenantDel = await mkTenant({ name: 'Cliente Eliminando', status: 'DELETING', createdAt: daysAgo(200) });
  const tenantNew = await mkTenant({ name: 'Cliente Nuevo', status: 'ACTIVE', createdAt: daysAgo(1) });
  const tenantOld = await mkTenant({ name: 'Cliente Antiguo', status: 'ACTIVE', createdAt: daysAgo(100) });

  const themeA = await mkTheme({ title: 'Tema A', tenantId: tenantA.id });
  const themeA2 = await mkTheme({ title: 'Tema A2', tenantId: tenantA.id });
  const themeB = await mkTheme({ title: 'Tema B', tenantId: tenantB.id });
  const themeGlobal = await mkTheme({ title: 'Tema Global', tenantId: null, isGlobal: true });

  const vocA1 = await mkUser({ tag: 'a1', name: 'Vocero A1', role: 'VOCERO', tenantId: tenantA.id });
  const vocA2 = await mkUser({ tag: 'a2', name: 'Vocero A2', role: 'VOCERO', tenantId: tenantA.id });
  const vocSusp = await mkUser({ tag: 'susp', name: 'Vocero Suspendido', role: 'VOCERO', status: 'SUSPENDED', tenantId: tenantA.id });
  const vocAnon = await mkUser({ tag: 'anon', name: 'Vocero Anonimizado', role: 'VOCERO', anonymizedAt: new Date(), tenantId: tenantA.id });
  const vocB1 = await mkUser({ tag: 'b1', name: 'Vocero B1', role: 'VOCERO', tenantId: tenantB.id });
  const vocWeek = await mkUser({ tag: 'week', name: 'Vocero Fuera', role: 'VOCERO', tenantId: tenantA.id });
  const adminA = await mkUser({ tag: 'adm', name: 'Admin A', role: 'ADMIN', tenantId: tenantA.id });

  // Sesiones (todas COMPLETED)
  await mkSession({ userId: vocA1.id, themeId: themeA.id, tenantId: tenantA.id, createdAt: daysAgo(1) });
  await mkSession({ userId: vocA1.id, themeId: themeA.id, tenantId: tenantA.id, createdAt: daysAgo(2) });
  await mkSession({ userId: vocSusp.id, themeId: themeA2.id, tenantId: tenantA.id, createdAt: daysAgo(1) });
  await mkSession({ userId: vocAnon.id, themeId: themeA2.id, tenantId: tenantA.id, createdAt: daysAgo(1) });
  await mkSession({ userId: vocB1.id, themeId: themeB.id, tenantId: tenantB.id, createdAt: daysAgo(1) });
  await mkSession({ userId: vocWeek.id, themeId: themeA.id, tenantId: tenantA.id, createdAt: daysAgo(40) }); // fuera del período

  return { created, tenantA, tenantB, tenantSusp, tenantDel, tenantNew, tenantOld, themeA, themeA2, vocA1, vocA2, vocSusp, vocAnon, vocB1, vocWeek, adminA };
}

// Borra TODO lo creado (por orden de dependencias).
async function cleanup(created) {
  await prisma.session.deleteMany({ where: { id: { in: created.sessions } } });
  await prisma.theme.deleteMany({ where: { id: { in: created.themes } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  await prisma.tenant.deleteMany({ where: { id: { in: created.tenants } } });
}

async function main() {
  const period = resolvePeriod({ period: '30' });
  const fx = await createFixtures();
  const {
    created, tenantA, tenantB, tenantSusp, tenantDel, tenantNew, tenantOld,
    themeA, vocA1, vocA2, vocSusp, vocAnon, vocB1, adminA,
  } = fx;
  const inList = (list, id) => list.some((r) => r.id === id);
  const countOf = (list, id) => list.find((r) => r.id === id)?.sessions;

  try {
    // ---------------------------------------------------------- Voceros
    console.log('\nVoceros (rankings de voceros vigentes)');
    const rankA = await voceroRankings(prisma, { tenantId: tenantA.id, from: period.from, to: period.to });
    ok(inList(rankA.top, vocA1.id) && countOf(rankA.top, vocA1.id) === 2, '1. VOCERO ACTIVE con sesiones aparece en "más entrenamiento" (2)');
    ok(inList(rankA.bottom, vocA2.id) && countOf(rankA.bottom, vocA2.id) === 0, '2. VOCERO ACTIVE con 0 sesiones aparece en "menos entrenamiento" (0)');
    ok(!inList(rankA.top, vocSusp.id) && !inList(rankA.bottom, vocSusp.id), '3. VOCERO SUSPENDED no aparece');
    ok(!inList(rankA.top, vocAnon.id) && !inList(rankA.bottom, vocAnon.id), '4. VOCERO anonimizado no aparece');
    ok(!inList(rankA.top, adminA.id) && !inList(rankA.bottom, adminA.id), '5. Usuario no VOCERO no aparece');
    ok(rankA.bottom.some((r) => r.name === 'Vocero Fuera' && r.sessions === 0), '6a. Sesión fuera del período no cuenta (Vocero Fuera = 0)');

    const rankB = await voceroRankings(prisma, { tenantId: tenantB.id, from: period.from, to: period.to });
    ok(inList(rankB.top, vocB1.id) && !inList(rankB.top, vocA1.id) && !inList(rankB.bottom, vocA1.id), '6b. Se respetan los límites del tenant (B no ve voceros de A)');

    // ---------------------------------------------------------- Clientes
    console.log('\nClientes (tenants)');
    const tm = await tenantMetrics(prisma, { from: period.from, to: period.to });
    const curNames = tm.current.map((t) => t.name);
    const createdNames = tm.created.map((t) => t.name);
    ok(curNames.includes(tenantA.name), '7. Tenant ACTIVE aparece como cliente actual');
    ok(!curNames.includes(tenantSusp.name), '8. Tenant SUSPENDED no aparece como cliente actual');
    ok(!curNames.includes(tenantDel.name), '9. Tenant DELETING no aparece como cliente actual');
    ok(createdNames.includes(tenantNew.name), '10. Tenant creado dentro del período aparece en "creados en el período"');
    ok(!createdNames.includes(tenantOld.name), '11. Tenant creado fuera del período no aparece en ese período');
    ok(tm.current.length > 0 && tm.current.every((t) => typeof t.name === 'string' && t.name.length > 0), '12. Se muestra Tenant.name (no solo el id)');

    const scopeAdmin = scopeFromRequest({ apiRole: 'admin', user: { tenantId: tenantA.id } });
    const scopeMaster = scopeFromRequest({ apiRole: 'master', user: { tenantId: null } });
    ok(scopeAdmin.tenantId === tenantA.id && scopeAdmin.apiRole === 'admin', '13a. ADMIN queda acotado a su propio tenant (scope desde el token)');
    ok(scopeMaster.tenantId === null, '13b. MASTER/SYSTEM tiene alcance global (tenantId null)');

    // ---------------------------------------------------------- Temas
    console.log('\nTemas (preferencia, extra)');
    const tp = await themePreference(prisma, { tenantId: tenantA.id, from: period.from, to: period.to });
    ok(tp.preferred.some((t) => t.title === themeA.title), 'Extra 1. El tema más usado aparece en "más usados"');
    ok(tp.preferred.every((t) => typeof t.title === 'string' && t.title.length > 0), 'Extra 2. Se muestra Theme.title (no solo el id)');
  } finally {
    await cleanup(created);
  }
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
