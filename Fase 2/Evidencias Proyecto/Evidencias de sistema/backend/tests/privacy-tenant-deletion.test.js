// Pruebas de la eliminación de organizaciones: deben desaparecer los DOS archivos de cada
// sesión (video y pista de audio) y la organización no puede darse por eliminada si algo queda.
// Datos sintéticos en una carpeta temporal; no se toca uploads/sessions ni ninguna base real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createPrismaStub, TMP, file } = require('./privacy-support');
const { deleteTenantFiles, processTenantDeletion, processPendingTenantDeletions } = require('../lib/tenantDeletion');

// Organizaciones sintéticas:
//   A: sesiones con video+audio, solo video, solo audio y sin archivos
//   B: otra organización (no debe tocarse)
//   C: sesión cuyo archivo de video NO se puede borrar (directorio) → reintento
//   D: organización ya en DELETING (job periódico)
const IDS = {
  a1: 'del-a1',
  a2: 'del-a2',
  a3: 'del-a3',
  a4: 'del-a4',
  b1: 'del-b1',
  c1: 'del-c1',
  d1: 'del-d1',
};

function seed() {
  return {
    tenant: [
      { id: 'tA', name: 'Cliente A', status: 'ACTIVE', createdAt: new Date('2026-01-01') },
      { id: 'tB', name: 'Cliente B', status: 'ACTIVE', createdAt: new Date('2026-01-01') },
      { id: 'tC', name: 'Cliente C', status: 'ACTIVE', createdAt: new Date('2026-01-01') },
      { id: 'tD', name: 'Cliente D', status: 'DELETING', createdAt: new Date('2026-01-01'), deletionRequestedAt: new Date() },
    ],
    user: [
      { id: 'uA', tenantId: 'tA', role: 'VOCERO' },
      { id: 'uB', tenantId: 'tB', role: 'VOCERO' },
      { id: 'uC', tenantId: 'tC', role: 'VOCERO' },
      { id: 'uD', tenantId: 'tD', role: 'VOCERO' },
    ],
    theme: [{ id: 'thA', tenantId: 'tA' }, { id: 'thD', tenantId: 'tD' }],
    session: [
      { id: IDS.a1, tenantId: 'tA', userId: 'uA', themeId: 'thA' },
      { id: IDS.a2, tenantId: 'tA', userId: 'uA', themeId: 'thA' },
      { id: IDS.a3, tenantId: 'tA', userId: 'uA', themeId: 'thA' },
      { id: IDS.a4, tenantId: 'tA', userId: 'uA', themeId: 'thA' },
      { id: IDS.b1, tenantId: 'tB', userId: 'uB', themeId: 'thA' },
      { id: IDS.c1, tenantId: 'tC', userId: 'uC', themeId: 'thA' },
      { id: IDS.d1, tenantId: 'tD', userId: 'uD', themeId: 'thD' },
    ],
    scenarioAssignment: [{ id: 'asA', themeId: 'thA' }, { id: 'asD', themeId: 'thD' }],
    scenarioRubric: [{ id: 'rbA', assignmentId: 'asA' }],
    deletionRequest: [],
    tenantEvent: [],
    transcriptionAudit: [],
    retentionPause: [],
    // La eliminación de una organización borra también sus solicitudes de extensión del plazo
    // (referencian usuarios con Restrict) antes de borrar los usuarios.
    retentionExtensionRequest: [
      { id: 'reA', tenantId: 'tA', requestedById: 'uA', status: 'PENDING' },
      { id: 'reD', tenantId: 'tD', requestedById: 'uD', status: 'PENDING' },
    ],
  };
}

// Archivos reales de las sesiones (solo los que deben existir en cada caso).
function createFiles() {
  file(`${IDS.a1}.webm`);
  file(`${IDS.a1}.audio.webm`);
  file(`${IDS.a2}.webm`);
  file(`${IDS.a3}.audio.webm`);
  // a4: sin archivos
  file(`${IDS.b1}.webm`);
  file(`${IDS.b1}.audio.webm`);
  // c1: el "archivo" es un directorio con contenido → no se puede borrar como archivo
  fs.mkdirSync(path.join(TMP, `${IDS.c1}.webm`), { recursive: true });
  fs.writeFileSync(path.join(TMP, `${IDS.c1}.webm`, 'bloqueo.txt'), 'x');
  file(`${IDS.d1}.webm`);
  file(`${IDS.d1}.audio.webm`);
}

const exists = (name) => fs.existsSync(path.join(TMP, name));

test('eliminación de organización: borra video y audio de las sesiones y tolera los que faltan', async () => {
  createFiles();
  const prisma = createPrismaStub(seed());

  const result = await deleteTenantFiles(prisma, 'tA', { sessionsDir: TMP });

  assert.equal(result.removed, 4, 'debe borrar los 4 archivos existentes de la organización A (2 de a1, 1 de a2 y 1 de a3)');
  assert.deepEqual(result.failures, []);
  assert.equal(result.pending, false);
  assert.equal(exists(`${IDS.a1}.webm`), false, 'video de la sesión con ambos archivos');
  assert.equal(exists(`${IDS.a1}.audio.webm`), false, 'audio de la sesión con ambos archivos');
  assert.equal(exists(`${IDS.a2}.webm`), false, 'sesión que solo tenía video');
  assert.equal(exists(`${IDS.a3}.audio.webm`), false, 'sesión que solo tenía audio');
  assert.equal(exists(`${IDS.a4}.webm`), false, 'sesión sin archivos se procesa sin error');
  // La otra organización conserva sus dos archivos.
  assert.equal(exists(`${IDS.b1}.webm`), true, 'no se borra el video de otra organización');
  assert.equal(exists(`${IDS.b1}.audio.webm`), true, 'no se borra el audio de otra organización');
});

