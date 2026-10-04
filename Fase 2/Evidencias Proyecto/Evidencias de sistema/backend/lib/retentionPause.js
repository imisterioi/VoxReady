// Pausa del plazo de retención durante suspensiones (persistente en PostgreSQL).
// Se registra la UNIÓN de intervalos en que el usuario estuvo efectivamente suspendido
// (por su propia suspensión y/o la de su tenant), sin solapamientos ni doble conteo.
// El tiempo efectivo de retención de una sesión = (ahora − createdAt) − pausas dentro de ese rango.

// ¿Está el usuario efectivamente suspendido? (él mismo o su tenant)
function isEffectivelyPaused(userStatus, tenantStatus) {
  return userStatus === 'SUSPENDED' || tenantStatus === 'SUSPENDED';
}

// Abre o cierra el intervalo de pausa del usuario para que coincida con su estado efectivo.
// Idempotente: repetir suspensión/reactivación no crea intervalos duplicados ni los altera.
async function syncUserPause(db, userId) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { status: true, tenant: { select: { status: true } } } });
  if (!user) return { changed: false };
  const paused = isEffectivelyPaused(user.status, user.tenant?.status);
  const open = await db.retentionPause.findFirst({ where: { userId, endedAt: null }, select: { id: true } });

  if (paused && !open) {
    await db.retentionPause.create({ data: { userId } });
    return { changed: true, action: 'open' };
  }
  if (!paused && open) {
    await db.retentionPause.update({ where: { id: open.id }, data: { endedAt: new Date() } });
    return { changed: true, action: 'close' };
  }
  return { changed: false };
}

// Reconcilia TODOS los usuarios al arrancar: inicializa/cierra intervalos para que la pausa
// registrada coincida con el estado actual. Sirve de backfill para suspensiones previas a
// esta funcionalidad y sanea cualquier deriva. Idempotente.
async function reconcilePauses(prisma) {
  const users = await prisma.user.findMany({
    select: { id: true, status: true, tenant: { select: { status: true } }, retentionPauses: { where: { endedAt: null }, select: { id: true } } },
  });
  let changed = 0;
  for (const u of users) {
    const paused = isEffectivelyPaused(u.status, u.tenant?.status);
    const open = u.retentionPauses[0];
    if (paused && !open) {
      await prisma.retentionPause.create({ data: { userId: u.id } });
      changed += 1;
    } else if (!paused && open) {
      await prisma.retentionPause.update({ where: { id: open.id }, data: { endedAt: new Date() } });
      changed += 1;
    }
  }
  if (changed) console.log(`[Retención] ${changed} intervalo(s) de pausa reconciliado(s)`);
  return { changed };
}

// Milisegundos de pausa que caen dentro del rango [fromMs, toMs].
function pauseOverlapMs(intervals, fromMs, toMs) {
  let total = 0;
  for (const iv of intervals) {
    const start = new Date(iv.startedAt).getTime();
    const end = iv.endedAt ? new Date(iv.endedAt).getTime() : toMs; // intervalo abierto → hasta ahora
    const s = Math.max(start, fromMs);
    const e = Math.min(end, toMs);
    if (e > s) total += e - s;
  }
  return total;
}

// Tiempo efectivo de retención transcurrido para una sesión (excluye los periodos en pausa).
function effectiveElapsedMs(createdAt, intervals, nowMs) {
  const fromMs = new Date(createdAt).getTime();
  return Math.max(0, nowMs - fromMs - pauseOverlapMs(intervals || [], fromMs, nowMs));
}

module.exports = { isEffectivelyPaused, syncUserPause, reconcilePauses, pauseOverlapMs, effectiveElapsedMs };