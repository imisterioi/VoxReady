// Eliminación manual de TENANTS: resiliente, idempotente y reintentable.
//
// Estrategia ante la falta de transacción entre PostgreSQL y el filesystem:
//  - ORDEN: primero ARCHIVOS, luego BD. Motivo: mientras el tenant exista en BD podemos
//    seguir localizando sus sesiones/archivos; si borráramos la BD primero, perderíamos
//    el mapeo sesión→archivo y quedarían grabaciones huérfanas para siempre.
//  - Se eliminan los DOS archivos de cada sesión (video `<id>.webm` y pista de audio
//    `<id>.audio.webm`) y se VERIFICA en disco que ya no queden antes de tocar la BD.
//  - La transacción de BD es atómica (todo o nada). Si el borrado de archivos falla, NO se
//    toca la BD: el tenant queda en DELETING y se reintenta (sin datos a medias).
//  - Idempotente: archivo ya borrado → ok; deleteMany → no-op; tenant ya inexistente → completo.
//  - El estado vive en Tenant.status = 'DELETING' (persistente, sobrevive reinicios).
const fs = require('fs');
const path = require('path');
const { removeSessionMedia } = require('./uploadGuard');

const SESSIONS_DIR = path.join(__dirname, '..', 'uploads', 'sessions');

// Archivos que puede tener UNA sesión (los mismos nombres que produce la subida de medios):
//   <id>.webm        grabación de video
//   <id>.audio.webm  pista de audio (evidencia del WPM)
// Se enumeran aquí para poder VERIFICAR en disco, no para borrar a mano: el borrado lo hace
// `removeSessionMedia`, que ya contempla los dos y tolera que falte cualquiera de ellos.
const MEDIA_SUFFIXES = ['.webm', '.audio.webm'];

// Archivos de esa sesión que todavía existen en disco (comprobación real, no de base de datos).
function remainingMedia(sessionId, dir) {
  return MEDIA_SUFFIXES.map((suffix) => path.join(dir, `${sessionId}${suffix}`)).filter((file) => fs.existsSync(file));
}

// 1) Marca el tenant como DELETING (idempotente). Devuelve { found, already }.
async function startTenantDeletion(prisma, tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } });
  if (!tenant) return { found: false, already: true }; // ya no existe
  if (tenant.status === 'DELETING') return { found: true, already: true };
  await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'DELETING', deletionRequestedAt: new Date() } });
  return { found: true, already: false };
}

// 2) Elimina los archivos de CADA sesión del tenant (video y pista de audio).
// Idempotente y reintentable: devuelve { removed, failures, remaining, pending }.
//
// POR QUÉ SE VERIFICA DESPUÉS DE BORRAR
// `removeSessionMedia` hace un borrado best-effort (no propaga errores), así que el retorno no
// sirve como garantía. La garantía se obtiene comprobando, sesión por sesión, qué archivos
// siguen en disco: si alguno permanece, el tenant NO puede darse por eliminado.
// `sessionsDir` es inyectable solo para las pruebas (por defecto, la carpeta real de grabaciones).
async function deleteTenantFiles(prisma, tenantId, { sessionsDir = SESSIONS_DIR } = {}) {
  const sessions = await prisma.session.findMany({ where: { tenantId }, select: { id: true } });
  let removed = 0;
  const failures = [];
  const remaining = [];

  for (const s of sessions) {
    // Borra los dos archivos posibles; si uno no existe, el proceso continúa con normalidad.
    removed += removeSessionMedia(s.id, sessionsDir);

    const still = remainingMedia(s.id, sessionsDir);
    if (still.length) {
      remaining.push({ sessionId: s.id, files: still.map((file) => path.basename(file)) });
      failures.push({ sessionId: s.id, error: 'archivo no eliminado', files: still.map((file) => path.basename(file)) });
    }
  }

  return { removed, failures, remaining, pending: failures.length > 0 };
}

