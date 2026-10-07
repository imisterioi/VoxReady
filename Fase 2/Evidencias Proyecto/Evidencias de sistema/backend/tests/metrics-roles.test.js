// Prueba de aislamiento por rol de los endpoints de métricas (HTTP real).
//
// Levanta una app Express mínima con las rutas de métricas, crea fixtures de dos
// organizaciones y comprueba:
//   - VOCERO no puede consultar métricas administrativas (403).
//   - ADMIN solo ve su organización e ignora cualquier ?tenantId= del cliente.
//   - MASTER/SYSTEM ve la vista global y puede seleccionar una organización válida.
// Limpia todo lo creado en `finally`.
//
// Uso:  node tests/metrics-roles.test.js
require('dotenv').config();
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { createToken } = require('../auth');
const registerMetricsRoutes = require('../routes/metrics');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass += 1; console.log('  \u2713', msg); }
  else { fail += 1; console.log('  \u2717', msg); }
};

async function createFixtures() {
  const s = Date.now().toString(36);
  const created = { tenants: [], users: [], themes: [], sessions: [] };
  const mkTenant = async (name, status = 'ACTIVE') => {
    const t = await prisma.tenant.create({ data: { name: `[test-${s}] ${name}`, status } });
    created.tenants.push(t.id);
    return t;
  };
  const mkUser = async (name, role, tenantId) => {
    const u = await prisma.user.create({ data: { name, email: `roles-${s}-${name.replace(/\s+/g, '')}@t.test`, role, status: 'ACTIVE', tenantId } });
    created.users.push(u.id);
    return u;
  };
  const mkTheme = async (title, tenantId) => {
    const th = await prisma.theme.create({ data: { title: `[test-${s}] ${title}`, context: 'c', keyMessages: 'k', tenantId } });
    created.themes.push(th.id);
    return th;
  };
  const mkSession = async (userId, themeId, tenantId, ago) => {
    const d = daysAgo(ago);
    const se = await prisma.session.create({ data: { status: 'COMPLETED', score: 70, completedAt: d, createdAt: d, userId, themeId, tenantId } });
    created.sessions.push(se.id);
    return se;
  };

  const tenantA = await mkTenant('Organización Alfa');
  const tenantB = await mkTenant('Organización Beta');
  const themeA = await mkTheme('Tema Alfa', tenantA.id);
  const themeB = await mkTheme('Tema Beta', tenantB.id);
  const adminA = await mkUser('Admin Alfa', 'ADMIN', tenantA.id);
  const voceroA = await mkUser('Vocero Alfa', 'VOCERO', tenantA.id);
  const voceroB = await mkUser('Vocero Beta', 'VOCERO', tenantB.id);
  const master = await mkUser('Maestro', 'MASTER', null);
  const system = await mkUser('Sistema', 'SYSTEM', null);

  await mkSession(voceroA.id, themeA.id, tenantA.id, 1);
  await mkSession(voceroA.id, themeA.id, tenantA.id, 3);
  await mkSession(voceroB.id, themeB.id, tenantB.id, 2);

  return { created, tenantA, tenantB, adminA, voceroA, voceroB, master, system };
}

