// Latido de la interfaz: cada pocos segundos el layout busca novedades (notificaciones e informes
// listos). Cuando encuentra algo nuevo pide a las pantallas abiertas que recarguen sus datos.
//
// `useApiData` escucha este evento y recarga en silencio (sin mostrar «cargando»), así la
// información en pantalla se actualiza sola sin recargar el navegador.

export const HEARTBEAT_MS = 5000;
export const REFRESH_EVENT = 'voxready:refresh';

export function requestRefresh() {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(REFRESH_EVENT));
  }
}

// Claves de las notificaciones no leídas que no estaban en la consulta anterior. En la primera
// consulta (`known` vacío) no hay «nuevas»: solo se registra lo que ya existía.
export function newUnread(items = [], known = null) {
  const keyOf = (item) => `${item.sessionId}:${item.sentAt || ''}`;
  const unread = (Array.isArray(items) ? items : []).filter((item) => item.unread);
  const keys = new Set(unread.map(keyOf));
  if (!known) return { fresh: [], keys };
  return { fresh: unread.filter((item) => !known.has(keyOf(item))), keys };
}
