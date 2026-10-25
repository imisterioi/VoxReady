// Registro en memoria de las sesiones de entrevista orquestadas.
//
// Una misma práctica reutiliza SIEMPRE la misma instancia (mismas reservas, mismo contexto y
// mismo modelo activo) entre solicitudes. No se comparte nada entre sesiones distintas.
// La limpieza es explícita (dispose) o por `disposeIdle`: nunca se libera una sesión con
// consultas pendientes, para no perder respuestas en curso.
const sessions = new Map();

function getOrCreate(sessionId, build) {
  if (!sessionId) return null; // entrevista genérica de laboratorio: sin estado persistente
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const created = build();
  sessions.set(sessionId, created);
  return created;
}

function get(sessionId) {
  return sessionId ? sessions.get(sessionId) || null : null;
}

function dispose(sessionId) {
  const session = get(sessionId);
  if (!session) return false;
  try {
    session.dispose?.();
  } catch {
    /* la sesión ya estaba cerrada */
  }
  sessions.delete(sessionId);
  return true;
}

function size() {
  return sessions.size;
}

// Libera sesiones inactivas que NO tengan trabajo pendiente. Devuelve cuántas liberó.
function disposeIdle({ maxIdleMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  let freed = 0;
  for (const [id, entry] of sessions) {
    const pending = entry.session?.pendingCount?.() ?? 0;
    const lastUsed = entry.lastUsedAt ?? 0;
    if (pending === 0 && now() - lastUsed > maxIdleMs) {
      dispose(id);
      freed += 1;
    }
  }
  return freed;
}

function touch(sessionId, at = Date.now()) {
  const entry = sessions.get(sessionId);
  if (entry) entry.lastUsedAt = at;
}

module.exports = { getOrCreate, get, dispose, disposeIdle, touch, size };
