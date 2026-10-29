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
export function feedFilterOptions(items = []) {
  const counts = countRequestsByKind(items);
  return [
    { value: 'all', label: `Todas · ${counts.all}` },
    { value: 'privacy', label: `Privacidad · ${counts.privacy}` },
    { value: 'retention', label: `Retención · ${counts.retention}` },
  ];
}
