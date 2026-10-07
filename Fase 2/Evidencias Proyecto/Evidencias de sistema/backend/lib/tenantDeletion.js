// Eliminación manual de TENANTS: resiliente, idempotente y reintentable.
//
// Estrategia ante la falta de transacción entre PostgreSQL y el filesystem:
//  - ORDEN: primero ARCHIVOS, luego BD. Motivo: mientras el tenant exista en BD podemos
//    seguir localizando sus sesiones/archivos; si borráramos la BD primero, perderíamos
//    el mapeo sesión→archivo y quedarían .webm huérfanos para siempre.
//  - La transacción de BD es atómica (todo o nada). Si el borrado de archivos falla, NO se
//    toca la BD: el tenant queda en DELETING y se reintenta (sin datos a medias).
//  - Idempotente: archivo ya borrado → ok; deleteMany → no-op; tenant ya inexistente → completo.
//  - El estado vive en Tenant.status = 'DELETING' (persistente, sobrevive reinicios).
const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = path.join(__dirname, '..', 'uploads', 'sessions');
const videoPath = (id) => path.join(SESSIONS_DIR, `${id}.webm`);

// 1) Marca el tenant como DELETING (idempotente). Devuelve { found, already }.
async function startTenantDeletion(prisma, tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } });
  if (!tenant) return { found: false, already: true }; // ya no existe
  if (tenant.status === 'DELETING') return { found: true, already: true };
  await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'DELETING', deletionRequestedAt: new Date() } });
  return { found: true, already: false };
}

// 2) Intenta eliminar los archivos .webm del tenant (identificados por sus sesiones en BD).
// Idempotente y con reintentos: devuelve { removed, failures, pending }.
async function deleteTenantFiles(prisma, tenantId) {
  const sessions = await prisma.session.findMany({ where: { tenantId }, select: { id: true } });
  let removed = 0;
  const failures = [];
  for (const s of sessions) {
    const file = videoPath(s.id);
    try {
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
        removed += 1;
      }
    } catch (error) {
      failures.push({ sessionId: s.id, error: error.message });
    }
  }
  // Pendiente si hubo fallos o si todavía queda algún archivo del tenant en disco.
  const stillExists = sessions.some((s) => fs.existsSync(videoPath(s.id)));
  return { removed, failures, pending: failures.length > 0 || stillExists };
}

// 3) Elimina TODOS los registros del tenant en una transacción atómica.
// No toca escenarios globales (tenantId=null) ni otros tenants. deleteMany → idempotente.
async function deleteTenantRecords(prisma, tenantId) {
  const themeIds = (await prisma.theme.findMany({ where: { tenantId }, select: { id: true } })).map((t) => t.id);
  const assignmentIds = themeIds.length
    ? (await prisma.scenarioAssignment.findMany({ where: { themeId: { in: themeIds } }, select: { id: true } })).map((a) => a.id)
    : [];

  await prisma.$transaction(async (tx) => {
    if (assignmentIds.length) await tx.scenarioRubric.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
    if (themeIds.length) await tx.scenarioAssignment.deleteMany({ where: { themeId: { in: themeIds } } });
    await tx.deletionRequest.deleteMany({ where: { tenantId } });            // requestedBy es Restrict
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
async function processTenantDeletion(prisma, tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return { status: 'completed', reason: 'tenant no existe' }; // ya eliminado

  const files = await deleteTenantFiles(prisma, tenantId);
  if (files.pending) {
    console.warn(`[Eliminación] tenant ${tenantId}: quedan archivos pendientes (${files.failures.length} fallo(s)); se reintentará.`);
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
async function processPendingTenantDeletions(prisma) {
  const tenants = await prisma.tenant.findMany({ where: { status: 'DELETING' }, select: { id: true } });
  let done = 0;
  let pending = 0;
  for (const t of tenants) {
    try {
      const r = await processTenantDeletion(prisma, t.id);
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
