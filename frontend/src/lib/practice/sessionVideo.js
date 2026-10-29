// URL del vídeo de UNA sesión concreta. No hay respaldo a otra sesión: sin id, null.
// Se usa encodeURIComponent para que el id viaje literal en la ruta.
// `apiUrl` y `token` se reciben explícitamente para poder probar el módulo en Node
// (sin depender de import.meta.env, que solo existe dentro de Vite).
export function sessionVideoUrl(sessionId, { apiUrl, token } = {}) {
  if (!sessionId || !apiUrl) return null;
  return `${apiUrl}/api/sessions/${encodeURIComponent(sessionId)}/video?token=${encodeURIComponent(token || '')}`;
}