// 3) Elimina TODOS los registros del tenant en una transacción atómica.
// No toca escenarios globales (tenantId=null) ni otros tenants. deleteMany → idempotente.
async function deleteTenantRecords(prisma, tenantId) {
  const themeIds = (await prisma.theme.findMany({ where: { tenantId }, select: { id: true } })).map((t) => t.id);
  const assignmentIds = themeIds.length
    ? (await prisma.scenarioAssignment.findMany({ where: { themeId: { in: themeIds } }, select: { id: true } })).map((a) => a.id)
    : [];

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { createdAt: true } });

  await prisma.$transaction(async (tx) => {
    // Cliente perdido: queda solo el hecho (id y fechas), ningún dato de la organización
    if (tenant) await tx.tenantEvent.create({ data: { tenantId, type: 'DELETED', tenantCreatedAt: tenant.createdAt } });
    if (assignmentIds.length) await tx.scenarioRubric.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
    if (themeIds.length) await tx.scenarioAssignment.deleteMany({ where: { themeId: { in: themeIds } } });
    await tx.deletionRequest.deleteMany({ where: { tenantId } });            // requestedBy es Restrict
    // Las solicitudes de extensión del plazo también referencian usuarios (requestedById es
    // Restrict): hay que borrarlas antes que los usuarios o la eliminación de la organización
    // quedaría bloqueada por la clave foránea.
    await tx.retentionExtensionRequest.deleteMany({ where: { tenantId } });
    await tx.session.deleteMany({ where: { tenantId } });                    // userId/themeId son Restrict
    if (themeIds.length) await tx.theme.deleteMany({ where: { tenantId } }); // solo temas del tenant
    await tx.user.deleteMany({ where: { tenantId } });                       // RetentionPause cae por Cascade
    await tx.tenant.deleteMany({ where: { id: tenantId } });
  });
}

// 4) Verificación final: true si NO queda ningún dato del tenant.
async function verifyTenantDeletion(prisma, tenantId) {
  const [tenant, users, sessions, themes, requests] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }),
    prisma.user.count({ where: { tenantId } }),
    prisma.session.count({ where: { tenantId } }),
    prisma.theme.count({ where: { tenantId } }),
    prisma.deletionRequest.count({ where: { tenantId } }),
  ]);
  return !tenant && users === 0 && sessions === 0 && themes === 0 && requests === 0;
}

// 5) Proceso completo de UN tenant. Idempotente y reintentable.
// Devuelve { status: 'completed' | 'pending', ... }.
// Los registros de la organización SOLO se eliminan cuando ya no queda ningún archivo de sus
// sesiones en disco: así nunca se pierde el mapeo sesión→archivo mientras existan grabaciones.
async function processTenantDeletion(prisma, tenantId, { sessionsDir = SESSIONS_DIR } = {}) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return { status: 'completed', reason: 'tenant no existe' }; // ya eliminado

  const files = await deleteTenantFiles(prisma, tenantId, { sessionsDir });
  if (files.pending) {
    console.warn(
      `[Eliminación] tenant ${tenantId}: quedan ${files.remaining.length} sesión(es) con archivos (${files.failures.length} fallo(s)); se reintentará.`,
    );
    return { status: 'pending', files };
  }

  await deleteTenantRecords(prisma, tenantId);

  const ok = await verifyTenantDeletion(prisma, tenantId);
  if (!ok) {
    console.warn(`[Eliminación] tenant ${tenantId}: verificación final falló; se reintentará.`);
    return { status: 'pending', files, reason: 'verificación fallida' };
  }
  console.log(`[Eliminación] tenant ${tenantId} eliminado por completo (${files.removed} archivo(s)).`);
  return { status: 'completed', files };
}

// 6) Job periódico/de arranque: procesa todos los tenants en DELETING (secuencial).
async function processPendingTenantDeletions(prisma, { sessionsDir = SESSIONS_DIR } = {}) {
  const tenants = await prisma.tenant.findMany({ where: { status: 'DELETING' }, select: { id: true } });
  let done = 0;
  let pending = 0;
  for (const t of tenants) {
    try {
      const r = await processTenantDeletion(prisma, t.id, { sessionsDir });
      if (r.status === 'completed') done += 1; else pending += 1;
    } catch (error) {
      pending += 1;
      console.warn(`[Eliminación] tenant ${t.id} falló:`, error.message);
    }
  }
  return { total: tenants.length, done, pending };
}

module.exports = {
  startTenantDeletion,
  processTenantDeletion,
  processPendingTenantDeletions,
  verifyTenantDeletion,
  deleteTenantFiles,
  deleteTenantRecords,
};