async function cleanup(created) {
  await prisma.session.deleteMany({ where: { id: { in: created.sessions } } });
  await prisma.theme.deleteMany({ where: { id: { in: created.themes } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  await prisma.tenant.deleteMany({ where: { id: { in: created.tenants } } });
}

async function main() {
  const { once } = require('events');
  const app = express();
  app.use(express.json());
  registerMetricsRoutes(app, prisma);
  const server = app.listen(0);
  await once(server, 'listening');
  const port = server.address().port;
  const get = async (p, token) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };

  const fx = await createFixtures();
  const { created, tenantA, tenantB, adminA, voceroA, voceroB, master, system } = fx;
  const tAdmin = createToken(adminA);
  const tVocero = createToken(voceroA);
  const tMaster = createToken(master);
  const tSystem = createToken(system);

  const namesOf = (list) => (list || []).map((r) => r.name);

  try {
    // ---------------------------------------------------- VOCERO
    console.log('\nVOCERO');
    const v1 = await get('/api/metrics/overview', tVocero);
    ok(v1.status === 403, '1. VOCERO no puede consultar métricas administrativas (403)');
    const v2 = await get('/api/metrics/voceros', tVocero);
    ok(v2.status === 403, '2. VOCERO no puede consultar el ranking de voceros (403)');
    const v3 = await get('/api/metrics/overview');
    ok(v3.status === 401, '3. Sin token no se accede a las métricas (401)');

    // ---------------------------------------------------- ADMIN
    console.log('\nADMIN');
    const a1 = await get('/api/metrics/overview', tAdmin);
    ok(a1.status === 200 && a1.body.scope === 'tenant' && a1.body.tenant?.id === tenantA.id, '4. ADMIN ve su organización (scope tenant)');
    ok(namesOf(a1.body.voceros.top).includes(voceroA.name) && !namesOf(a1.body.voceros.top).includes(voceroB.name), '5. El ranking del ADMIN corresponde solo a su organización');
    ok(a1.body.organizations === null, '6. El ADMIN no recibe la lista de organizaciones');
    // Intento de cambiar de tenant por parámetro: debe ignorarse.
    const a2 = await get(`/api/metrics/overview?tenantId=${tenantB.id}`, tAdmin);
    ok(a2.status === 200 && a2.body.scope === 'tenant' && a2.body.tenant?.id === tenantA.id, '7. ADMIN no puede ver otro tenant con ?tenantId= (se ignora)');
    ok(!namesOf(a2.body.voceros.top).includes(voceroB.name), '8. El ranking del ADMIN sigue siendo el suyo aunque envíe otro tenantId');
    const a3 = await get('/api/metrics/tenants', tAdmin);
    ok(a3.status === 403, '9. ADMIN no accede a los clientes/tenants globales (403)');

    // ----------------------------- MASTER (configurador): SIN dashboard global
    console.log('\nMASTER (configurador)');
    const mm1 = await get('/api/metrics/overview', tMaster);
    ok(mm1.status === 403, '10. MASTER no obtiene el dashboard global (403)');
    const mm2 = await get('/api/metrics/voceros', tMaster);
    ok(mm2.status === 403, '11. MASTER no obtiene rankings de voceros (403)');
    const mm3 = await get('/api/metrics/themes', tMaster);
    ok(mm3.status === 403, '12. MASTER no obtiene la preferencia de temas (403)');
    const mm4 = await get('/api/metrics/tenants', tMaster);
    ok(mm4.status === 403, '13. MASTER no obtiene la lista de clientes/tenants (403)');

    // ------------------------- SYSTEM (Administrador del Sistema): visión global
    console.log('\nSYSTEM (administrador del sistema)');
    const s1 = await get('/api/metrics/overview', tSystem);
    const orgNames = namesOf(s1.body.organizations);
    ok(s1.status === 200 && s1.body.scope === 'global', '14. SYSTEM ve la vista global');
    ok(orgNames.includes(tenantA.name) && orgNames.includes(tenantB.name), '15. SYSTEM recibe la lista de organizaciones (por nombre)');
    ok(s1.body.summary.organizations != null && s1.body.summary.organizationsCreated != null, '16. SYSTEM ve conteos globales de organizaciones');

    const s2 = await get(`/api/metrics/overview?tenantId=${tenantB.id}`, tSystem);
    ok(s2.status === 200 && s2.body.scope === 'tenant' && s2.body.tenant?.id === tenantB.id, '17. SYSTEM puede seleccionar una organización');
    ok(namesOf(s2.body.voceros.top).includes(voceroB.name) && !namesOf(s2.body.voceros.top).includes(voceroA.name), '18. Al seleccionar, solo aparecen voceros de esa organización');

    const s3 = await get('/api/metrics/overview', tSystem);
    ok(s3.body.scope === 'global', '19. SYSTEM puede volver a "Todas las organizaciones"');

    const s4 = await get('/api/metrics/overview?tenantId=no-existe-123', tSystem);
    ok(s4.status === 400, '20. SYSTEM con organización inexistente recibe 400');

    const s5 = await get('/api/metrics/tenants', tSystem);
    ok(s5.status === 200, '21. SYSTEM obtiene las métricas de clientes');
  } finally {
    await new Promise((r) => server.close(r));
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
