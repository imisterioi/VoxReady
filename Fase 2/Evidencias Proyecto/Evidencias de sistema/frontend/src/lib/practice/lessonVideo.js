// URL del video de UNA microlección. Se entrega por la ruta protegida del backend
// (`/api/micro-lessons/:id/video`), que exige sesión válida: no hay ruta pública ni enlace externo.
// `apiUrl` y `token` se reciben como parámetros para poder probar el módulo en Node.
export function lessonVideoUrl(lessonId, { apiUrl, token } = {}) {
  if (!lessonId || !apiUrl) return null;
  return `${apiUrl}/api/micro-lessons/${encodeURIComponent(lessonId)}/video?token=${encodeURIComponent(token || '')}`;
}
