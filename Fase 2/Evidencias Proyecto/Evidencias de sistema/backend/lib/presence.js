// Usuarios conectados: se considera conectado a quien hizo una petición autenticada
// en los últimos minutos (el frontend envía además un latido periódico).
// Vive en memoria: es un indicador en vivo, no un historial.

const WINDOW_MS = 5 * 60 * 1000;
const seen = new Map(); // userId → { at, role, tenantId }

function touch(user, now = Date.now()) {
  if (!user?.id) return;
  seen.set(user.id, { at: now, role: user.role, tenantId: user.tenantId || null });
}

function forget(userId) {
  seen.delete(userId);
}

// Conectados ahora, en total y por rol. tenantId (opcional) acota a una organización.
function connected({ tenantId = null, now = Date.now() } = {}) {
  const byRole = { VOCERO: 0, ADMIN: 0, MASTER: 0, SYSTEM: 0 };
  let total = 0;
  for (const [userId, entry] of seen) {
    if (now - entry.at > WINDOW_MS) {
      seen.delete(userId); // limpieza de entradas vencidas
      continue;
    }
    if (tenantId && entry.tenantId !== tenantId) continue;
    total += 1;
    if (entry.role in byRole) byRole[entry.role] += 1;
  }
  return { total, byRole, windowMinutes: WINDOW_MS / 60000 };
}

module.exports = { touch, forget, connected, WINDOW_MS };