test('eliminación de organización: completa el proceso y verifica antes de borrar los registros', async () => {
  createFiles();
  const prisma = createPrismaStub(seed());

  const result = await processTenantDeletion(prisma, 'tA', { sessionsDir: TMP });

  assert.equal(result.status, 'completed');
  assert.equal(prisma.db.tenant.some((t) => t.id === 'tA'), false, 'la organización ya no existe');
  assert.equal(prisma.db.session.filter((s) => s.tenantId === 'tA').length, 0, 'sus sesiones se eliminaron');
  assert.equal(prisma.db.user.filter((u) => u.tenantId === 'tA').length, 0);
  assert.equal(prisma.db.theme.filter((t) => t.tenantId === 'tA').length, 0);
  assert.equal(prisma.db.scenarioRubric.filter((r) => r.assignmentId === 'asA').length, 0);
  const eventos = prisma.db.tenantEvent.filter((e) => e.tenantId === 'tA' && e.type === 'DELETED');
  assert.equal(eventos.length, 1, 'se registra el cliente perdido una sola vez');
  // Las solicitudes de extensión del plazo referencian usuarios (Restrict): deben borrarse o la
  // eliminación quedaría bloqueada por la clave foránea.
  assert.equal(prisma.db.retentionExtensionRequest.filter((r) => r.tenantId === 'tA').length, 0);
  // Nada de la otra organización se toca.
  assert.equal(prisma.db.tenant.some((t) => t.id === 'tB'), true);
  assert.equal(prisma.db.session.filter((s) => s.tenantId === 'tB').length, 1);
});

test('eliminación de organización: repetir el proceso no genera inconsistencias', async () => {
  createFiles();
  const prisma = createPrismaStub(seed());

  const primera = await processTenantDeletion(prisma, 'tA', { sessionsDir: TMP });
  const segunda = await processTenantDeletion(prisma, 'tA', { sessionsDir: TMP });
  const tercera = await processTenantDeletion(prisma, 'tA', { sessionsDir: TMP });

  assert.equal(primera.status, 'completed');
  assert.equal(segunda.status, 'completed');
  assert.equal(segunda.reason, 'tenant no existe');
  assert.equal(tercera.status, 'completed');
  assert.equal(prisma.db.tenantEvent.filter((e) => e.tenantId === 'tA').length, 1, 'no se duplican eventos');
});

test('eliminación de organización: un archivo que no se puede borrar impide declararla eliminada y el reintento la completa', async () => {
  createFiles();
  const prisma = createPrismaStub(seed());

  // 1) El archivo de video de c1 no se puede borrar (es un directorio con contenido).
  const result = await processTenantDeletion(prisma, 'tC', { sessionsDir: TMP });

  assert.equal(result.status, 'pending', 'no puede declararse completada');
  assert.equal(result.files.pending, true);
  assert.deepEqual(result.files.remaining, [{ sessionId: IDS.c1, files: [`${IDS.c1}.webm`] }]);
  assert.equal(exists(`${IDS.c1}.webm`), true, 'el archivo sigue en disco');
  // Los registros se conservan: sin ellos se perdería el mapeo sesión→archivo para reintentar.
  assert.equal(prisma.db.tenant.some((t) => t.id === 'tC'), true);
  assert.equal(prisma.db.session.filter((s) => s.tenantId === 'tC').length, 1);
  assert.equal(prisma.db.tenantEvent.filter((e) => e.tenantId === 'tC').length, 0);

  // 2) Se libera el bloqueo (emula que el archivo dejó de estar en uso) y el reintento completa.
  fs.rmSync(path.join(TMP, `${IDS.c1}.webm`), { recursive: true, force: true });

  const reintento = await processTenantDeletion(prisma, 'tC', { sessionsDir: TMP });
  assert.equal(reintento.status, 'completed');
  assert.equal(prisma.db.tenant.some((t) => t.id === 'tC'), false);
  assert.equal(prisma.db.session.filter((s) => s.tenantId === 'tC').length, 0);
  assert.equal(prisma.db.tenantEvent.filter((e) => e.tenantId === 'tC' && e.type === 'DELETED').length, 1);

  // 3) Y una tercera ejecución sigue siendo idempotente.
  const tercera = await processTenantDeletion(prisma, 'tC', { sessionsDir: TMP });
  assert.equal(tercera.status, 'completed');
});

test('eliminación de organización: el job periódico procesa las que están en DELETING', async () => {
  createFiles();
  const prisma = createPrismaStub(seed());

  const resumen = await processPendingTenantDeletions(prisma, { sessionsDir: TMP });

  assert.deepEqual(resumen, { total: 1, done: 1, pending: 0 });
  assert.equal(exists(`${IDS.d1}.webm`), false, 'video de la organización en DELETING');
  assert.equal(exists(`${IDS.d1}.audio.webm`), false, 'audio de la organización en DELETING');
  assert.equal(prisma.db.tenant.some((t) => t.id === 'tD'), false);
});
