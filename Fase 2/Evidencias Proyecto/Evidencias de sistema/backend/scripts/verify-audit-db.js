// Verificación real del ciclo de auditoría contra PostgreSQL.
// Crea su PROPIO tenant/usuario/tema/sesión marcados como prueba, comprueba el ciclo
// completo y borra TODO lo que creó (incluso si falla). No toca sesiones existentes.
//
//   cd backend && node scripts/verify-audit-db.js
require('dotenv').config();
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env.local') });

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { auditRowsFor, persistAudit } = require('../lib/transcriptionAudit');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const TAG = `__audit_test_${Date.now()}__`;
const ids = {};

const diagnostics = (status) => [
  {
    index: 0,
    status,
    engine: status === 'ok' ? 'nvidia-canary-1b' : null,
    code: status === 'ok' ? null : 'ALL_ENGINES_FAILED',
    totalMs: 321,
    attempts: [
      { engine: 'nvidia-whisper-large-v3', ok: false, code: 'RIVA_ERROR', ms: 100 },
      { engine: 'nvidia-canary-1b', ok: status === 'ok', code: null, ms: 221 },
    ],
  },
];

async function main() {
  const tenant = await prisma.tenant.create({ data: { name: TAG } });
  ids.tenant = tenant.id;
  const user = await prisma.user.create({ data: { email: `${TAG}@example.invalid`, name: TAG } });
  ids.user = user.id;
  const theme = await prisma.theme.create({ data: { title: TAG, context: 'prueba', keyMessages: 'prueba', tenantId: tenant.id } });
  ids.theme = theme.id;
  const session = await prisma.session.create({ data: { userId: user.id, themeId: theme.id, tenantId: tenant.id } });
  ids.session = session.id;

  const failed = auditRowsFor({ sessionId: session.id, diagnostics: diagnostics('failed'), answers: [''] });
  const ok = auditRowsFor({ sessionId: session.id, diagnostics: diagnostics('ok'), answers: ['respuesta de prueba'] });

  console.log('1) alta failed:', await persistAudit(prisma, failed));
  console.log('2) repetir failed (no duplica):', await persistAudit(prisma, failed));
  let rows = await prisma.transcriptionAudit.findMany({ where: { sessionId: session.id } });
  console.log('   filas tras repetir:', rows.length, '| estado:', rows[0]?.status);

  console.log('3) transición failed->ok:', await persistAudit(prisma, ok));
  rows = await prisma.transcriptionAudit.findMany({ where: { sessionId: session.id } });
  console.log('   estado:', rows[0]?.status, '| motor:', rows[0]?.engine, '| texto:', rows[0]?.transcript, '| ms:', rows[0]?.totalMs);

  const overwrite = [{ ...ok[0], transcript: 'NO DEBE ESCRIBIRSE', engine: 'local-whisper-small' }];
  console.log('4) repetir ok (no sobrescribe):', await persistAudit(prisma, overwrite));
  rows = await prisma.transcriptionAudit.findMany({ where: { sessionId: session.id } });
  console.log('   texto conservado:', rows[0]?.transcript, '| motor:', rows[0]?.engine);
  console.log('   intentos:', JSON.stringify(rows[0]?.attempts));

  await prisma.transcriptionAudit.updateMany({ where: { sessionId: session.id }, data: { transcript: null } });
  rows = await prisma.transcriptionAudit.findMany({ where: { sessionId: session.id } });
  console.log('5) retención (transcript=null):', rows[0]?.transcript === null, '| intentos sin texto:', !JSON.stringify(rows[0]?.attempts).includes('respuesta de prueba'));
}

async function cleanup() {
  try {
    if (ids.session) await prisma.transcriptionAudit.deleteMany({ where: { sessionId: ids.session } });
    if (ids.session) await prisma.session.deleteMany({ where: { id: ids.session } });
    if (ids.theme) await prisma.theme.deleteMany({ where: { id: ids.theme } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    if (ids.tenant) await prisma.tenant.deleteMany({ where: { id: ids.tenant } });
    console.log('limpieza: ok');
  } catch (error) {
    console.error('limpieza incompleta:', error.message);
  }
}

main()
  .catch((error) => console.error('ERROR:', error.message))
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
