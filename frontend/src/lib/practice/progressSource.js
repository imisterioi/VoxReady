// Origen de datos del progreso: qué historial consulta cada audiencia.
//
// Regla de seguridad (comprobada en el backend, no aquí): el vocero NUNCA envía `userId`
// —siempre se consulta su propia sesión del token— y el administrador siempre indica el
// vocero de su organización. Si falta el identificador en la vista administrativa se devuelve
// `null` (no se consulta nada) en vez de caer en el historial propio o en el de toda la
// organización.
//
// El historial va PAGINADO en el servidor: se pide un bloque (`limit`, por defecto 20) y la
// página concreta, así no se descarga todo el historial para mostrar 10 filas.
export function progressPath({ audience = 'user', userId = null, page = 1, limit = 20 } = {}) {
  const params = new URLSearchParams();
  if (audience === 'admin') {
    if (!userId) return null;
    params.set('userId', userId);
  }
  const parsedPage = Math.floor(Number(page));
  if (Number.isFinite(parsedPage) && parsedPage > 1) params.set('page', String(parsedPage));
  const parsedLimit = Math.floor(Number(limit));
  if (Number.isFinite(parsedLimit) && parsedLimit > 0) params.set('limit', String(parsedLimit));
  const query = params.toString();
  return query ? `/api/sessions?${query}` : '/api/sessions';
}

// Ventana acotada para las estadísticas del progreso (series, tendencia y recomendaciones).
// No es "todo el historial": es el mismo tope histórico del endpoint y se mantiene acotado.
export function analyticsPath({ audience = 'user', userId = null, limit = 50 } = {}) {
  return progressPath({ audience, userId, page: 1, limit });
}

