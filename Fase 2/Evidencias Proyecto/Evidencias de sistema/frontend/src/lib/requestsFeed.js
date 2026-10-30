// Sección unificada de solicitudes: junta los dos tipos que gestiona el sistema en UNA sola
// lista ordenada (de la más reciente a la más antigua), sin mezclar organizaciones.
//
// Cada pantalla le pasa solo las solicitudes que le corresponden (el administrador del sistema,
// las de una organización; el administrador del cliente, las de la suya), así que la unificación
// es puramente visual y no cambia ningún permiso ni alcance.
export const REQUEST_KINDS = {
  privacy: { label: 'Privacidad', tone: 'accent' },
  retention: { label: 'Retención', tone: 'warning' },
};

const time = (value) => new Date(value || 0).getTime();

export function buildRequestsFeed({ privacy = [], extensions = [] } = {}) {
  const items = [
    ...(privacy || []).map((request) => ({ kind: 'privacy', createdAt: request.createdAt, request })),
    ...(extensions || []).map((request) => ({ kind: 'retention', createdAt: request.createdAt, request })),
  ];
  // Orden: de la solicitud más reciente a la más antigua (las que no tienen fecha van al final).
  return items.sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

export function filterRequestsFeed(items = [], kind = 'all') {
  if (kind === 'all') return items;
  return items.filter((item) => item.kind === kind);
}

export function countRequestsByKind(items = []) {
  return {
    all: items.length,
    privacy: items.filter((i) => i.kind === 'privacy').length,
    retention: items.filter((i) => i.kind === 'retention').length,
  };
}

// Opciones del filtro interno, con el recuento de cada tipo.
// Si se pasa el diccionario activo, las etiquetas salen traducidas; si no, español.
export function feedFilterOptions(items = [], d = null) {
  const counts = countRequestsByKind(items);
  const t = d?.L?.req;
  return [
    { value: 'all', label: t ? t.filterAll(counts.all) : `Todas · ${counts.all}` },
    { value: 'privacy', label: t ? t.filterPrivacy(counts.privacy) : `Privacidad · ${counts.privacy}` },
    { value: 'retention', label: t ? t.filterRetention(counts.retention) : `Retención · ${counts.retention}` },
  ];
}

// Tipos de solicitud con la etiqueta del idioma activo (si no se pasa diccionario, español).
export function requestKinds(d) {
  const t = d?.L?.req?.kinds;
  if (!t) return REQUEST_KINDS;
  return {
    privacy: { ...REQUEST_KINDS.privacy, label: t.privacy },
    retention: { ...REQUEST_KINDS.retention, label: t.retention },
  };
}
